import { Client } from '@colyseus/sdk';
import { generateRun } from '../../shared/seed/index.mjs';
import { hazardPhase } from '../../shared/nightshift/hazards.mjs';
import { freePort, startTestServer } from '../test-server.mjs';

const started = Date.now();
const result = { test: 'nightshift-9floors', pass: false, notes: { forced: [] } };
const root = process.cwd();
const rooms = [];
let server;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

async function waitFor(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}

function playerFor(room, role) {
  return [...room.state.players.values()].find((player) => player.role === role);
}

function roomRole(room) {
  const player = [...room.state.players.entries()].find(([sessionId]) => sessionId === room.sessionId)?.[1];
  assert(player?.role === 'pix' || player?.role === 'nee', `room has no local role: ${room.roomId}`);
  return player.role;
}

function sendSnapshot(room, position, tetherPull = 0.9) {
  room.send('snapshot', {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    orientation: { pitch: 0, yaw: 0, roll: 0 },
    boost: 'off', movement: 'idle', selfPowered: false, tetherPull,
  });
}

function listen(room, messages) {
  room.onMessage('objective-state', (message) => messages.objectives.push(message));
  room.onMessage('floor-cleared', (message) => messages.cleared.push(message));
  room.onMessage('floor-start', (message) => messages.starts.push(message));
}

function currentRun(room) {
  return { floor: room.state.run.floor, seed: room.state.run.seed >>> 0, captures: room.state.run.captures };
}

function floorObjective(messages, floor, seed) {
  return messages.objectives.filter((message) => message.floor === floor && (message.seed >>> 0) === (seed >>> 0)).at(-1);
}

function objectiveState(room, messages) {
  const run = currentRun(room);
  return floorObjective(messages, run.floor, run.seed)?.state;
}

function phaseSignature(phase) {
  return `${phase.on}:${phase.warn}`;
}

function nearHazardBoundary(hazard, t) {
  if (hazard.kind === 'ice' || hazard.kind === 'gust' || hazard.kind === 'sweeper') return false;
  const period = hazard.period > 0 ? hazard.period : 1;
  const cycle = ((t / period + (hazard.phase ?? 0)) % 1 + 1) % 1;
  const duty = Math.max(0, Math.min(1, hazard.duty ?? 0));
  return Math.min(cycle, Math.abs(cycle - duty), 1 - cycle) < 0.08;
}

async function waitForFloor(roomsForFloor, floor, seed = null) {
  await waitFor(() => roomsForFloor.every((room) => {
    const run = currentRun(room);
    return run.floor === floor && (seed == null || run.seed === (seed >>> 0));
  }), `both rooms on floor ${floor}`);
  const runs = roomsForFloor.map(currentRun);
  assert(runs.every((run) => run.floor === runs[0].floor && run.seed === runs[0].seed), `run state differs on floor ${floor}`);
  return runs[0];
}

async function driveObjective(roomA, roomB, messagesA, messagesB, plan) {
  const roleA = roomRole(roomA);
  const roleB = roomRole(roomB);
  const byRole = new Map([[roleA, roomA], [roleB, roomB]]);
  assert(byRole.size === 2, 'expected PIX and NEE clients');
  const sendBoth = (a, b) => {
    sendSnapshot(roomA, roleA === 'pix' ? a : b);
    sendSnapshot(roomB, roleB === 'pix' ? a : b);
  };

  if (plan.objective.kind === 'twin-levers') {
    for (let i = 0; i < 30; i++) {
      sendBoth(plan.objective.levers[0], plan.objective.levers[1]);
      await sleep(100);
      const state = objectiveState(roomA, messagesA);
      if (state?.done) break;
    }
  } else if (plan.objective.kind === 'pylon-safe') {
    for (let i = 0; i < 35; i++) {
      sendBoth(plan.objective.safe, plan.objective.anchor);
      await sleep(100);
      const state = objectiveState(roomA, messagesA);
      if (state?.done) break;
    }
  } else if (plan.objective.kind === 'relay') {
    for (const pad of plan.objective.pads) {
      for (let i = 0; i < 8; i++) {
        const current = new Map([[pad.role, pad]]);
        sendSnapshot(roomA, current.get(roleA) ?? plan.objective.pads[0], 0);
        sendSnapshot(roomB, current.get(roleB) ?? plan.objective.pads[0], 0);
        await sleep(100);
        const state = objectiveState(roomA, messagesA);
        if (state?.done || state?.step > plan.objective.pads.indexOf(pad)) break;
      }
    }
  }

  if (['twin-levers', 'pylon-safe', 'relay'].includes(plan.objective.kind)) {
    await waitFor(() => objectiveState(roomA, messagesA)?.done === true, `${plan.objective.kind} objective complete`, 8_000);
    await waitFor(() => objectiveState(roomB, messagesB)?.done === true, `${plan.objective.kind} objective on guest`, 8_000);
  }
}

