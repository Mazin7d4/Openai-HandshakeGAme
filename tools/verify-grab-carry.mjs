/**
 * Two headless Colyseus clients: server-authoritative co-op grab/carry.
 * Covers grab sync, out-of-range + contested grabs, handoff, steal lock + steal,
 * drop on capture, and reconnect while carrying (item survives the hold, drops after it).
 * Spawns its own server with HANDSHAKE_TEST_HOOKS=1 and RECONNECT_SECONDS=4. No browser.
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@colyseus/sdk';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.GRAB_CARRY_TEST_PORT ?? 2579);
const RECONNECT_SECONDS = 4;
const started = Date.now();
const result = { test: 'grab-carry', pass: false, notes: {} };
const rooms = [];
let server;
let serverLog = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function waitFor(pred, msg, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${msg}`);
}
function waitForPort(port, timeoutMs = 20_000) {
  const t0 = Date.now();
  return new Promise((ok, fail) => {
    const tryOnce = () => {
      const s = createConnection({ port, host: '127.0.0.1' }, () => { s.end(); ok(); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - t0 > timeoutMs) fail(new Error(`server did not listen on ${port}`));
        else setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}
const obj = (room, id) => room.state.objects.get(id);
const playerOf = (room, role) => [...room.state.players.values()].find((p) => p.role === role);
function fly(room, position) {
  room.send('snapshot', {
    position, velocity: { x: 0, y: 0, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 },
    boost: 'off', movement: 'idle', selfPowered: false, tetherPull: 0,
  });
}
/** Both clients agree on the object's ownership. */
function both(a, b, id, pred) { return pred(obj(a, id)) && pred(obj(b, id)); }
const at = (p, dx = 0, dy = 0, dz = 0) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz });

