import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { freePort, startTestServer } from '../test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const started = Date.now();
const result = { test: 'leaderboard-server', pass: false, notes: {} };
const rooms = [];
let server;
let tempRoot;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitFor(predicate, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}
async function getJson(port, path, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return { response, body: await response.json() };
}
function eventsFor(room) {
  const events = { recorded: [], skipped: [], names: [] };
  room.onMessage('leaderboard-recorded', (message) => events.recorded.push(message));
  room.onMessage('leaderboard-skipped', (message) => events.skipped.push(message));
  room.onMessage('leaderboard-name-result', (message) => events.names.push(message));
  return events;
}
async function openDaily(port, waitMs = 1200, elapsedSeconds = Math.max(1, Math.round(waitMs / 1000))) {
  const endpoint = `ws://127.0.0.1:${port}`;
  const host = await new Client(endpoint).create('handshake', { mode: 'daily' });
  rooms.push(host);
  const hostEvents = eventsFor(host);
  const guest = await new Client(endpoint).joinById(host.roomId);
  rooms.push(guest);
  const guestEvents = eventsFor(guest);
  await waitFor(() => host.state.started && host.state.players.size === 2, 'daily room started');
  await sleep(waitMs);
  host.send('debug-run-clear', { elapsedSeconds, timesSpotted: 0 });
  return { host, guest, hostEvents, guestEvents };
}
async function closeRoom(room) {
  if (!room) return;
  room.reconnection.maxRetries = 0;
  await Promise.race([room.leave(true).catch(() => {}), sleep(500)]);
}

function runUnit() {
  const unit = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/leaderboard-unit.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 30_000, env: process.env,
  });
  assert(unit.status === 0, `leaderboard unit failed: ${(unit.stderr || unit.stdout || '').slice(-1000)}`);
}

async function phaseOne(file) {
  const port = await freePort();
  server = await startTestServer({
    port, root,
    env: {
      HANDSHAKE_TEST_HOOKS: '1', LEADERBOARD_ACCEPT_DEBUG: '1',
      LEADERBOARD_MIN_DAILY_SECONDS: '1', LEADERBOARD_MIN_FLOOR_SECONDS: '0',
      LEADERBOARD_IP_LIMIT: '3', LEADERBOARD_FILE: file, RECONNECT_SECONDS: '2',
    },
  });
  const daily = await openDaily(port, 3000);
  await waitFor(() => daily.hostEvents.recorded.length === 1 && daily.guestEvents.recorded.length === 1, 'daily recorded');
  const dailyKey = `daily:${new Date().toISOString().slice(0, 10)}`;
  assert(daily.hostEvents.recorded[0].boards.some((board) => board.key === dailyKey && board.rank === 1), 'daily rank');
  let http = await getJson(port, '/leaderboard');
  assert(http.response.status === 200 && http.body.daily.entries.length === 1, 'daily HTTP board');
  daily.host.send('leaderboard-name', { name: 'Ace', score: 999999, timeSeconds: 0.1 });
  await waitFor(() => daily.hostEvents.names.length === 1 && daily.hostEvents.names[0].ok === true, 'name accepted');
  http = await getJson(port, `/leaderboard?board=${encodeURIComponent(dailyKey)}`);
  assert(http.body.entries[0].display.includes('Ace') && http.body.entries[0].score !== 999999, 'client score ignored');
  daily.host.send('leaderboard-submit', { score: 999999 });
  const beforeIgnored = http.body.entries.length;
  await sleep(100);
  http = await getJson(port, '/leaderboard');
  assert(http.body.daily.entries.length === beforeIgnored, 'unknown submit changed board');
  const post = await fetch(`http://127.0.0.1:${port}/leaderboard`, { method: 'POST' });
  assert(post.status === 405, 'POST leaderboard not rejected');
  daily.host.send('leaderboard-name', { name: 'sh1t' });
  await waitFor(() => daily.hostEvents.names.length === 2, 'profanity response');
  assert(daily.hostEvents.names[1].reason === 'profanity', 'profanity response reason');
  await sleep(1050);
  daily.host.send('leaderboard-name', { name: '012345678901234567890' });
  await waitFor(() => daily.hostEvents.names.length === 3, 'long name response');
  assert(daily.hostEvents.names[2].name.length === 16, 'name truncation');
  assert((await getJson(port, '/health')).body.leaderboard === true, 'health leaderboard flag');
  result.notes.daily = dailyKey;

  const forged = await openDaily(port, 100, 5);
  await waitFor(() => forged.hostEvents.skipped.length === 1, 'forged daily skipped');
  assert(forged.hostEvents.skipped[0].reason === 'daily-wall-clock', 'forged daily reason');
  http = await getJson(port, '/leaderboard');
  assert(http.body.daily.entries.length === 1, 'forged daily inserted');
  // Renames re-broadcast the same entry; a second clear of the same run must not add a new one.
  daily.host.send('debug-run-clear', { elapsedSeconds: 2, timesSpotted: 0 });
  await sleep(300);
  assert(new Set(daily.hostEvents.recorded.map((message) => message.id)).size === 1, 'duplicate run record');
  assert((await getJson(port, '/leaderboard')).body.daily.entries.length === 1, 'second clear inserted');

  for (let index = 0; index < 3; index++) {
    const run = await openDaily(port, 1100);
    await waitFor(() => run.hostEvents.recorded.length + run.hostEvents.skipped.length === 1, `rate phase run ${index + 1}`);
    if (index === 2) assert(run.hostEvents.skipped[0]?.reason === 'rate-limit', 'rate limit reason');
  }
  result.notes.rateLimit = true;
  await closeRoom(daily.host); await closeRoom(daily.guest);
  await closeRoom(forged.host); await closeRoom(forged.guest);
  for (const room of rooms.splice(0)) await closeRoom(room);
  await server.stop();
  server = null;
}

