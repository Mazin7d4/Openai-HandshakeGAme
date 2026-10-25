/** Pure Night Shift scoring shared by the server and client. */

export function floorBase(stats = {}) {
  const elapsed = stats.elapsedSeconds ?? 0;
  const spotted = stats.timesSpotted ?? 0;
  const saves = stats.tetherSaves ?? 0;
  const twangs = stats.cordTwangs ?? 0;
  const raw = 1000
    + Math.max(0, Math.round((300 - elapsed) * 4))
    - 150 * spotted
    + 50 * saves
    + 25 * Math.min(10, twangs);
  return Math.max(100, raw);
}

export function dropFloorsFrom(floors = {}, floor = 1) {
  const next = {};
  for (const [key, entry] of Object.entries(floors ?? {})) {
    const number = Number(key);
    if (Number.isFinite(number) && number < floor) next[number] = { points: entry.points, clean: entry.clean === true };
  }
  return next;
}

export function summarize(floors = {}) {
  const floorNums = Object.keys(floors).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (floorNums.length === 0) return { total: 0, streak: 0, multiplier: 1, lastFloor: 0 };
  const lastFloor = floorNums[floorNums.length - 1];
  const total = floorNums.reduce((sum, floor) => sum + (Number(floors[floor]?.points) || 0), 0);
  let streak = 0;
  for (let floor = lastFloor; floor >= 1; floor--) {
    if (floors[floor]?.clean === true) streak++;
    else break;
  }
  return { total, streak, multiplier: Math.min(3, 1 + 0.5 * streak), lastFloor };
}

export function scoreFloorPure(stats = {}, floor = 1, floors = {}) {
  const clean = (stats.timesSpotted ?? 0) === 0;
  const base = floorBase(stats);
  const payoutScale = Number.isFinite(stats.payoutScale) ? Math.max(0, stats.payoutScale) : 1;
  const nextFloors = { ...floors, [floor]: { points: 0, clean } };
  let streak = 0;
  if (clean) {
    for (let current = floor; current >= 1; current--) {
      if (nextFloors[current]?.clean === true) streak++;
      else break;
    }
  }
  const multiplier = Math.min(3, 1 + 0.5 * streak);
  const points = Math.round(base * multiplier * payoutScale);
  nextFloors[floor] = { points, clean };
  const summary = summarize(nextFloors);
  return { points, base, multiplier, streak, total: summary.total, floors: nextFloors };
}
