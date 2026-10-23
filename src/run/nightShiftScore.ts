import type { RunStats } from '../ui/heistAwards.ts';
import {
  scoreFloorPure,
  summarize,
  type NightShiftFloors,
} from '../../shared/nightShiftScore.mjs';

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

export function recordBest(floor: number, total: number): BestScore {
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
  const state = loadRun();
  const scored = scoreFloorPure({
    elapsedSeconds: stats.elapsedSeconds,
    timesSpotted: stats.timesSpotted,
    tetherSaves: stats.tetherSaves,
    cordTwangs: stats.cordTwangs,
  }, floor, state.floors as NightShiftFloors);
  state.floors = scored.floors;
  saveRun(state);
  recordBest(floor, scored.total);
  return {
    points: scored.points,
    base: scored.base,
    multiplier: scored.multiplier,
    streak: scored.streak,
    total: scored.total,
  };
}

export function runSummary(): RunSummary {
  const state = loadRun();
  return summarize(state.floors as NightShiftFloors);
}

export { floorBase } from '../../shared/nightShiftScore.mjs';
