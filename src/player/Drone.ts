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
import type { LoadedModel } from '../assets/AssetLoader.ts';
import type { CameraSubject } from '../camera/CameraSubject.ts';
import type { FlightAxes } from '../input/FlightAxes.ts';
import type { DroneNetworkState } from '../network/NetworkTypes.ts';
import { COLLISION_GROUP } from '../physics/CollisionGroups.ts';
import { reportStabilityIssue } from '../dev/StabilityDiagnostics.ts';
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
  /** Freshly loaded drone.glb instance. The visual takes ownership. */
  model: LoadedModel;
}

/** PIX (P1) is blue/cyan, NEE (P2) is coral/pink. Same model, swapped accents. */
export const DRONE_PALETTES: Record<'pix' | 'nee', DronePalette> = {
  pix: {
    accent: new Color3(0.06, 0.48, 1),
    glow: new Color3(0.24, 0.86, 1),
    eye: new Color3(0.7, 0.94, 1),
  },
  nee: {
    accent: new Color3(1, 0.28, 0.46),
    glow: new Color3(1, 0.38, 0.58),
    eye: new Color3(1, 0.55, 0.45),
  },
};

/** Velocity lost to a contact (m/s) before the mascot reacts with stunned eyes. */
const IMPACT_THRESHOLD = 4;
/** Keep the mascot face readable while still hinting at its travel direction. */
const MAX_PRESENTATION_YAW_OFFSET = 0.38;
const PRESENTATION_YAW_RESPONSE = 8;
const MAX_SAFE_SPEED = 28;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

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
  private readonly remoteVelocity = new Vector3();
  private readonly zero = new Vector3();
  private readonly lastSafePosition = new Vector3();
  private readonly snapshot: PlayerSnapshot;
  private boost: BoostState = 'off';
  private inputBoost = false;
  private visualYaw: number | null = null;
  private focused = false;
  private selfPowered = false;
  private tetherPull = 0;
  private yankCooldown = 0;

  constructor(scene: Scene, plugin: HavokPlugin, options: DroneOptions) {
    this.plugin = plugin;
    this.id = options.id ?? 'local-player';
    this.snapshot = createPlayerSnapshot(this.id);

    this.root = CreateBox(`${this.id}-collider`, { width: 1.3, height: 0.72, depth: 1.15 }, scene);
    this.root.position.copyFrom(options.spawn);
    this.lastSafePosition.copyFrom(options.spawn);
    this.root.isVisible = false;
    this.root.isPickable = false;

    this.aggregate = new PhysicsAggregate(
      this.root,
      PhysicsShapeType.BOX,
      { mass: 1.2, friction: 0.08, restitution: 0 },
      scene,
    );
    this.aggregate.shape.filterMembershipMask = this.id === 'player-1'
      ? COLLISION_GROUP.pix
      : COLLISION_GROUP.nee;
    this.aggregate.shape.filterCollideMask = COLLISION_GROUP.all;
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

    this.visual = new DroneVisual(
      scene,
      this.root,
      options.palette ?? DRONE_PALETTES.pix,
      options.model,
    );
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

  /** Where the cord visually attaches (socket on the back shell). Gameplay still uses the centre. */
  getTetherAnchor(target: Vector3): Vector3 {
    return this.visual.getSocketPosition(target);
  }

  /** Movement leads the aim; at rest the readable visual facing provides it. */
  getThrowDirection(target: Vector3): Vector3 {
    const velocity = this.flight.velocity;
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    if (planarSpeed > 1.5) {
      return target.set(velocity.x / planarSpeed, 0, velocity.z / planarSpeed);
    }
    const yaw = this.visual.root.rotation.y;
    return target.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  }

  /** Integrate input into the steered velocity and bank pose. */
  steer(dt: number, input: FlightAxes, basis: PlanarBasis, faceGameplayCamera = true): void {
    this.selfPowered =
      input.thrust !== 0 || input.strafe !== 0 || input.lift !== 0 || input.boost;
    this.tetherPull = 0;
    const pose = this.flight.step(input, basis, dt);
    this.inputBoost = input.boost;
    const node = this.visual.root;
    node.rotation.x = pose.bankPitch;
    node.rotation.z = pose.bankRoll;

    if (!faceGameplayCamera) {
      // Preserve the original pose while the F2 inspection camera is active.
      this.visualYaw = pose.yaw;
      node.rotation.y = pose.yaw;
      return;
    }

    // The gameplay controller owns velocity; this yaw is presentation only. The
    // face points back toward the cinematic camera, with a small travel-direction
    // bias so strafing still reads without casually showing the drone's back.
    const cameraYaw = Math.atan2(-basis.forward.x, -basis.forward.z);
    const velocity = this.flight.velocity;
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    const moveBlend = clamp(planarSpeed / FLIGHT_TUNING.cruiseSpeed, 0, 1);
    const movementYaw =
      planarSpeed > FLIGHT_TUNING.idleSpeed ? Math.atan2(velocity.x, velocity.z) : cameraYaw;
    const movementOffset = clamp(
      shortestAngle(cameraYaw, movementYaw),
      -MAX_PRESENTATION_YAW_OFFSET,
      MAX_PRESENTATION_YAW_OFFSET,
    );
    const targetYaw = cameraYaw + movementOffset * moveBlend;

    if (this.visualYaw === null) {
      this.visualYaw = targetYaw;
    } else {
      const weight = 1 - Math.exp(-PRESENTATION_YAW_RESPONSE * dt);
      this.visualYaw += shortestAngle(this.visualYaw, targetYaw) * weight;
    }
    node.rotation.y = this.visualYaw;
  }

  /** Nudge the steered velocity (tether pull, knockback, pickups). */
  applyVelocityDelta(delta: Vector3): void {
    this.flight.velocity.addInPlace(delta);
  }

  applyTetherVelocityDelta(delta: Vector3, strength: number): void {
    this.flight.velocity.addInPlace(delta);
    this.tetherPull = Math.max(this.tetherPull, clamp(strength, 0, 1));
    if (this.tetherPull > 0.72 && this.yankCooldown <= 0) {
      this.visual.tetherYank(this.tetherPull);
      this.yankCooldown = 0.75;
    }
  }

  /** Gameplay interactions may request a focused face without affecting control. */
  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  /**
   * Apply an already-smoothed replicated pose. This is presentation/state sync;
   * local movement continues to use steer() and the existing FlightController.
   */
  applyRemoteState(state: DroneNetworkState): void {
    if (!finiteValues(
      state.position.x, state.position.y, state.position.z,
      state.velocity.x, state.velocity.y, state.velocity.z,
      state.orientation.pitch, state.orientation.yaw, state.orientation.roll,
    )) {
      reportStabilityIssue('network-physics', `${this.id} received a non-finite remote transform.`);
      return;
    }
    this.root.position.set(state.position.x, state.position.y, state.position.z);
    this.remoteVelocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
    this.flight.syncVelocity(this.remoteVelocity);
    this.inputBoost = state.boost === 'active';
    this.boost = state.boost;
    this.movement = state.movement;
    this.selfPowered = state.selfPowered;
    this.tetherPull = state.tetherPull;
    const node = this.visual.root;
    node.rotation.set(state.orientation.pitch, state.orientation.yaw, state.orientation.roll);
    this.visualYaw = state.orientation.yaw;
  }

  /** Push the steered velocity into Havok. */
  commit(): void {
    if (!isFiniteVector(this.flight.velocity)) {
      reportStabilityIssue('physics', `${this.id} produced a non-finite commanded velocity; stopping it.`);
      this.flight.velocity.setAll(0);
    }
    clampMagnitude(this.flight.velocity, MAX_SAFE_SPEED);
    this.lockUpright();
    this.aggregate.body.setLinearVelocity(this.flight.velocity);
  }

  /** Back-compat single call for one drone with no constraints. */
  prePhysics(dt: number, input: FlightAxes, basis: PlanarBasis): void {
    this.steer(dt, input, basis);
    this.commit();
  }

  postPhysics(dt: number): void {
    this.yankCooldown = Math.max(0, this.yankCooldown - dt);
    this.aggregate.body.getLinearVelocityToRef(this.resolvedVelocity);
    if (!isFiniteVector(this.root.position) || !isFiniteVector(this.resolvedVelocity)) {
      reportStabilityIssue('physics', `${this.id} produced a non-finite Havok transform; restoring its last safe pose.`);
      this.root.position.copyFrom(this.lastSafePosition);
      this.resolvedVelocity.setAll(0);
      this.flight.velocity.setAll(0);
      this.aggregate.body.setLinearVelocity(this.zero);
      this.lockUpright();
    } else {
      this.lastSafePosition.copyFrom(this.root.position);
      if (this.resolvedVelocity.lengthSquared() > MAX_SAFE_SPEED * MAX_SAFE_SPEED) {
        clampMagnitude(this.resolvedVelocity, MAX_SAFE_SPEED);
        this.aggregate.body.setLinearVelocity(this.resolvedVelocity);
      }
    }
    const impact = Vector3.Distance(this.flight.velocity, this.resolvedVelocity);
    if (impact > IMPACT_THRESHOLD) {
      this.visual.impact(impact);
    }
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
    this.visual.update({
      velocity: this.resolvedVelocity,
      boosting: this.inputBoost,
      focused: this.focused,
      selfPowered: this.selfPowered,
      tetherPull: this.tetherPull,
      dt,
    });
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
    const orientation = this.visual.root.rotation;
    this.snapshot.orientation.pitch = orientation.x;
    this.snapshot.orientation.yaw = orientation.y;
    this.snapshot.orientation.roll = orientation.z;
    this.snapshot.movement = this.movement;
    this.snapshot.boost = this.boost;
    this.snapshot.selfPowered = this.selfPowered;
    this.snapshot.tetherPull = this.tetherPull;
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

function isFiniteVector(value: Vector3): boolean {
  return finiteValues(value.x, value.y, value.z);
}

function finiteValues(...values: number[]): boolean {
  return values.every(Number.isFinite);
}

function clampMagnitude(value: Vector3, maximum: number): void {
  const lengthSquared = value.lengthSquared();
  if (lengthSquared > maximum * maximum) value.scaleInPlace(maximum / Math.sqrt(lengthSquared));
}
