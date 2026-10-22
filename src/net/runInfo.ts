/**
 * Thin UI adapter over ClientRun synced run state.
 * Daily / challenge / replay intents feed startLocalRun; HUD reads getRunInfo().
 */
import {
  dailySeed as dailySeedShared,
  parseSeed,
  randomSeed,
  runOptionsFromSearch,
  type UrlRunOptions,
} from '../../shared/run.ts';
import {
  getRunState,
  setBeatTarget,
  type ClientRunSnapshot,
} from '../run/ClientRun.ts';
import { getRunSeed } from '../seed/index.ts';

export interface RunInfo {
  seed: number;
  floor: number;
  /** Night Shift captures this run. */
  captures: number;
  /** Challenge-link target time in milliseconds, when the run was opened from ?beat=. */
  timeToBeatMs?: number;
}

type RunIntent = {
  seed?: number;
  floor?: number;
  captures?: number;
  mode?: UrlRunOptions['mode'];
  timeToBeatMs?: number;
};

let intent: RunIntent | null = null;

/** Re-export: deterministic UTC calendar seed (shared/run.ts — single source of truth). */
export const dailySeed = dailySeedShared;

/** One-shot / sticky override for the next Night Shift boot (daily, challenge, replay). */
export function prepareRun(next: RunIntent | null): void {
  intent = next;
  if (next?.timeToBeatMs != null) setBeatTarget(next.timeToBeatMs);
}

export function prepareDailyRun(date: Date = new Date()): void {
  prepareRun({ seed: dailySeed(date), floor: 1, captures: 0, mode: 'nightshift' });
}

export function prepareChallengeRun(seed: number, timeToBeatMs?: number): void {
  const beat = Number.isFinite(timeToBeatMs) ? Math.max(0, Math.round(timeToBeatMs!)) : undefined;
  prepareRun({
    seed: seed >>> 0,
    floor: 1,
    captures: 0,
    mode: 'nightshift',
    ...(beat !== undefined ? { timeToBeatMs: beat } : {}),
  });
}

export function clearRunIntent(): void {
  intent = null;
}

/** Consume prepared intent for startLocalRun (URL params still win when present). */
export function consumeRunIntent(): RunIntent | null {
  const next = intent;
  intent = null;
  return next;
}

/** Pending intent without clearing (boot card / pre-start getRunInfo). */
export function peekRunIntent(): RunIntent | null {
  return intent;
}

/**
 * Single read path for HUD / report / boot.
 * Prefers synced ClientRun state so co-op clients and reconnects show the server seed/floor.
 */
export function getRunInfo(): RunInfo {
  const run: ClientRunSnapshot | null = getRunState();
  if (run) {
    return {
      seed: run.seed,
      floor: run.floor,
      captures: run.captures,
      ...(run.beatTarget != null ? { timeToBeatMs: run.beatTarget } : {}),
    };
  }

  const pending = intent;
  if (pending && Number.isFinite(pending.seed)) {
    const base = getRunSeed({ seed: pending.seed!, floor: pending.floor ?? 1 });
    return {
      seed: base.seed,
      floor: base.floor,
      captures: Math.max(0, (pending.captures ?? 0) | 0),
      ...(pending.timeToBeatMs !== undefined ? { timeToBeatMs: pending.timeToBeatMs } : {}),
    };
  }

  const fromUrl = runOptionsFromSearch(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  if (fromUrl.seed != null) {
    const base = getRunSeed({ seed: fromUrl.seed, floor: 1 });
    return {
      seed: base.seed,
      floor: base.floor,
      captures: 0,
      ...(fromUrl.beat != null ? { timeToBeatMs: fromUrl.beat } : {}),
    };
  }

  const base = getRunSeed();
  return { seed: base.seed, floor: base.floor, captures: 0 };
}

/** Format a millisecond challenge target for HUD chips / copy ("5:42"). */
export function formatBeatMs(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export { parseSeed, randomSeed, runOptionsFromSearch };
