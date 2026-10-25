/** Headless co-op REMATCH vote, reset, seed, stats, leave and reconnect checks. */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@colyseus/sdk';
import { freePort, startTestServer } from './test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.REMATCH_TEST_PORT ? Number(process.env.REMATCH_TEST_PORT) : await freePort();
const RECONNECT_SECONDS = 4;
const started = Date.now();
const result = { test: 'rematch', pass: false, notes: {} };
const rooms = [];
let server;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitFor(predicate, message, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}
const playerOf = (room, role) => [...room.state.players.values()].find((player) => player.role === role);
function fly(room, position, yaw = 0) {
  room.send('snapshot', {
    position, velocity: { x: 0, y: 0, z: 0 }, orientation: { pitch: 0, yaw, roll: 0 },
    boost: 'off', movement: 'idle', selfPowered: false, tetherPull: 0,
  });
}
async function joinPair(endpoint, options = {}) {
  const pix = await new Client(endpoint).create('handshake', options);
  const nee = await new Client(endpoint).joinById(pix.roomId);
  rooms.push(pix, nee);
  await waitFor(() => pix.state.players.size === 2 && nee.state.players.size === 2, 'pair seated');
  return { pix, nee };
}
async function reachResults(pix, nee) {
  pix.send('debug-run-clear');
  await waitFor(() => pix.state.mission.stage === 'complete' && nee.state.mission.stage === 'complete', 'results phase');
}
async function voteBoth(pix, nee) {
  const starts = [];
  pix.onMessage('rematch-start', (message) => starts.push({ from: 'pix', message }));
  nee.onMessage('rematch-start', (message) => starts.push({ from: 'nee', message }));
  await sleep(350);
  pix.send('rematch-vote', { want: true });
  await waitFor(() => playerOf(nee, 'pix')?.rematchVote === true, 'PIX vote sync');
  await sleep(350);
  nee.send('rematch-vote', { want: true });
  await waitFor(() => starts.length === 2, 'rematch-start for both clients');
  await waitFor(() => pix.state.run.rematches > 0 && pix.state.mission.stage === 'infiltrate', 'rematch state reset');
  return starts;
}
async function createPassStat(pix, nee) {
  const item = [...pix.state.objects.keys()].find((id) => id !== 'prototype');
  assert(item, 'missing test grabbable');
  const home = playerOf(pix, 'pix').position;
  const point = { x: home.x + 3, y: home.y + 1, z: home.z + 3 };
  pix.send('debug-object-place', { objectId: item, ...point });
  await waitFor(() => Math.abs(pix.state.objects.get(item).position.x - point.x) < 0.01, 'stat item placed');
  fly(pix, point, Math.PI);
  fly(nee, { x: point.x, y: point.y, z: point.z + 1.5 });
  await sleep(200);
  pix.send('grab-object', { objectId: item });
  await waitFor(() => pix.state.objects.get(item).holderId === pix.sessionId, 'stat item grabbed');
  await sleep(350);
  pix.send('handoff-object', { objectId: item });
  await waitFor(() => playerOf(pix, 'pix').passes >= 1 && playerOf(nee, 'pix').passes >= 1, 'pass stat synced');
  return item;
}
function sameStats(a, b) {
  return ['lootDelivered', 'lootCarrySeconds', 'passes', 'rescues', 'capturedCount', 'grabs', 'hacks']
    .every((field) => a[field] === b[field]);
}
async function closeRoom(room) {
  try { room.reconnection.maxRetries = 0; await Promise.race([room.leave(true), sleep(500)]); } catch { /* already closed */ }
}

