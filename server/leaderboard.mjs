import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dailySeed } from '../shared/run.ts';
import { PROFANITY_WORDS, WHOLE_WORD } from './profanity-words.mjs';

const LEET = new Map([
  ['0', 'o'], ['1', 'i'], ['3', 'e'], ['4', 'a'], ['5', 's'], ['7', 't'],
  ['8', 'b'], ['9', 'g'], ['@', 'a'], ['$', 's'], ['!', 'i'], ['|', 'i'], ['+', 't'],
]);

function lettersOnly(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0-9@$!|+]/g, (character) => LEET.get(character) ?? character)
    .replace(/[^a-z]/g, '');
}

function collapseRepeats(value, count) {
  const expression = count === 1 ? /(.)\1+/g : /(.)\1{2,}/g;
  return value.replace(expression, '$1'.repeat(count));
}

export function normalizeForProfanity(text) {
  return collapseRepeats(lettersOnly(text), 2);
}

function normalizedTokens(text) {
  return String(text).normalize('NFKD').split(/\s+/u).filter(Boolean).map(lettersOnly)
    .flatMap((token) => [collapseRepeats(token, 2), collapseRepeats(token, 1)]);
}

export function isProfane(text) {
  const normalized = normalizeForProfanity(text);
  const collapsed = collapseRepeats(normalized, 1);
  if (PROFANITY_WORDS.some((word) => normalized.includes(word) || collapsed.includes(word))) return true;
  const tokens = normalizedTokens(text);
  return WHOLE_WORD.some((word) => tokens.includes(word));
}

