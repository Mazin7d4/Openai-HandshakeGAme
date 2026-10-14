import type { Vector3 } from '@babylonjs/core';
import type { FlightAxes } from '../input/FlightAxes.ts';
import type { InteractionActions } from '../input/InteractionActions.ts';

/**
 * TEST-ONLY autopilot, enabled with `?autotest`. Verifiers set a target per role
 * and wait on position/state instead of sending timed key presses, so the heist
 * checks behave the same at 2 FPS (software WebGL) and 144 FPS.
 * It steers through the normal FlightAxes seam: no teleporting, real collisions.
 */
export interface AutopilotTarget { x: number; y: number; z: number; tolerance: number }
type Role = 'pix' | 'nee';

export class Autopilot {
  static readonly enabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('autotest');

  private readonly targets = new Map<Role, AutopilotTarget>();
  private readonly pending = new Map<Role, Partial<InteractionActions>>();
  private readonly arrived = new Map<Role, boolean>();
  private readonly positions = new Map<Role, { x: number; y: number; z: number }>();

  install(): void {
    (window as unknown as { __autotest: unknown }).__autotest = {
      goto: (role: Role, x: number, y: number, z: number, tolerance = 1) => {
        this.targets.set(role, { x, y, z, tolerance });
        this.arrived.set(role, false);
      },
      stop: (role: Role) => this.targets.delete(role),
      press: (role: Role, action: keyof InteractionActions) => {
        this.pending.set(role, { ...this.pending.get(role), [action]: true });
      },
      arrived: (role: Role) => this.arrived.get(role) === true,
      position: (role: Role) => this.positions.get(role) ?? null,
    };
  }

  /** Returns overriding axes for this role, or null when no target is set. */
  steer(role: Role, at: Vector3, basis: { forward: Vector3; right: Vector3 }): FlightAxes | null {
    this.positions.set(role, { x: at.x, y: at.y, z: at.z });
    const target = this.targets.get(role);
    if (!target) return null;
    const dx = target.x - at.x;
    const dy = target.y - at.y;
    const dz = target.z - at.z;
    const planar = Math.hypot(dx, dz);
    if (planar < target.tolerance && Math.abs(dy) < 0.6) {
      this.arrived.set(role, true);
      this.targets.delete(role);
      return { strafe: 0, thrust: 0, lift: 0, boost: false };
    }
    // Proportional steering in camera space; saturates far away, eases in close so
    // large low-FPS timesteps cannot overshoot narrow vent openings.
    const gain = 0.9;
    const f = basis.forward;
    const r = basis.right;
    const thrust = (f.x * dx + f.z * dz) * gain;
    const strafe = (r.x * dx + r.z * dz) * gain;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return {
      thrust: clamp(thrust),
      strafe: clamp(strafe),
      lift: clamp(dy * 1.2),
      boost: planar > 4,
    };
  }

  /** Merge any queued one-shot actions for this role (consumed once). */
  interactions(role: Role, base: InteractionActions): InteractionActions {
    const queued = this.pending.get(role);
    if (!queued) return base;
    this.pending.delete(role);
    return { ...base, ...queued };
  }
}
