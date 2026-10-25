export const BOT_TUNING = {
  followNear: 2.2,
  followFar: 3.2,
  passDistance: 1.2,
  avoidRadius: 4,
  rescueDelay: 0.8,
  exitArrive: 3,
};

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
  const { self, leader, leaderForward, leaderHolding, selfHoldingLoot, exit, leaderCaptured, capturedFor, threats } = input;
  if (leaderCaptured && shouldRescue(capturedFor)) {
    return { mode: 'rescue', point: { x: leader.x, y: leader.y, z: leader.z } };
  }
  if (selfHoldingLoot && exit) {
    return { mode: 'carry', point: avoidThreats(exit, threats) };
  }
  if (leaderHolding && leaderForward) {
    return {
      mode: 'pass',
      point: avoidThreats({
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
