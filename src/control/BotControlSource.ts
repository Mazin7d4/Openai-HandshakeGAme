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
  /** Leader is carrying something too heavy to haul alone. */
  leaderHauling?(): boolean;
  leaderVelocity?(): Vector3 | null;
  /** Leader is mid-hack: guard the spot instead of drifting and tugging the cord. */
  leaderHacking?(): boolean;
  /** Leader was shoved / stunned / hanging off a ledge and needs a yank. */
  leaderInTrouble?(): boolean;
}

export type BotState = 'follow' | 'haul' | 'guard' | 'rescue' | 'idle';

/**
 * CPU companion: a small steering state machine (follow / haul / guard / rescue), no LLM.
 * Follow is a follow-the-leader wingman. It keeps a comfortable
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
  private yankCooldown = 0;
  private troubleTime = 0;
  /** Current behaviour, exposed for the HUD/tests. */
  state: BotState = 'idle';

  private readonly sensors?: BotSensors;

  constructor(sensors?: BotSensors) {
    this.sensors = sensors;
  }

  sample(dt: number): DroneControlFrame {
    const s = this.sensors;
    this.yankCooldown = Math.max(0, this.yankCooldown - dt);
    if (!s || s.busy?.()) { this.state = 'idle'; return this.idle; }
    const self = s.self();
    const leader = s.leader();
    if (!self || !leader) { this.state = 'idle'; return this.idle; }
    const basis = s.basis();
    // Rescue: react after a short, human-feeling delay, then yank once (cooldown keeps it from spamming).
    this.troubleTime = s.leaderInTrouble?.() ? this.troubleTime + dt : 0;
    if (this.troubleTime > 0.35 && this.yankCooldown === 0) {
      this.state = 'rescue';
      this.yankCooldown = 2.5;
      return { actions: zeroFlightAxes(), interactions: { ...zeroInteractionActions(), yank: true } };
    }
    if (s.leaderHacking?.()) {
      // Guard: hover in place, only correcting altitude, so the cord stays slack during the hack.
      this.state = 'guard';
      const dy = leader.y - self.y;
      return { actions: { thrust: 0, strafe: 0, lift: Math.abs(dy) > 1.5 ? Math.max(-1, Math.min(1, dy)) * 0.5 : 0, boost: false }, interactions: this.idle.interactions };
    }
    if (s.leaderHauling?.()) {
      this.state = 'haul';
      return { actions: this.haul(self, leader, s.leaderVelocity?.() ?? null, basis), interactions: this.idle.interactions };
    }
    this.state = 'follow';
    return { actions: this.follow(self, leader, basis), interactions: this.idle.interactions };
  }

  /**
   * Haul: the heavy-carry rule needs the partner moving (>1.5 m/s) alongside the carrier.
   * Fly to a point ahead of the carrier along its travel direction (or the camera's forward when
   * the carrier is stuck, i.e. tow), staying within ~4 m so the cord is taut but not yanking.
   */
  private haul(self: Vector3, leader: Vector3, vel: Vector3 | null, basis: { forward: Vector3; right: Vector3 }): FlightAxes {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const speed = vel ? Math.hypot(vel.x, vel.z) : 0;
    const dirX = speed > 0.5 ? vel!.x / speed : basis.forward.x;
    const dirZ = speed > 0.5 ? vel!.z / speed : basis.forward.z;
    const tx = leader.x + dirX * 3.5 - self.x;
    const tz = leader.z + dirZ * 3.5 - self.z;
    // Always keep some motion along the haul direction so the "helping" check passes.
    const mx = tx + dirX * 1.5;
    const mz = tz + dirZ * 1.5;
    const dy = leader.y + 0.6 - self.y;
    return {
      thrust: clamp((basis.forward.x * mx + basis.forward.z * mz) * 0.6),
      strafe: clamp((basis.right.x * mx + basis.right.z * mz) * 0.6),
      lift: Math.abs(dy) > 0.3 ? clamp(dy) : 0,
      boost: Math.hypot(tx, tz) > 6,
    };
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
