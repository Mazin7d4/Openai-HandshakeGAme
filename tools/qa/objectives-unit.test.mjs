import { createObjectiveState, objectiveBotTarget, serializeObjectiveState, stepObjective, lootLocked } from '../../shared/nightshift/objectives.mjs';
import { ObjectiveSim } from '../../server/objectiveSim.mjs';

const started = Date.now();
const result = { test: 'objectives-unit', pass: false, notes: {} };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const p = (role, x, z, tetherPull = 0) => ({ role, x, y: 0, z, tetherPull });
const run = (state, plan, input, seconds, tick = 0.1) => { for (let t = 0; t < seconds - 1e-8; t += tick) stepObjective(state, plan, { ...input, dt: tick }); };

try {
  const twin = { kind: 'twin-levers', label: 'Pull both levers', levers: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], leverRadius: 1, holdSeconds: 1 };
  let s = createObjectiveState(twin); run(s, twin, { players: [p('pix', 0, 0)], yanks: [] }, 5); assert(!s.done, 'one lever completed');
  run(s, twin, { players: [p('pix', 0, 0), p('nee', 10, 0)], yanks: [] }, 1.1); assert(s.done, 'twin levers did not complete');
  s = createObjectiveState(twin); run(s, twin, { players: [p('pix', 0, 0), p('nee', 10, 0)], yanks: [] }, 0.8); run(s, twin, { players: [p('pix', 0, 0)], yanks: [] }, 0.2); assert(s.timer > 0, 'lever hold reset instead of decaying');
  s = createObjectiveState(twin); run(s, twin, { players: [p('pix', 0, 0)], yanks: [] }, 0.1); run(s, twin, { players: [p('pix', 10, 0)], yanks: [] }, 2); assert(!s.done, 'single drone held both levers');

  const pyl = { kind: 'pylon-safe', label: 'Pull the safe', pylon: { x: 0, y: 0, z: 0 }, safe: { x: -4, y: 0, z: 0 }, anchor: { x: 4, y: 0, z: 0 }, hookRadius: 1, pullsRequired: 3 };
  s = createObjectiveState(pyl); for (let i = 0; i < 3; i++) { run(s, pyl, { players: [p('pix', -4, 0, .9), p('nee', 4, 0, .9)], yanks: [] }, .6); run(s, pyl, { players: [p('pix', -4, 0, .9), p('nee', 4, 0, .9)], yanks: [] }, .8); } assert(s.done && s.pulls === 3, 'pylon pulls failed');
  s = createObjectiveState(pyl); run(s, pyl, { players: [p('pix', -4, 0, .9), p('nee', -4, 0, .9)], yanks: ['pix'] }, .1); assert(s.pulls === 0, 'same-side pylon pulled');
  s = createObjectiveState(pyl); stepObjective(s, pyl, { dt: .1, players: [p('pix', -4, 0, .9), p('nee', 4, 0, .9)], yanks: ['pix'] }); assert(s.pulls === 1, 'pylon yank failed');

  const fragile = { kind: 'fragile', label: 'Handle with care', cracksToShatter: 3 }; s = createObjectiveState(fragile); for (let i = 0; i < 3; i++) { run(s, fragile, { players: [], carrier: 'pix', yanks: [] }, 1.0); stepObjective(s, fragile, { dt: .1, players: [], carrier: 'pix', yanks: ['pix'] }); } assert(s.shatters === 1 && !lootLocked(s, fragile), 'fragile behavior failed');
  const relay = { kind: 'relay', label: 'Relay pads', pads: [{ x: 0, y: 0, z: 0, role: 'pix' }, { x: 2, y: 0, z: 0, role: 'nee' }], padRadius: 1, stepSeconds: 1 }; s = createObjectiveState(relay); stepObjective(s, relay, { dt: .1, players: [p('nee', 0, 0)], yanks: [] }); assert(s.step === 0, 'wrong relay role stepped'); stepObjective(s, relay, { dt: .1, players: [p('pix', 0, 0)], yanks: [] }); stepObjective(s, relay, { dt: .1, players: [p('nee', 2, 0)], yanks: [] }); assert(s.done, 'relay did not complete');

  const sim = new ObjectiveSim(); sim.reset(twin); sim.noteYank('pix'); sim.step(.1, [{ role: 'pix', position: { x: 0, y: 0, z: 0 }, connected: true }]); assert(sim.snapshot().seq > 0, 'sim did not collect events');
  const a = createObjectiveState(relay), b = createObjectiveState(relay); for (let i = 0; i < 10; i++) { const input = { dt: .1, players: [p('pix', i === 0 ? 0 : 2, 0), p('nee', i > 0 ? 2 : 8, 0)], yanks: [] }; stepObjective(a, relay, input); stepObjective(b, relay, input); } assert(JSON.stringify(serializeObjectiveState(a)) === JSON.stringify(serializeObjectiveState(b)), 'nondeterministic state');
  result.notes.cases = 5; result.pass = true;
} catch (error) { result.error = String(error?.message ?? error).slice(0, 1500); }
result.seconds = Math.round((Date.now() - started) / 1000);
console.log('QA_RESULT ' + JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
