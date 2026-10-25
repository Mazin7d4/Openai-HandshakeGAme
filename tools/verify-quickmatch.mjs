import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@colyseus/sdk';
import { freePort, startTestServer } from './test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();
const result = { test: 'quickmatch-server', pass: false, notes: {} };
const rooms = [];
const servers = [];
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function waitFor(predicate, message, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (predicate()) return; } catch { /* state is still syncing */ }
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}
const endpoint = (port) => `ws://127.0.0.1:${port}`;
async function closeRoom(room) {
  try { room.reconnection.maxRetries = 0; await Promise.race([room.leave(true), sleep(500)]); } catch { /* already closed */ }
}
async function joinQuick(port, qmKey, mode = 'standard') {
  const room = await new Client(endpoint(port)).joinOrCreate('handshake', { quickMatch: true, qmKey, mode });
  rooms.push(room);
  return room;
}
async function start(env = {}) {
  const port = await freePort();
  const server = await startTestServer({ port, root, env: { RECONNECT_SECONDS: '3', EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120', ...env } });
  servers.push(server);
  return { port, server };
}

async function main() {
  const { port } = await start();
  const pair = await Promise.all([joinQuick(port, 'standard'), joinQuick(port, 'standard')]);
  assert(pair[0].roomId === pair[1].roomId, 'simultaneous quick matches did not share a room');
  await waitFor(() => pair[0].state.started && pair[0].state.players.size === 2, 'simultaneous pair');
  assert(new Set([...pair[0].state.players.values()].map((p) => p.role)).size === 2, 'pair roles were not distinct');
  result.notes.simultaneous = true;
  for (const room of pair) await closeRoom(room);

  const cancelA = await joinQuick(port, 'k-cancel');
  const cancelId = cancelA.roomId;
  await cancelA.leave(true);
  const cancelB = await joinQuick(port, 'k-cancel');
  await waitFor(() => cancelB.state.players.size === 1, 'cancel second seat synced');
  assert(cancelB.roomId !== cancelId && cancelB.state.players.size === 1 && !cancelB.state.started, 'cancel left a matchable seat');
  result.notes.cancel = true;
  await closeRoom(cancelB);

  const dropA = await joinQuick(port, 'k-drop');
  const dropId = dropA.roomId;
  dropA.reconnection.maxRetries = 0;
  dropA.connection.close(4000, 'network drop');
  await sleep(500);
  const dropB = await joinQuick(port, 'k-drop');
  assert(dropB.roomId !== dropId, 'dropped queued seat remained matchable');
  result.notes.drop = true;
  await closeRoom(dropB);

  const privateRoom = await new Client(endpoint(port)).create('handshake', {});
  rooms.push(privateRoom);
  const publicRoom = await joinQuick(port, 'standard');
  assert(publicRoom.roomId !== privateRoom.roomId, 'private room was returned by quick match');
  const privateJoin = await new Client(endpoint(port)).joinById(privateRoom.roomId);
  rooms.push(privateJoin);
  assert(privateJoin.roomId === privateRoom.roomId, 'joinById could not join private room');
  result.notes.private = true;
  await closeRoom(publicRoom);
  await closeRoom(privateJoin);
  await closeRoom(privateRoom);

  const botA = await joinQuick(port, 'k-bot');
  botA.send('quickmatch-bot');
  await waitFor(() => botA.state.players.size === 2 && [...botA.state.players.values()].some((p) => p.bot), 'quick-match bot');
  assert(botA.state.started, 'bot fallback did not start the run');
  const botB = await joinQuick(port, 'k-bot');
  await waitFor(() => botA.state.players.size === 2 && ![...botA.state.players.values()].some((p) => p.bot), 'bot takeover');
  assert(botB.roomId === botA.roomId && [...botA.state.players.values()].every((p) => !p.bot), 'stranger did not take bot seat');
  result.notes.bot = true;
  await closeRoom(botB);
  await closeRoom(botA);

  const standard = await joinQuick(port, 'standard', 'standard');
  const night = await joinQuick(port, 'nightshift', 'nightshift');
  assert(standard.roomId !== night.roomId, 'mode keys shared a room');
  result.notes.mode = true;
  await closeRoom(standard);
  await closeRoom(night);

  const leavePair = await Promise.all([joinQuick(port, 'k-leave'), joinQuick(port, 'k-leave')]);
  await leavePair[1].leave(true);
  const third = await joinQuick(port, 'k-leave');
  assert(third.roomId !== leavePair[0].roomId, 'paired room was not locked after partner leave');
  result.notes.lock = true;
  await closeRoom(leavePair[0]);
  await closeRoom(third);

  const limited = await start({ QM_RATE_PER_MIN: '3' });
  for (let i = 0; i < 3; i++) {
    const room = await joinQuick(limited.port, `limit-${i}`);
    await closeRoom(room);
  }
  let rejected = false;
  try { await joinQuick(limited.port, 'limit-4'); } catch (error) { rejected = /quick match limit, try again in a minute/i.test(String(error)); }
  assert(rejected, 'fourth quick-match join was not rate limited');
  const normal = await new Client(endpoint(limited.port)).create('handshake', {});
  rooms.push(normal);
  result.notes.ipLimit = true;
  await closeRoom(normal);
}

const hardTimeout = setTimeout(() => {
  console.log(`QA_RESULT ${JSON.stringify({ ...result, error: 'overall timeout 55s', seconds: Math.round((Date.now() - started) / 1000) })}`);
  for (const server of servers) server.child.kill('SIGTERM');
  process.exit(1);
}, 55_000);

try { await main(); result.pass = true; }
catch (error) {
  result.error = String(error?.message ?? error);
  result.serverTail = servers.at(-1)?.log().split('\n').slice(-8).join('\n');
} finally {
  for (const room of rooms) await closeRoom(room);
  for (const server of servers) await server.stop();
  clearTimeout(hardTimeout);
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log(`QA_RESULT ${JSON.stringify(result)}`);
process.exit(result.pass ? 0 : 1);
