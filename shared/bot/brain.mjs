import { DOORWAYS, STATIC_BLOCKERS } from '../nightshift/levelGeometry.mjs';

export const BOT_TUNING = {
  followNear: 2.2,
  followFar: 3.2,
  passDistance: 1.2,
  avoidRadius: 4,
  rescueDelay: 0.8,
  exitArrive: 3,
  hackSeconds: 3.5,
  objectiveRange: 15,
};

function segmentIntersectsBox(a, b, box, margin = 0) {
  const yMin = Math.min(a.y, b.y);
  const yMax = Math.max(a.y, b.y);
  if (yMax < box.min.y - margin || yMin > box.max.y + margin) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [p, q] of [
    [-dx, a.x - (box.min.x - margin)],
    [dx, box.max.x + margin - a.x],
    [-dz, a.z - (box.min.z - margin)],
    [dz, box.max.z + margin - a.z],
  ]) {
    if (Math.abs(p) < 1e-6) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

function flightPathBlocked(a, b) {
  return STATIC_BLOCKERS.some((blocker) => (
    segmentIntersectsBox(a, b, blocker, 0.35)
    && !DOORWAYS.some((doorway) => segmentIntersectsBox(a, b, doorway, 0.05))
  ));
}

function breadcrumbTarget(self, leader, trail) {
  if (!Array.isArray(trail) || trail.length === 0 || !flightPathBlocked(self, leader)) return null;
  for (let index = trail.length - 1; index >= 0; index--) {
    const point = trail[index];
    if (planarDistance(self, point) > 1.8 && !flightPathBlocked(self, point)) {
      return { x: point.x, y: point.y, z: point.z };
    }
  }
  return null;
}

export function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function shouldRescue(capturedFor) {
  return capturedFor >= BOT_TUNING.rescueDelay;
}

export function avoidThreats(point, threats, radius = BOT_TUNING.avoidRadius) {
  if (!point) return null;
  const result = { ...point };
  for (const threat of threats ?? []) {
    const dx = result.x - threat.x;
    const dz = result.z - threat.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= radius) continue;
    if (distance < 0.0001) {
      result.x += radius;
      continue;
    }
    const push = radius - distance;
    result.x += dx / distance * push;
    result.z += dz / distance * push;
  }
  return result;
}

export function botGoal(input) {
  const { self, leader, leaderForward, leaderHolding, leaderTrail, selfHoldingLoot, exit, leaderCaptured, capturedFor, threats } = input;
  if (leaderCaptured && shouldRescue(capturedFor)) {
    return { mode: 'rescue', point: { x: leader.x, y: leader.y, z: leader.z } };
  }
  if (selfHoldingLoot && exit) {
    return { mode: 'carry', point: avoidThreats(exit, threats) };
  }
  if (leaderHolding && leaderForward) {
    const breadcrumb = breadcrumbTarget(self, leader, leaderTrail);
    return {
      mode: 'pass',
      point: avoidThreats(breadcrumb ?? {
        x: leader.x + leaderForward.x * BOT_TUNING.passDistance,
        y: leader.y,
        z: leader.z + leaderForward.z * BOT_TUNING.passDistance,
      }, threats),
    };
  }
  const distance = planarDistance(self, leader);
  if (distance > BOT_TUNING.followFar) {
    const length = distance || 1;
    return {
      mode: 'follow',
      point: avoidThreats({
        x: leader.x - (leader.x - self.x) / length * BOT_TUNING.followNear,
        y: leader.y,
        z: leader.z - (leader.z - self.z) / length * BOT_TUNING.followNear,
      }, threats),
    };
  }
  return { mode: 'hold', point: null };
}
