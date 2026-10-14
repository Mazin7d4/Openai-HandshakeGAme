import type { Vector3 } from '@babylonjs/core';
import { zeroFlightAxes, type FlightAxes } from '../input/FlightAxes.ts';
import { zeroInteractionActions } from '../input/InteractionActions.ts';
import type { DroneControlFrame, DroneControlSource } from './DroneControlSource.ts';

/** What the CPU companion is allowed to perceive. Supplied only in single-player. */
export interface BotSensors {
  self(): Vector3 | null;
  leader(): Vector3 | null;
  basis(): { forward: Vector3; right: Vector3 };
  /** True while the companion is locked into a hack overlay / should hold still. */
  busy?(): boolean;
}

/**
 * CPU companion, first pass: a follow-the-leader wingman. It keeps a comfortable
 * slack distance (so the tether stays loose instead of yanking the player), matches
 * the leader's altitude, sprints to catch up when left behind, and idles otherwise.
 * Without sensors (dev-local inactive drone) it stays idle, exactly as before.
 * It steers through the same FlightAxes seam as humans: no teleporting.
 */
export class BotControlSource implements DroneControlSource {
  readonly kind = 'bot' as const;

  private readonly idle: DroneControlFrame = {
    actions: zeroFlightAxes(),
    interactions: zeroInteractionActions(),
  };
  private following = false;

  private readonly sensors?: BotSensors;

  constructor(sensors?: BotSensors) {
    this.sensors = sensors;
  }

  sample(_dt: number): DroneControlFrame {
    const s = this.sensors;
    if (!s || s.busy?.()) return this.idle;
    const self = s.self();
    const leader = s.leader();
    if (!self || !leader) return this.idle;
    return { actions: this.follow(self, leader, s.basis()), interactions: this.idle.interactions };
  }

  private follow(self: Vector3, leader: Vector3, basis: { forward: Vector3; right: Vector3 }): FlightAxes {
    const dx = leader.x - self.x;
    const dz = leader.z - self.z;
    const planar = Math.hypot(dx, dz);
    // Hysteresis: start following beyond 3.2 m, settle once inside 2.2 m.
    if (planar > 3.2) this.following = true;
    else if (planar < 2.2) this.following = false;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const dy = leader.y - self.y;
    const lift = Math.abs(dy) > 0.35 ? clamp(dy * 1.2) : 0;
    if (!this.following) return { thrust: 0, strafe: 0, lift, boost: false };
    // Aim for a point 2 m short of the leader so we never ram into them.
    const k = Math.max(0, planar - 2) / Math.max(planar, 0.001);
    const tx = dx * k;
    const tz = dz * k;
    const gain = 0.8;
    return {
      thrust: clamp((basis.forward.x * tx + basis.forward.z * tz) * gain),
      strafe: clamp((basis.right.x * tx + basis.right.z * tz) * gain),
      lift,
      boost: planar > 7,
    };
  }

  dispose(): void {
    // Stateless apart from hysteresis; nothing to release.
  }
}