async function main() {
  server = await startTestServer({
    port: PORT,
    root,
    env: { HANDSHAKE_TEST_HOOKS: '1', RECONNECT_SECONDS: String(RECONNECT_SECONDS), EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120' },
  });
  const endpoint = `ws://127.0.0.1:${PORT}`;

  const standard = await joinPair(endpoint, { mode: 'standard' });
  const outsideBefore = playerOf(standard.pix, 'pix').rematchVote;
  standard.pix.send('rematch-vote', { want: true });
  await sleep(350);
  assert(playerOf(standard.pix, 'pix').rematchVote === outsideBefore, 'vote outside results was accepted');
  await createPassStat(standard.pix, standard.nee);
  await reachResults(standard.pix, standard.nee);
  await sleep(350);
  standard.pix.send('rematch-vote', { want: true });
  await waitFor(() => playerOf(standard.nee, 'pix').rematchVote === true, 'vote visible on partner');
  standard.pix.send('rematch-vote', { want: true });
  await sleep(100);
  assert(playerOf(standard.pix, 'pix').rematchVote === true, 'duplicate vote was not idempotent');
  await sleep(350);
  standard.pix.send('rematch-vote', { want: false });
  await waitFor(() => playerOf(standard.nee, 'pix').rematchVote === false, 'vote cancellation');
  assert(sameStats(playerOf(standard.pix, 'pix'), playerOf(standard.nee, 'pix')) && playerOf(standard.pix, 'pix').passes >= 1, 'stats disagree before rematch');
  const oldSeed = standard.pix.state.run.seed;
  const starts = await voteBoth(standard.pix, standard.nee);
  assert(standard.pix.roomId === standard.nee.roomId, 'room changed during rematch');
  assert(standard.pix.state.players.size === 2 && [...standard.pix.state.players.values()].every((p) => p.connected), 'players dropped during rematch');
  assert(standard.pix.connection.isOpen && standard.nee.connection.isOpen, 'a client socket closed during rematch');
  assert(starts[0].message.seed !== oldSeed, 'standard rematch reused its seed');
  assert(standard.pix.state.objects.get('prototype').mode === 'free', 'prototype remained held after rematch');
  assert([...standard.pix.state.players.values()].every((player) => !player.captured && !player.rematchVote &&
    ['lootDelivered', 'lootCarrySeconds', 'passes', 'rescues', 'capturedCount', 'grabs', 'hacks'].every((field) => player[field] === 0)), 'player state did not reset');
  result.notes.standard = { rematches: standard.pix.state.run.rematches, seedChanged: true, pass: true };

  const night = await joinPair(endpoint, { mode: 'nightshift' });
  await reachResults(night.pix, night.nee);
  const nightSeed = night.pix.state.run.seed;
  await voteBoth(night.pix, night.nee);
  assert(night.pix.state.run.seed !== nightSeed && night.pix.state.run.floor === 1, 'Night Shift rematch did not reset its floor/seed');
  result.notes.nightshift = { seedChanged: true, floor: night.pix.state.run.floor };

  const pinned = await joinPair(endpoint, { mode: 'standard', seed: 12345 });
  await reachResults(pinned.pix, pinned.nee);
  await voteBoth(pinned.pix, pinned.nee);
  assert(pinned.pix.state.run.seed === 12345 && pinned.nee.state.run.seed === 12345, 'pinned seed changed');
  result.notes.pinned = pinned.pix.state.run.seed;

  const leaving = await joinPair(endpoint, { mode: 'standard' });
  await reachResults(leaving.pix, leaving.nee);
  const leftEvents = [];
  leaving.pix.onMessage('rematch-partner-left', (message) => leftEvents.push(message));
  await sleep(350);
  leaving.pix.send('rematch-vote', { want: true });
  await waitFor(() => playerOf(leaving.nee, 'pix').rematchVote === true, 'pending vote before leave');
  await leaving.nee.leave(true);
  await waitFor(() => leftEvents.length === 1 && leaving.pix.state.players.size === 1, 'partner-left event');
  assert(playerOf(leaving.pix, 'pix').rematchVote === false, 'remaining vote was not cleared after partner leave');
  result.notes.partnerLeft = true;

  const held = await joinPair(endpoint, { mode: 'standard' });
  await reachResults(held.pix, held.nee);
  await sleep(350);
  held.pix.send('rematch-vote', { want: true });
  await waitFor(() => playerOf(held.nee, 'pix').rematchVote === true, 'vote before reconnect hold');
  held.pix.reconnection.maxRetries = 0;
  held.pix.connection.close(4010, 'rematch-hold');
  await waitFor(() => playerOf(held.nee, 'pix').connected === false, 'drop during reconnect hold');
  assert(playerOf(held.nee, 'pix').rematchVote === true, 'vote was lost during reconnect hold');
  result.notes.reconnectHold = 'vote kept';
}

const hardTimeout = setTimeout(() => {
  console.log('QA_RESULT ' + JSON.stringify({ ...result, error: 'overall timeout 90s', seconds: Math.round((Date.now() - started) / 1000) }));
  server?.child.kill('SIGTERM');
  process.exit(1);
}, 90_000);

try {
  await main();
  result.pass = true;
} catch (error) {
  result.error = String(error?.message ?? error);
  result.serverTail = server?.log().split('\n').slice(-8).join('\n');
} finally {
  for (const room of rooms) await closeRoom(room);
  await server?.stop();
  clearTimeout(hardTimeout);
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log('QA_RESULT ' + JSON.stringify(result));
process.exit(result.pass ? 0 : 1);