function compareFloorCleared(a, b, floor) {
  const keys = ['floor', 'seed', 'points', 'total', 'boss'];
  for (const key of keys) assert(a[key] === b[key], `floor ${floor} cleared differs at ${key}: ${a[key]} vs ${b[key]}`);
  assert(a.next?.floor === floor + 1 && b.next?.floor === floor + 1, `floor ${floor} next floor mismatch`);
  assert(JSON.stringify(a.next) === JSON.stringify(b.next), `floor ${floor} next payload differs`);
}

async function phaseA(endpoint) {
  const host = await new Client(endpoint).create('handshake', { mode: 'nightshift', seed: 424242 });
  rooms.push(host);
  const guest = await new Client(endpoint).joinById(host.roomId);
  rooms.push(guest);
  const messagesA = { objectives: [], cleared: [], starts: [] };
  const messagesB = { objectives: [], cleared: [], starts: [] };
  listen(host, messagesA); listen(guest, messagesB);
  host.send('debug-patrol-freeze', { frozen: true });
  await waitFor(() => host.state.players.size === 2 && guest.state.players.size === 2, 'phase A seats');
  host.send('debug-objective'); guest.send('debug-objective');

  let total = 0;
  for (let floor = 1; floor <= 9; floor++) {
    const run = await waitForFloor([host, guest], floor);
    const plan = generateRun(run.seed, floor).plan;
    assert(plan.job.boss === (floor % 3 === 0), `floor ${floor} boss mismatch`);
    host.send('debug-objective'); guest.send('debug-objective');
    await waitFor(() => floorObjective(messagesA, floor, run.seed) && floorObjective(messagesB, floor, run.seed), `objective snapshot floor ${floor}`);
    await sleep(100);
    const objectiveA = floorObjective(messagesA, floor, run.seed);
    const objectiveB = floorObjective(messagesB, floor, run.seed);
    assert(objectiveA.state.kind === (plan.objective?.kind ?? 'grab'), `floor ${floor} objective kind mismatch on host`);
    assert(objectiveB.state.kind === objectiveA.state.kind, `floor ${floor} objective kind mismatch on guest`);
    assert(objectiveA.floor === floor && (objectiveA.seed >>> 0) === run.seed, `floor ${floor} objective identity mismatch`);
    assert(JSON.stringify(objectiveA.state) === JSON.stringify(objectiveB.state), `floor ${floor} initial objective snapshots differ`);

    const elapsedA = Number(host.state.mission.elapsedSeconds);
    const elapsedB = Number(guest.state.mission.elapsedSeconds);
    assert(Math.abs(elapsedA - elapsedB) <= 0.25, `floor ${floor} elapsed differs: ${elapsedA} vs ${elapsedB}`);
    for (const hazard of plan.hazards) {
      const phaseA = hazardPhase(hazard, elapsedA);
      const phaseB = hazardPhase(hazard, elapsedB);
      assert(phaseSignature(phaseA) === phaseSignature(phaseB) || nearHazardBoundary(hazard, elapsedA) || nearHazardBoundary(hazard, elapsedB), `floor ${floor} hazard phase differs for ${hazard.id}`);
    }

    await driveObjective(host, guest, messagesA, messagesB, plan);
    host.send('debug-run-clear', { elapsedSeconds: 40, timesSpotted: 0 });
    await waitFor(() => messagesA.cleared.filter((message) => message.floor === floor).length === 1, `host floor-cleared ${floor}`);
    await waitFor(() => messagesB.cleared.filter((message) => message.floor === floor).length === 1, `guest floor-cleared ${floor}`);
    await sleep(100);
    const clearedA = messagesA.cleared.filter((message) => message.floor === floor);
    const clearedB = messagesB.cleared.filter((message) => message.floor === floor);
    assert(clearedA.length === 1 && clearedB.length === 1, `floor ${floor} floor-cleared was not exactly once`);
    compareFloorCleared(clearedA[0], clearedB[0], floor);
    assert(clearedA[0].boss === (floor % 3 === 0), `floor ${floor} cleared boss mismatch`);
    total += clearedA[0].points;
    assert(clearedA[0].total === total, `floor ${floor} total mismatch: expected ${total}, got ${clearedA[0].total}`);
    host.send('run-next-floor', { floor });
    await waitForFloor([host, guest], floor + 1);
  }
  assert(!host.state.run.ended && !guest.state.run.ended, 'phase A run ended after floor 9');
  assert(host.state.run.score === guest.state.run.score && host.state.run.score === total, 'phase A totals differ');
  result.notes.phaseA = { floors: 9, total, finalFloor: host.state.run.floor };
}