async function phaseTwo(file) {
  const port = await freePort();
  server = await startTestServer({
    port, root,
    env: {
      HANDSHAKE_TEST_HOOKS: '1', LEADERBOARD_ACCEPT_DEBUG: '1',
      LEADERBOARD_MIN_DAILY_SECONDS: '1', LEADERBOARD_MIN_FLOOR_SECONDS: '0',
      LEADERBOARD_IP_LIMIT: '100', LEADERBOARD_FILE: file,
      ALLOWED_ORIGINS: 'https://mazin7d4.github.io', RECONNECT_SECONDS: '2',
    },
  });
  const endpoint = `ws://127.0.0.1:${port}`;
  const runs = [];
  for (const spotted of [0, 2]) {
    const host = await new Client(endpoint).create('handshake', { mode: 'nightshift' });
    rooms.push(host);
    const events = eventsFor(host);
    const guest = await new Client(endpoint).joinById(host.roomId);
    rooms.push(guest);
    await waitFor(() => host.state.started && host.state.players.size === 2, 'night room started');
    host.send('debug-run-clear', { elapsedSeconds: 0, timesSpotted: spotted });
    await waitFor(() => host.state.run.floorCleared, 'night floor clear');
    host.send('run-next-floor', { floor: 1 });
    await waitFor(() => host.state.run.floor === 2, 'night next floor');
    host.send('debug-run-capture'); host.send('debug-run-capture'); host.send('debug-run-capture');
    await waitFor(() => events.recorded.length === 1, 'night leaderboard record');
    runs.push({ host, guest, events });
  }
  const board = await getJson(port, '/leaderboard?board=nightshift:all');
  assert(board.response.status === 200 && board.body.entries.length >= 2, 'night board entries');
  assert(board.body.entries[0].score >= board.body.entries[1].score, 'night score ordering');
  assert(board.body.entries[0].score !== board.body.entries[1].score, 'night scores differ');
  const cors = await getJson(port, '/leaderboard', { Origin: 'https://mazin7d4.github.io' });
  assert(cors.response.headers.get('access-control-allow-origin') === 'https://mazin7d4.github.io', 'leaderboard CORS');
  result.notes.nightshift = board.body.entries.slice(0, 2).map((entry) => entry.score);
  for (const room of rooms.splice(0)) await closeRoom(room);
  await server.stop();
  server = null;

  server = await startTestServer({
    port: await freePort(), root,
    env: { LEADERBOARD_FILE: file, LEADERBOARD_IP_LIMIT: '100', ALLOWED_ORIGINS: 'https://mazin7d4.github.io' },
  });
  const persisted = await getJson(server.port, '/leaderboard');
  assert(persisted.body.daily.entries.some((entry) => entry.display.includes('0123456789012345')), 'daily persistence');
  const persistedCors = await getJson(server.port, '/leaderboard', { Origin: 'https://mazin7d4.github.io' });
  assert(persistedCors.response.headers.get('access-control-allow-origin') === 'https://mazin7d4.github.io', 'persisted CORS');
  assert(persisted.body.nightshift.entries.length >= 2, 'night persistence');
}

async function main() {
  runUnit();
  tempRoot = mkdtempSync(join(tmpdir(), 'leaderboard-server-'));
  const file = join(tempRoot, 'lb.json');
  await phaseOne(file);
  await phaseTwo(file);
}

const hardTimeout = setTimeout(() => {
  console.log(`QA_RESULT ${JSON.stringify({ ...result, error: 'overall timeout 90s' })}`);
  server?.child.kill('SIGTERM');
  process.exit(1);
}, 90_000);

try {
  await main();
  result.pass = true;
} catch (error) {
  result.error = String(error?.message ?? error);
  result.serverTail = server?.log?.().split('\n').slice(-30).join('\n');
} finally {
  for (const room of rooms.splice(0)) await closeRoom(room);
  await server?.stop();
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  clearTimeout(hardTimeout);
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log(`QA_RESULT ${JSON.stringify(result)}`);
process.exit(result.pass ? 0 : 1);
