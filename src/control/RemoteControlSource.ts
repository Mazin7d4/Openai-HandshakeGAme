import { zeroFlightAxes } from '../input/FlightAxes.ts';
import { zeroInteractionActions } from '../input/InteractionActions.ts';
import { SnapshotInterpolator } from '../network/SnapshotInterpolator.ts';
import type { DroneNetworkState } from '../network/NetworkTypes.ts';
import type { DroneControlFrame, DroneControlSource } from './DroneControlSource.ts';

const VELOCITY_RESPONSE = 12;
const ZERO_VELOCITY = { x: 0, y: 0, z: 0 };

function damp(current: number, target: number, response: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-response * dt));
}

function cloneState(state: DroneNetworkState): DroneNetworkState {
  return {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
    orientation: { ...state.orientation },
  };
}

/** Copy into owned storage; schema patches and callers may reuse their input objects. */
function updateState(target: DroneNetworkState, state: DroneNetworkState): void {
  const { position, velocity, orientation } = target;
  Object.assign(position, state.position);
  Object.assign(velocity, state.connected ? state.velocity : ZERO_VELOCITY);
  Object.assign(orientation, state.orientation);
  Object.assign(target, state);
  target.position = position; target.velocity = velocity; target.orientation = orientation;
  if (!state.connected) { target.boost = 'off'; target.movement = 'idle'; }
}

function samePose(a: DroneNetworkState, b: DroneNetworkState): boolean {
  const av = a.connected ? a.velocity : ZERO_VELOCITY;
  return a.connected === b.connected && a.captured === b.captured
    && a.position.x === b.position.x && a.position.y === b.position.y && a.position.z === b.position.z
    && av.x === b.velocity.x && av.y === b.velocity.y && av.z === b.velocity.z
    && a.orientation.yaw === b.orientation.yaw && a.orientation.pitch === b.orientation.pitch && a.orientation.roll === b.orientation.roll;
}

/** Smooths the latest client-owned network snapshots for presentation. */
export class RemoteControlSource implements DroneControlSource {
  readonly kind = 'remote' as const;

  private readonly actions = zeroFlightAxes();
  private readonly interactions = zeroInteractionActions();
  private readonly interpolator = new SnapshotInterpolator();
  private readonly now: () => number;
  private target: DroneNetworkState | null = null;
  private current: DroneNetworkState | null = null;
  private frame: DroneControlFrame = { actions: this.actions, interactions: this.interactions };
  constructor(now: () => number = () => performance.now()) { this.now = now; }

  push(state: DroneNetworkState): void {
    // Unrelated schema patches must update status without restamping the pose.
    const changed = !this.target || !samePose(state, this.target);
    if (!this.target) this.target = cloneState(state);
    updateState(this.target, state);
    const next = this.target;
    if (!changed) return;
    const receivedAt = this.now();
    this.interpolator.push({
      t: receivedAt, pos: next.position, vel: next.velocity,
      yaw: next.orientation.yaw, pitch: next.orientation.pitch, roll: next.orientation.roll,
      connected: next.connected, captured: next.captured,
    }, receivedAt);
    if (!this.current) {
      this.current = cloneState(next);
      this.frame = { actions: this.actions, interactions: this.interactions, remoteState: this.current };
    }
  }

  sample(dt: number): DroneControlFrame {
    if (!this.target || !this.current) {
      return this.frame;
    }

    const target = this.target;
    const current = this.current;
    const pose = this.interpolator.sample(this.now());
    if (pose) {
      Object.assign(current.position, pose.pos);
      Object.assign(current.velocity, pose.vel);
      current.orientation.pitch = pose.pitch; current.orientation.yaw = pose.yaw; current.orientation.roll = pose.roll;
    }
    current.movement = target.movement;
    current.boost = target.boost;
    current.connected = target.connected;
    current.selfPowered = target.selfPowered;
    current.tetherPull = damp(current.tetherPull, target.tetherPull, VELOCITY_RESPONSE, dt);
    current.captured = target.captured === true;
    current.capturedBy = target.capturedBy ?? -1;
    current.struggles = target.struggles ?? 0;
    current.carryFor = target.carryFor ?? 0;
    current.rescueProgress = target.rescueProgress ?? 0;
    // While captured, snap to the server hold point (no extrapolation drift).
    if (current.captured) {
      current.position.x = target.position.x;
      current.position.y = target.position.y;
      current.position.z = target.position.z;
      Object.assign(current.velocity, ZERO_VELOCITY);
    }

    return this.frame;
  }

  dispose(): void {
    this.target = null;
    this.current = null;
    this.interpolator.reset();
    this.frame = { actions: this.actions, interactions: this.interactions };
  }
}
