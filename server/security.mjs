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
      { stunnedFor: 0, shoveCooldown: 0, waypoint: 0 },
      { stunnedFor: 0, shoveCooldown: 0, waypoint: 0 },
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
      this.patrol.push({ stunnedFor: 0, shoveCooldown: 0, waypoint: 0 });
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
      this.patrol[i].stunnedFor = 0;
      this.patrol[i].shoveCooldown = 0;
      this.patrol[i].waypoint = 0;
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
   * Main tick. Returns { spotted: role[], shoves: [{role,index,impulse:{x,y,z}}] }.
   */
  update(dtSeconds, ctx) {
    const dt = dtSeconds;
    const spotted = [];
    const shoves = [];
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
    if (!ctx.active) return { spotted, shoves };

    const patrolCount = this.state.patrols.length;
    for (let i = 0; i < patrolCount; i++) {
      const rt = this.patrol[i];
      const sp = this.state.patrols[i];
      const route = this.routes[i];

      rt.stunnedFor = Math.max(0, rt.stunnedFor - dt);
      rt.shoveCooldown = Math.max(0, rt.shoveCooldown - dt);
      sp.stunned = rt.stunnedFor > 0;

      if (rt.stunnedFor > 0) continue;

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
      if (objectStunned) continue;

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

      // Find nearest connected player
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of ctx.players) {
        if (!p.connected) continue;
        const d = dist(p.position, sp);
        if (d < nearestDist) { nearestDist = d; nearest = p; }
      }

      let target = routeTarget;
      if (nearest && nearestDist < CHASE_RANGE) target = nearest.position;

      const patrolSpeed = route?.speed ?? this.tuning.patrolSpeed ?? DEFAULT_PATROL_SPEED;
      const dx = target.x - sp.x;
      const dy = target.y - sp.y;
      const dz = target.z - sp.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      let vx, vy, vz;
      if (dSq > 0.05) {
        const len = Math.sqrt(dSq);
        vx = (dx / len) * patrolSpeed;
        vy = (dy / len) * patrolSpeed;
        vz = (dz / len) * patrolSpeed;
      } else {
        vx = dx; vy = dy; vz = dz;
      }

      sp.x = round2(sp.x + vx * dt);
      sp.y = round2(sp.y + vy * dt);
      sp.z = round2(sp.z + vz * dt);

      // Shove
      if (nearest && rt.shoveCooldown <= 0 && nearestDist < SHOVE_DISTANCE) {
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

    return { spotted, shoves };
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
      this.patrol[i].stunnedFor = 0;
      this.patrol[i].shoveCooldown = 0;
      this.patrol[i].waypoint = 0;
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
