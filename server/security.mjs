import { schema, t } from '@colyseus/schema';

// ── Schema types ──────────────────────────────────────────────────────────────

const SecurityPatrol = schema(
  {
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    stunned: t.boolean().default(false),
  },
  'SecurityPatrol',
);

const Security = schema(
  {
    patrols: t.array(SecurityPatrol),
    cameraDisabled: t.boolean().default(false),
    detectionPix: t.float32().default(0),
    detectionNee: t.float32().default(0),
  },
  'Security',
);

export { SecurityPatrol, Security };

// ── Constants (matching client SecuritySystem.ts) ─────────────────────────────

const DEFAULT_PATROL_SPEED = 3.1;
const STUN_DURATION = 3.4;
const FAST_OBJECT_STUN_DURATION = 3.2;
const FAST_OBJECT_RADIUS = 1.65;
const FAST_OBJECT_MIN_SPEED = 5;
const SHOVE_DISTANCE = 1.55;
const SHOVE_COOLDOWN = 1.2;
const SHOVE_STRENGTH = 4.2;
const SHOVE_Y = 1.2;
const CHASE_RANGE = 9;
/** Capture-and-carry (matches client SecuritySystem solo tuning). */
const CAPTURE_RANGE = 1.55;
const CAPTURE_COOLDOWN = 3;
const CARRY_MAX = 4.5;
const CARRY_POINT = { x: 0, y: 3.5, z: 10 };
const CARRY_HAUL_SPEED = 2.2;
const HOLD_OFFSET_Y = -0.95;
const STRUGGLE_NEEDED = 3;
const STRAIN_TETHER = 0.85;
const STRAIN_HOLD = 0.6;
/** Approx cord length where strain reads high enough to yank-free. */
const STRAIN_DISTANCE = 11;

