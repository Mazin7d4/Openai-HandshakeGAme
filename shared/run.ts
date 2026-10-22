/**
 * Shared run-state helpers (client + server).
 * Generator-agnostic: a 32-bit unsigned seed plus mode/floor/captures plumbing.
 */

export type RunMode = 'standard' | 'daily' | 'nightshift';

export const MAX_CAPTURES = 3;

export interface RunState {
  mode: RunMode;
  /** Unsigned 32-bit seed for the current floor. */
  seed: number;
  floor: number;
  captures: number;
  maxCaptures: number;
  startedAt: number;
  floorTimes: number[];
}

export interface RunCreateOptions {
  seed?: number;
  mode?: RunMode;
}

export interface FloorStartPayload {
  seed: number;
  floor: number;
  /** Present when mirrored from room state / floor-start (Night Shift remix gate). */
  mode?: RunMode;
}

const UINT32 = 0xffffffff;

/** FNV-1a style mix → uint32. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mixUint32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Format a uint32 seed as a short uppercase base36 code for URLs. */
export function formatSeed(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase();
}

/**
 * Parse a seed from a URL param: decimal digits or base36 code.
 * Returns null when the value is missing or invalid.
 */
export function parseSeed(input: string | null | undefined): number | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n > UINT32) return null;
    return n >>> 0;
  }
  if (!/^[0-9a-z]+$/i.test(trimmed)) return null;
  const n = parseInt(trimmed, 36);
  if (!Number.isFinite(n) || n < 0 || n > UINT32) return null;
  return n >>> 0;
}

/**
 * Deterministic daily seed from a UTC calendar date.
 * Accepts a Date (uses its UTC Y-M-D) or a `YYYY-MM-DD` string.
 */
export function dailySeed(dateUTC: Date | string = new Date()): number {
  const key = typeof dateUTC === 'string'
    ? dateUTC.slice(0, 10)
    : dateUTC.toISOString().slice(0, 10);
  return hashString(`daily:${key}`);
}

/** Deterministic seed for the next Night Shift floor. */
export function nextFloorSeed(seed: number, floor: number): number {
  return mixUint32((seed >>> 0) ^ Math.imul(floor >>> 0, 0x9e3779b1));
}

export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

export function isRunMode(value: unknown): value is RunMode {
  return value === 'standard' || value === 'daily' || value === 'nightshift';
}

/** Resolve create options into a concrete seed + mode. */
export function resolveRunCreate(options: RunCreateOptions = {}): { mode: RunMode; seed: number } {
  const mode: RunMode = isRunMode(options.mode) ? options.mode : 'standard';
  if (typeof options.seed === 'number' && Number.isFinite(options.seed)) {
    return { mode, seed: options.seed >>> 0 };
  }
  if (mode === 'daily') {
    return { mode, seed: dailySeed() };
  }
  return { mode, seed: randomSeed() };
}

export function createRunState(options: RunCreateOptions = {}, now = Date.now()): RunState {
  const { mode, seed } = resolveRunCreate(options);
  return {
    mode,
    seed,
    floor: 1,
    captures: 0,
    maxCaptures: MAX_CAPTURES,
    startedAt: now,
    floorTimes: [],
  };
}

/** Night Shift: record floor time, bump floor, and derive the next seed. */
export function advanceFloor(state: RunState, floorTimeSeconds = 0): RunState {
  const floor = state.floor + 1;
  return {
    ...state,
    floor,
    seed: nextFloorSeed(state.seed, floor),
    floorTimes: [...state.floorTimes, floorTimeSeconds],
  };
}

/** Night Shift: increment captures; `ended` when the run is out of lives. */
export function recordCapture(state: RunState): { state: RunState; ended: boolean } {
  const captures = state.captures + 1;
  return {
    state: { ...state, captures },
    ended: captures >= state.maxCaptures,
  };
}

export interface ChallengeUrlOptions {
  seed: number;
  mode?: RunMode;
  beat?: number;
}

/** Build a challenge link preserving path and other query params. */
export function challengeUrl(base: string | URL, options: ChallengeUrlOptions): string {
  const url = new URL(typeof base === 'string' ? base : base.toString());
  url.searchParams.set('seed', formatSeed(options.seed));
  if (options.mode && options.mode !== 'standard') {
    url.searchParams.set('mode', options.mode);
  } else {
    url.searchParams.delete('mode');
  }
  if (options.beat != null && Number.isFinite(options.beat)) {
    url.searchParams.set('beat', String(Math.max(0, Math.round(options.beat))));
  } else {
    url.searchParams.delete('beat');
  }
  return url.toString();
}

/** Build a daily-run link (`?mode=daily`). Optionally pin a UTC date via seed. */
export function dailyUrl(base: string | URL, options?: { date?: Date | string }): string {
  const url = new URL(typeof base === 'string' ? base : base.toString());
  url.searchParams.set('mode', 'daily');
  if (options?.date != null) {
    url.searchParams.set('seed', formatSeed(dailySeed(options.date)));
  } else {
    url.searchParams.delete('seed');
  }
  url.searchParams.delete('beat');
  return url.toString();
}

export interface UrlRunOptions {
  seed?: number;
  mode?: RunMode;
  beat?: number;
}

/** Read `?seed=`, `?mode=daily|nightshift`, `?beat=<ms>` from a search string or params. */
export function runOptionsFromSearch(search: string | URLSearchParams): UrlRunOptions {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
  const out: UrlRunOptions = {};
  const seed = parseSeed(params.get('seed'));
  if (seed != null) out.seed = seed;
  const modeRaw = params.get('mode')?.trim().toLowerCase();
  if (modeRaw === 'daily' || modeRaw === 'nightshift') out.mode = modeRaw;
  const beatRaw = params.get('beat');
  if (beatRaw != null && beatRaw !== '') {
    const beat = Number(beatRaw);
    if (Number.isFinite(beat) && beat >= 0) out.beat = beat;
  }
  return out;
}
