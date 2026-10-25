import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@colyseus/sdk';
import { freePort, startTestServer } from './test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.BOT_TEST_PORT ? Number(process.env.BOT_TEST_PORT) : await freePort();
const RECONNECT_SECONDS = 4;
const started = Date.now();
const result = { test: 'bot-server', pass: false, notes: {} };
const rooms = [];
let server;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitFor(predicate, message, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (predicate()) return; } catch { /* state not synced yet */ }
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}
const playerOf = (room, role) => [...room.state.players.values()].find((player) => player.role === role);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fly(room, position, yaw = 0) {
  room.send('snapshot', {
    position, velocity: { x: 0, y: 0, z: 0 }, orientation: { pitch: 0, yaw, roll: 0 },
    boost: 'off', movement: 'idle', selfPowered: false, tetherPull: 0,
  });
}
async function makeBotRoom() {
  const host = await new Client(`ws://127.0.0.1:${PORT}`).create('handshake', { bot: true });
  rooms.push(host);
  await waitFor(() => host.state.players.size === 2 && host.state.players.get('bot')?.bot === true, 'bot seat');
  return host;
}
async function sendPath(room, from, to, duration = 3000) {
  const steps = Math.max(1, Math.round(duration / 100));
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    fly(room, {
      x: from.x + (to.x - from.x) * f,
      y: from.y + (to.y - from.y) * f,
      z: from.z + (to.z - from.z) * f,
    }, Math.PI);
    await sleep(100);
  }
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

  const followRoom = await makeBotRoom();
  const host = playerOf(followRoom, 'pix');
  const bot = followRoom.state.players.get('bot');
  assert(followRoom.state.started && bot.role === 'nee', 'bot room did not start with NEE bot');
  const start = { x: host.position.x, y: host.position.y, z: host.position.z };
  await sendPath(followRoom, start, { ...start, z: start.z + 8 }, 3000);
  const followDistance = distance(host.position, bot.position);
  assert(followDistance <= 4 && followDistance >= 1.5, `bot follow distance ${followDistance.toFixed(2)}`);
  result.notes.followDistance = Number(followDistance.toFixed(2));

  const item = [...followRoom.state.objects.keys()].find((id) => id !== 'prototype');
  const itemPoint = { x: host.position.x, y: host.position.y, z: host.position.z };
  followRoom.send('debug-object-place', { objectId: item, ...itemPoint });
  fly(followRoom, itemPoint, Math.PI);
  await waitFor(() => Math.abs(followRoom.state.objects.get(item)?.position.x - itemPoint.x) < 0.01, 'desk object placed');
  followRoom.send('grab-object', { objectId: item });
  await waitFor(() => followRoom.state.objects.get(item)?.holderId === followRoom.sessionId, 'host grabbed desk object');
  const passDeadline = Date.now() + 1500;
  while (Date.now() < passDeadline && followRoom.state.objects.get(item)?.heldBy !== 'nee') {
    followRoom.send('handoff-object', { objectId: item });
    await sleep(100);
  }
  assert(followRoom.state.objects.get(item)?.heldBy === 'nee', 'bot did not receive desk handoff');
  await waitFor(() => followRoom.state.objects.get(item)?.heldBy === '', 'bot released desk object', 6500);
  result.notes.passRelease = true;

  followRoom.send('debug-stage', { stage: 'escape', openDoor: true, freezePatrols: true });
  await sleep(300);
  const proto = () => followRoom.state.objects.get('prototype');
  await waitFor(() => Boolean(proto()?.position), 'prototype present after escape stage');
  const prototypePoint = { x: host.position.x, y: host.position.y, z: host.position.z };
  followRoom.send('debug-object-place', { objectId: 'prototype', ...prototypePoint });
  fly(followRoom, prototypePoint, Math.PI);
  await waitFor(() => Math.abs(proto().position.x - prototypePoint.x) < 0.01, 'prototype placed');
  followRoom.send('grab-object', { objectId: 'prototype' });
  await waitFor(() => proto().heldBy === 'pix', 'host grabbed prototype');
  const handoffStart = Date.now();
  while (Date.now() - handoffStart < 2500 && proto().heldBy !== 'nee') {
    followRoom.send('handoff-object', { objectId: 'prototype' });
    await sleep(100);
  }
  await waitFor(() => proto().heldBy === 'nee', 'bot received prototype', 1500);
  const extraction = followRoom.world?.extraction ?? { x: -15, y: 2, z: -61 };
  const carryStartDistance = distance(followRoom.state.players.get('bot').position, extraction);
  await sendPath(followRoom, itemPoint, extraction, 3000);
  const carryMidDistance = distance(followRoom.state.players.get('bot').position, extraction);
  assert(carryMidDistance < carryStartDistance, 'bot did not carry prototype toward extraction');
  await sendPath(followRoom, playerOf(followRoom, 'pix').position, extraction, 7000);
  await waitFor(() => followRoom.state.mission.extracted === true, 'bot delivered prototype', 15000);
  result.notes.extracted = { startDistance: Number(carryStartDistance.toFixed(2)), midDistance: Number(carryMidDistance.toFixed(2)) };

  const botLastPosition = { x: followRoom.state.players.get('bot').position.x, y: followRoom.state.players.get('bot').position.y, z: followRoom.state.players.get('bot').position.z };
  const handoffEvents = [];
  followRoom.onMessage('bot-seat', (message) => handoffEvents.push(message));
  const joiner = await new Client(`ws://127.0.0.1:${PORT}`).joinById(followRoom.roomId);
  rooms.push(joiner);
  await waitFor(() => !followRoom.state.players.has('bot') && followRoom.state.players.size === 2, 'bot takeover');
  const joinedNee = playerOf(followRoom, 'nee');
  assert(joinedNee.playerId === joiner.sessionId && joinedNee.bot === false, 'joiner did not take NEE bot seat');
  assert(distance(joinedNee.position, botLastPosition) <= 0.5, 'handoff position was not preserved');
  assert(followRoom.state.objects.get('prototype').holderId === joiner.sessionId, 'held prototype holder id was not handed off');
  assert(handoffEvents.some((message) => message.active === false && message.handoff === true), 'bot handoff event missing');
  result.notes.handoff = true;
  await joiner.leave(true);
  await waitFor(() => followRoom.state.players.get('bot')?.role === 'nee' && followRoom.state.started, 'bot returned after leave', 1500);
  result.notes.returned = true;

  const rescueRoom = await makeBotRoom();
  rescueRoom.send('debug-patrol-freeze', { frozen: true });
  const patrol = rescueRoom.state.security.patrols[0];
  await sendPath(rescueRoom, { ...playerOf(rescueRoom, 'pix').position }, { x: patrol.x, y: patrol.y + 0.95, z: patrol.z }, 8500);
  const rescued = [];
  rescueRoom.onMessage('rescued', (message) => rescued.push(message));
  rescueRoom.send('debug-force-capture', { role: 'pix', index: 0 });
  await waitFor(() => rescued.some((message) => message.role === 'pix' && message.reason === 'yank'), 'bot rescue', 3000);
  await waitFor(() => playerOf(rescueRoom, 'pix').captured === false, 'captured host released', 1500);
  result.notes.rescue = true;

  const solo = await new Client(`ws://127.0.0.1:${PORT}`).create('handshake', {});
  rooms.push(solo);
  await waitFor(() => solo.state.players.size === 1 && solo.state.started === false, 'non-bot room control');
  assert(![...solo.state.players.values()].some((player) => player.bot), 'bot appeared without opt-in');
  result.notes.control = true;
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
  result.stack = String(error?.stack ?? "").split("\n").slice(1, 3).join(" | ");
  result.serverTail = server?.log().split('\n').slice(-8).join('\n');
} finally {
  for (const room of rooms) await closeRoom(room);
  await server?.stop();
  clearTimeout(hardTimeout);
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log('QA_RESULT ' + JSON.stringify(result));
process.exit(result.pass ? 0 : 1);
