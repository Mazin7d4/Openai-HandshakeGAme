/**
 * Thin UI adapter over the seed remix stub.
 * Wraps getRunSeed() today so Netcode can swap the run-state source later without UI churn.
 */
import { dailySeed as dailySeedShared, getRunSeed } from '../seed/index.ts';

export interface RunInfo {
  seed: number;
  floor: number;
  /** Night Shift captures this run; stubbed at 0 until Netcode owns the counter. */
  captures: number;
  /** Challenge-link target time in milliseconds, when the run was opened from ?beat=. */
  timeToBeatMs?: number;
}

type RunIntent = {
  seed?: number;
  floor?: number;
  captures?: number;
  timeToBeatMs?: number;
};

let intent: RunIntent | null = null;

/** Re-export: deterministic UTC calendar seed (same helper QA / Netcode use). */
export const dailySeed = dailySeedShared;

/** One-shot / sticky override for the next Night Shift boot (daily, challenge, replay). */
export function prepareRun(next: RunIntent | null): void {
  intent = next;
}

export function prepareDailyRun(date: Date = new Date()): void {
  prepareRun({ seed: dailySeed(date), floor: 0, captures: 0 });
}

export function prepareChallengeRun(seed: number, timeToBeatMs?: number): void {
  const beat = Number.isFinite(timeToBeatMs) ? Math.max(0, Math.round(timeToBeatMs!)) : undefined;
  prepareRun({
    seed: seed >>> 0,
    floor: 0,
    captures: 0,
    ...(beat !== undefined ? { timeToBeatMs: beat } : {}),
  });
}

export function clearRunIntent(): void {
  intent = null;
}

/**
 * Single read path for HUD / report / boot. Always goes through getRunSeed() so a
 * future Netcode getter can replace that stub without touching call sites.
 */
export function getRunInfo(): RunInfo {
  const override = intent && Number.isFinite(intent.seed)
    ? { seed: intent.seed!, floor: intent.floor ?? 0 }
    : null;
  const base = getRunSeed(override);
  const captures = Math.max(0, (intent?.captures ?? 0) | 0);
  const timeToBeatMs = intent?.timeToBeatMs;
  return {
    seed: base.seed,
    floor: base.floor,
    captures,
    ...(timeToBeatMs !== undefined ? { timeToBeatMs } : {}),
  };
}

/** Format a millisecond challenge target for Doto chips / copy ("5:42"). */
export function formatBeatMs(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
