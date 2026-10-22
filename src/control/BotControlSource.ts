import { Vector3 } from '@babylonjs/core';
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
  /** Where the companion's own job is (e.g. its console), or null to just follow. */
  objective?(): Vector3 | null;
  /** Work the objective while parked on it; true while working. Called with dt. */
  work?(dt: number): boolean;
  /** Current cord polyline (either end may be first) and strain 0..1. */
  cordPath?(): readonly Vector3[];
  cordStrain?(): number;
  /** Zip along the given points to the leader (ghosted glide). */
  zip?(path: Vector3[]): void;
  zipping?(): boolean;
  /** The leader is held by security: yank them free. */
  leaderCaptured?(): boolean;
}

/** Seconds without closing on the leader (while far) before the companion zips to them. */
export const BOT_STUCK_SECONDS = 2.5;

export type BotState = 'follow' | 'haul' | 'guard' | 'rescue' | 'idle' | 'zip' | 'objective' | 'work';

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
  private stuckTime = 0;
  private stretchTime = 0;
  private checkTimer = 0;
  private lastCheck = Number.POSITIVE_INFINITY;
  /** Recent leader positions: real free space, so a zip can always end somewhere open. */
  private readonly trail: Vector3[] = [];
  private trailTimer = 0;
  /** Total zips so far (tests). */
  zips = 0;
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
    if (s.zipping?.()) { this.state = 'zip'; return this.idle; }
    // Rescue: react after a short, human-feeling delay, then yank once (cooldown keeps it from spamming).
    const captured = s.leaderCaptured?.() ?? false;
    this.troubleTime = s.leaderInTrouble?.() || captured ? this.troubleTime + dt : 0;
    if (captured && this.troubleTime > 0.8 && this.yankCooldown === 0) {
      this.state = 'rescue';
      this.yankCooldown = 1.2;
      return { actions: zeroFlightAxes(), interactions: { ...zeroInteractionActions(), yank: true } };
    }
    if (this.troubleTime > 0.35 && this.yankCooldown === 0) {
      this.state = 'rescue';
      this.yankCooldown = 2.5;
      return { actions: zeroFlightAxes(), interactions: { ...zeroInteractionActions(), yank: true } };
    }
    // Own job (e.g. NEE's console during a paired hack): go there and work it.
    const objective = s.objective?.() ?? null;
    if (objective) {
      if (s.work?.(dt)) {
        this.state = 'work';
        return { actions: zeroFlightAxes(), interactions: this.idle.interactions };
      }
      this.state = 'objective';
      if (this.recover(dt, self, objective, [objective.clone()])) { this.state = 'zip'; return this.idle; }
      return { actions: this.goTo(self, objective, basis), interactions: this.idle.interactions };
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
    s.work?.(0);
    if (this.recover(dt, self, leader)) {
      this.state = 'zip';
      return this.idle;
    }
    this.state = 'follow';
    return { actions: this.follow(self, leader, basis), interactions: this.idle.interactions };
  }

  private resetStuck(): void {
    this.stuckTime = 0;
    this.stretchTime = 0;
    this.checkTimer = 0;
    this.lastCheck = Number.POSITIVE_INFINITY;
  }

  /**
   * Never strand the player: if we have not closed on the leader for BOT_STUCK_SECONDS
   * while far away (or the cord is over-stretched for a second), zip along the cord.
   */
  private recover(dt: number, self: Vector3, leader: Vector3, direct?: Vector3[]): boolean {
    const s = this.sensors!;
    if (!s.zip || !s.cordPath) return false;
    const distance = Vector3.Distance(self, leader);
    this.trailTimer += dt;
    if (this.trailTimer > 0.2) {
      this.trailTimer = 0;
      if (!this.trail.length || Vector3.Distance(this.trail[this.trail.length - 1], leader) > 0.5) this.trail.push(leader.clone());
      if (this.trail.length > 40) this.trail.shift();
    }
    this.stretchTime = (s.cordStrain?.() ?? 0) > 0.95 ? this.stretchTime + dt : 0;
    this.checkTimer += dt;
    if (this.checkTimer >= 0.5) {
      if (distance > (direct ? 2.5 : 4.5) && this.lastCheck - distance < 0.3) this.stuckTime += this.checkTimer;
      else this.stuckTime = 0;
      this.lastCheck = distance;
      this.checkTimer = 0;
    }
    if (this.stuckTime < BOT_STUCK_SECONDS && this.stretchTime < 1) return false;
    if (direct) {
      s.zip(direct);
      this.zips += 1;
      this.resetStuck();
      return true;
    }
    const raw = s.cordPath();
    const path = raw.length > 1 && Vector3.DistanceSquared(raw[0], self) > Vector3.DistanceSquared(raw[raw.length - 1], self)
      ? [...raw].reverse()
      : [...raw];
    // Glide along the cord, stopping a little short of the leader.
    const points = path.filter((point) => Vector3.Distance(point, leader) > 1.4);
    // Land on the leader's own recent flight path (known open space) 1.4-4 m behind them.
    const landing = [...this.trail].reverse().find((p) => { const d = Vector3.Distance(p, leader); return d > 1.4 && d < 4; });
    points.push(landing ?? leader.add(self.subtract(leader).normalize().scale(1.4)));
    s.zip(points.map((p) => p.clone()));
    this.zips += 1;
    this.resetStuck();
    return true;
  }

  private goTo(self: Vector3, target: Vector3, basis: { forward: Vector3; right: Vector3 }): FlightAxes {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const dx = target.x - self.x;
    const dz = target.z - self.z;
    const dy = target.y - self.y;
    return {
      thrust: clamp((basis.forward.x * dx + basis.forward.z * dz) * 0.8),
      strafe: clamp((basis.right.x * dx + basis.right.z * dz) * 0.8),
      lift: Math.abs(dy) > 0.3 ? clamp(dy * 1.2) : 0,
      boost: Math.hypot(dx, dz) > 6,
    };
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
