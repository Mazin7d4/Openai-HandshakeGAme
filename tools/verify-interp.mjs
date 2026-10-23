import { SnapshotInterpolator } from '../src/network/SnapshotInterpolator.ts';

const rng = (() => { let n = 0x41c64e6d; return () => ((n = Math.imul(n, 1664525) + 1013904223) >>> 0) / 0x100000000; })();
const mag = (v) => Math.hypot(v.x, v.y, v.z);
const LATENCY_MS = 75;
const TURN_AT = 4.8;
const path = (u) => ({
  x: 4.8 * Math.sin(u), y: 1.2 * Math.sin(u * 0.5), z: 4.8 * Math.sin(u) * Math.cos(u),
});
const pathVelocity = (u) => ({
  x: 4.8 * Math.cos(u), y: 0.6 * Math.cos(u * 0.5), z: 4.8 * Math.cos(2 * u),
});
const truth = (t) => {
  const beforeDash = Math.min(t, 2.1);
  const dash = Math.max(0, Math.min(t, 2.8) - 2.1);
  const afterDash = Math.max(0, t - 2.8);
  const parameterAtTurn = 0.9 * beforeDash + 0.9 * 1.7 * dash + 0.9 * afterDash;
  const u = t <= TURN_AT ? parameterAtTurn : parameterAtTurn - 0.9 * 2 * (t - TURN_AT);
  const rate = t > TURN_AT ? -0.9 : (t > 2.1 && t < 2.8 ? 0.9 * 1.7 : 0.9);
  const p = path(u);
  const pv = pathVelocity(u);
  return { pos: p, vel: { x: pv.x * rate, y: pv.y * rate, z: pv.z * rate } };
};
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a, n) => ({ x: a.x * n, y: a.y * n, z: a.z * n });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const packets = [];
for (let i = 0; i <= 180; i++) {
  const sent = i * 50;
  if (sent >= 2950 && sent < 3250) continue;
  if (rng() < 0.02) continue;
  const extra = (rng() * 2 - 1) * 2.5;
  packets.push({ arrival: sent + LATENCY_MS + extra, sent, state: truth(sent / 1000) });
}
packets.sort((a, b) => a.arrival - b.arrival);

const interp = new SnapshotInterpolator();
let packetIndex = 0;
let now = 0;
let last = null;
let sumSq = 0, count = 0, maxError = 0, maxNowError = 0, maxStep = 0, reverse = 0, stallStep = 0, maxBound = 0;
let previousDisplayedVelocity = null;
let stallRecoveryError = 0;
let stepBoundViolation = false;
let delay = 100;
const FRAME_DT_MS = 1000 / 60;
const renderUntil = packets[packets.length - 1].arrival + 100;
const stallRecoveryAt = 3250 + LATENCY_MS + 500;
for (let frame = 0; frame * FRAME_DT_MS <= renderUntil; frame++) {
  now = frame * FRAME_DT_MS;
  while (packetIndex < packets.length && packets[packetIndex].arrival <= now) {
    const q = packets[packetIndex++];
    interp.push({ t: q.arrival, pos: q.state.pos, vel: q.state.vel, yaw: 0, pitch: 0, roll: 0, connected: true, captured: false }, q.arrival);
  }
  const out = interp.sample(now);
  if (!out) continue;
  delay = out.delayMs;
  const displayedSenderTime = Math.max(0, (now - delay - LATENCY_MS) / 1000);
  const expected = truth(displayedSenderTime);
  const e = mag(sub(out.pos, expected.pos));
  const enow = mag(sub(out.pos, truth(now / 1000).pos));
  sumSq += e * e; count++; maxError = Math.max(maxError, e); maxNowError = Math.max(maxNowError, enow);
  if (now >= stallRecoveryAt) stallRecoveryError = Math.max(stallRecoveryError, e);
  if (last) {
    const step = mag(sub(out.pos, last.pos));
    maxStep = Math.max(maxStep, step);
    const frameTruth = truth(Math.max(0, (now - delay - LATENCY_MS) / 1000));
    const currentBound = Math.max(mag(frameTruth.vel), mag(truth(displayedSenderTime + FRAME_DT_MS / 1000).vel)) * (FRAME_DT_MS / 1000) * 1.6 + 0.02;
    maxBound = Math.max(maxBound, currentBound);
    const directionReversed = previousDisplayedVelocity && dot(previousDisplayedVelocity, frameTruth.vel) < 0;
    if (!directionReversed) reverse = Math.max(reverse, -dot(sub(out.pos, last.pos), frameTruth.vel));
    if (step > currentBound + 1e-6) stepBoundViolation = true;
    if (now > 2900 && now < 3500) stallStep = Math.max(stallStep, step);
    previousDisplayedVelocity = frameTruth.vel;
  }
  last = out;
}

