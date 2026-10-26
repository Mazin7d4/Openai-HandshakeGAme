import { strict as assert } from 'node:assert';
import { Client } from '@colyseus/sdk';
import { createHash } from 'node:crypto';
import { campaignLayout } from '../../shared/campaign/levels.mjs';
import { freePort, startTestServer } from '../test-server.mjs';

const started = Date.now();
const result = { test: 'campaign-coop', pass: false, notes: {} };
const root = process.cwd();
const rooms = [];
let server;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}
function player(room, role) {
  return [...room.state.players.values()].find((candidate) => candidate.role === role);
}
function snapshot(room, role, position) {
  assert(player(room, role), `missing ${role} player`);
  room.send('snapshot', {
    position, velocity: { x: 0, y: 0, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 },
    boost: 'off', movement: 'idle', selfPowered: false, tetherPull: 0,
  });
}
function hash(plan) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

try {
  const levelId = 'l2-twin-levers';
  const expected = campaignLayout(levelId);
  server = await startTestServer({
    port: await freePort(), root,
    env: { HANDSHAKE_TEST_HOOKS: '1', EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120' },
  });
  const endpoint = `ws://127.0.0.1:${server.port}`;
  const host = await new Client(endpoint).create('handshake', { mode: 'campaign', levelId });
  rooms.push(host);
  const guest = await new Client(endpoint).joinById(host.roomId);
  rooms.push(guest);
  const messages = [[], []].map(() => ({ starts: [], objectives: [], complete: [] }));
  for (const [room, received] of [[host, messages[0]], [guest, messages[1]]]) {
    room.onMessage('floor-start', (message) => received.starts.push(message));
    room.onMessage('objective-state', (message) => received.objectives.push(message));
    room.onMessage('campaign-complete', (message) => received.complete.push(message));
  }
  await waitFor(() => host.state.players.size === 2 && guest.state.players.size === 2, 'both clients seated');
  host.send('debug-run-floor', { floor: 1 });
  await waitFor(() => messages[0].starts.some((message) => message.levelId === levelId), 'host campaign floor-start');
  await waitFor(() => messages[1].starts.some((message) => message.levelId === levelId), 'guest campaign floor-start');
  assert.equal(messages[0].starts.at(-1).levelId, levelId);
  assert.equal(messages[1].starts.at(-1).levelId, levelId);
  assert.equal(hash(expected.plan), hash(campaignLayout(levelId).plan), 'campaign plan hash is not stable');

  host.send('debug-stage', { stage: 'steal-prototype', openDoor: true });
  const [leverA, leverB] = expected.plan.objective.levers;
  for (let i = 0; i < 28; i++) {
    snapshot(host, 'pix', leverA);
    snapshot(guest, 'nee', leverB);
    await sleep(80);
  }
  await waitFor(() => messages[0].objectives.some((message) => message.state.done), 'host twin-lever objective');
  await waitFor(() => messages[1].objectives.some((message) => message.state.done), 'guest twin-lever objective');
  assert.deepEqual(messages[0].objectives.at(-1).state, messages[1].objectives.at(-1).state);

  host.send('debug-run-escape');
  await waitFor(() => messages[0].complete.length > 0 && messages[1].complete.length > 0, 'campaign completion on both clients');
  assert.deepEqual(messages[0].complete.at(-1), messages[1].complete.at(-1), 'completion payload differs');
  assert.equal(messages[0].complete.at(-1).levelId, levelId);
  assert.equal(Array.isArray(messages[0].complete.at(-1).stars), true);
  result.notes = { levelId, planHash: hash(expected.plan), stars: messages[0].complete.at(-1).stars };
  result.pass = true;
} catch (error) {
  result.error = String(error?.message ?? error);
  result.serverTail = server?.log?.().split('\n').slice(-25).join('\n');
} finally {
  for (const room of rooms) {
    try { await Promise.race([room.leave(true), sleep(500)]); } catch { /* already gone */ }
  }
  await server?.stop();
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log(`QA_RESULT ${JSON.stringify(result)}`);
process.exitCode = result.pass ? 0 : 1;