async function phaseB(endpoint) {
  let choice;
  for (let seed = 1; seed <= 500 && !choice; seed++) {
    const plan = generateRun(seed, 2).plan;
    if (plan.objective.kind === 'twin-levers') choice = { seed, plan };
  }
  if (!choice) {
    for (let seed = 1; seed <= 500 && !choice; seed++) {
      const plan = generateRun(seed, 2).plan;
      if (plan.objective.kind === 'relay') choice = { seed, plan };
    }
  }
  assert(choice, 'could not find tether objective for phase B');

  const host = await new Client(endpoint).create('handshake', { mode: 'nightshift', seed: choice.seed });
  rooms.push(host);
  const guest = await new Client(endpoint).joinById(host.roomId);
  rooms.push(guest);
  const messagesA = { objectives: [], cleared: [], starts: [] };
  const messagesB = { objectives: [], cleared: [], starts: [] };
  listen(host, messagesA); listen(guest, messagesB);
  host.send('debug-patrol-freeze', { frozen: true });
  host.send('debug-run-floor', { floor: 2 });
  await waitForFloor([host, guest], 2);
  host.send('debug-objective'); guest.send('debug-objective');
  await waitFor(() => floorObjective(messagesA, 2, choice.seed) && floorObjective(messagesB, 2, choice.seed), 'phase B objective snapshot');

  const roleA = roomRole(host);
  const roleB = roomRole(guest);
  const levers = choice.plan.objective.levers;
  if (choice.plan.objective.kind === 'twin-levers') {
    const partialMs = Math.max(250, Math.round((choice.plan.objective.holdSeconds ?? 1.2) * 400));
    const until = Date.now() + partialMs;
    while (Date.now() < until) {
      sendSnapshot(host, roleA === 'pix' ? levers[0] : levers[1]);
      sendSnapshot(guest, roleB === 'pix' ? levers[0] : levers[1]);
      await sleep(100);
    }
  } else {
    const first = choice.plan.objective.pads[0];
    sendSnapshot(host, roleA === first.role ? first : choice.plan.objective.pads[1], 0);
    sendSnapshot(guest, roleB === first.role ? first : choice.plan.objective.pads[1], 0);
    await sleep(250);
  }
  const before = objectiveState(host, messagesA);
  assert(before, 'phase B did not receive partial objective state');
  const partialProgress = before.progress;
  const partialStep = before.step;
  const partialSeq = before.seq;
  if (choice.plan.objective.kind === 'twin-levers') assert(partialProgress > 0.5 && partialProgress < 0.9, `partial twin-lever progress out of range: ${partialProgress}`);
  else assert(partialStep === 1, `partial relay step expected 1, got ${partialStep}`);

  const token = guest.reconnectionToken;
  assert(typeof token === 'string' && token.length > 0, 'guest has no reconnection token');
  guest.reconnection.enabled = false;
  guest.connection.close(4999, 'qa-drop');
  await waitFor(() => playerFor(host, roleB)?.connected === false, 'guest disconnected seat');
  const t0 = Number(host.state.mission.elapsedSeconds);
  const frozenAt = Date.now();
  while (Date.now() - frozenAt < 3_000) {
    sendSnapshot(host, roleA === 'pix' ? levers?.[0] ?? choice.plan.objective.pads[0] : levers?.[1] ?? choice.plan.objective.pads[0]);
    await sleep(100);
  }
  const t1 = Number(host.state.mission.elapsedSeconds);
  assert(Math.abs(t1 - t0) < 0.3, 'mission timer advanced during drop');
  const afterDrop = objectiveState(host, messagesA);
  assert(afterDrop?.progress >= partialProgress && afterDrop?.step >= partialStep, `objective regressed during drop: ${partialProgress}/${partialStep} -> ${afterDrop?.progress}/${afterDrop?.step}`);
  assert(afterDrop?.seq === partialSeq, `objective sequence changed while frozen: ${partialSeq} -> ${afterDrop?.seq}`);

  const reconnected = await new Client(endpoint).reconnect(token);
  rooms.push(reconnected);
  const messagesBReconnect = { objectives: [], cleared: [], starts: [] };
  listen(reconnected, messagesBReconnect);
  await waitFor(() => playerFor(host, roleB)?.connected === true, 'guest reconnected seat', 5_000);
  let resumed = false;
  await waitFor(() => {
    resumed = Number(host.state.mission.elapsedSeconds) > t1 + 0.5;
    return resumed && Math.abs(Number(reconnected.state.mission.elapsedSeconds) - Number(host.state.mission.elapsedSeconds)) <= 0.5;
  }, 'mission timer resumed after reconnect', 3_000);
  assert(resumed, 'mission timer did not resume');
  await waitFor(() => floorObjective(messagesBReconnect, 2, choice.seed), 'objective snapshot resent on reconnect', 2_000);
  const resent = floorObjective(messagesBReconnect, 2, choice.seed);
  assert(resent.state.progress >= partialProgress && resent.state.step >= partialStep, `reconnect objective state regressed: ${JSON.stringify(resent.state)}`);
  assert(resent.state.seq === partialSeq, `reconnect objective sequence changed: ${partialSeq} -> ${resent.state.seq}`);
  await waitFor(() => currentRun(host).floor === currentRun(reconnected).floor
    && currentRun(host).seed === currentRun(reconnected).seed
    && currentRun(host).captures === currentRun(reconnected).captures, 'reconnected run state');

  await driveObjective(host, reconnected, messagesA, messagesBReconnect, choice.plan);
  host.send('debug-run-clear', { elapsedSeconds: 40, timesSpotted: 0 });
  await waitFor(() => messagesA.cleared.some((message) => message.floor === 2), 'phase B host floor-cleared');
  await waitFor(() => messagesBReconnect.cleared.some((message) => message.floor === 2), 'phase B guest floor-cleared');
  const clearedA = messagesA.cleared.find((message) => message.floor === 2);
  const clearedB = messagesBReconnect.cleared.find((message) => message.floor === 2);
  compareFloorCleared(clearedA, clearedB, 2);
  host.send('run-next-floor', { floor: 2 });
  await waitForFloor([host, reconnected], 3);
  assert(!host.state.run.ended && !reconnected.state.run.ended, 'phase B run ended after reconnect floor');
  result.notes.phaseB = { seed: choice.seed, objective: choice.plan.objective.kind, partialProgress, partialStep, reconnectSeq: resent.state.seq, timer: { t0, t1, resumed } };
}

async function main() {
  server = await startTestServer({
    port: await freePort(), root,
    env: { HANDSHAKE_TEST_HOOKS: '1', EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120' },
  });
  const endpoint = `ws://127.0.0.1:${server.port}`;
  await phaseA(endpoint);
  await phaseB(endpoint);
  result.pass = true;
}

try {
  await Promise.race([
    main(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('overall timeout: 150s')), 150_000)),
  ]);
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
