import {
  Color3,
  CreateBox,
  HavokPlugin,
  PhysicsActivationControl,
  PhysicsAggregate,
  PhysicsPrestepType,
  PhysicsShapeType,
  Vector3,
  TransformNode,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import type { CameraSubject } from '../camera/CameraSubject.ts';
import type { FlightAxes } from '../input/FlightAxes.ts';
import type { PlanarBasis } from './FlightController.ts';
import { FlightController } from './FlightController.ts';
import {
  createPlayerSnapshot,
  type BoostState,
  type MovementState,
  type PlayerSnapshot,
} from './PlayerState.ts';
import { applySolidColor } from '../scene/solidMaterial.ts';
import { FLIGHT_TUNING } from './FlightTuning.ts';

export interface DroneOptions {
  id?: string;
  spawn: Vector3;
}

/**
 * Local drone pawn. The physics body stays upright. Banking is visual only,
 * so the collider does not dig into the floor when the craft tilts.
 */
export class Drone implements CameraSubject {
  readonly id: string;
  readonly root: Mesh;

  private movement: MovementState = 'idle';

  private readonly visual: TransformNode;
  private readonly aggregate: PhysicsAggregate;
  private readonly flight = new FlightController();
  private readonly plugin: HavokPlugin;
  private readonly resolvedVelocity = new Vector3();
  private readonly zero = new Vector3();
  private readonly snapshot: PlayerSnapshot;
  private boost: BoostState = 'off';
  private inputBoost = false;

  constructor(scene: Scene, plugin: HavokPlugin, options: DroneOptions) {
    this.plugin = plugin;
    this.id = options.id ?? 'local-player';
    this.snapshot = createPlayerSnapshot(this.id);

    this.root = CreateBox('drone-collider', { width: 1.45, height: 0.38, depth: 1.15 }, scene);
    this.root.position.copyFrom(options.spawn);
    this.root.isVisible = false;
    this.root.isPickable = false;

    this.aggregate = new PhysicsAggregate(
      this.root,
      PhysicsShapeType.BOX,
      { mass: 1.2, friction: 0.08, restitution: 0 },
      scene,
    );
    const body = this.aggregate.body;
    body.setGravityFactor(0);
    body.setLinearDamping(0);
    body.setAngularDamping(30);
    body.setMassProperties({
      mass: 1.2,
      inertia: new Vector3(12, 12, 12),
    });
    body.setLinearVelocity(this.zero);
    body.setAngularVelocity(this.zero);
    plugin.setActivationControl(body, PhysicsActivationControl.ALWAYS_ACTIVE);

    this.visual = new TransformNode('drone-visual', scene);
    this.visual.parent = this.root;
    this.buildVisual(scene);
  }

  getFocusPosition(target: Vector3): Vector3 {
    return target.copyFrom(this.root.position);
  }

  prePhysics(dt: number, input: FlightAxes, basis: PlanarBasis): void {
    const pose = this.flight.step(input, basis, dt);
    this.inputBoost = input.boost;
    this.visual.rotation.x = pose.bankPitch;
    this.visual.rotation.y = pose.yaw;
    this.visual.rotation.z = pose.bankRoll;
    this.lockUpright();
    this.aggregate.body.setLinearVelocity(pose.velocity);
  }

  postPhysics(): void {
    this.aggregate.body.getLinearVelocityToRef(this.resolvedVelocity);
    this.flight.syncVelocity(this.resolvedVelocity);
    const speed = this.resolvedVelocity.length();
    if (speed <= FLIGHT_TUNING.idleSpeed) {
      this.movement = 'idle';
    } else if (this.inputBoost) {
      this.movement = 'boosting';
    } else {
      this.movement = 'cruising';
    }
    this.boost = this.inputBoost ? 'active' : 'off';
  }

  /** Reused object. Copy it before storing it across frames. */
  captureSnapshot(): PlayerSnapshot {
    const position = this.root.position;
    const velocity = this.resolvedVelocity;
    this.snapshot.id = this.id;
    this.snapshot.position.x = position.x;
    this.snapshot.position.y = position.y;
    this.snapshot.position.z = position.z;
    this.snapshot.velocity.x = velocity.x;
    this.snapshot.velocity.y = velocity.y;
    this.snapshot.velocity.z = velocity.z;
    this.snapshot.movement = this.movement;
    this.snapshot.boost = this.boost;
    return this.snapshot;
  }

  private lockUpright(): void {
    const rotation = this.root.rotationQuaternion;
    if (rotation) {
      rotation.set(0, 0, 0, 1);
    }
    const body = this.aggregate.body;
    body.setPrestepType(PhysicsPrestepType.TELEPORT);
    this.plugin.setPhysicsBodyTransformation(body, this.root);
    body.setPrestepType(PhysicsPrestepType.DISABLED);
    body.setAngularVelocity(this.zero);
  }

  private buildVisual(scene: Scene): void {
    const bodyColor = new Color3(0.93, 0.42, 0.24);
    const accent = new Color3(0.16, 0.17, 0.2);
    const noseColor = new Color3(0.96, 0.72, 0.38);

    const fuselage = CreateBox('drone-fuselage', { width: 0.32, height: 0.16, depth: 0.92 }, scene);
    fuselage.parent = this.visual;
    fuselage.position.z = 0.02;
    applySolidColor(fuselage, bodyColor, scene);

    const nose = CreateBox('drone-nose', { width: 0.16, height: 0.1, depth: 0.22 }, scene);
    nose.parent = this.visual;
    nose.position.set(0, 0, 0.54);
    applySolidColor(nose, noseColor, scene);

    const wingL = CreateBox('drone-wing-l', { width: 0.58, height: 0.05, depth: 0.24 }, scene);
    wingL.parent = this.visual;
    wingL.position.set(-0.42, 0, 0.02);
    applySolidColor(wingL, accent, scene);

    const wingR = CreateBox('drone-wing-r', { width: 0.58, height: 0.05, depth: 0.24 }, scene);
    wingR.parent = this.visual;
    wingR.position.set(0.42, 0, 0.02);
    applySolidColor(wingR, accent, scene);

    const tail = CreateBox('drone-tail', { width: 0.08, height: 0.22, depth: 0.16 }, scene);
    tail.parent = this.visual;
    tail.position.set(0, 0.14, -0.34);
    applySolidColor(tail, accent, scene);
  }
}
