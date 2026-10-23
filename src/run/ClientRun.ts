/**
 * Client-side run-state accessor for HUD / title-screen / Heist Report owners.
 * Multiplayer mirrors room state; solo keeps a local RunState (never contacts the server).
 */
import {
  advanceFloor,
  challengeUrl as buildChallengeUrl,
  createRunState,
  dailyUrl as buildDailyUrl,
  formatSeed,
  recordCapture,
  runOptionsFromSearch,
  type ChallengeUrlOptions,
  type FloorStartPayload,
  type RunMode,
  type RunState,
  type UrlRunOptions,
} from '../../shared/run.ts';
import {
  applyRunLayout,
  generateRun,
  getRunSeed,
  setRunSeedGetter,
  type ApplyRunLayoutTargets,
  type RunLayout,
} from '../seed/index.ts';

export interface ClientRunSnapshot {
  mode: RunMode;
  seed: number;
  seedCode: string;
  floor: number;
  captures: number;
  maxCaptures: number;
  beatTarget: number | null;
  startedAt: number;
  floorTimes: readonly number[];
  score: number;
  streak: number;
  multiplier: number;
  lastFloorPoints: number;
  floorCleared: boolean;
  ended: boolean;
}

type FloorStartListener = (payload: FloorStartPayload, layout: RunLayout | null) => void;
type LayoutSinkProvider = () => ApplyRunLayoutTargets | null | undefined;

let snapshot: ClientRunSnapshot | null = null;
let localState: RunState | null = null;
let beatTarget: number | null = null;
let ended = false;
const floorListeners = new Set<FloorStartListener>();
let layoutSinkProvider: LayoutSinkProvider | null = null;

function toSnapshot(state: RunState): ClientRunSnapshot {
  const scored = state as RunState & Partial<Pick<ClientRunSnapshot, 'score' | 'streak' | 'multiplier' | 'lastFloorPoints' | 'floorCleared'>>;
  return {
    mode: state.mode,
    seed: state.seed,
    seedCode: formatSeed(state.seed),
    floor: state.floor,
    captures: state.captures,
    maxCaptures: state.maxCaptures,
    beatTarget,
    startedAt: state.startedAt,
    floorTimes: [...state.floorTimes],
    score: scored.score ?? 0,
    streak: scored.streak ?? 0,
    multiplier: scored.multiplier ?? 1,
    lastFloorPoints: scored.lastFloorPoints ?? 0,
    floorCleared: scored.floorCleared ?? false,
    ended,
  };
}

/** Current run view for UI (null before a run is started). */
export function getRunState(): ClientRunSnapshot | null {
  return snapshot;
}

/** GameplayWorld registers sinks so floor-start can call applyRunLayout(generateRun(...), sinks). */
export function setLayoutSinkProvider(provider: LayoutSinkProvider | null): void {
  layoutSinkProvider = provider;
}

export function onFloorStart(listener: FloorStartListener): () => void {
  floorListeners.add(listener);
  return () => {
    floorListeners.delete(listener);
  };
}

/**
 * Hook point for seed-driven layout.
 * Night Shift only remixed; standard/daily keep the handcrafted level.
 * Call on solo start, multiplayer floor-start, and reconnect restore.
 */
export function applyFloorStart(payload: FloorStartPayload): RunLayout | null {
  const mode = payload.mode ?? snapshot?.mode ?? localState?.mode ?? 'standard';
  let layout: RunLayout | null = null;
  if (mode === 'nightshift') {
    layout = generateRun(payload.seed, payload.floor);
    const sinks = layoutSinkProvider?.() ?? undefined;
    applyRunLayout(layout, sinks ?? undefined);
  }
  for (const listener of floorListeners) listener({ ...payload, mode }, layout);
  return layout;
}

export function readUrlRunOptions(search = window.location.search): UrlRunOptions {
  return runOptionsFromSearch(search);
}

