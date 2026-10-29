import { prototypeRecovery } from '../../shared/prototypeSafety.mjs';

const started = Date.now();
const result = { test: 'prototype-safety', pass: false, notes: {} };
const cradle = { x: 0, y: 5.25, z: 18 };
function assert(ok, why) { if (!ok) throw new Error(why); }
try {
  for (const p of [{ x: 4, y: 1, z: 22 }, { x: 9, y: 3, z: 38 }, { x: 11, y: 2, z: 43.5 }]) {
    assert(prototypeRecovery(p, cradle, true) === null, `legal drop moved: ${JSON.stringify(p)}`);
  }
  const failures = [
    { x: 25, y: 1, z: 20 }, { x: -19, y: 2, z: 20 }, { x: 0, y: -3, z: 20 },
    { x: 0, y: 10, z: 20 }, { x: 0, y: 2, z: 50 }, { x: 0, y: NaN, z: 20 },
    { x: 0, y: 2, z: 1 }, { x: 0, y: 2, z: -30 },
  ];
  for (const p of failures) {
    const recovered = prototypeRecovery(p, cradle, true);
    assert(JSON.stringify(recovered) === JSON.stringify(cradle), `unreachable drop failed recovery: ${JSON.stringify(p)}`);
  }
  assert(prototypeRecovery({ x: 0, y: 2, z: -30 }, cradle, false) === null, 'alarm gate recovery ran before alarm');
  const raised = prototypeRecovery({ x: 30, y: 1, z: 20 }, { x: 4, y: 2.5, z: 21 }, true);
  assert(raised.x === 4 && raised.y === 2.5 && raised.z === 21, 'seeded cradle ignored');
  result.pass = true; result.notes = { legalDrops: 3, unreachableDrops: failures.length, seededCradle: true };
} catch (error) { result.error = error.message; }
finally { result.seconds = Math.round((Date.now() - started) / 1000); console.log('QA_RESULT ' + JSON.stringify(result)); process.exitCode = result.pass ? 0 : 1; }
