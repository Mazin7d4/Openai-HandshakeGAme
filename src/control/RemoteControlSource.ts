import { zeroFlightAxes } from '../input/FlightAxes.ts';
import { zeroInteractionActions } from '../input/InteractionActions.ts';
import { SnapshotInterpolator } from '../network/SnapshotInterpolator.ts';
import type { DroneNetworkState } from '../network/NetworkTypes.ts';
import type { DroneControlFrame, DroneControlSource } from './DroneControlSource.ts';

const VELOCITY_RESPONSE = 12;

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

/** Smooths the latest client-owned network snapshots for presentation. */
export class RemoteControlSource implements DroneControlSource {
  readonly kind = 'remote' as const;

  private readonly actions = zeroFlightAxes();
  private readonly interactions = zeroInteractionActions();
  private readonly interpolator = new SnapshotInterpolator();
  private readonly now: () => number;
  private target: DroneNetworkState | null = null;
  private current: DroneNetworkState | null = null;
  private lastPoseKey = '';
  constructor(now: () => number = () => performance.now()) { this.now = now; }

  push(state: DroneNetworkState): void {
    const next = cloneState(state);
    // Dropped seats are frozen server-side; keep the last pose still for the partner.
    if (!next.connected) {
      next.velocity = { x: 0, y: 0, z: 0 };
      next.boost = 'off';
      next.movement = 'idle';
    }
    this.target = next;
    const receivedAt = this.now();
    // Status fires on every state patch (and on unrelated changes); only a changed pose is a new
    // snapshot. Re-pushing an unchanged pose would stamp it with a later time and stutter (stop-go).
    const p = next.position, v = next.velocity, o = next.orientation;
    const poseKey = `${p.x},${p.y},${p.z},${v.x},${v.y},${v.z},${o.yaw},${o.pitch},${o.roll},${next.connected},${next.captured}`;
    if (poseKey === this.lastPoseKey) {
      if (!this.current) this.current = cloneState(next);
      return;
    }
    this.lastPoseKey = poseKey;
    this.interpolator.push({
      t: receivedAt, pos: next.position, vel: next.velocity,
      yaw: next.orientation.yaw, pitch: next.orientation.pitch, roll: next.orientation.roll,
      connected: next.connected, captured: next.captured,
    }, receivedAt);
    if (!this.current) {
      this.current = cloneState(next);
    }
  }

  sample(dt: number): DroneControlFrame {
    if (!this.target || !this.current) {
      return { actions: this.actions, interactions: this.interactions };
    }

    const target = this.target;
    const current = this.current;
    const pose = this.interpolator.sample(this.now());
    if (pose) {
      current.position = { ...pose.pos };
      current.velocity = { ...pose.vel };
      current.orientation = { pitch: pose.pitch, yaw: pose.yaw, roll: pose.roll };
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
      current.velocity = { x: 0, y: 0, z: 0 };
    }

    return { actions: this.actions, interactions: this.interactions, remoteState: current };
  }

  dispose(): void {
    this.target = null;
    this.current = null;
    this.interpolator.reset();
    this.lastPoseKey = '';
  }
}
