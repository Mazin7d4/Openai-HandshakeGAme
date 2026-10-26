import assert from 'node:assert/strict';
import { checkHazardTrips, describeHazardKind, DRONE_RADIUS, hazardForceAt, hazardPhase, hazardSummary, HazardTripGate, HAZARD_COLORS } from '../../shared/nightshift/hazards.mjs';

const started = Date.now();
const result = { test: 'hazards-unit', pass: false, notes: {} };
const p = (role, x, y, z, captured = false) => ({ role, x, y, z, captured });
const wire = { id: 'w', kind: 'tripwire', a: { x: 0, y: 0, z: -2 }, b: { x: 0, y: 0, z: 2 }, period: 2, duty: 0.5, phase: 0 };

function expect(condition, message) { assert.ok(condition, message); }
try {
  for (let i = 0; i < 6; i++) {
    expect(hazardPhase(wire, i * 2 + 0.25).on, 'wire should be on');
    expect(!hazardPhase(wire, i * 2 + 1.25).on, 'wire should be off');
    expect(hazardPhase(wire, i * 2 + 1.8).warn, 'wire should warn before flash');
  }
  const onTrip = checkHazardTrips([wire], 0.1, [p('pix', 0.1, 0, 0)], []);
  expect(onTrip.length === 1 && onTrip[0].via === 'drone', 'drone beam trip');
  expect(checkHazardTrips([wire], 1.1, [p('pix', 0.1, 0, 0)], []).length === 0, 'off beam trip');
  const gate = new HazardTripGate();
  expect(gate.filter(onTrip, 0).length === 1 && gate.filter(onTrip, 2.4).length === 0 && gate.filter(onTrip, 2.5).length === 1, 'trip gate');
  const cord = [p('pix', -2, 0, 0), p('nee', 2, 0, 0)];
  const cordTrip = checkHazardTrips([wire], 0.1, [cord[0], cord[1]], [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]);
  expect(cordTrip.length === 1 && cordTrip[0].via === 'cord' && cordTrip[0].role === 'pix', 'cord trip attribution');
  const sweeper = { id: 's', kind: 'sweeper', center: { x: 0, y: 0, z: 0 }, range: 5, halfAngle: 0.3, baseYaw: 0, sweep: 1, period: 4, phase: 0 };
  expect(checkHazardTrips([sweeper], 0, [p('pix', 0, 0, 3)], []).length === 1, 'sweeper in cone');
  expect(checkHazardTrips([sweeper], 0, [p('pix', 3, 0, 0)], []).length === 0, 'sweeper outside cone');
  expect(Math.abs(hazardPhase(sweeper, 1).yaw - 1) < 1e-9 && Math.abs(hazardPhase(sweeper, 3).yaw + 1) < 1e-9, 'sweeper yaw');
  const slab = { id: 'g', kind: 'pulse-gate', rect: { x0: -0.1, x1: 0.1, y0: -1, y1: 1, z0: -2, z1: 2 }, period: 2, duty: 1 };
  expect(checkHazardTrips([slab], 0, [p('pix', 0.5, 0, 0)], []).length === 1, 'slab drone trip');
  expect(checkHazardTrips([slab], 0, [p('pix', -2, 0, 0), p('nee', 2, 0, 0)], [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])[0].via === 'cord', 'slab cord trip');
  const out = { ax: 9, ay: 9, az: 9, slip: 9 };
  const gust = { id: 'gust', kind: 'gust', rect: { x0: -1, x1: 1, y0: -1, y1: 1, z0: -1, z1: 1 }, force: { x: 2, y: 0, z: -3 } };
  const ice = { id: 'ice', kind: 'ice', rect: gust.rect };
  expect(hazardForceAt([gust, ice], 0, 0, 0, 0, out).ax === 2 && out.az === -3 && out.slip === 0.85, 'force inside');
  hazardForceAt([gust, ice], 0, 2, 0, 0, out);
  expect(out.ax === 0 && out.ay === 0 && out.az === 0 && out.slip === 0, 'force outside');
  expect(DRONE_RADIUS === 0.6 && HAZARD_COLORS.danger === '#ff4d5a' && hazardSummary([wire, ice]).length === 2, 'exports and summary');
  expect(describeHazardKind('tripwire').tip.length <= 60, 'tip length');

  let seedModule = null;
  try { seedModule = await import('../../shared/seed/index.mjs'); } catch { /* Chunk A may still be under construction. */ }
  if (seedModule && typeof seedModule.generateRun === 'function') {
    for (let seed = 0; seed < 200; seed++) for (let floor = 1; floor <= 9; floor++) {
      const plan = seedModule.generateRun(seed, floor)?.plan;
      if (!plan) continue;
      expect(floor !== 1 || plan.hazards.length <= 1, 'floor one hazard count');
      for (const h of plan.hazards) {
        if (h.kind === 'sweeper') expect((h.range ?? 0) <= 10, 'sweeper range');
        if (floor === 1) expect(h.kind !== 'pulse-gate' && h.kind !== 'gust', 'floor one hazard type');
        if (h.kind === 'tripwire' || h.kind === 'pulse-gate') expect((1 - (h.duty ?? 0)) * (h.period ?? 1) >= 1.2, 'hazard off window');
      }
    }
  }
  const sameA = checkHazardTrips([wire], 0.1, [p('pix', 0.1, 0, 0)], []);
  const sameB = checkHazardTrips([wire], 0.1, [p('pix', 0.1, 0, 0)], []);
  expect(JSON.stringify(sameA) === JSON.stringify(sameB), 'determinism');
  result.pass = true;
} catch (error) { result.error = String(error?.message ?? error).slice(0, 1500); }
finally { result.seconds = Math.round((Date.now() - started) / 1000); console.log('QA_RESULT ' + JSON.stringify(result)); process.exitCode = result.pass ? 0 : 1; }