/** Start a local (solo / offline) run. Does not contact the server. */
export function startLocalRun(
  options?: UrlRunOptions & { mode?: RunMode; floor?: number; captures?: number },
): ClientRunSnapshot {
  const fromUrl = { ...readUrlRunOptions(), ...options };
  if (fromUrl.beat != null) beatTarget = fromUrl.beat;
  ended = false;

  let seed = fromUrl.seed;
  let floor = fromUrl.floor;
  // Honor stash / prepared seed when URL/options omit them (Play again, Next floor, Daily).
  if (seed == null || floor == null) {
    const resolved = getRunSeed(seed != null ? { seed, floor: floor ?? 1 } : null);
    seed = seed ?? resolved.seed;
    floor = floor ?? resolved.floor;
  }

  localState = createRunState({ seed, mode: fromUrl.mode });
  localState = {
    ...localState,
    floor: Math.max(1, (floor ?? localState.floor) | 0),
    captures: Math.max(0, (fromUrl.captures ?? localState.captures) | 0),
  };
  snapshot = toSnapshot(localState);
  applyFloorStart({ seed: localState.seed, floor: localState.floor, mode: localState.mode });
  return snapshot;
}

/** Mirror authoritative multiplayer run fields into the client accessor. */
export function syncNetworkRun(partial: {
  mode: RunMode;
  seed: number;
  floor: number;
  captures: number;
  maxCaptures: number;
  startedAt: number;
  floorTimes: readonly number[];
  score: number;
  streak: number;
  multiplier: number;
  lastFloorPoints: number;
  floorCleared: boolean;
  ended?: boolean;
}): ClientRunSnapshot {
  localState = null;
  if (partial.ended != null) ended = partial.ended;
  const state = {
    mode: partial.mode,
    seed: partial.seed >>> 0,
    floor: partial.floor,
    captures: partial.captures,
    maxCaptures: partial.maxCaptures,
    startedAt: partial.startedAt,
    floorTimes: [...partial.floorTimes],
    score: partial.score ?? 0,
    streak: partial.streak ?? 0,
    multiplier: partial.multiplier ?? 1,
    lastFloorPoints: partial.lastFloorPoints ?? 0,
    floorCleared: partial.floorCleared ?? false,
  } as RunState;
  snapshot = toSnapshot(state);
  return snapshot;
}

/** Solo Night Shift: successful escape → next floor + new seed. */
export function localEscape(floorTimeSeconds = 0): ClientRunSnapshot | null {
  if (!localState || localState.mode !== 'nightshift' || ended) return snapshot;
  localState = advanceFloor(localState, floorTimeSeconds);
  snapshot = toSnapshot(localState);
  applyFloorStart({ seed: localState.seed, floor: localState.floor, mode: localState.mode });
  return snapshot;
}

/** Solo Night Shift: capture → increment; end run at maxCaptures. */
export function localCapture(): ClientRunSnapshot | null {
  if (!localState || localState.mode !== 'nightshift' || ended) return snapshot;
  const result = recordCapture(localState);
  localState = result.state;
  ended = result.ended;
  snapshot = toSnapshot(localState);
  return snapshot;
}

export function setBeatTarget(ms: number | null): void {
  beatTarget = ms;
  if (snapshot) snapshot = { ...snapshot, beatTarget };
}

export function clearRunState(): void {
  snapshot = null;
  localState = null;
  beatTarget = null;
  ended = false;
}

export function challengeUrl(options: ChallengeUrlOptions, base = window.location.href): string {
  return buildChallengeUrl(base, options);
}

export function dailyUrl(options?: { date?: Date | string }, base = window.location.href): string {
  return buildDailyUrl(base, options);
}

// Register as the getRunSeed() backing store for Night Shift / HUD.
setRunSeedGetter(() => {
  if (!snapshot) return null;
  return { seed: snapshot.seed, floor: snapshot.floor };
});

export {
  formatSeed,
  parseSeed,
  dailySeed,
  nextFloorSeed,
  runOptionsFromSearch,
} from '../../shared/run.ts';
