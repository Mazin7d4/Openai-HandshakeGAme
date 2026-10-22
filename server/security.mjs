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

const CAMERA_ORIGIN = { x: 0, y: 3.7, z: 8.5 };
const CAMERA_FORWARD_RAW = { x: 0, y: -0.08, z: -1 };
const CF_LEN = Math.hypot(CAMERA_FORWARD_RAW.x, CAMERA_FORWARD_RAW.y, CAMERA_FORWARD_RAW.z);
const CAMERA_FORWARD = {
  x: CAMERA_FORWARD_RAW.x / CF_LEN,
  y: CAMERA_FORWARD_RAW.y / CF_LEN,
  z: CAMERA_FORWARD_RAW.z / CF_LEN,
};
const CAMERA_RANGE = 10;
const CAMERA_HALF_ANGLE = Math.PI / 5;
const COS_HALF_ANGLE = Math.cos(CAMERA_HALF_ANGLE);

const PATROL_SPEED = 3.1;
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
      { stunnedFor: 0, shoveCooldown: 0 },
      { stunnedFor: 0, shoveCooldown: 0 },
    ];
    this.camera = {
      meters: { pix: 0, nee: 0 },
      alertCooldown: { pix: 0, nee: 0 }, // per drone: each one is spotted on its own timer
    };
  }

  /**
   * Main tick. Returns { spotted: role[], shoves: [{role,index,impulse:{x,y,z}}] }.
   */
  update(dtSeconds, ctx) {
    const dt = dtSeconds;
    const spotted = [];
    const shoves = [];

    // ── Camera ──────────────────────────────────────────────────────────
    for (const role of ['pix', 'nee']) {
      this.camera.alertCooldown[role] = Math.max(0, this.camera.alertCooldown[role] - dt);
    }

    for (const p of ctx.players) {
      if (!p.connected || !(p.role in this.camera.meters)) continue;
      const role = p.role;                    // 'pix' | 'nee'
      const meterKey = role;                  // matches camera.meters keys
      const rel = {
        x: p.position.x - CAMERA_ORIGIN.x,
        y: p.position.y - CAMERA_ORIGIN.y,
        z: p.position.z - CAMERA_ORIGIN.z,
      };
      const distance = Math.hypot(rel.x, rel.y, rel.z);
      const inside = !ctx.cameraDisabled &&
        distance < CAMERA_RANGE &&
        distance > 0.1 &&
        dot({ x: rel.x / distance, y: rel.y / distance, z: rel.z / distance }, CAMERA_FORWARD) > COS_HALF_ANGLE;
      const prev = this.camera.meters[meterKey];
      const next = Math.max(0, Math.min(1, prev + dt * (inside ? 0.72 : -1.2)));
      this.camera.meters[meterKey] = next;

      // Spotted
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

    for (let i = 0; i < 2; i++) {
      const rt = this.patrol[i];
      const sp = this.state.patrols[i];

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

      // Movement
      const phase = i * Math.PI;
      const routeTarget = {
        x: Math.sin(ctx.elapsed * 0.55 + phase) * 5,
        y: 2.2,
        z: 10 + Math.cos(ctx.elapsed * 0.55 + phase) * 4,
      };

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

      const dx = target.x - sp.x;
      const dy = target.y - sp.y;
      const dz = target.z - sp.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      let vx, vy, vz;
      if (dSq > 0.05) {
        const len = Math.sqrt(dSq);
        vx = (dx / len) * PATROL_SPEED;
        vy = (dy / len) * PATROL_SPEED;
        vz = (dz / len) * PATROL_SPEED;
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
    for (let i = 0; i < 2; i++) {
      const sp = this.state.patrols[i];
      sp.x = HOME_POSITIONS[i].x;
      sp.y = HOME_POSITIONS[i].y;
      sp.z = HOME_POSITIONS[i].z;
      sp.stunned = false;
      this.patrol[i].stunnedFor = 0;
      this.patrol[i].shoveCooldown = 0;
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
