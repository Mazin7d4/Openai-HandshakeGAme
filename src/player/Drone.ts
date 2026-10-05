import {
  Color3,
  CreateBox,
  HavokPlugin,
  PhysicsActivationControl,
  PhysicsAggregate,
  PhysicsPrestepType,
  PhysicsShapeType,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import type { CameraSubject } from '../camera/CameraSubject.ts';
import type { FlightAxes } from '../input/FlightAxes.ts';
import type { PlanarBasis } from './FlightController.ts';
import { FlightController } from './FlightController.ts';
import { DroneVisual, type DronePalette } from './DroneVisual.ts';
import {
  createPlayerSnapshot,
  type BoostState,
  type MovementState,
  type PlayerSnapshot,
} from './PlayerState.ts';
import { FLIGHT_TUNING } from './FlightTuning.ts';

export interface DroneOptions {
  id?: string;
  spawn: Vector3;
  palette?: DronePalette;
}

export const DRONE_PALETTES: Record<'coral' | 'mint', DronePalette> = {
  coral: { body: new Color3(0.97, 0.47, 0.3), glow: new Color3(1, 0.62, 0.25) },
  mint: { body: new Color3(0.36, 0.82, 0.74), glow: new Color3(0.4, 1, 0.85) },
};

/**
 * Local drone pawn. The physics body stays upright. Banking is visual only,
 * so the collider does not dig into the floor when the craft tilts.
 *
 * Frame order: steer() for every drone, then any constraints (tether),
 * then commit() for every drone, then scene.render(), then postPhysics().
 */
export class Drone implements CameraSubject {
  readonly id: string;
  readonly root: Mesh;

  private movement: MovementState = 'idle';

  private readonly visual: DroneVisual;
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

    this.root = CreateBox(`${this.id}-collider`, { width: 1.3, height: 0.72, depth: 1.15 }, scene);
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

    this.visual = new DroneVisual(scene, this.root, options.palette ?? DRONE_PALETTES.coral);
  }

  /** Steered velocity for this frame. Constraints may read and nudge it before commit(). */
  get velocity(): Vector3 {
    return this.flight.velocity;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  getFocusPosition(target: Vector3): Vector3 {
    return target.copyFrom(this.root.position);
  }

  /** Integrate input into the steered velocity and bank pose. */
  steer(dt: number, input: FlightAxes, basis: PlanarBasis): void {
    const pose = this.flight.step(input, basis, dt);
    this.inputBoost = input.boost;
    const node = this.visual.root;
    node.rotation.x = pose.bankPitch;
    node.rotation.y = pose.yaw;
    node.rotation.z = pose.bankRoll;
  }

  /** Nudge the steered velocity (tether pull, knockback, pickups). */
  applyVelocityDelta(delta: Vector3): void {
    this.flight.velocity.addInPlace(delta);
  }

  /** Push the steered velocity into Havok. */
  commit(): void {
    this.lockUpright();
    this.aggregate.body.setLinearVelocity(this.flight.velocity);
  }

  /** Back-compat single call for one drone with no constraints. */
  prePhysics(dt: number, input: FlightAxes, basis: PlanarBasis): void {
    this.steer(dt, input, basis);
    this.commit();
  }

  postPhysics(dt: number): void {
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
    this.visual.update({ velocity: this.resolvedVelocity, boosting: this.inputBoost, dt });
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

  dispose(): void {
    this.visual.dispose();
    this.aggregate.dispose();
    this.root.dispose();
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
}