const HOME_POSITIONS = [
  { x: -4, y: 2.2, z: 10 },
  { x: 4, y: 2.2, z: 13 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function distSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-8) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function round2(v) { return Math.round(v * 100) / 100; }

function emptyPatrolRuntime() {
  return {
    stunnedFor: 0,
    shoveCooldown: 0,
    waypoint: 0,
    captureCooldown: 0,
    dazedFor: 0,
    carryingRole: null,
    carryFor: 0,
    strainFor: 0,
    struggles: 0,
  };
}

const DEFAULT_CAMERA = {
  origin: { x: 0, y: 3.7, z: 8.5 },
  forward: normalize({ x: 0, y: -0.08, z: -1 }),
  range: 10,
  halfAngle: Math.PI / 5,
  cosHalf: Math.cos(Math.PI / 5),
  sweepPeriod: 6,
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSecurityState() {
  const state = new Security();
  for (let i = 0; i < 2; i++) {
    const p = new SecurityPatrol();
    p.x = HOME_POSITIONS[i].x;
    p.y = HOME_POSITIONS[i].y;
    p.z = HOME_POSITIONS[i].z;
    state.patrols.push(p);
  }
  return state;
}

// ── SecuritySim ───────────────────────────────────────────────────────────────

export class SecuritySim {
  constructor(state) {
    this.state = state;
    this.patrol = [
      emptyPatrolRuntime(),
      emptyPatrolRuntime(),
    ];
    this.camera = {
      meters: { pix: 0, nee: 0 },
      alertCooldown: { pix: 0, nee: 0 }, // per drone: each one is spotted on its own timer
    };
    this.routes = HOME_POSITIONS.map((home, i) => ({
      waypoints: [
        { ...home },
        { x: Math.sin(i * Math.PI) * 5, y: 2.2, z: 10 + Math.cos(i * Math.PI) * 4 },
      ],
      speed: DEFAULT_PATROL_SPEED,
    }));
    this.cameras = [{ ...DEFAULT_CAMERA, origin: { ...DEFAULT_CAMERA.origin }, forward: { ...DEFAULT_CAMERA.forward } }];
    this.tuning = {
      patrolSpeed: DEFAULT_PATROL_SPEED,
      cameraSweepScale: 1,
      detectionRateScale: 1,
      guardCount: 2,
    };
  }

  /**
   * Apply a RunLayout from shared/seed (server seed hook calls this via applyRunLayout).
   * Resizes patrol schema entries and swaps routes / cameras / tuning.
   */
  applyLayout(layout) {
    const routes = layout?.patrolRoutes ?? [];
    const count = Math.max(1, routes.length || 2);
    while (this.state.patrols.length < count) {
      const p = new SecurityPatrol();
      this.state.patrols.push(p);
      this.patrol.push(emptyPatrolRuntime());
    }
    while (this.state.patrols.length > count) {
      this.state.patrols.pop();
      this.patrol.pop();
    }
    this.routes = routes.length
      ? routes.map((route) => ({
        waypoints: route.waypoints.map((w) => ({ x: w.x, y: w.y, z: w.z })),
        speed: route.speed ?? layout.escalation?.patrolSpeed ?? DEFAULT_PATROL_SPEED,
      }))
      : HOME_POSITIONS.map((home) => ({ waypoints: [{ ...home }], speed: DEFAULT_PATROL_SPEED }));

    for (let i = 0; i < count; i++) {
      const home = this.routes[i]?.waypoints[0] ?? HOME_POSITIONS[i % HOME_POSITIONS.length];
      const sp = this.state.patrols[i];
      sp.x = home.x;
      sp.y = home.y;
      sp.z = home.z;
      sp.stunned = false;
      Object.assign(this.patrol[i], emptyPatrolRuntime());
    }

    const cams = layout?.cameras ?? [];
    this.cameras = (cams.length ? cams : [DEFAULT_CAMERA]).map((cam) => {
      const forward = normalize(cam.forward ?? DEFAULT_CAMERA.forward);
      const halfAngle = cam.sweepAngle ?? DEFAULT_CAMERA.halfAngle;
      return {
        origin: { ...(cam.origin ?? DEFAULT_CAMERA.origin) },
        forward,
        range: cam.range ?? DEFAULT_CAMERA.range,
        halfAngle,
        cosHalf: Math.cos(halfAngle),
        sweepPeriod: cam.sweepPeriod ?? DEFAULT_CAMERA.sweepPeriod,
      };
    });

    this.tuning = {
      patrolSpeed: layout?.escalation?.patrolSpeed ?? DEFAULT_PATROL_SPEED,
      cameraSweepScale: layout?.escalation?.cameraSweepScale ?? 1,
      detectionRateScale: layout?.escalation?.detectionRateScale ?? 1,
      guardCount: count,
    };
    this.camera.meters.pix = 0;
    this.camera.meters.nee = 0;
    this.camera.alertCooldown.pix = 0;
    this.camera.alertCooldown.nee = 0;
    this.state.detectionPix = 0;
    this.state.detectionNee = 0;
    this.state.cameraDisabled = false;
  }

  /**
   * Main tick.
   * Returns { spotted, shoves, captures, releases, overrides }.
   * Capture/rescue uses the same ranges and timers as solo SecuritySystem.
   */
  update(dtSeconds, ctx) {
    const dt = dtSeconds;
    const spotted = [];
    const shoves = [];
    const captures = [];
    const releases = [];
    const overrides = [];
    const detectScale = this.tuning.detectionRateScale ?? 1;

    // ── Cameras (any seeded placement can fill the detection meter) ─────
    for (const role of ['pix', 'nee']) {
      this.camera.alertCooldown[role] = Math.max(0, this.camera.alertCooldown[role] - dt);
    }

    for (const p of ctx.players) {
      if (!p.connected || !(p.role in this.camera.meters)) continue;
      const role = p.role;
      const meterKey = role;
      let inside = false;
      if (!ctx.cameraDisabled) {
        for (const cam of this.cameras) {
          const rel = {
            x: p.position.x - cam.origin.x,
            y: p.position.y - cam.origin.y,
            z: p.position.z - cam.origin.z,
          };
          const distance = Math.hypot(rel.x, rel.y, rel.z);
          if (distance < cam.range && distance > 0.1 &&
            dot({ x: rel.x / distance, y: rel.y / distance, z: rel.z / distance }, cam.forward) > cam.cosHalf) {
            inside = true;
            break;
          }
        }
      }
      const prev = this.camera.meters[meterKey];
      const next = Math.max(0, Math.min(1, prev + dt * (inside ? 0.72 * detectScale : -1.2)));
      this.camera.meters[meterKey] = next;

      if (next >= 1 && this.camera.alertCooldown[role] <= 0) {
        spotted.push(role);
        this.camera.alertCooldown[role] = 3;
        this.camera.meters[meterKey] = 0.35;
      }
    }

    // Write detection into schema (bandwidth: only when changed by >= 0.02 or at exact 0/1)
    const writeMeter = (schemaKey, meterKey) => {
      const value = this.camera.meters[meterKey];
      const current = this.state[schemaKey];
      const delta = Math.abs(value - current);
      if (delta >= 0.02 || value === 0 || value === 1) {
        this.state[schemaKey] = value;
      }
    };
    writeMeter('detectionPix', 'pix');
    writeMeter('detectionNee', 'nee');
    this.state.cameraDisabled = ctx.cameraDisabled;

    // ── Patrols ─────────────────────────────────────────────────────────
    if (!ctx.active) {
      for (let i = 0; i < this.patrol.length; i++) {
        if (this.patrol[i].carryingRole) {
          const freed = this.releaseCarry(i, 'timeout');
          if (freed) releases.push(freed);
        }
      }
      return { spotted, shoves, captures, releases, overrides };
    }

    const partnerOf = (role) => ctx.players.find((p) => p.role !== role && p.connected) ?? null;
    const patrolCount = this.state.patrols.length;
    for (let i = 0; i < patrolCount; i++) {
      const rt = this.patrol[i];
      const sp = this.state.patrols[i];
      const route = this.routes[i];

      rt.stunnedFor = Math.max(0, rt.stunnedFor - dt);
      rt.shoveCooldown = Math.max(0, rt.shoveCooldown - dt);
      rt.captureCooldown = Math.max(0, rt.captureCooldown - dt);
      rt.dazedFor = Math.max(0, rt.dazedFor - dt);
      sp.stunned = rt.stunnedFor > 0;

      if (rt.stunnedFor > 0) {
        if (rt.carryingRole) {
          const freed = this.releaseCarry(i, 'stun');
          if (freed) releases.push(freed);
        }
        continue;
      }

      // Fast-object stun
      let objectStunned = false;
      for (const obj of ctx.objects) {
        if (obj.heldBy !== '') continue;
        const speed = Math.hypot(obj.velocity.x, obj.velocity.y, obj.velocity.z);
        if (speed < FAST_OBJECT_MIN_SPEED) continue;
        if (dist(obj.position, sp) < FAST_OBJECT_RADIUS) {
          rt.stunnedFor = FAST_OBJECT_STUN_DURATION;
          sp.stunned = true;
          objectStunned = true;
          break;
        }
      }
      if (objectStunned) {
        if (rt.carryingRole) {
          const freed = this.releaseCarry(i, 'stun');
          if (freed) releases.push(freed);
        }
        continue;
      }

      // Active carry: haul to holding pen; free on yank / struggle / strain / timeout.
      if (rt.carryingRole) {
        const captive = ctx.players.find((p) => p.role === rt.carryingRole);
        if (!captive || !captive.connected) {
          const freed = this.releaseCarry(i, 'timeout');
          if (freed) releases.push(freed);
          continue;
        }
        // Sync struggle count from room (boost presses while captured).
        if (typeof captive.struggles === 'number') rt.struggles = Math.max(rt.struggles, captive.struggles | 0);
        if (captive.yankedRecently) {
          const freed = this.releaseCarry(i, 'yank');
          if (freed) releases.push(freed);
          continue;
        }
        rt.carryFor += dt;
        const partner = partnerOf(captive.role);
        const tetherDist = partner ? dist(captive.position, partner.position) : 0;
        const strained = (captive.tetherPull ?? 0) >= STRAIN_TETHER || tetherDist >= STRAIN_DISTANCE;
        rt.strainFor = strained ? rt.strainFor + dt : 0;
        if (rt.struggles >= STRUGGLE_NEEDED) {
          const freed = this.releaseCarry(i, 'struggle');
          if (freed) releases.push(freed);
          continue;
        }
        if (rt.strainFor > STRAIN_HOLD) {
          const freed = this.releaseCarry(i, 'strain');
          if (freed) releases.push(freed);
          continue;
        }
        if (rt.carryFor > CARRY_MAX) {
          const freed = this.releaseCarry(i, 'timeout');
          if (freed) releases.push(freed);
          continue;
        }
        // Haul toward the lab holding pen.
        const to = { x: CARRY_POINT.x - sp.x, y: CARRY_POINT.y - sp.y, z: CARRY_POINT.z - sp.z };
        const toLen = Math.hypot(to.x, to.y, to.z);
        if (toLen > 0.45) {
          sp.x = round2(sp.x + (to.x / toLen) * CARRY_HAUL_SPEED * dt);
          sp.y = round2(sp.y + (to.y / toLen) * CARRY_HAUL_SPEED * dt);
          sp.z = round2(sp.z + (to.z / toLen) * CARRY_HAUL_SPEED * dt);
        }
        const hold = { x: sp.x, y: sp.y + HOLD_OFFSET_Y, z: sp.z };
        overrides.push({
          role: captive.role,
          index: i,
          position: hold,
          carryFor: rt.carryFor,
          struggles: rt.struggles,
          rescueProgress: Math.min(1, rt.struggles / STRUGGLE_NEEDED),
        });
        continue;
      }

      // Waypoint patrol (fallback: legacy sine orbit if route missing)
      let routeTarget;
      if (route?.waypoints?.length) {
        let wpIndex = rt.waypoint % route.waypoints.length;
        let targetWp = route.waypoints[wpIndex];
        if (dist(sp, targetWp) < 0.85) {
          rt.waypoint = (wpIndex + 1) % route.waypoints.length;
          wpIndex = rt.waypoint;
          targetWp = route.waypoints[wpIndex];
        }
        routeTarget = targetWp;
      } else {
        const phase = i * Math.PI;
        routeTarget = {
          x: Math.sin(ctx.elapsed * 0.55 + phase) * 5,
          y: 2.2,
          z: 10 + Math.cos(ctx.elapsed * 0.55 + phase) * 4,
        };
      }

      // Find nearest connected free player
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of ctx.players) {
        if (!p.connected || p.captured) continue;
        const d = dist(p.position, sp);
        if (d < nearestDist) { nearestDist = d; nearest = p; }
      }

      let target = routeTarget;
      let speed = route?.speed ?? this.tuning.patrolSpeed ?? DEFAULT_PATROL_SPEED;
      if (rt.dazedFor > 0) speed = 0.6;
      else if (nearest && nearestDist < CHASE_RANGE) target = nearest.position;

      const dx = target.x - sp.x;
      const dy = target.y - sp.y;
      const dz = target.z - sp.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      let vx, vy, vz;
      if (dSq > 0.05) {
        const len = Math.sqrt(dSq);
        vx = (dx / len) * speed;
        vy = (dy / len) * speed;
        vz = (dz / len) * speed;
      } else {
        vx = dx; vy = dy; vz = dz;
      }

      sp.x = round2(sp.x + vx * dt);
      sp.y = round2(sp.y + vy * dt);
      sp.z = round2(sp.z + vz * dt);

      // Capture (preferred) or shove — same range as solo.
      if (nearest && rt.dazedFor <= 0 && nearestDist < CAPTURE_RANGE) {
        if (rt.captureCooldown <= 0) {
          rt.carryingRole = nearest.role;
          rt.carryFor = 0;
          rt.strainFor = 0;
          rt.struggles = 0;
          captures.push({ role: nearest.role, index: i });
          const hold = { x: sp.x, y: sp.y + HOLD_OFFSET_Y, z: sp.z };
          overrides.push({
            role: nearest.role,
            index: i,
            position: hold,
            carryFor: 0,
            struggles: 0,
            rescueProgress: 0,
          });
        } else if (rt.shoveCooldown <= 0 && nearestDist < SHOVE_DISTANCE) {
          const dir = normalize({
            x: nearest.position.x - sp.x,
            y: nearest.position.y - sp.y,
            z: nearest.position.z - sp.z,
          });
          shoves.push({
            role: nearest.role,
            index: i,
            impulse: { x: dir.x * SHOVE_STRENGTH, y: SHOVE_Y, z: dir.z * SHOVE_STRENGTH },
          });
          rt.shoveCooldown = SHOVE_COOLDOWN;
        }
      }
    }

    return { spotted, shoves, captures, releases, overrides };
  }

  /** Free whoever this patrol is carrying. Returns { role, index, reason } or null. */
  releaseCarry(index, reason) {
    const rt = this.patrol[index];
    if (!rt?.carryingRole) return null;
    const role = rt.carryingRole;
    rt.carryingRole = null;
    rt.carryFor = 0;
    rt.strainFor = 0;
    rt.struggles = 0;
    rt.captureCooldown = CAPTURE_COOLDOWN;
    rt.dazedFor = reason === 'stun' ? 0 : 1.1;
    if (reason !== 'timeout' && reason !== 'stun') {
      const sp = this.state.patrols[index];
      // Kick the pod away from the holding pen a bit (solo release shove).
      const kick = normalize({ x: sp.x - CARRY_POINT.x, y: 0, z: sp.z - CARRY_POINT.z });
      if (kick.x || kick.z) {
        sp.x = round2(sp.x + kick.x * 0.8);
        sp.z = round2(sp.z + kick.z * 0.8);
      }
    }
    return { role, index, reason };
  }

  /** Partner yank / explicit free: release the patrol holding `role`. */
  releaseRole(role, reason = 'yank') {
    for (let i = 0; i < this.patrol.length; i++) {
      if (this.patrol[i].carryingRole === role) return this.releaseCarry(i, reason);
    }
    return null;
  }

  /** TEST / room hook: force a patrol to grab a role at its current position. */
  forceCapture(role, index = 0) {
    if (index < 0 || index >= this.patrol.length) return null;
    const rt = this.patrol[index];
    if (rt.carryingRole || rt.stunnedFor > 0) return null;
    // Drop any other hold on this role.
    this.releaseRole(role, 'timeout');
    rt.carryingRole = role;
    rt.carryFor = 0;
    rt.strainFor = 0;
    rt.struggles = 0;
    return { role, index };
  }

  carryInfo(role) {
    for (let i = 0; i < this.patrol.length; i++) {
      const rt = this.patrol[i];
      if (rt.carryingRole === role) {
        return {
          index: i,
          carryFor: rt.carryFor,
          struggles: rt.struggles,
          rescueProgress: Math.min(1, rt.struggles / STRUGGLE_NEEDED),
        };
      }
    }
    return null;
  }

  /**
   * Clothesline stun. Returns false if invalid or already stunned.
   */
  stun(index, awayFrom, durationSeconds = STUN_DURATION) {
    if (index !== 0 && index !== 1) return false;
    const rt = this.patrol[index];
    if (rt.stunnedFor > 0) return false;

    const sp = this.state.patrols[index];
    if (awayFrom) {
      const hDx = sp.x - awayFrom.x;
      const hDz = sp.z - awayFrom.z;
      const hDist = Math.hypot(hDx, hDz);
      if (hDist > 0.1) {
        sp.x = round2(sp.x + (hDx / hDist) * 1.2);
        sp.z = round2(sp.z + (hDz / hDist) * 1.2);
      }
    }
    sp.y = round2(Math.max(0.8, sp.y - 0.6));
    rt.stunnedFor = durationSeconds;
    sp.stunned = true;
    return true;
  }

  patrolPosition(index) {
    if (index !== 0 && index !== 1) return null;
    const sp = this.state.patrols[index];
    return { x: sp.x, y: sp.y, z: sp.z };
  }

  reset() {
    for (let i = 0; i < this.state.patrols.length; i++) {
      const home = this.routes[i]?.waypoints[0] ?? HOME_POSITIONS[i % HOME_POSITIONS.length];
      const sp = this.state.patrols[i];
      sp.x = home.x;
      sp.y = home.y;
      sp.z = home.z;
      sp.stunned = false;
      Object.assign(this.patrol[i], emptyPatrolRuntime());
    }
    this.camera.meters.pix = 0;
    this.camera.meters.nee = 0;
    this.camera.alertCooldown.pix = 0;
    this.camera.alertCooldown.nee = 0;
    this.state.detectionPix = 0;
    this.state.detectionNee = 0;
    this.state.cameraDisabled = false;
  }
}
