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
import { applyRunLayout, generateRun } from '../../shared/run-layout.ts';

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
  ended: boolean;
}

type FloorStartListener = (payload: FloorStartPayload) => void;

let snapshot: ClientRunSnapshot | null = null;
let localState: RunState | null = null;
let beatTarget: number | null = null;
let ended = false;
const floorListeners = new Set<FloorStartListener>();

function toSnapshot(state: RunState): ClientRunSnapshot {
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
    ended,
  };
}

/** Current run view for UI (null before a run is started). */
export function getRunState(): ClientRunSnapshot | null {
  return snapshot;
}

export function onFloorStart(listener: FloorStartListener): () => void {
  floorListeners.add(listener);
  return () => {
    floorListeners.delete(listener);
  };
}

/**
 * Hook point: apply the (future) seed-driven layout, then notify listeners.
 * Call whenever the floor seed changes (solo start, multiplayer floor-start, reconnect restore).
 */
export function applyFloorStart(payload: FloorStartPayload): void {
  applyRunLayout(generateRun(payload.seed, payload.floor));
  for (const listener of floorListeners) listener(payload);
}

export function readUrlRunOptions(search = window.location.search): UrlRunOptions {
  return runOptionsFromSearch(search);
}

/** Start a local (solo / offline) run from URL options. Does not contact the server. */
export function startLocalRun(options?: UrlRunOptions): ClientRunSnapshot {
  const fromUrl = options ?? readUrlRunOptions();
  beatTarget = fromUrl.beat ?? null;
  ended = false;
  localState = createRunState({ seed: fromUrl.seed, mode: fromUrl.mode });
  snapshot = toSnapshot(localState);
  applyFloorStart({ seed: localState.seed, floor: localState.floor });
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
  ended?: boolean;
}): ClientRunSnapshot {
  localState = null;
  if (partial.ended != null) ended = partial.ended;
  const state: RunState = {
    mode: partial.mode,
    seed: partial.seed >>> 0,
    floor: partial.floor,
    captures: partial.captures,
    maxCaptures: partial.maxCaptures,
    startedAt: partial.startedAt,
    floorTimes: [...partial.floorTimes],
  };
  snapshot = toSnapshot(state);
  return snapshot;
}

/** Solo Night Shift: successful escape → next floor + new seed. */
export function localEscape(floorTimeSeconds = 0): ClientRunSnapshot | null {
  if (!localState || localState.mode !== 'nightshift' || ended) return snapshot;
  localState = advanceFloor(localState, floorTimeSeconds);
  snapshot = toSnapshot(localState);
  applyFloorStart({ seed: localState.seed, floor: localState.floor });
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

export {
  formatSeed,
  parseSeed,
  dailySeed,
  nextFloorSeed,
  runOptionsFromSearch,
} from '../../shared/run.ts';
