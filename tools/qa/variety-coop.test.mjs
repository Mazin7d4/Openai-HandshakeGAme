import { createHash } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { generateRun } from '../../shared/seed/index.mjs';
import { hazardPhase } from '../../shared/nightshift/hazards.mjs';
import { freePort, startTestServer } from '../test-server.mjs';

const started = Date.now();
const result = { test: 'variety-coop', pass: false, notes: {} };
const root = process.cwd();
const rooms = [];
let server;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function waitFor(predicate, message, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}
function hash(seed, floor) {
  return createHash('sha1').update(JSON.stringify(generateRun(seed, floor).plan)).digest('hex');
}
function rolePlayer(room, role) {
  return [...room.state.players.values()].find((player) => player.role === role);
}
function setSnapshot(room, role, position, tetherPull = 0.9) {
  const player = rolePlayer(room, role);
  assert(player, `missing ${role} player`);
  room.send('snapshot', {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    orientation: { pitch: 0, yaw: 0, roll: 0 },
    boost: 'off', movement: 'idle', selfPowered: false, tetherPull,
  });
}

async function main() {
  let choice = null;
  for (let seed = 0; seed < 2000 && !choice; seed++) {
    for (let floor = 2; floor <= 9; floor++) {
      const plan = generateRun(seed, floor).plan;
      const trip = plan.hazards.find((hazard) => hazard.kind === 'tripwire' || hazard.kind === 'sweeper');
      if (plan.objective.kind === 'twin-levers' && trip) {
        choice = { seed, floor, plan, trip };
        break;
      }
    }
  }
  assert(choice, 'could not find a twin-lever floor with a trip hazard');
  server = await startTestServer({
    port: await freePort(), root,
    env: { HANDSHAKE_TEST_HOOKS: '1', EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120' },
  });
  const endpoint = `ws://127.0.0.1:${server.port}`;
  const host = await new Client(endpoint).create('handshake', { mode: 'nightshift', seed: choice.seed });
  rooms.push(host);
  const guest = await new Client(endpoint).joinById(host.roomId);
  rooms.push(guest);
  const hostMessages = { starts: [], objectives: [], hazards: [], spotted: [] };
  const guestMessages = { starts: [], objectives: [], hazards: [], spotted: [] };
  const listen = (room, messages) => {
    room.onMessage('floor-start', (message) => messages.starts.push(message));
    room.onMessage('objective-state', (message) => messages.objectives.push(message));
    room.onMessage('hazard-trip', (message) => messages.hazards.push(message));
    room.onMessage('security-spotted', (message) => messages.spotted.push(message));
  };
  listen(host, hostMessages); listen(guest, guestMessages);
  await waitFor(() => host.state.players.size === 2 && guest.state.players.size === 2, 'both clients seated');
  host.send('debug-run-floor', { floor: choice.floor });
  await waitFor(() => hostMessages.starts.some((message) => message.floor === choice.floor));
  await waitFor(() => guestMessages.starts.some((message) => message.floor === choice.floor));
  await waitFor(() => host.state.run.floor === choice.floor && guest.state.run.floor === choice.floor, 'run floor synced');
  assert(hash(choice.seed, choice.floor) === hash(host.state.run.seed, host.state.run.floor), `host plan hash mismatch: want ${choice.seed}/${choice.floor} got ${host.state.run.seed}/${host.state.run.floor}`);
  assert(hash(choice.seed, choice.floor) === hash(guest.state.run.seed, guest.state.run.floor), 'guest plan hash mismatch');
  result.notes.floor = choice.floor;
  result.notes.objective = choice.plan.objective.kind;

  host.send('debug-stage', { stage: 'steal-prototype', openDoor: true });
  const loot = generateRun(choice.seed, choice.floor).loot;
  setSnapshot(host, 'pix', loot, 0);
  setSnapshot(guest, 'nee', loot, 0);
  host.send('grab-object', { objectId: 'prototype' });
  await sleep(250);
  assert(![...host.state.objects.values()].find((object) => object.id === 'prototype')?.heldBy, 'locked prototype was grabbed');

  const [leverA, leverB] = choice.plan.objective.levers;
  for (let i = 0; i < 24; i++) {
    setSnapshot(host, 'pix', leverA);
    setSnapshot(guest, 'nee', leverB);
    await sleep(100);
  }
  await waitFor(() => hostMessages.objectives.some((message) => message.floor === choice.floor && message.state.done));
  await waitFor(() => guestMessages.objectives.some((message) => message.floor === choice.floor && message.state.done));
  assert(JSON.stringify(hostMessages.objectives.at(-1).state) === JSON.stringify(guestMessages.objectives.at(-1).state), 'objective snapshots differ');
  for (let i = 0; i < 5; i++) {
    setSnapshot(host, 'pix', loot, 0);
    await sleep(100);
  }
  host.send('grab-object', { objectId: 'prototype' });
  await waitFor(() => [...host.state.objects.values()].find((object) => object.id === 'prototype')?.heldBy === 'pix', 'unlocked prototype grab');

  const trip = choice.trip;
  const now = host.state.mission.elapsedSeconds;
  let position;
  if (trip.kind === 'tripwire') {
    position = { x: (trip.a.x + trip.b.x) / 2, y: trip.a.y, z: (trip.a.z + trip.b.z) / 2 };
  } else {
    const phase = hazardPhase(trip, now);
    const yaw = phase.yaw ?? trip.baseYaw ?? 0;
    position = { x: trip.center.x + Math.sin(yaw) * 2, y: trip.center.y, z: trip.center.z + Math.cos(yaw) * 2 };
  }
  for (let i = 0; i < 90 && (!hostMessages.hazards.length || !hostMessages.spotted.length); i++) {
    setSnapshot(host, 'pix', position, 0);
    await sleep(100);
  }
  await waitFor(() => hostMessages.hazards.length > 0 && guestMessages.hazards.length > 0, 'hazard trip on both clients');
  await waitFor(() => hostMessages.spotted.length > 0 && guestMessages.spotted.length > 0, 'security spot on both clients');
  assert(JSON.stringify(hostMessages.hazards.at(-1)) === JSON.stringify(guestMessages.hazards.at(-1)), 'hazard payload differs');
  result.notes.hazard = hostMessages.hazards.at(-1);
  result.pass = true;
}

try {
  await main();
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
