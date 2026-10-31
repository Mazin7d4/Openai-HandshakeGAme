import { serverHttpUrl } from './ServerEndpoint.ts';

export type WarmupState = 'unknown' | 'waking' | 'ready' | 'unreachable';
export type WarmupListener = (state: WarmupState) => void;

const DEFAULT_BUDGET_MS = 150_000;
const MIN_BUDGET_MS = 1_000;
const MAX_BUDGET_MS = 300_000;
// Render may hold the first request while the container boots. Keep that request alive.
const PING_TIMEOUT_MS = 60_000;
const RETRY_BACKOFFS_MS = [500, 1_000, 2_000, 3_000];

let state: WarmupState = 'unknown';
let runPromise: Promise<void> | null = null;
let runId = 0;
let readyAt = 0;
/** Render's free tier sleeps after ~15 min idle, so an old "ready" is re-checked before host/join. */
const READY_FRESH_MS = 5 * 60_000;

export let warmupStartedAt: number | null = null;

const listeners = new Set<WarmupListener>();

function setWarmupState(next: WarmupState): void {
  if (next === 'ready') readyAt = Date.now();
  document.documentElement.dataset.warmup = next;
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener(state);
}

function budgetFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('wakeTimeout');
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_BUDGET_MS;
  return Math.max(MIN_BUDGET_MS, Math.min(MAX_BUDGET_MS, Number(raw)));
}

export function warmupBudgetMs(): number {
  return budgetFromUrl();
}

async function pingHealth(remainingMs: number): Promise<boolean> {
  try {
    const response = await fetch(`${serverHttpUrl()}/health`, {
      mode: 'cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1, Math.min(PING_TIMEOUT_MS, remainingMs))),
    });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runWarmup(id: number, startedAt: number, budgetMs: number): Promise<void> {
  const remaining = () => Math.max(0, budgetMs - (Date.now() - startedAt));

  if (await pingHealth(remaining())) {
    if (id === runId) setWarmupState('ready');
    return;
  }
  if (id !== runId) return;
  setWarmupState('waking');

  let retry = 0;
  while (id === runId && remaining() > 0) {
    const backoff = RETRY_BACKOFFS_MS[Math.min(retry, RETRY_BACKOFFS_MS.length - 1)];
    await wait(Math.min(backoff, remaining()));
    if (id !== runId || remaining() <= 0) break;
    if (await pingHealth(remaining())) {
      if (id === runId) setWarmupState('ready');
      return;
    }
    retry++;
  }

  if (id === runId) setWarmupState('unreachable');
}

export function getWarmupState(): WarmupState {
  return state;
}

export function onWarmupChange(callback: WarmupListener): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function startWarmup(): void {
  if (state === 'ready' || state === 'waking' || runPromise) return;
  if (state === 'unreachable') return;

  const startedAt = Date.now();
  const id = ++runId;
  warmupStartedAt = startedAt;
  setWarmupState('waking');
  const promise = runWarmup(id, startedAt, budgetFromUrl());
  let tracked: Promise<void>;
  tracked = promise.finally(() => {
    if (runPromise === tracked) runPromise = null;
  });
  runPromise = tracked;
  void runPromise;
}

export function warmupIsFresh(): boolean {
  return state === 'ready' && Date.now() - readyAt < READY_FRESH_MS;
}

export function warmupReadyWithin(ms: number): boolean {
  return state === 'ready' && Date.now() - readyAt < ms;
}

/** Start a new check unless one is running: after unreachable, or when "ready" has gone stale. */
export function revalidateWarmup(): void {
  if (state === 'waking' || state === 'unknown' && runPromise) return;
  if (warmupIsFresh()) return;
  runId++;
  runPromise = null;
  state = 'unknown';
  startWarmup();
}

export function retryWarmup(): void {
  if (state !== 'unreachable') {
    startWarmup();
    return;
  }
  runPromise = null;
  setWarmupState('unknown');
  startWarmup();
}

export function waitForServer(options: {
  signal?: AbortSignal;
  onTick?: (elapsedMs: number, state: WarmupState) => void;
} = {}): Promise<'ready' | 'unreachable' | 'cancelled'> {
  if (state === 'ready') return Promise.resolve('ready');
  if (state === 'unreachable') return Promise.resolve('unreachable');

  startWarmup();
  const signal = options.signal;
  if (signal?.aborted) return Promise.resolve('cancelled');

  return new Promise((resolve) => {
    let settled = false;
    const startedAt = warmupStartedAt ?? Date.now();
    const elapsed = () => Math.max(0, Date.now() - startedAt);
    const finish = (result: 'ready' | 'unreachable' | 'cancelled') => {
      if (settled) return;
      settled = true;
      unsubscribe();
      window.clearInterval(ticker);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const onChange = (next: WarmupState) => {
      options.onTick?.(elapsed(), next);
      if (next === 'ready' || next === 'unreachable') finish(next);
    };
    const unsubscribe = onWarmupChange(onChange);
    const abort = () => finish('cancelled');
    const ticker = window.setInterval(() => options.onTick?.(elapsed(), state), 1_000);

    options.onTick?.(elapsed(), state);
    signal?.addEventListener('abort', abort, { once: true });
    if (state === 'ready' || state === 'unreachable') finish(state);
  });
}
