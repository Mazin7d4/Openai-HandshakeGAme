import { serverHttpUrl } from './ServerEndpoint.ts';

export interface Entry {
  id: string;
  display: string;
  names: { pix: string; nee: string };
  team: string;
  score: number;
  timeSeconds: number;
  floors: number;
  spotted: number;
  recordedAt: number;
  seed: number;
}

export interface Board {
  key: string;
  entries: Entry[];
}

export interface LeaderboardSummary {
  daily: Board;
  nightshift: Board;
  nightshiftWeek: Board;
  solo?: { daily: Board; nightshift: Board; nightshiftWeek: Board };
}

export interface RecordedBoard extends Board {
  rank: number | null;
}

export interface LeaderboardRecordedPayload {
  id: string;
  boards: RecordedBoard[];
}

export interface LeaderboardNameResult {
  ok: boolean;
  reason?: 'empty' | 'profanity' | 'limit';
  name?: string;
}

export type LeaderboardFetchResult =
  | { status: 'ok'; data: LeaderboardSummary }
  | { status: 'waking' }
  | { status: 'error' };

interface FetchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function isBoard(value: unknown): value is Board {
  const board = value as Partial<Board> | null;
  return Boolean(board && typeof board.key === 'string' && Array.isArray(board.entries));
}

function isSummary(value: unknown): value is LeaderboardSummary {
  const summary = value as Partial<LeaderboardSummary> | null;
  return Boolean(summary && isBoard(summary.daily) && isBoard(summary.nightshift) && isBoard(summary.nightshiftWeek));
}

/** Fetch the public boards without making a failed wake-up request an app error. */
export async function fetchLeaderboards({ timeoutMs = 6000, signal }: FetchOptions = {}): Promise<LeaderboardFetchResult> {
  const controller = new AbortController();
  let timer: number | undefined;
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  try {
    if (signal?.aborted) return { status: 'error' };
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(0, timeoutMs));
    const response = await fetch(`${serverHttpUrl()}/leaderboard`, {
      signal: controller.signal,
      cache: 'no-store',
      mode: 'cors',
    });
    if (response.status === 202 || response.status === 502 || response.status === 503 || response.status === 504) {
      return { status: 'waking' };
    }
    if (!response.ok) return { status: 'error' };
    const data: unknown = await response.json();
    if (!isSummary(data)) return { status: 'error' };
    return { status: 'ok', data };
  } catch {
    return timedOut ? { status: 'waking' } : { status: 'error' };
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function formatEntryScore(boardKey: string, entry: Entry): string {
  if (boardKey.includes('daily:')) {
    const tenths = Math.max(0, Math.round((Number(entry.timeSeconds) || 0) * 10));
    const minutes = Math.floor(tenths / 600);
    const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
    return `${minutes}:${seconds}`;
  }
  return `${(Number(entry.score) || 0).toLocaleString('en-US')} · F${Math.max(0, Number(entry.floors) || 0)}`;
}
