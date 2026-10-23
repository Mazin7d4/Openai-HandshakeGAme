import type { RunStats } from '../ui/heistAwards.ts';

export interface FloorScoreEntry {
  points: number;
  clean: boolean;
}

export interface RunState {
  floors: Record<number, FloorScoreEntry>;
}

export interface BestScore {
  floor: number;
  score: number;
}

export interface ScoreFloorResult {
  points: number;
  base: number;
  multiplier: number;
  streak: number;
  total: number;
}

export interface RunSummary {
  total: number;
  streak: number;
  multiplier: number;
  lastFloor: number;
}

const RUN_KEY = 'pixnee.ns.run';
const BEST_KEY = 'pixnee.ns.best';

function loadRun(): RunState {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.floors === 'object' && parsed.floors !== null) {
        return parsed as RunState;
      }
    }
  } catch {
    // sessionStorage unavailable
  }
  return { floors: {} };
}

function saveRun(state: RunState): void {
  try {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage unavailable
  }
}

export function beginFloor(floor: number): void {
  const state = loadRun();
  let changed = false;
  for (const k of Object.keys(state.floors)) {
    const f = Number(k);
    if (f >= floor) {
      delete state.floors[f];
      changed = true;
    }
  }
  if (changed) {
    saveRun(state);
  }
}

export function resetRun(): void {
  try {
    sessionStorage.removeItem(RUN_KEY);
  } catch {
    // sessionStorage unavailable
  }
}

export function getBest(): BestScore | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.floor === 'number' &&
        typeof parsed.score === 'number'
      ) {
        return { floor: parsed.floor, score: parsed.score };
      }
    }
  } catch {
    // localStorage unavailable
  }
  return null;
}

function updateBest(floor: number, total: number): BestScore {
  const current = getBest();
  const next: BestScore = {
    floor: current ? Math.max(current.floor, floor) : floor,
    score: current ? Math.max(current.score, total) : total,
  };
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable
  }
  return next;
}

export function scoreFloor(stats: RunStats, floor: number): ScoreFloorResult {
  const elapsed = stats.elapsedSeconds ?? 0;
  const spotted = stats.timesSpotted ?? 0;
  const saves = stats.tetherSaves ?? 0;
  const twangs = stats.cordTwangs ?? 0;

  const rawBase = 1000 + Math.max(0, Math.round((300 - elapsed) * 4)) - 150 * spotted + 50 * saves + 25 * Math.min(10, twangs);
  const base = Math.max(100, rawBase);
  const clean = spotted === 0;

  const state = loadRun();
  let streak = 0;
  if (clean) {
    streak = 1;
    for (let f = floor - 1; f >= 1; f--) {
      const entry = state.floors[f];
      if (entry && entry.clean) {
        streak++;
      } else {
        break;
      }
    }
  }

  const multiplier = Math.min(3, 1 + 0.5 * streak);
  const points = Math.round(base * multiplier);

  state.floors[floor] = { points, clean };
  saveRun(state);

  const total = Object.values(state.floors).reduce((sum, entry) => sum + entry.points, 0);
  updateBest(floor, total);

  return { points, base, multiplier, streak, total };
}

export function runSummary(): RunSummary {
  const state = loadRun();
  const floorNums = Object.keys(state.floors).map(Number).sort((a, b) => a - b);
  if (floorNums.length === 0) {
    return { total: 0, streak: 0, multiplier: 1, lastFloor: 0 };
  }

  const lastFloor = floorNums[floorNums.length - 1];
  const total = Object.values(state.floors).reduce((sum, entry) => sum + entry.points, 0);

  let streak = 0;
  for (let f = lastFloor; f >= 1; f--) {
    const entry = state.floors[f];
    if (entry && entry.clean) {
      streak++;
    } else {
      break;
    }
  }

  const multiplier = Math.min(3, 1 + 0.5 * streak);
  return { total, streak, multiplier, lastFloor };
}
