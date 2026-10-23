/**
 * Run-state seed getter (Night Shift / HUD / floor wiring).
 * Backed by the authoritative RunState on client (ClientRun) and by create options on server.
 *
 * Signature matches the GameDev stub: getRunSeed(override?) → { seed, floor }.
 */

import { createRunState } from '../run.ts';

/**
 * @typedef {{ seed: number, floor: number }} RunSeed
 */

const SESSION_KEY = 'pixnee.runSeed';

/** @type {null | (() => RunSeed | null | undefined)} */
let activeGetter = null;

/**
 * Register the live run-state reader (ClientRun calls this on the browser).
 * @param {null | (() => RunSeed | null | undefined)} getter
 */
export function setRunSeedGetter(getter) {
  activeGetter = typeof getter === 'function' ? getter : null;
}

/**
 * @returns {RunSeed | null}
 */
function readSessionIntent() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.seed)) return null;
    sessionStorage.removeItem(SESSION_KEY);
    return {
      seed: parsed.seed >>> 0,
      floor: Math.max(0, (parsed.floor ?? 0) | 0),
    };
  } catch {
    return null;
  }
}

/**
 * @param {RunSeed} value
 */
export function stashRunSeed(value) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      seed: value.seed >>> 0,
      floor: Math.max(0, value.floor | 0),
    }));
  } catch {
    /* private mode */
  }
}

/**
 * @param {{ seed?: number, floor?: number } | null | undefined} [override]
 * @returns {RunSeed}
 */
export function getRunSeed(override) {
  if (override && Number.isFinite(override.seed)) {
    return {
      seed: override.seed >>> 0,
      floor: Math.max(0, (override.floor ?? 1) | 0),
    };
  }
  if (activeGetter) {
    const current = activeGetter();
    if (current && Number.isFinite(current.seed)) {
      return {
        seed: current.seed >>> 0,
        floor: Math.max(0, (current.floor ?? 1) | 0),
      };
    }
  }
  const pending = readSessionIntent();
  if (pending) return pending;
  const created = createRunState({ mode: 'nightshift' });
  return { seed: created.seed, floor: created.floor };
}

/**
 * Advance to the next Night Shift floor index (same seed).
 * Seed derivation for endless floors lives in shared/run.ts `nextFloorSeed(seed, floor)`.
 *
 * @param {RunSeed} current
 * @returns {RunSeed}
 */
export function nextFloorSeed(current) {
  return {
    seed: current.seed >>> 0,
    floor: Math.max(0, (current.floor | 0) + 1),
  };
}
