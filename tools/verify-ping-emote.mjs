import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@colyseus/sdk';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PING_EMOTE_TEST_PORT ?? '2578';
const started = Date.now();
const result = { test: 'ping-emote', pass: false, notes: {} };
const rooms = [];
let server;
let log = '';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
async function waitFor(predicate, message, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (predicate()) return; await sleep(25); }
  throw new Error(`timeout: ${message}`);
}
function waitPort(port) {
  const start = Date.now();
  return new Promise((resolvePort, reject) => {
    const retry = () => {
      const socket = createConnection({ host: '127.0.0.1', port: Number(port) }, () => { socket.end(); resolvePort(); });
      socket.on('error', () => { socket.destroy(); if (Date.now() - start > 20000) reject(new Error('server did not listen')); else setTimeout(retry, 100); });
    };
    retry();
  });
}
const messages = (room, type) => { const list = []; room.onMessage(type, (message) => list.push(message)); return list; };

try {
  server = spawn(process.execPath, ['--experimental-strip-types', resolve(root, 'server/index.mjs')], { cwd: root, env: { ...process.env, PORT: String(PORT), HANDSHAKE_TEST_HOOKS: '1', EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => { log += chunk; }); server.stderr.on('data', (chunk) => { log += chunk; });
  await waitPort(PORT);
  const host = await new Client(`ws://127.0.0.1:${PORT}`).create('handshake', {}); rooms.push(host);
  const guest = await new Client(`ws://127.0.0.1:${PORT}`).joinById(host.roomId); rooms.push(guest);
  const hp = messages(host, 'ping-placed'); const gp = messages(guest, 'ping-placed');
  const he = messages(host, 'emote-played'); const ge = messages(guest, 'emote-played');
  await waitFor(() => host.state.players.size === 2 && guest.state.players.size === 2, 'players');
  const pix = [...host.state.players.values()].find((p) => p.role === 'pix');
  host.send('ping', { x: pix.position.x + 2, y: pix.position.y, z: pix.position.z + 2 });
  await waitFor(() => hp.length === 1 && gp.length === 1, 'ping relay');
  assert(hp[0].role === 'pix' && hp[0].x === gp[0].x && hp[0].z === gp[0].z, 'ping mismatch');
  guest.send('emote', { id: 'yay' }); await waitFor(() => he.length === 1 && ge.length === 1, 'emote relay');
  assert(he[0].role === 'nee' && he[0].id === 'yay', 'emote mismatch');
  await sleep(800); const baseline = hp.length; for (let i = 0; i < 5; i++) host.send('ping', { x: 1, y: 1, z: 1 }); await sleep(200); assert(hp.length === baseline + 1, 'ping rate limit');
  await sleep(800); host.send('ping', { x: 1, y: 1, z: 1 }); await waitFor(() => hp.length === baseline + 2, 'post cooldown ping');
  const emoteBaseline = he.length; for (let i = 0; i < 3; i++) guest.send('emote', { id: 'go' }); await sleep(100); assert(he.length === emoteBaseline + 1, 'emote rate limit');
  for (const id of ['dance', 42, '', null, {}]) host.send('emote', { id }); await sleep(100); assert(he.length === emoteBaseline + 1, 'bad emote accepted');
  const before = Object.keys(host.state.toJSON()).sort().join(','); const countBeforeBad = hp.length;
  host.send('ping', { x: 'bad', y: NaN, z: 1 }); await sleep(100); assert(hp.length === countBeforeBad, 'bad ping accepted');
  await sleep(800); host.send('ping', { x: 1e6, y: 1e6, z: 1e6 }); await waitFor(() => hp.length === countBeforeBad + 1, 'clamped ping');
  const clamped = hp.at(-1); const sender = [...host.state.players.values()].find((p) => p.role === 'pix');
  assert(Math.abs(clamped.x) <= 200 && clamped.y >= -20 && clamped.y <= 80 && Math.abs(clamped.z) <= 200, 'ping outside world box');
  assert(Math.hypot(clamped.x - sender.position.x, clamped.y - sender.position.y, clamped.z - sender.position.z) <= 120.01, 'ping outside sender range');
  assert(Object.keys(host.state.toJSON()).sort().join(',') === before, 'ephemeral data entered state');
  result.notes.events = { pings: hp.length, emotes: he.length };
  result.pass = true;
} catch (error) { result.error = `${error.message}${log ? ` (${log.slice(-300)})` : ''}`; }
finally { for (const room of rooms) await room.leave(true).catch(() => {}); server?.kill('SIGTERM'); }
result.seconds = Math.round((Date.now() - started) / 1000);
console.log(`QA_RESULT ${JSON.stringify(result)}`);
process.exitCode = result.pass ? 0 : 1;
