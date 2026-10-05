import { zeroFlightAxes } from '../input/FlightAxes.ts';
import type { DroneNetworkState } from '../network/NetworkTypes.ts';
import type { DroneControlFrame, DroneControlSource } from './DroneControlSource.ts';

const POSITION_RESPONSE = 14;
const VELOCITY_RESPONSE = 12;
const ROTATION_RESPONSE = 12;
const MAX_EXTRAPOLATION_SECONDS = 0.1;

function damp(current: number, target: number, response: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-response * dt));
}

function dampAngle(current: number, target: number, response: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-response * dt));
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
  private target: DroneNetworkState | null = null;
  private current: DroneNetworkState | null = null;
  private targetReceivedAt = performance.now();

  push(state: DroneNetworkState): void {
    this.target = cloneState(state);
    this.targetReceivedAt = performance.now();
    if (!this.current) {
      this.current = cloneState(state);
    }
  }

  sample(dt: number): DroneControlFrame {
    if (!this.target || !this.current) {
      return { actions: this.actions };
    }

    const target = this.target;
    const current = this.current;
    const age = Math.min(
      (performance.now() - this.targetReceivedAt) / 1000,
      MAX_EXTRAPOLATION_SECONDS,
    );
    current.position.x = damp(
      current.position.x,
      target.position.x + target.velocity.x * age,
      POSITION_RESPONSE,
      dt,
    );
    current.position.y = damp(
      current.position.y,
      target.position.y + target.velocity.y * age,
      POSITION_RESPONSE,
      dt,
    );
    current.position.z = damp(
      current.position.z,
      target.position.z + target.velocity.z * age,
      POSITION_RESPONSE,
      dt,
    );
    current.velocity.x = damp(current.velocity.x, target.velocity.x, VELOCITY_RESPONSE, dt);
    current.velocity.y = damp(current.velocity.y, target.velocity.y, VELOCITY_RESPONSE, dt);
    current.velocity.z = damp(current.velocity.z, target.velocity.z, VELOCITY_RESPONSE, dt);
    current.orientation.pitch = dampAngle(
      current.orientation.pitch,
      target.orientation.pitch,
      ROTATION_RESPONSE,
      dt,
    );
    current.orientation.yaw = dampAngle(
      current.orientation.yaw,
      target.orientation.yaw,
      ROTATION_RESPONSE,
      dt,
    );
    current.orientation.roll = dampAngle(
      current.orientation.roll,
      target.orientation.roll,
      ROTATION_RESPONSE,
      dt,
    );
    current.movement = target.movement;
    current.boost = target.boost;
    current.connected = target.connected;

    return { actions: this.actions, remoteState: current };
  }

  dispose(): void {
    this.target = null;
    this.current = null;
  }
}