export function sanitizeName(raw) {
  const value = String(raw ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}\u200B-\u200D\uFEFF]/gu, '')
    .trim()
    .replace(/[^\p{L}\p{N} _.'!&-]/gu, '');
  return Array.from(value).slice(0, 16).join('');
}

// floorBase's bounded terms are: 1000 + (300 * 4) + (50 * 10 tether saves)
// + (25 * 10 twangs) = 2950. The score multiplier is capped at 3, so 8850
// is a deliberately conservative per-floor bound for leaderboard validation.
export const MAX_FLOOR_POINTS = 8850;

function utcDate(value) {
  const time = Number(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function isoWeekKey(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const year = day.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round((day - firstThursday) / 604800000);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateRun(run, limits = {}) {
  if (!run || (run.mode !== 'daily' && run.mode !== 'nightshift')) return { ok: false, reason: 'mode' };
  const kind = run.humans === 2 && run.bots === 0
    ? 'coop'
    : run.humans === 1 && run.bots === 1
      ? 'solo'
      : null;
  if (!kind) return { ok: false, reason: 'players' };
  if (run.tainted && limits.acceptTainted !== true) return { ok: false, reason: 'tainted' };

  const now = utcDate(run.now);
  if (!now) return { ok: false, reason: 'now' };

  if (run.mode === 'daily') {
    const started = utcDate(run.missionStartedAt);
    const elapsed = Number(run.elapsedSeconds);
    const minSeconds = kind === 'solo'
      ? (Number.isFinite(limits.soloMinDailySeconds) ? limits.soloMinDailySeconds : 45)
      : (Number.isFinite(limits.minDailySeconds) ? limits.minDailySeconds : 30);
    if (!finite(elapsed) || elapsed < minSeconds || elapsed > 3600) return { ok: false, reason: 'daily-time' };
    if (!started || elapsed > (now.getTime() - started.getTime()) / 1000 + 2) return { ok: false, reason: 'daily-wall-clock' };
    if ((!finite(Number(run.lootDelivered)) || Number(run.lootDelivered) < 1) && !(run.tainted && limits.acceptTainted === true)) return { ok: false, reason: 'loot' };
    const startedKey = started && dateKey(started);
    const nowKey = dateKey(now);
    const matches = [startedKey, nowKey].filter((key, index, keys) => keys.indexOf(key) === index && Number(run.seed) === dailySeed(key));
    if (matches.length === 0) return { ok: false, reason: 'daily-seed' };
    return { ok: true, boards: [`${kind === 'solo' ? 'solo:' : ''}daily:${matches[0]}`], kind };
  }

  if (!Number.isFinite(run.captures) || run.captures < Number(run.maxCaptures)) return { ok: false, reason: 'captures' };
  const floors = Number(run.floorsCleared);
  if (!Number.isInteger(floors) || floors < 1 || floors > 200) return { ok: false, reason: 'floors' };
  const score = Number(run.score);
  if (!finite(score) || score <= 0 || score > floors * MAX_FLOOR_POINTS) return { ok: false, reason: 'score' };
  const runStarted = utcDate(run.runStartedAt);
  if (!runStarted) return { ok: false, reason: 'run-start' };
  const duration = (now.getTime() - runStarted.getTime()) / 1000;
  const minFloorSeconds = kind === 'solo'
    ? (Number.isFinite(limits.soloMinFloorSeconds) ? limits.soloMinFloorSeconds : 25)
    : (Number.isFinite(limits.minFloorSeconds) ? limits.minFloorSeconds : 20);
  if (duration < floors * minFloorSeconds || duration > 8 * 60 * 60) return { ok: false, reason: 'duration' };
  const week = isoWeekKey(now);
  const prefix = kind === 'solo' ? 'solo:' : '';
  return { ok: true, boards: [`${prefix}nightshift:all`, `${prefix}nightshift:week:${week}`], kind };
}

function boardType(board) {
  return board.startsWith('daily:') || board.startsWith('solo:daily:') ? 'daily' : 'nightshift';
}

function compareEntries(a, b, board) {
  if (boardType(board) === 'daily') {
    return (a.timeSeconds - b.timeSeconds)
      || (a.spotted - b.spotted)
      || (a.recordedAt - b.recordedAt)
      || a.id.localeCompare(b.id);
  }
  return (b.score - a.score)
    || (b.floors - a.floors)
    || (a.recordedAt - b.recordedAt)
    || a.id.localeCompare(b.id);
}

function cloneEntry(entry) {
  return { ...entry, names: { ...entry.names } };
}

function displayEntry(entry) {
  return { ...cloneEntry(entry), display: entry.team || `${entry.names.pix} & ${entry.names.nee}` };
}

function parseStored(value) {
  if (!value || typeof value !== 'object' || !value.boards || typeof value.boards !== 'object') {
    throw new Error('invalid leaderboard format');
  }
  const boards = {};
  for (const [board, entries] of Object.entries(value.boards)) {
    if (!Array.isArray(entries)) continue;
    boards[board] = entries.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string')
      .map((entry) => ({
        id: entry.id,
        board,
        names: { pix: String(entry.names?.pix ?? 'PIX'), nee: String(entry.names?.nee ?? 'NEE') },
        team: String(entry.team ?? ''),
        score: Number(entry.score) || 0,
        timeSeconds: Number(entry.timeSeconds) || 0,
        floors: Number(entry.floors) || 0,
        spotted: Number(entry.spotted) || 0,
        recordedAt: Number(entry.recordedAt) || 0,
        seed: Number(entry.seed) >>> 0,
      }));
  }
  return boards;
}

export class LeaderboardStore {
  constructor({ file, keepPerBoard = 50, keepDailyBoards = 14, keepWeeklyBoards = 8, now = () => Date.now(), writeDelayMs = 250 } = {}) {
    this.file = file || '';
    this.keepPerBoard = Math.max(1, Math.floor(keepPerBoard));
    this.keepDailyBoards = Math.max(0, Math.floor(keepDailyBoards));
    this.keepWeeklyBoards = Math.max(0, Math.floor(keepWeeklyBoards));
    this.now = now;
    this.writeDelayMs = Math.max(0, Number(writeDelayMs) || 0);
    this.boards = {};
    this.writeTimer = null;
    this.dirty = false;
  }

  load() {
    if (!this.file) return this;
    try {
      if (!existsSync(this.file)) return this;
      this.boards = parseStored(JSON.parse(readFileSync(this.file, 'utf8')));
      for (const [board, entries] of Object.entries(this.boards)) {
        entries.sort((a, b) => compareEntries(a, b, board));
        entries.splice(this.keepPerBoard);
      }
      this.prune();
    } catch (error) {
      console.warn(`[handshake] leaderboard load warning: ${error?.message ?? String(error)}`);
      this.boards = {};
    }
    return this;
  }

  prune() {
    const pruneType = (prefix, keep) => {
      const keys = Object.keys(this.boards).filter((key) => key.startsWith(prefix)).sort().reverse();
      for (const key of keys.slice(keep)) delete this.boards[key];
    };
    for (const prefix of ['daily:', 'solo:daily:']) pruneType(prefix, this.keepDailyBoards);
    for (const prefix of ['nightshift:week:', 'solo:nightshift:week:']) pruneType(prefix, this.keepWeeklyBoards);
  }

  scheduleWrite() {
    if (!this.file) return;
    this.dirty = true;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flushSync();
    }, this.writeDelayMs);
    this.writeTimer.unref?.();
  }

  flushSync() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.file || !this.dirty) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp-${process.pid}`;
      writeFileSync(temporary, JSON.stringify({ version: 1, boards: this.boards }, null, 2));
      renameSync(temporary, this.file);
      this.dirty = false;
    } catch (error) {
      console.warn(`[handshake] leaderboard write warning: ${error?.message ?? String(error)}`);
    }
  }

  add(boardKeys, entryBase) {
    const id = randomBytes(4).toString('hex');
    const ranks = {};
    const keys = [...new Set(boardKeys)];
    for (const board of keys) {
      const entry = {
        id, board,
        names: { pix: String(entryBase.names?.pix ?? 'PIX'), nee: String(entryBase.names?.nee ?? 'NEE') },
        team: String(entryBase.team ?? ''),
        score: Number(entryBase.score) || 0,
        timeSeconds: Number(entryBase.timeSeconds) || 0,
        floors: Number(entryBase.floors) || 0,
        spotted: Number(entryBase.spotted) || 0,
        recordedAt: Number(entryBase.recordedAt) || this.now(),
        seed: Number(entryBase.seed) >>> 0,
      };
      this.boards[board] ??= [];
      this.boards[board].push(entry);
      this.boards[board].sort((a, b) => compareEntries(a, b, board));
      this.boards[board].splice(this.keepPerBoard);
      const rank = this.boards[board].findIndex((candidate) => candidate.id === id);
      ranks[board] = rank < 0 ? null : rank + 1;
    }
    this.prune();
    for (const board of keys) {
      const rank = (this.boards[board] ?? []).findIndex((candidate) => candidate.id === id);
      ranks[board] = rank < 0 ? null : rank + 1;
    }
    this.scheduleWrite();
    return { id, ranks };
  }

  rename(id, role, name, { team = false } = {}) {
    let changed = false;
    for (const entries of Object.values(this.boards)) {
      for (const entry of entries) {
        if (entry.id !== id) continue;
        if (team) entry.team = name;
        else if (role === 'pix' || role === 'nee') entry.names[role] = name;
        else continue;
        changed = true;
      }
    }
    if (changed) this.scheduleWrite();
    return changed;
  }

  top(board, n = 10) {
    return (this.boards[board] ?? []).slice(0, Math.max(0, n)).map(displayEntry);
  }

  boardsSummary(now = this.now()) {
    const date = utcDate(now) ?? new Date(this.now());
    const dailyKey = `daily:${dateKey(date)}`;
    const weekKey = `nightshift:week:${isoWeekKey(date)}`;
    return {
      daily: { key: dailyKey, entries: this.top(dailyKey) },
      nightshift: { key: 'nightshift:all', entries: this.top('nightshift:all') },
      nightshiftWeek: { key: weekKey, entries: this.top(weekKey) },
      solo: {
        daily: { key: `solo:${dailyKey}`, entries: this.top(`solo:${dailyKey}`) },
        nightshift: { key: 'solo:nightshift:all', entries: this.top('solo:nightshift:all') },
        nightshiftWeek: { key: `solo:nightshift:week:${isoWeekKey(date)}`, entries: this.top(`solo:nightshift:week:${isoWeekKey(date)}`) },
      },
    };
  }
}

export class RateLimiter {
  constructor({ limit, windowMs, now = () => Date.now() } = {}) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.windowMs = Math.max(1, Number(windowMs) || 1);
    this.now = now;
    this.hits = new Map();
  }

  timestamps(key, now = this.now()) {
    const current = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (current.length) this.hits.set(key, current);
    else this.hits.delete(key);
    return current;
  }

  canHit(key) {
    return this.timestamps(key).length < this.limit;
  }

  hit(key) {
    const now = this.now();
    if (this.hits.size > 2000) {
      for (const candidate of this.hits.keys()) this.timestamps(candidate, now);
    }
    const current = this.timestamps(key, now);
    if (current.length >= this.limit) return false;
    current.push(now);
    this.hits.set(key, current);
    return true;
  }
}
