import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailySeed } from '../shared/run.ts';
import {
  LeaderboardStore,
  MAX_FLOOR_POINTS,
  isProfane,
  normalizeForProfanity,
  RateLimiter,
  sanitizeName,
  validateRun,
} from '../server/leaderboard.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runChecks() {
  assert(normalizeForProfanity('FUUUCK') === 'fuuck', 'repeat normalization');
  for (const value of ['sh1t', 'f u c k', 'FUUUCK', 'b!tch']) assert(isProfane(value), `profanity missed: ${value}`);
  for (const value of ['Scunthorpe', 'Classic', 'Assassin', 'Titan', 'Pix & Nee']) assert(!isProfane(value), `false profanity: ${value}`);
  assert(sanitizeName('  Píx\u200b\tNee!<>01234567890123456789  ') === 'Píx Nee!01234567', 'name sanitation');

  const started = Date.parse('2026-10-25T10:00:00.000Z');
  const now = started + 40_000;
  const daily = {
    mode: 'daily', seed: dailySeed('2026-10-25'), missionStartedAt: started, now,
    elapsedSeconds: 35, timesSpotted: 0, lootDelivered: 1, humans: 2, bots: 0, tainted: false,
  };
  assert(validateRun(daily, {}).ok, 'daily accepted');
  assert(validateRun({ ...daily, elapsedSeconds: 30, now: started + 5_000 }, {}).reason === 'daily-wall-clock', 'daily wall clock');
  assert(validateRun({ ...daily, elapsedSeconds: 29 }, {}).reason === 'daily-time', 'daily minimum');
  assert(validateRun({ ...daily, seed: 1 }, {}).reason === 'daily-seed', 'daily seed');
  assert(validateRun({ ...daily, bots: 1 }, {}).reason === 'players', 'bot rejected');
  assert(validateRun({ ...daily, humans: 1 }, {}).reason === 'players', 'one human rejected');
  assert(validateRun({ ...daily, tainted: true }, {}).reason === 'tainted', 'taint rejected');
  assert(validateRun({ ...daily, tainted: true, lootDelivered: 0 }, { acceptTainted: true }).ok, 'debug daily accepted');

  const soloDaily = {
    ...daily, now: started + 50_000, elapsedSeconds: 45, humans: 1, bots: 1,
  };
  const soloDailyResult = validateRun(soloDaily, {});
  assert(soloDailyResult.ok && soloDailyResult.kind === 'solo' && soloDailyResult.boards[0] === 'solo:daily:2026-10-25', 'solo daily accepted');
  assert(validateRun({ ...soloDaily, elapsedSeconds: 44 }, {}).reason === 'daily-time', 'solo daily minimum');
  assert(validateRun({ ...soloDaily, humans: 1, bots: 0 }, {}).reason === 'players', 'one human without bot rejected');
  assert(validateRun({ ...soloDaily, humans: 2, bots: 1 }, {}).reason === 'players', 'three-player run rejected');

  const night = {
    mode: 'nightshift', seed: 123, missionStartedAt: started, runStartedAt: started,
    now: started + 45_000, elapsedSeconds: 20, timesSpotted: 1, lootDelivered: 0,
    floorsCleared: 2, score: MAX_FLOOR_POINTS * 2 - 1, captures: 3, maxCaptures: 3,
    humans: 2, bots: 0, tainted: false,
  };
  assert(validateRun(night, { minFloorSeconds: 20 }).ok, 'night accepted');
  assert(validateRun({ ...night, score: MAX_FLOOR_POINTS * 2 + 1 }, { minFloorSeconds: 20 }).reason === 'score', 'night score bound');
  assert(validateRun({ ...night, floorsCleared: 0 }, { minFloorSeconds: 20 }).reason === 'floors', 'night floors');
  assert(validateRun({ ...night, now: started + 20_000 }, { minFloorSeconds: 20 }).reason === 'duration', 'night duration');
  const soloNight = { ...night, now: started + 55_000, humans: 1, bots: 1 };
  const soloNightResult = validateRun(soloNight, {});
  assert(soloNightResult.ok && soloNightResult.kind === 'solo' && soloNightResult.boards.includes('solo:nightshift:all'), 'solo night accepted');
  assert(validateRun({ ...soloNight, now: started + 49_000 }, {}).reason === 'duration', 'solo night minimum');

  let clock = started;
  const limiter = new RateLimiter({ limit: 2, windowMs: 1000, now: () => clock });
  assert(limiter.hit('ip') && limiter.hit('ip') && !limiter.hit('ip'), 'rate limiter limit');
  clock += 1001;
  assert(limiter.hit('ip'), 'rate limiter window');

  const root = mkdtempSync(join(tmpdir(), 'leaderboard-unit-'));
  const file = join(root, 'leaderboard.json');
  const store = new LeaderboardStore({ file, writeDelayMs: 0, now: () => started });
  store.add(['daily:2026-10-25'], { names: { pix: 'PIX', nee: 'NEE' }, timeSeconds: 30, spotted: 1, recordedAt: started, seed: 1 });
  store.add(['daily:2026-10-25'], { names: { pix: 'A', nee: 'B' }, timeSeconds: 20, spotted: 2, recordedAt: started + 1, seed: 1 });
  assert(store.top('daily:2026-10-25')[0].timeSeconds === 20, 'daily ordering');
  store.add(['nightshift:all'], { names: { pix: 'PIX', nee: 'NEE' }, score: 100, floors: 1, recordedAt: started, seed: 1 });
  store.add(['nightshift:all'], { names: { pix: 'A', nee: 'B' }, score: 200, floors: 1, recordedAt: started + 1, seed: 1 });
  assert(store.top('nightshift:all')[0].score === 200, 'night ordering');
  store.add(['solo:daily:2026-10-25'], { names: { pix: 'PIX', nee: 'AI' }, timeSeconds: 30, spotted: 1, recordedAt: started, seed: 1 });
  store.add(['solo:daily:2026-10-25'], { names: { pix: 'A', nee: 'AI' }, timeSeconds: 20, spotted: 2, recordedAt: started + 1, seed: 1 });
  assert(store.top('solo:daily:2026-10-25')[0].timeSeconds === 20, 'solo daily ordering');
  const summary = store.boardsSummary(started);
  assert(summary.solo.daily.key === 'solo:daily:2026-10-25' && summary.solo.nightshift.key === 'solo:nightshift:all', 'solo summary');
  const id = store.top('daily:2026-10-25')[0].id;
  assert(store.rename(id, 'pix', 'Ace'), 'rename');
  store.flushSync();
  const loaded = new LeaderboardStore({ file, writeDelayMs: 0 });
  loaded.load();
  assert(loaded.top('daily:2026-10-25')[0].display.includes('Ace'), 'persistence');
  rmSync(root, { recursive: true, force: true });
}

try {
  runChecks();
  console.log('leaderboard-unit ok');
} catch (error) {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
}
