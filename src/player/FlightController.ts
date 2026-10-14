import { Vector3 } from '@babylonjs/core';
import type { FlightAxes } from '../input/FlightAxes.ts';
import { FLIGHT_TUNING } from './FlightTuning.ts';
import type { BoostState, MovementState } from './PlayerState.ts';

export interface PlanarBasis {
  forward: Vector3;
  right: Vector3;
}

export interface FlightPose {
  readonly velocity: Vector3;
  bankPitch: number;
  bankRoll: number;
  yaw: number;
  movement: MovementState;
  boost: BoostState;
}

function moveTowards(current: Vector3, target: Vector3, maxDelta: number): void {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dz = target.z - current.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= maxDelta || distance === 0) {
    current.copyFrom(target);
    return;
  }
  const scale = maxDelta / distance;
  current.x += dx * scale;
  current.y += dy * scale;
  current.z += dz * scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function expBlend(current: number, target: number, response: number, dt: number): number {
  const weight = 1 - Math.exp(-response * dt);
  return current + (target - current) * weight;
}

/**
 * Accelerates a velocity toward the stick, then banks from the resulting motion.
 * Physics resolves collisions and writes the clipped velocity back through syncVelocity.
 */
export class FlightController {
  /** Steered velocity. Constraints may add to it between step() and the physics commit. */
  readonly velocity = new Vector3();
  private readonly desired = new Vector3();
  private bankPitch = 0;
  private bankRoll = 0;

  step(input: FlightAxes, basis: PlanarBasis, dt: number): FlightPose {
    const tuning = FLIGHT_TUNING;
    const forward = basis.forward;
    const right = basis.right;
    const boosting = input.boost;
    const speed = tuning.cruiseSpeed * (boosting ? tuning.boostMultiplier : 1);
    const vertical = tuning.verticalSpeed * (boosting ? 1.2 : 1);

    let wishX = right.x * input.strafe + forward.x * input.thrust;
    let wishZ = right.z * input.strafe + forward.z * input.thrust;
    const horizontal = Math.hypot(wishX, wishZ);
    if (horizontal > 1) {
      wishX /= horizontal;
      wishZ /= horizontal;
    }

    this.desired.set(wishX * speed, input.lift * vertical, wishZ * speed);

    const hasInput = input.thrust !== 0 || input.strafe !== 0 || input.lift !== 0;
    // Counter-steering (stick against current travel) bites harder than plain
    // acceleration, so turns and stops feel crisp instead of floaty.
    const against = this.velocity.x * this.desired.x + this.velocity.y * this.desired.y + this.velocity.z * this.desired.z < 0;
    const rate = hasInput || boosting
      ? tuning.acceleration * (against ? tuning.counterSteerBoost : 1)
      : tuning.deceleration;
    moveTowards(this.velocity, this.desired, rate * dt);

    const forwardSpeed = this.velocity.x * forward.x + this.velocity.z * forward.z;
    const rightSpeed = this.velocity.x * right.x + this.velocity.z * right.z;
    const velPitch = clamp(-forwardSpeed / tuning.cruiseSpeed, -1.2, 1.2);
    const velRoll = clamp(-rightSpeed / tuning.cruiseSpeed, -1.2, 1.2);
    const targetPitch = (velPitch * 0.62 + -input.thrust * 0.38) * tuning.maxBankPitch;
    const targetRoll = (velRoll * 0.62 + -input.strafe * 0.38) * tuning.maxBankRoll;
    this.bankPitch = expBlend(this.bankPitch, targetPitch, tuning.bankResponse, dt);
    this.bankRoll = expBlend(this.bankRoll, targetRoll, tuning.bankResponse, dt);

    const moving = this.velocity.length() > tuning.idleSpeed;
    let movement: MovementState = 'idle';
    if (moving && boosting) {
      movement = 'boosting';
    } else if (moving) {
      movement = 'cruising';
    }

    return {
      velocity: this.velocity,
      bankPitch: this.bankPitch,
      bankRoll: this.bankRoll,
      yaw: Math.atan2(forward.x, forward.z),
      movement,
      boost: boosting ? 'active' : 'off',
    };
  }

  /** Replace the steered velocity with the velocity Havok kept after contact. */
  syncVelocity(resolved: Vector3): void {
    this.velocity.copyFrom(resolved);
  }
}