const beforeTeleport = last;
const teleportT = now;
interp.push({ t: teleportT, pos: { x: 20, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, connected: true, captured: false });
const teleported = interp.sample(teleportT);
const teleportDistance = mag(sub(teleported.pos, { x: 20, y: 0, z: 0 }));
interp.push({ t: teleportT + 1, pos: { x: 21, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, connected: false, captured: false });
interp.sample(teleportT + 1);
interp.push({ t: teleportT + 2, pos: { x: -20, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, connected: true, captured: false });
const reconnected = interp.sample(teleportT + 2);
const reconnectDistance = mag(sub(reconnected.pos, { x: -20, y: 0, z: 0 }));
const rms = Math.sqrt(sumSq / Math.max(1, count));
const bound = maxBound;
const pass = !stepBoundViolation && reverse <= 0.01 && maxStep <= bound + 1e-6 && rms < 0.35 && maxError < 1.2 && stallStep <= bound + 1e-6 && stallRecoveryError < 0.35 && teleportDistance < 0.01 && reconnectDistance < 0.01;
const metrics = { rms: +rms.toFixed(3), maxError: +maxError.toFixed(3), maxNowError: +maxNowError.toFixed(3), maxStep: +maxStep.toFixed(3), bound: +bound.toFixed(3), reverse: +reverse.toFixed(3), stallStep: +stallStep.toFixed(3), stallRecoveryError: +stallRecoveryError.toFixed(3), teleportDistance: +teleportDistance.toFixed(3), reconnectDistance: +reconnectDistance.toFixed(3), delay: +delay.toFixed(1) };
console.log(`interp metrics ${JSON.stringify(metrics)}`);

// Patch aliasing through RemoteControlSource: the sender emits every ~55-66 ms (frame-gated 50 ms),
// the server patches every 50 ms and the client status also fires on unrelated changes, so the same
// pose is often re-delivered. Duplicates must not stamp a later time (stop-go stutter).
const { RemoteControlSource } = await import('../src/control/RemoteControlSource.ts');
let clock = 0;
const remote = new RemoteControlSource(() => clock);
const base = { playerId: 'p2', role: 'nee', connected: true, boost: 'off', movement: 'flying', selfPowered: true, tetherPull: 0, captured: false, capturedBy: -1, struggles: 0, carryFor: 0, rescueProgress: 0, orientation: { pitch: 0, yaw: 0, roll: 0 } };
let latestSent = null, nextSend = 0, nextPatch = 0, nextNoise = 7, prev = null, aliasMaxStep = 0, aliasViolation = false, aliasReverse = 0;
for (let frame = 0; frame * FRAME_DT_MS <= 4000; frame++) {
  clock = frame * FRAME_DT_MS;
  const senderClock = clock - LATENCY_MS;
  if (senderClock >= nextSend) { const s = truth(senderClock / 1000); latestSent = { ...base, position: s.pos, velocity: s.vel }; nextSend = senderClock + 50 + Math.ceil(rng() * 16); }
  if (latestSent && clock >= nextPatch) { remote.push(latestSent); nextPatch += 50 + (rng() * 2 - 1) * 2.5; }
  if (latestSent && clock >= nextNoise) { remote.push(latestSent); nextNoise += 33; }
  const out = remote.sample(FRAME_DT_MS / 1000).remoteState;
  if (!out) continue;
  if (prev) {
    const step = mag(sub(out.position, prev));
    const shown = truth(Math.max(0, (clock - 120 - LATENCY_MS) / 1000));
    const bound = Math.max(mag(shown.vel), 12) * (FRAME_DT_MS / 1000) * 1.6 + 0.02;
    aliasMaxStep = Math.max(aliasMaxStep, step);
    if (clock > 500 && step > bound) aliasViolation = true;
    if (clock > 500 && Math.abs(clock / 1000 - TURN_AT - 0.2) > 0.3) aliasReverse = Math.max(aliasReverse, -dot(sub(out.position, prev), shown.vel) / Math.max(1e-6, mag(shown.vel)));
  }
  prev = { ...out.position };
}
const aliasPass = !aliasViolation && aliasReverse <= 0.01;
console.log(`interp alias ${JSON.stringify({ maxStep: +aliasMaxStep.toFixed(3), reverse: +aliasReverse.toFixed(3), pass: aliasPass })}`);
const allPass = pass && aliasPass;
console.log(`QA_RESULT ${JSON.stringify({ test: 'interp', pass: allPass, seconds: +(now / 1000).toFixed(2), notes: { ...metrics, aliasMaxStep: +aliasMaxStep.toFixed(3), aliasReverse: +aliasReverse.toFixed(3) }, ...(allPass ? {} : { error: pass ? 'patch aliasing stutter' : 'interpolation bounds exceeded' }) })}`);
process.exitCode = allPass ? 0 : 1;
