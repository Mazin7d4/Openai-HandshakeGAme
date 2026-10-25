const TAU = Math.PI * 2;

export const DRONE_RADIUS = 0.6;

export const HAZARD_COLORS = Object.freeze({
  danger: '#ff4d5a',
  warn: '#ffb03f',
  safe: '#39e6a5',
  gust: '#9ad8ff',
  ice: '#bfe9ff',
});

function cycle01(t, period, phase) {
  const value = t / period + phase;
  return value - Math.floor(value);
}

export function hazardPhase(h, t) {
  const period = h.period > 0 ? h.period : 1;
  const phase = h.phase ?? 0;
  if (h.kind === 'sweeper') {
    return {
      on: true,
      cycle01: cycle01(t, period, phase),
      warn: false,
      yaw: (h.baseYaw ?? 0) + (h.sweep ?? 0) * Math.sin(TAU * (t / period + phase)),
    };
  }
  if (h.kind === 'ice' || h.kind === 'gust') return { on: true, cycle01: 0, warn: false };
  const cycle = cycle01(t, period, phase);
  const duty = Math.max(0, Math.min(1, h.duty ?? 0));
  return {
    on: cycle < duty,
    cycle01: cycle,
    warn: cycle >= duty && cycle > 1 - 0.35 / period,
  };
}

function pointSegmentDistanceSq(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  let u = 0;
  if (lengthSq > 1e-12) {
    u = ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lengthSq;
    u = Math.max(0, Math.min(1, u));
  }
  const x = a.x + dx * u, y = a.y + dy * u, z = a.z + dz * u;
  return (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
}

// Returns the squared closest distance and writes the two closest points into outA/outB.
function segmentSegmentDistanceSq(a, b, c, d, outA, outB) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = d.x - c.x, vy = d.y - c.y, vz = d.z - c.z;
  const wx = a.x - c.x, wy = a.y - c.y, wz = a.z - c.z;
  const aa = ux * ux + uy * uy + uz * uz;
  const bb = ux * vx + uy * vy + uz * vz;
  const cc = vx * vx + vy * vy + vz * vz;
  const dd = ux * wx + uy * wy + uz * wz;
  const ee = vx * wx + vy * wy + vz * wz;
  const denom = aa * cc - bb * bb;
  let s = 0, r = 0;
  if (denom > 1e-12) s = Math.max(0, Math.min(1, (bb * ee - cc * dd) / denom));
  const tNumer = bb * s + ee;
  if (tNumer <= 0) { r = 0; s = Math.max(0, Math.min(1, -dd / aa || 0)); }
  else if (tNumer >= cc) { r = 1; s = Math.max(0, Math.min(1, (bb - dd) / aa || 0)); }
  else r = tNumer / cc;
  const ax = a.x + ux * s, ay = a.y + uy * s, az = a.z + uz * s;
  const bx = c.x + vx * r, by = c.y + vy * r, bz = c.z + vz * r;
  if (outA) { outA.x = ax; outA.y = ay; outA.z = az; }
  if (outB) { outB.x = bx; outB.y = by; outB.z = bz; }
  return (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
}

function insideRect(p, rect) {
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
  const z0 = Math.min(rect.z0, rect.z1), z1 = Math.max(rect.z0, rect.z1);
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1;
}

function insideExpandedRect(p, rect, radius) {
  const x0 = Math.min(rect.x0, rect.x1) - radius, x1 = Math.max(rect.x0, rect.x1) + radius;
  const y0 = Math.min(rect.y0, rect.y1) - radius, y1 = Math.max(rect.y0, rect.y1) + radius;
  const z0 = Math.min(rect.z0, rect.z1) - radius, z1 = Math.max(rect.z0, rect.z1) + radius;
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1;
}

function segmentIntersectsBox(a, b, rect, outPoint) {
  const minX = Math.min(rect.x0, rect.x1), maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1), maxY = Math.max(rect.y0, rect.y1);
  const minZ = Math.min(rect.z0, rect.z1), maxZ = Math.max(rect.z0, rect.z1);
  let enter = 0, exit = 1;
  const check = (start, delta, min, max) => {
    if (Math.abs(delta) < 1e-12) return start >= min && start <= max;
    let a0 = (min - start) / delta, a1 = (max - start) / delta;
    if (a0 > a1) { const temp = a0; a0 = a1; a1 = temp; }
    enter = Math.max(enter, a0); exit = Math.min(exit, a1);
    return enter <= exit;
  };
  const hit = check(a.x, b.x - a.x, minX, maxX) && check(a.y, b.y - a.y, minY, maxY) && check(a.z, b.z - a.z, minZ, maxZ);
  if (hit && outPoint) {
    outPoint.x = a.x + (b.x - a.x) * enter;
    outPoint.y = a.y + (b.y - a.y) * enter;
    outPoint.z = a.z + (b.z - a.z) * enter;
  }
  return hit;
}

function nearestRole(point, players) {
  let role = players[0]?.role ?? 'pix';
  let best = Infinity;
  for (const player of players) {
    if (player.captured) continue;
    const dx = player.x - point.x, dy = player.y - point.y, dz = player.z - point.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < best) { best = distance; role = player.role; }
  }
  return role;
}

