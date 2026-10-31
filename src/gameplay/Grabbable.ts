import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import type { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import { PhysicsActivationControl, PhysicsMotionType, PhysicsPrestepType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate.js';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { DroneRole, GrabbableNetworkState } from '../network/NetworkTypes.ts';
import { reportStabilityIssue } from '../dev/StabilityDiagnostics.ts';
import { COLLISION_GROUP } from '../physics/CollisionGroups.ts';
import { applySolidColor } from '../scene/solidMaterial.ts';
import type { Interactable } from './Interactable.ts';
import { prototypeRecovery } from '../../shared/prototypeSafety.mjs';

const POSITION_RESPONSE = 14;
const ROTATION_RESPONSE = 12;
const HOLD_RESPONSE = 11;
const MAX_HOLD_SPEED = 18;
const MAX_FREE_SPEED = 32;
const RELEASE_COLLISION_GRACE = 0.16;

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
  /** Sits locked in a display cradle (can't be bumped off) until the first grab. */
  cradled?: boolean;
  /** Too heavy for one drone: the carrier crawls unless the partner flies with it. */
  heavy?: boolean;
}

/** A small dynamic body that can switch between local physics and a replicated pose. */
const OUT_OF_WORLD_Y = -3;

export class Grabbable implements Interactable {
  readonly id: string;
  readonly mesh: Mesh;
  readonly label: string;
  readonly grabRadius: number;
  readonly heavy: boolean;
  /** Presentation: whether the partner is currently helping haul a heavy object. */
  helped = false;
  readonly collisionRadius: number;

  private readonly aggregate: PhysicsAggregate;
  private readonly plugin: HavokPlugin;
  private readonly velocity = new Vector3();
  private readonly targetPosition = new Vector3();
  private readonly targetVelocity = new Vector3();
  private readonly targetRotation = new Vector3();
  private readonly controlledVelocity = new Vector3();
  private readonly zero = new Vector3();
  private readonly lastSafePosition = new Vector3();
  private targetReady = false;
  private locallyAuthoritative = true;
  private motionMode: 'dynamic' | 'held' | 'replicated' = 'dynamic';
  private collisionGrace = 0;
  private revision = -1;
  private authority: DroneRole = 'pix';
  private holder: DroneRole | null = null;
  private holderId = '';
  private lastEvent = '';
  private cradled = false;
  private readonly cradlePosition = new Vector3();
  private handoffArc: { from: Vector3; to: Vector3; elapsed: number } | null = null;

  constructor(scene: Scene, plugin: HavokPlugin, spec: GrabbableSpec) {
    this.id = spec.id;
    this.label = spec.label;
    this.grabRadius = spec.grabRadius ?? 3.2;
    this.heavy = spec.heavy ?? false;
    this.plugin = plugin;
    const size = spec.size ?? 1.1;
    const shape = spec.shape ?? 'box';
    this.collisionRadius = shape === 'box' ? size * 0.72 : size * 0.58;
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
    this.aggregate.shape.filterMembershipMask = COLLISION_GROUP.grabbable;
    this.aggregate.shape.filterCollideMask = COLLISION_GROUP.all;
    plugin.setActivationControl(this.aggregate.body, PhysicsActivationControl.ALWAYS_ACTIVE);
    this.lastSafePosition.copyFrom(this.mesh.position);
    this.cradled = spec.cradled ?? false;
    this.cradlePosition.copyFrom(spec.position);
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  /** Re-seat a cradled prop (prototype loot) for a seeded RunLayout. */
  relocateCradle(next: Vector3): void {
    this.cradlePosition.copyFrom(next);
    this.lastSafePosition.copyFrom(next);
    this.mesh.position.copyFrom(next);
    this.targetPosition.copyFrom(next);
    if (this.holder === null) {
      this.aggregate.body.setLinearVelocity(this.zero);
      this.aggregate.body.setAngularVelocity(this.zero);
    }
  }

  /** Release and re-seat loot after a fragile objective shatter. */
  resetToCradle(next: Vector3): void {
    this.holder = null;
    this.holderId = '';
    this.cradled = true;
    this.relocateCradle(next);
    this.setMotionMode('dynamic');
    this.setSafeVelocity(this.zero);
  }

  get heldBy(): DroneRole | null {
    return this.holder;
  }

  get authorityRole(): DroneRole {
    return this.authority;
  }

  get networkRevision(): number {
    return this.revision;
  }

  get speed(): number {
    return this.velocity.length();
  }

  /** Free, unheld and simulated on this client (so a local push is authoritative). */
  get pushable(): boolean {
    return this.motionMode === 'dynamic' && !this.cradled && this.holder === null;
  }

  /** Add a velocity change to a free local body (cord sweeps, bumps). */
  nudge(delta: Vector3): boolean {
    if (!this.pushable) return false;
    this.aggregate.body.getLinearVelocityToRef(this.velocity);
    this.velocity.addInPlace(delta);
    clampMagnitude(this.velocity, MAX_FREE_SPEED * 0.5);
    this.aggregate.body.setLinearVelocity(this.velocity);
    return true;
  }

  distanceTo(point: Vector3): number {
    return Vector3.Distance(this.mesh.position, point);
  }

  grab(role: DroneRole): void {
    this.cradled = false;
    this.holder = role;
    this.authority = role;
    this.locallyAuthoritative = true;
    this.setMotionMode('held');
  }

  release(position: Vector3, velocity: Vector3): void {
    this.holder = null;
    this.mesh.position.copyFrom(position);
    this.lastSafePosition.copyFrom(position);
    this.teleportBody();
    this.collisionGrace = RELEASE_COLLISION_GRACE;
    this.setMotionMode('dynamic');
    this.setSafeVelocity(velocity);
  }

  applyNetworkState(state: GrabbableNetworkState, localRole: DroneRole): void {
    const wasLocal = this.locallyAuthoritative;
    const shouldBeLocal = state.authority === localRole;
    const revisionChanged = state.revision !== this.revision;
    this.authority = state.authority;
    this.holder = state.heldBy;
    this.holderId = state.holderId;
    this.lastEvent = state.lastEvent;
    this.revision = state.revision;
    this.targetPosition.set(state.position.x, state.position.y, state.position.z);
    this.targetVelocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
    this.targetRotation.set(
      state.orientation.pitch,
      state.orientation.yaw,
      state.orientation.roll,
    );
    this.targetReady = true;
    this.locallyAuthoritative = shouldBeLocal;
    if (state.heldBy) this.cradled = false;

    if (this.holder) {
      this.setMotionMode('held');
      return;
    }

    if (shouldBeLocal && (!wasLocal || revisionChanged)) {
      this.mesh.position.copyFrom(this.targetPosition);
      this.mesh.rotationQuaternion = Quaternion.FromEulerAngles(
        this.targetRotation.x,
        this.targetRotation.y,
        this.targetRotation.z,
      );
      this.teleportBody();
      this.lastSafePosition.copyFrom(this.mesh.position);
      this.collisionGrace = revisionChanged ? RELEASE_COLLISION_GRACE : 0;
      this.setMotionMode('dynamic');
      this.setSafeVelocity(this.targetVelocity);
    } else if (shouldBeLocal) {
      this.setMotionMode('dynamic');
    } else {
      this.setMotionMode('replicated');
    }
  }

  /** Presentation-only handoff arc; ownership and the animated physics body already moved. */
  startHandoffArc(from: Vector3, to: Vector3, reducedMotion: boolean): void {
    this.handoffArc = null;
    this.mesh.position.copyFrom(reducedMotion ? to : from);
    if (!reducedMotion) this.handoffArc = { from: from.clone(), to: to.clone(), elapsed: 0 };
    this.teleportBody();
  }

  update(dt: number, holdTarget?: Vector3, holderVelocity?: Vector3): void {
    if (this.holder && holdTarget && holderVelocity) {
      this.updateHeld(dt, holdTarget, holderVelocity);
      return;
    }

    if (this.motionMode === 'dynamic') {
      this.updateDynamic(dt);
      return;
    }

    if (!this.targetReady || this.motionMode !== 'replicated') {
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
    if (this.motionMode === 'held') this.velocity.copyFrom(this.controlledVelocity);
    else this.aggregate.body.getLinearVelocityToRef(this.velocity);
    const euler = (this.mesh.rotationQuaternion ?? Quaternion.Identity()).toEulerAngles();
    return {
      id: this.id,
      position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      orientation: { pitch: euler.x, yaw: euler.y, roll: euler.z },
      heldBy: this.holder,
      holderId: this.holderId,
      lastEvent: this.lastEvent,
      authority: this.authority,
      mode: this.holder ? 'held' : 'free',
      revision: this.revision,
    };
  }

  dispose(): void {
    this.aggregate.dispose();
    this.mesh.dispose();
  }

  private setMotionMode(mode: 'dynamic' | 'held' | 'replicated'): void {
    if (this.motionMode === mode) {
      this.updateCollisionMask();
      return;
    }
    this.motionMode = mode;
    const dynamic = mode === 'dynamic';
    this.aggregate.body.setMotionType(dynamic ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.ANIMATED);
    this.aggregate.body.setPrestepType(dynamic ? PhysicsPrestepType.DISABLED : PhysicsPrestepType.TELEPORT);
    this.aggregate.body.setGravityFactor(dynamic ? 1 : 0);
    if (!dynamic) {
      this.aggregate.body.setLinearVelocity(this.zero);
      this.aggregate.body.setAngularVelocity(this.zero);
    }
    this.updateCollisionMask();
  }

  private updateHeld(dt: number, holdTarget: Vector3, holderVelocity: Vector3): void {
    this.setMotionMode('held');
    if (!isFiniteVector(holdTarget) || !isFiniteVector(holderVelocity)) {
      reportStabilityIssue('physics', `${this.id} received a non-finite carry target or holder velocity.`);
      return;
    }
    const oldX = this.mesh.position.x;
    const oldY = this.mesh.position.y;
    const oldZ = this.mesh.position.z;
    if (this.handoffArc) {
      this.handoffArc.elapsed = Math.min(0.25, this.handoffArc.elapsed + Math.max(dt, 0));
      const progress = this.handoffArc.elapsed / 0.25;
      const eased = 1 - (1 - progress) ** 3;
      this.mesh.position.set(
        this.handoffArc.from.x + (this.handoffArc.to.x - this.handoffArc.from.x) * eased,
        this.handoffArc.from.y + (this.handoffArc.to.y - this.handoffArc.from.y) * eased,
        this.handoffArc.from.z + (this.handoffArc.to.z - this.handoffArc.from.z) * eased,
      );
      if (progress >= 1) this.handoffArc = null;
    } else {
      const weight = 1 - Math.exp(-HOLD_RESPONSE * Math.max(dt, 0));
      this.controlledVelocity.copyFrom(holdTarget).subtractInPlace(this.mesh.position);
      const distance = this.controlledVelocity.length();
      const maxStep = MAX_HOLD_SPEED * Math.max(dt, 1 / 240);
      const step = Math.min(distance * weight, maxStep);
      if (distance > 1e-5) {
        this.mesh.position.addInPlace(this.controlledVelocity.scaleInPlace(step / distance));
      }
    }
    const safeDt = Math.max(dt, 1 / 240);
    this.controlledVelocity.set(
      (this.mesh.position.x - oldX) / safeDt,
      (this.mesh.position.y - oldY) / safeDt,
      (this.mesh.position.z - oldZ) / safeDt,
    );
    clampMagnitude(this.controlledVelocity, MAX_HOLD_SPEED);
    this.lastSafePosition.copyFrom(this.mesh.position);
    this.teleportBody();
  }

  private updateDynamic(dt: number): void {
    if (this.cradled) {
      // Drones bumping the display used to knock the prototype onto the floor before anyone grabbed it.
      this.mesh.position.copyFrom(this.cradlePosition);
      this.mesh.rotationQuaternion = Quaternion.Identity();
      this.teleportBody();
      this.aggregate.body.setLinearVelocity(this.zero);
      this.aggregate.body.setAngularVelocity(this.zero);
      return;
    }
    if (this.id === 'prototype') {
      const recover = prototypeRecovery(this.mesh.position, this.cradlePosition, !!this.mesh.getScene().metadata?.heistAlarm);
      if (recover) {
        this.mesh.position.set(recover.x, recover.y, recover.z);
        this.lastSafePosition.copyFrom(this.mesh.position);
        this.teleportBody();
        this.aggregate.body.setLinearVelocity(this.zero);
        this.aggregate.body.setAngularVelocity(this.zero);
        return;
      }
    }
    this.aggregate.body.getLinearVelocityToRef(this.velocity);
    if (!isFiniteVector(this.mesh.position) || !isFiniteVector(this.velocity)) {
      reportStabilityIssue('physics', `${this.id} produced a non-finite dynamic transform; restoring its last safe pose.`);
      this.mesh.position.copyFrom(this.lastSafePosition);
      this.teleportBody();
      this.aggregate.body.setLinearVelocity(this.zero);
      return;
    }
    // Fast throws at low frame rates can tunnel through the floor slab. Recover to the last in-world pose
    // instead of letting the object fall forever (it used to end up clamped at y=-200 on the server).
    if (this.mesh.position.y < OUT_OF_WORLD_Y) {
      console.warn(`[physics] ${this.id} left the world; restored to its last safe pose.`);
      this.mesh.position.copyFrom(this.lastSafePosition);
      this.mesh.position.y = Math.max(this.mesh.position.y, 1);
      this.teleportBody();
      this.aggregate.body.setLinearVelocity(this.zero);
      return;
    }
    if (this.mesh.position.y > 0.2) this.lastSafePosition.copyFrom(this.mesh.position);
    if (this.velocity.lengthSquared() > MAX_FREE_SPEED * MAX_FREE_SPEED) {
      clampMagnitude(this.velocity, MAX_FREE_SPEED);
      this.aggregate.body.setLinearVelocity(this.velocity);
    }
    if (this.collisionGrace > 0) {
      this.collisionGrace = Math.max(0, this.collisionGrace - dt);
      this.updateCollisionMask();
    }
  }

  private setSafeVelocity(velocity: Vector3): void {
    this.velocity.copyFrom(velocity);
    if (!isFiniteVector(this.velocity)) {
      reportStabilityIssue('physics', `${this.id} release velocity was non-finite; using zero velocity.`);
      this.velocity.setAll(0);
    }
    clampMagnitude(this.velocity, MAX_FREE_SPEED);
    this.aggregate.body.setLinearVelocity(this.velocity);
  }

  private updateCollisionMask(): void {
    this.aggregate.shape.filterCollideMask = this.motionMode === 'dynamic'
      ? (this.collisionGrace > 0 ? COLLISION_GROUP.world : COLLISION_GROUP.all)
      : this.motionMode === 'held'
        ? COLLISION_GROUP.world
        : 0;
  }

  private teleportBody(): void {
    const body = this.aggregate.body;
    const previous = body.getPrestepType();
    body.setPrestepType(PhysicsPrestepType.TELEPORT);
    this.plugin.setPhysicsBodyTransformation(body, this.mesh);
    body.setPrestepType(previous);
  }
}

function isFiniteVector(value: Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function clampMagnitude(value: Vector3, maximum: number): void {
  const lengthSquared = value.lengthSquared();
  if (lengthSquared > maximum * maximum) value.scaleInPlace(maximum / Math.sqrt(lengthSquared));
}
