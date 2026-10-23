import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@colyseus/sdk';
import { generateRun } from '../shared/seed/index.mjs';
import { scoreFloorPure } from '../shared/nightShiftScore.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.NIGHTSHIFT_COOP_TEST_PORT ?? 2577);
const RECONNECT_SECONDS = 6;
const started = Date.now();
const result = { test: 'nightshift-coop', pass: false, notes: {} };
const rooms = [];
let server;
let serverLog = '';

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitFor(predicate, message, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}
function waitForPort(port, timeoutMs = 20_000) {
  const began = Date.now();
  return new Promise((resolvePort, reject) => {
    const tryOnce = () => {
      const socket = createConnection({ port, host: '127.0.0.1' }, () => { socket.end(); resolvePort(); });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - began > timeoutMs) reject(new Error(`server did not listen on ${port}`));
        else setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}
function layoutHash(seed, floor) {
  return createHash('sha1').update(JSON.stringify(generateRun(seed, floor))).digest('hex');
}
function attachMessages(room) {
  const events = { floorStarts: [], floorCleared: [], runEnded: [] };
  room.onMessage('floor-start', (message) => events.floorStarts.push(message));
  room.onMessage('floor-cleared', (message) => events.floorCleared.push(message));
  room.onMessage('run-ended', (message) => events.runEnded.push(message));
  return events;
}

async function main() {
  server = spawn(process.execPath, ['--experimental-strip-types', resolve(root, 'server/index.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      HANDSHAKE_TEST_HOOKS: '1',
      RECONNECT_SECONDS: String(RECONNECT_SECONDS),
      EMPTY_ROOM_SECONDS: '120',
      LONELY_ROOM_SECONDS: '120',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });
  await waitForPort(PORT);

  const endpoint = `ws://127.0.0.1:${PORT}`;
  const host = await new Client(endpoint).create('handshake', { mode: 'nightshift', seed: 123456 });
  rooms.push(host);
  const hostEvents = attachMessages(host);
  const guest = await new Client(endpoint).joinById(host.roomId);
  rooms.push(guest);
  const guestEvents = attachMessages(guest);
  await waitFor(() => host.state.players.size === 2 && guest.state.players.size === 2, 'both clients seated');

  assert(host.state.run.mode === 'nightshift' && guest.state.run.mode === 'nightshift', 'run mode mismatch');
  assert(host.state.run.floor === 1 && guest.state.run.floor === 1, 'initial floor mismatch');
  assert(host.state.run.seed === 123456 && guest.state.run.seed === 123456, 'initial seed mismatch');
  assert(layoutHash(host.state.run.seed, host.state.run.floor) === layoutHash(guest.state.run.seed, guest.state.run.floor), 'initial layout mismatch');
  result.notes.initialLayout = layoutHash(123456, 1);

  host.send('debug-run-clear', { timesSpotted: 0, elapsedSeconds: 100, tetherSaves: 1 });
  await waitFor(() => hostEvents.floorCleared.length === 1 && guestEvents.floorCleared.length === 1, 'floor 1 clear');
  const first = hostEvents.floorCleared[0];
  assert(JSON.stringify(first) === JSON.stringify(guestEvents.floorCleared[0]), 'floor clear payload mismatch');
  const expectedFirst = scoreFloorPure({ elapsedSeconds: 100, timesSpotted: 0, tetherSaves: 1 }, 1, {});
  assert(first.points === expectedFirst.points && first.multiplier === 1.5 && first.streak === 1, 'floor 1 score mismatch');
  const synced = (c) => c.state.run.score === first.total && c.state.run.multiplier === first.multiplier && c.state.run.streak === first.streak && c.state.run.floorCleared === true;
  await waitFor(() => synced(host) && synced(guest), 'score/multiplier/streak state sync after clear');
  host.send('debug-run-clear', { elapsedSeconds: 1 });
  await sleep(250);
  assert(hostEvents.floorCleared.length === 1 && guestEvents.floorCleared.length === 1, 'duplicate clear accepted');
  result.notes.firstClear = true;

  host.send('run-next-floor', { floor: 1 });
  guest.send('run-next-floor', { floor: 1 });
  host.send('run-next-floor', { floor: 1 });
  guest.send('run-next-floor', { floor: 1 });
  await waitFor(() => host.state.run.floor === 2 && guest.state.run.floor === 2, 'advance to floor 2');
  await waitFor(() => hostEvents.floorStarts.filter((m) => m.floor === 2).length === 1 && guestEvents.floorStarts.filter((m) => m.floor === 2).length === 1, 'floor 2 floor-start');
  assert(host.state.run.seed === first.next.seed && guest.state.run.seed === first.next.seed, 'floor 2 seed mismatch');
  host.send('run-next-floor', { floor: 1 });
  await sleep(250);
  assert(host.state.run.floor === 2 && guest.state.run.floor === 2, 'stale advance accepted');
  assert(host.state.run.score === first.total && guest.state.run.score === first.total, 'score not carried');
  assert(layoutHash(host.state.run.seed, 2) === layoutHash(guest.state.run.seed, 2), 'floor 2 layout mismatch');
  result.notes.advanceDeduped = true;

  host.send('debug-run-clear', { timesSpotted: 0, elapsedSeconds: 100 });
  await waitFor(() => hostEvents.floorCleared.length === 2 && guestEvents.floorCleared.length === 2, 'floor 2 clear');
  const second = hostEvents.floorCleared[1];
  assert(second.streak === 2 && second.multiplier === 2, 'floor 2 streak mismatch');
  const expectedSecond = scoreFloorPure({ elapsedSeconds: 100, timesSpotted: 0 }, 2, expectedFirst.floors);
  assert(second.total === expectedSecond.total, 'floor 2 total mismatch');
  host.send('run-next-floor', { floor: 2 });
  await waitFor(() => host.state.run.floor === 3 && guest.state.run.floor === 3, 'advance to floor 3');
  host.send('debug-run-clear', { timesSpotted: 2, elapsedSeconds: 100 });
  await waitFor(() => hostEvents.floorCleared.length === 3 && guestEvents.floorCleared.length === 3, 'floor 3 clear');
  const third = hostEvents.floorCleared[2];
  assert(third.streak === 0 && third.multiplier === 1, 'floor 3 dirty streak mismatch');
  assert(third.total === second.total + third.points, 'floor 3 total mismatch');
  result.notes.streaks = true;

  const capturesBefore = host.state.run.captures;
  host.send('run-capture');
  await sleep(250);
  assert(host.state.run.captures === capturesBefore && guest.state.run.captures === capturesBefore, 'public run-capture changed state');
  result.notes.publicCaptureIgnored = true;

  const token = guest.reconnectionToken;
  guest.reconnection.maxRetries = 0;
  guest.connection.close(4010, 'nightshift-coop-reconnect');
  await waitFor(() => host.state.players.get([...host.state.players.keys()].find((id) => id !== host.sessionId))?.connected === false, 'guest drop');
  const guest2 = await new Client(endpoint).reconnect(token);
  rooms.push(guest2);
  const guest2Events = attachMessages(guest2);
  await waitFor(() => guest2.state?.players?.size === 2 && [...guest2.state.players.values()].some((player) => player.connected), 'guest reconnect');
  assert(guest2.state.run.floor === host.state.run.floor && guest2.state.run.seed === host.state.run.seed, 'reconnect floor/seed mismatch');
  assert(guest2.state.run.score === host.state.run.score && guest2.state.run.streak === host.state.run.streak, 'reconnect score mismatch');
  assert(guest2.state.run.multiplier === host.state.run.multiplier && guest2.state.run.captures === host.state.run.captures, 'reconnect state mismatch');
  result.notes.reconnect = true;

  host.send('debug-run-capture');
  host.send('debug-run-capture');
  host.send('debug-run-capture');
  await waitFor(() => host.state.run.ended === true && guest2.state.run.ended === true, 'run ended');
  assert(host.state.run.captures === host.state.run.maxCaptures && guest2.state.run.captures === host.state.run.captures, `captures not counted once per event: ${host.state.run.captures}/${guest2.state.run.captures}`);
  await waitFor(() => hostEvents.runEnded.length === 1 && guest2Events.runEnded.length === 1, 'run-ended delivery');
  assert(JSON.stringify(hostEvents.runEnded[0]) === JSON.stringify(guest2Events.runEnded[0]), 'run-ended payload mismatch');
  assert(hostEvents.runEnded[0].floor === host.state.run.floor && hostEvents.runEnded[0].score === host.state.run.score, 'run-ended payload state mismatch');
  host.send('run-next-floor', { floor: host.state.run.floor });
  await sleep(250);
  assert(host.state.run.floor === 3 && guest2.state.run.floor === 3, 'advance after end accepted');
  assert(guest2Events.runEnded.length === 1, 'reconnected client missed run-ended');
  result.notes.gameOver = true;
}

const hardTimeout = setTimeout(() => {
  console.log(`QA_RESULT ${JSON.stringify({ ...result, error: 'overall timeout 60s' })}`);
  server?.kill('SIGTERM');
  process.exit(1);
}, 60_000);

try {
  await main();
  result.pass = true;
} catch (error) {
  result.error = String(error?.message ?? error);
  result.serverTail = serverLog.split("\n").slice(-30).join('\n');
} finally {
  for (const room of rooms) {
    try { room.reconnection.maxRetries = 0; await Promise.race([room.leave(true), sleep(500)]); } catch { /* already gone */ }
  }
  server?.kill('SIGTERM');
  clearTimeout(hardTimeout);
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log(`QA_RESULT ${JSON.stringify(result)}`);
process.exit(result.pass ? 0 : 1);