async function main() {
  server = spawn(process.execPath, ['--experimental-strip-types', resolve(root, 'server/index.mjs')], {
    cwd: root,
    env: {
      ...process.env, PORT: String(PORT), HANDSHAKE_TEST_HOOKS: '1', RECONNECT_SECONDS: String(RECONNECT_SECONDS),
      EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (c) => { serverLog += c; });
  server.stderr.on('data', (c) => { serverLog += c; });
  await waitForPort(PORT);
  const endpoint = `ws://127.0.0.1:${PORT}`;
  const pix = await new Client(endpoint).create('handshake', {});
  rooms.push(pix);
  pix.onMessage('*', () => {});
  const nee = await new Client(endpoint).joinById(pix.roomId);
  rooms.push(nee);
  nee.onMessage('*', () => {});
  await waitFor(() => pix.state.players.size === 2 && nee.state.players.size === 2, 'both seated');
  assert(playerOf(pix, 'pix')?.playerId === pix.sessionId, 'host is not PIX');
  const ids = [...pix.state.objects.keys()].filter((id) => id !== 'prototype');
  assert(ids.length >= 2, 'need two non-prototype grabbables');
  const [item, spare] = ids;
  result.notes.item = item;

  // Park the item somewhere open near spawn and fly both drones beside it.
  const home = playerOf(pix, 'pix').position;
  const P = { x: home.x + 3, y: home.y + 1.5, z: home.z + 3 };
  pix.send('debug-object-place', { objectId: item, ...P });
  await waitFor(() => both(pix, nee, item, (o) => Math.abs(o.position.x - P.x) < 0.01), 'item placed');
  fly(pix, at(P, -1)); fly(nee, at(P, 1));
  await sleep(150);

  // a) grab sync + out-of-range rejection
  pix.send('grab-object', { objectId: item });
  await waitFor(() => both(pix, nee, item, (o) => o.heldBy === 'pix' && o.holderId === pix.sessionId && o.mode === 'held'), 'grab synced');
  const S = obj(pix, spare).position;
  fly(nee, at(S, 30));
  await sleep(300);
  nee.send('grab-object', { objectId: spare });
  await sleep(300);
  assert(both(pix, nee, spare, (o) => o.heldBy === '' && o.mode === 'free'), 'out-of-range grab was accepted');
  result.notes.grabSync = true;

  // b) contested grab: both drones in range, same tick -> exactly one holder
  pix.send('release-object', { objectId: item, position: at(P, 0, -0.6), velocity: { x: 0, y: 0, z: 0 }, thrown: false });
  await waitFor(() => both(pix, nee, item, (o) => o.mode === 'free' && o.lastEvent === 'drop'), 'drop synced');
  fly(nee, at(P, 1));
  await sleep(300);
  pix.send('grab-object', { objectId: item });
  nee.send('grab-object', { objectId: item });
  await waitFor(() => both(pix, nee, item, (o) => o.mode === 'held'), 'contested grab resolved');
  await sleep(150);
  const winner = obj(pix, item).holderId;
  assert(winner && obj(nee, item).holderId === winner, 'clients disagree on contested holder');
  assert(obj(pix, item).lastEvent === 'grab', `contested grab produced ${obj(pix, item).lastEvent}`);
  const [winRoom, loseRoom] = winner === pix.sessionId ? [pix, nee] : [nee, pix];
  await sleep(300); // past the grab cooldown, still inside the steal lock
  loseRoom.send('grab-object', { objectId: item });
  await sleep(300);
  assert(obj(pix, item).holderId === winner, 'steal inside the lock window was accepted');
  result.notes.contestedWinner = obj(pix, item).heldBy;

  // c) handoff: rejected at 10 m, accepted at 2 m; then a steal after the lock
  fly(winRoom, P); fly(loseRoom, at(P, 10));
  await sleep(300);
  winRoom.send('handoff-object', { objectId: item });
  await sleep(300);
  assert(obj(pix, item).holderId === winner, 'handoff at 10 m was accepted');
  fly(loseRoom, at(P, 2));
  await sleep(300);
  winRoom.send('handoff-object', { objectId: item });
  await waitFor(() => both(pix, nee, item, (o) => o.holderId === loseRoom.sessionId && o.lastEvent === 'handoff'), 'handoff synced');
  await sleep(1100);
  fly(winRoom, at(obj(pix, item).position, 1.2));
  await sleep(300);
  winRoom.send('grab-object', { objectId: item });
  await waitFor(() => both(pix, nee, item, (o) => o.holderId === winRoom.sessionId && o.lastEvent === 'steal'), 'steal synced');
  result.notes.handoffSteal = true;

  // d) captured holder drops the item; captured drones cannot grab
  const carrierRole = obj(pix, item).heldBy;
  const carrier = winRoom;
  pix.send('debug-stage', { stage: 'escape', freezePatrols: true });
  await sleep(150);
  carrier.send('debug-force-capture', { role: carrierRole, index: 0 });
  await waitFor(() => playerOf(pix, carrierRole)?.captured === true, 'capture synced');
  await waitFor(() => both(pix, nee, item, (o) => o.mode === 'free' && o.heldBy === '' && o.lastEvent === 'captured'), 'drop on capture');
  await sleep(300);
  carrier.send('grab-object', { objectId: item });
  await sleep(300);
  assert(both(pix, nee, item, (o) => o.mode === 'free'), 'captured drone re-grabbed');
  carrier.send('debug-force-release', { role: carrierRole, reason: 'yank' });
  await waitFor(() => playerOf(pix, carrierRole)?.captured === false, 'capture released');
  result.notes.dropOnCapture = true;

  // e) reconnect while carrying: item survives the hold, drops only after it expires
  const ip = obj(pix, item).position;
  const near = { x: ip.x, y: ip.y + 0.8, z: ip.z };
  fly(nee, near);
  fly(pix, at(near, 6));
  await sleep(400);
  nee.send('grab-object', { objectId: item });
  await waitFor(() => both(pix, nee, item, (o) => o.holderId === nee.sessionId), 'NEE carrying');
  const neeId = nee.sessionId;
  const token = nee.reconnectionToken;
  nee.reconnection.maxRetries = 0; // manual reconnect below
  nee.connection.close(4010, 'grab-carry-drop');
  await waitFor(() => playerOf(pix, 'nee')?.connected === false, 'drop seen by partner');
  await sleep(500);
  assert(obj(pix, item).holderId === neeId && obj(pix, item).mode === 'held', 'item dropped during reconnect hold');
  const nee2 = await new Client(endpoint).reconnect(token);
  rooms.push(nee2);
  nee2.onMessage('*', () => {});
  await waitFor(() => playerOf(pix, 'nee')?.connected === true, 'reconnect seen by partner');
  await waitFor(() => both(pix, nee2, item, (o) => o.holderId === neeId && o.heldBy === 'nee' && o.mode === 'held'), 'item still held after reconnect');
  result.notes.reconnectKeepsItem = true;

  nee2.reconnection.maxRetries = 0;
  nee2.connection.close(4010, 'grab-carry-expire');
  await waitFor(() => playerOf(pix, 'nee')?.connected === false, 'second drop seen');
  await sleep((RECONNECT_SECONDS - 1.5) * 1000);
  assert(obj(pix, item).holderId === neeId, 'item dropped before the hold expired');
  await waitFor(() => obj(pix, item).mode === 'free' && obj(pix, item).lastEvent === 'disconnect', 'drop after hold expired', 5000);
  assert(obj(pix, item).authority === 'pix', 'free item authority not handed to the connected partner');
  result.notes.dropAfterHold = true;
}

const hardTimeout = setTimeout(() => {
  console.log('QA_RESULT ' + JSON.stringify({ ...result, error: 'overall timeout 90s', seconds: Math.round((Date.now() - started) / 1000) }));
  server?.kill('SIGTERM');
  process.exit(1);
}, 90_000);

try {
  await main();
  result.pass = true;
} catch (error) {
  result.error = String(error?.message ?? error);
  result.serverTail = serverLog.split('\n').slice(-8).join('\n');
} finally {
  for (const room of rooms) {
    try { room.reconnection.maxRetries = 0; await Promise.race([room.leave(true), sleep(500)]); } catch { /* already gone */ }
  }
  server?.kill('SIGTERM');
  clearTimeout(hardTimeout);
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log('QA_RESULT ' + JSON.stringify(result));
process.exit(result.pass ? 0 : 1);