export function checkHazardTrips(hazards, t, players, cordPoints) {
  const trips = [];
  const activePlayers = players ?? [];
  const cord = cordPoints ?? [];
  const nearest = { x: 0, y: 0, z: 0 };
  for (const h of hazards ?? []) {
    const phase = hazardPhase(h, t);
    if (!phase.on || h.kind === 'ice' || h.kind === 'gust') continue;
    let trip = null;
    if (h.kind === 'tripwire' && h.a && h.b) {
      for (const p of activePlayers) {
        if (!p.captured && pointSegmentDistanceSq(p, h.a, h.b) <= DRONE_RADIUS * DRONE_RADIUS) {
          trip = { id: h.id, kind: h.kind, role: p.role, via: 'drone' }; break;
        }
      }
      if (!trip) {
        for (let i = 1; i < cord.length; i++) {
          if (segmentSegmentDistanceSq(cord[i - 1], cord[i], h.a, h.b, nearest, null) <= 0.15 * 0.15) {
            trip = { id: h.id, kind: h.kind, role: nearestRole(nearest, activePlayers), via: 'cord' }; break;
          }
        }
      }
    } else if (h.kind === 'pulse-gate' && h.rect) {
      for (const p of activePlayers) {
        if (!p.captured && insideExpandedRect(p, h.rect, DRONE_RADIUS)) {
          trip = { id: h.id, kind: h.kind, role: p.role, via: 'drone' }; break;
        }
      }
      if (!trip) {
        for (let i = 1; i < cord.length; i++) {
          if (segmentIntersectsBox(cord[i - 1], cord[i], h.rect, nearest)) {
            trip = { id: h.id, kind: h.kind, role: nearestRole(nearest, activePlayers), via: 'cord' }; break;
          }
        }
      }
    } else if (h.kind === 'sweeper' && h.center) {
      const yaw = phase.yaw ?? 0;
      const halfAngle = Math.max(0, h.halfAngle ?? 0);
      const range = Math.max(0, h.range ?? 0);
      const cosHalf = Math.cos(halfAngle);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      for (const p of activePlayers) {
        if (p.captured) continue;
        const dx = p.x - h.center.x, dy = p.y - h.center.y, dz = p.z - h.center.z;
        const planar = Math.hypot(dx, dz);
        if (Math.hypot(dx, dy, dz) <= range && Math.abs(dy) <= range * 0.6 && planar > 1e-9 && (dx * fx + dz * fz) / planar >= cosHalf) {
          trip = { id: h.id, kind: h.kind, role: p.role, via: 'drone' }; break;
        }
      }
    }
    if (trip) trips.push(trip);
  }
  return trips;
}

export class HazardTripGate {
  constructor(cooldown = 2.5) { this.cooldown = cooldown; this.last = new Map(); }
  filter(trips, t) {
    const result = [];
    for (const trip of trips ?? []) {
      const key = `${trip.id}:${trip.role}`;
      const previous = this.last.get(key);
      if (previous === undefined || t - previous >= this.cooldown) {
        this.last.set(key, t);
        result.push(trip);
      }
    }
    return result;
  }
}

export function hazardForceAt(hazards, t, x, y, z, out) {
  out.ax = 0; out.ay = 0; out.az = 0; out.slip = 0;
  for (const h of hazards ?? []) {
    if (!h.rect || !insideRect({ x, y, z }, h.rect)) continue;
    if (h.kind === 'gust' && h.force) { out.ax += h.force.x; out.ay += h.force.y; out.az += h.force.z; }
    else if (h.kind === 'ice') out.slip = Math.max(out.slip, 0.85);
  }
  return out;
}

const DESCRIPTIONS = {
  tripwire: { name: 'Laser tripwire', tip: 'Lasers blink — cross in the dark, cord too!' },
  sweeper: { name: 'Sweeping eye', tip: 'Stay behind the sweep or move together.' },
  'pulse-gate': { name: 'Pulse gate', tip: 'Wait for the laser curtain to go dark.' },
  ice: { name: 'Slick floor', tip: 'Low grip — ease off the controls.' },
  gust: { name: 'Fan gust', tip: 'A blast pushes both drones sideways.' },
};

export function describeHazardKind(kind) { return DESCRIPTIONS[kind] ?? { name: 'Hazard', tip: 'Watch your spacing and timing.' }; }

export function hazardSummary(hazards) {
  const counts = new Map();
  for (const h of hazards ?? []) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
  const labels = [];
  for (const kind of ['tripwire', 'pulse-gate', 'sweeper', 'ice', 'gust']) {
    const count = counts.get(kind);
    if (!count) continue;
    if (kind === 'tripwire') labels.push(`${count} laser tripwire${count === 1 ? '' : 's'}`);
    else if (kind === 'pulse-gate') labels.push(`${count} pulse gate${count === 1 ? '' : 's'}`);
    else if (count === 1) labels.push(describeHazardKind(kind).name);
    else labels.push(`${count} ${describeHazardKind(kind).name.toLowerCase()}s`);
  }
  return labels;
}
