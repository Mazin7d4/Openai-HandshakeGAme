import {
  Color3,
  CreateBox,
  CreateCylinder,
  CreateSphere,
  HavokPlugin,
  PhysicsActivationControl,
  PhysicsAggregate,
  PhysicsMotionType,
  PhysicsPrestepType,
  PhysicsShapeType,
  Quaternion,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import type { DroneRole, GrabbableNetworkState } from '../network/NetworkTypes.ts';
import { applySolidColor } from '../scene/solidMaterial.ts';
import type { Interactable } from './Interactable.ts';

const POSITION_RESPONSE = 14;
const ROTATION_RESPONSE = 12;
const HOLD_SPRING = 8;
const MAX_HOLD_SPEED = 16;

function damp(current: number, target: number, response: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-response * dt));
}

export interface GrabbableSpec {
  id: string;
  label: string;
  position: Vector3;
  color: Color3;
  size?: number;
  shape?: 'box' | 'sphere' | 'cylinder';
  grabRadius?: number;
}

/** A small dynamic body that can switch between local physics and a replicated pose. */
export class Grabbable implements Interactable {
  readonly id: string;
  readonly mesh: Mesh;
  readonly label: string;
  readonly grabRadius: number;

  private readonly aggregate: PhysicsAggregate;
  private readonly plugin: HavokPlugin;
  private readonly velocity = new Vector3();
  private readonly targetPosition = new Vector3();
  private readonly targetVelocity = new Vector3();
  private readonly targetRotation = new Vector3();
  private readonly holdVelocity = new Vector3();
  private targetReady = false;
  private localPhysics = true;
  private revision = -1;
  private authority: DroneRole = 'pix';
  private holder: DroneRole | null = null;

  constructor(scene: Scene, plugin: HavokPlugin, spec: GrabbableSpec) {
    this.id = spec.id;
    this.label = spec.label;
    this.grabRadius = spec.grabRadius ?? 3.2;
    this.plugin = plugin;
    const size = spec.size ?? 1.1;
    const shape = spec.shape ?? 'box';
    this.mesh = shape === 'sphere'
      ? CreateSphere(spec.id, { diameter: size, segments: 16 }, scene)
      : shape === 'cylinder'
        ? CreateCylinder(spec.id, { height: size * 1.15, diameter: size, tessellation: 16 }, scene)
        : CreateBox(spec.id, { size }, scene);
    this.mesh.position.copyFrom(spec.position);
    this.mesh.rotationQuaternion = Quaternion.Identity();
    applySolidColor(this.mesh, spec.color, scene);
    this.aggregate = new PhysicsAggregate(
      this.mesh,
      shape === 'sphere'
        ? PhysicsShapeType.SPHERE
        : shape === 'cylinder'
          ? PhysicsShapeType.CYLINDER
          : PhysicsShapeType.BOX,
      { mass: 0.75, friction: 0.5, restitution: 0.12 },
      scene,
    );
    this.aggregate.body.setLinearDamping(0.12);
    this.aggregate.body.setAngularDamping(0.35);
    plugin.setActivationControl(this.aggregate.body, PhysicsActivationControl.ALWAYS_ACTIVE);
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  get heldBy(): DroneRole | null {
    return this.holder;
  }

  get authorityRole(): DroneRole {
    return this.authority;
  }

  distanceTo(point: Vector3): number {
    return Vector3.Distance(this.mesh.position, point);
  }

  grab(role: DroneRole): void {
    this.holder = role;
    this.authority = role;
    this.setLocalPhysics(true);
    this.aggregate.body.setGravityFactor(0.2);
  }

  release(velocity: Vector3): void {
    this.holder = null;
    this.aggregate.body.setGravityFactor(1);
    this.aggregate.body.setLinearVelocity(velocity);
  }

  applyNetworkState(state: GrabbableNetworkState, localRole: DroneRole): void {
    const wasLocal = this.localPhysics;
    const shouldBeLocal = state.authority === localRole;
    const revisionChanged = state.revision !== this.revision;
    this.authority = state.authority;
    this.holder = state.heldBy;
    this.revision = state.revision;
    this.targetPosition.set(state.position.x, state.position.y, state.position.z);
    this.targetVelocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
    this.targetRotation.set(
      state.orientation.pitch,
      state.orientation.yaw,
      state.orientation.roll,
    );
    this.targetReady = true;
    this.setLocalPhysics(shouldBeLocal);

    if (shouldBeLocal && (!wasLocal || revisionChanged)) {
      this.mesh.position.copyFrom(this.targetPosition);
      this.mesh.rotationQuaternion = Quaternion.FromEulerAngles(
        this.targetRotation.x,
        this.targetRotation.y,
        this.targetRotation.z,
      );
      this.teleportBody();
      this.aggregate.body.setLinearVelocity(this.targetVelocity);
    }
    this.aggregate.body.setGravityFactor(this.holder ? 0.2 : 1);
  }

  update(dt: number, holdTarget?: Vector3, holderVelocity?: Vector3): void {
    if (this.localPhysics) {
      if (this.holder && holdTarget && holderVelocity) {
        this.holdVelocity.copyFrom(holdTarget).subtractInPlace(this.mesh.position).scaleInPlace(HOLD_SPRING);
        this.holdVelocity.addInPlace(holderVelocity);
        const speed = this.holdVelocity.length();
        if (speed > MAX_HOLD_SPEED) {
          this.holdVelocity.scaleInPlace(MAX_HOLD_SPEED / speed);
        }
        this.aggregate.body.setLinearVelocity(this.holdVelocity);
      }
      return;
    }
    if (!this.targetReady) {
      return;
    }
    this.mesh.position.set(
      damp(this.mesh.position.x, this.targetPosition.x, POSITION_RESPONSE, dt),
      damp(this.mesh.position.y, this.targetPosition.y, POSITION_RESPONSE, dt),
      damp(this.mesh.position.z, this.targetPosition.z, POSITION_RESPONSE, dt),
    );
    const rotation = this.mesh.rotationQuaternion ?? Quaternion.Identity();
    const target = Quaternion.FromEulerAngles(
      this.targetRotation.x,
      this.targetRotation.y,
      this.targetRotation.z,
    );
    Quaternion.SlerpToRef(rotation, target, 1 - Math.exp(-ROTATION_RESPONSE * dt), rotation);
    this.mesh.rotationQuaternion = rotation;
    this.teleportBody();
  }

  captureState(): GrabbableNetworkState {
    this.aggregate.body.getLinearVelocityToRef(this.velocity);
    const euler = (this.mesh.rotationQuaternion ?? Quaternion.Identity()).toEulerAngles();
    return {
      id: this.id,
      position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      orientation: { pitch: euler.x, yaw: euler.y, roll: euler.z },
      heldBy: this.holder,
      authority: this.authority,
      mode: this.holder ? 'held' : 'free',
      revision: this.revision,
    };
  }

  dispose(): void {
    this.aggregate.dispose();
    this.mesh.dispose();
  }

  private setLocalPhysics(local: boolean): void {
    if (this.localPhysics === local) {
      return;
    }
    this.localPhysics = local;
    this.aggregate.body.setMotionType(local ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.ANIMATED);
    this.aggregate.body.setPrestepType(local ? PhysicsPrestepType.DISABLED : PhysicsPrestepType.TELEPORT);
  }

  private teleportBody(): void {
    const body = this.aggregate.body;
    const previous = body.getPrestepType();
    body.setPrestepType(PhysicsPrestepType.TELEPORT);
    this.plugin.setPhysicsBodyTransformation(body, this.mesh);
    body.setPrestepType(previous);
  }
}
