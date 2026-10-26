import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { freePort, startTestServer } from '../test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const started = Date.now();
const result = { test: 'bot-hack-server', pass: false, notes: {} };
const rooms = [];
let server;

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
function snapshot(room, position) {
  room.send('snapshot', {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    orientation: { pitch: 0, yaw: 0, roll: 0 },
    boost: 'off', movement: 'idle', selfPowered: false, tetherPull: 0,
  });
}
async function closeRoom(room) {
  try {
    room.reconnection.maxRetries = 0;
    await Promise.race([room.leave(true), sleep(500)]);
  } catch { /* already closed */ }
}

try {
  server = await startTestServer({
    port: await freePort(), root,
    env: { HANDSHAKE_TEST_HOOKS: '1', EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120' },
  });
  const room = await new Client(`ws://127.0.0.1:${server.port}`).create('handshake', { mode: 'standard', bot: true });
  rooms.push(room);
  await waitFor(() => room.state.started && room.state.players.get('bot')?.bot === true, 'bot room started');
  room.send('debug-patrol-freeze', { frozen: true });
  const terminalB = { x: 5.2, y: 2, z: -31 };
  snapshot(room, terminalB);
  await waitFor(() => room.state.mission.stage === 'hack-security', 'hack stage');
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !room.state.hack.stationBComplete) {
    snapshot(room, terminalB);
    await sleep(100);
  }
  assert(room.state.hack.stationBComplete === true, 'bot did not complete terminal B');
  result.notes.station = 'terminal-b';
  result.notes.humanHackStart = false;
  result.pass = true;
} catch (error) {
  result.error = String(error?.message ?? error);
  result.serverTail = server?.log?.().split('\n').slice(-20).join('\n');
} finally {
  for (const room of rooms) await closeRoom(room);
  await server?.stop();
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log(`QA_RESULT ${JSON.stringify(result)}`);
process.exit(result.pass ? 0 : 1);
