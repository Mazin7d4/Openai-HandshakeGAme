import crypto from 'node:crypto';
import { generateRun, validateRunLayout, validateFloorPlan } from '../../shared/seed/index.mjs';

const started = Date.now();
const result = { test: 'floorplan-sweep', pass: false, notes: {}, error: undefined };
// Pins re-cut for seed format v2 (floor-1 loading-dock escape).
const pinned = new Map([
  ['1/1', '9991c737d796f0b8cca80586afebfeca5bb24bba'],
  ['12345/2', '3bd17b8839d6e3759b21f2251ac028f70182d402'],
  ['4294967295/3', 'f6acd0cb2817351efd92ed9ae7eb86de4f418427'],
  ['2654435761/4', '6aaa614b452edcfe2ac3fcca2ad18118bb766c7e'],
  ['42/9', '9cdae8c6557d294a8977a70b932f0ab275233ae1'],
]);
function assert(ok, message) { if (!ok) throw new Error(message); }
function count(into, key) { into[key] = (into[key] ?? 0) + 1; }
function roundedPoint(point) { return [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100, Math.round(point.z * 100) / 100]; }
function objectivePoints(plan, layout) {
  if (plan.objective.kind === 'twin-levers') return plan.objective.levers;
  if (plan.objective.kind === 'pylon-safe') return [plan.objective.pylon, plan.objective.safe, plan.objective.anchor];
  if (plan.objective.kind === 'relay') return plan.objective.pads;
  // Grab and fragile intentionally have no generated point field; their loot
  // target is still useful as a small determinism sanity check.
  return [layout.loot];
}
function pieceHash(room) { return crypto.createHash('sha1').update(JSON.stringify(room.pieces)).digest('hex'); }

try {
  const objectives = {}, archetypes = {}, hazards = {};
  const objectivePositions = new Map();
  const pieceLayouts = new Map();
  let identicalConsecutive = 0;
  let consecutivePairs = 0;
  let fullFallbacks = 0;
  for (let s = 0; s < 200; s++) {
    const seed = (s * 2654435761 + 12345) >>> 0;
    let previousSignature = null;
    for (let floor = 1; floor <= 9; floor++) {
      const a = generateRun(seed, floor); const b = generateRun(seed, floor);
      assert(JSON.stringify(a) === JSON.stringify(b), `nondeterministic seed=${seed} floor=${floor}`);
      assert(a.plan, `missing plan seed=${seed} floor=${floor}`);
      const runCheck = validateRunLayout(a); assert(runCheck.ok, `invalid run ${seed}/${floor}: ${runCheck.reason}`);
      const planCheck = validateFloorPlan(a.plan, a); assert(planCheck.ok, `invalid plan ${seed}/${floor}: ${planCheck.reason}`);
      count(objectives, a.plan.objective.kind);
      const positions = objectivePositions.get(a.plan.objective.kind) ?? new Set();
      for (const point of objectivePoints(a.plan, a)) positions.add(JSON.stringify(roundedPoint(point)));
      objectivePositions.set(a.plan.objective.kind, positions);
      for (const room of a.plan.rooms) {
        count(archetypes, room.archetype);
        if (room.archetype !== 'classic') {
          const layouts = pieceLayouts.get(room.archetype) ?? new Set();
          layouts.add(pieceHash(room));
          pieceLayouts.set(room.archetype, layouts);
        }
      }
      for (const hazard of a.plan.hazards) count(hazards, hazard.kind);
      const signature = JSON.stringify([
        a.plan.rooms.map((room) => room.archetype),
        a.plan.objective.kind,
        a.plan.hazards.map((hazard) => hazard.kind),
      ]);
      if (floor > 1) {
        consecutivePairs += 1;
        if (signature === previousSignature) identicalConsecutive += 1;
        if (a.plan.rooms.every((room) => room.archetype === 'classic') && a.plan.hazards.length === 0) fullFallbacks += 1;
      }
      previousSignature = signature;
      if (floor === 1) assert(a.plan.objective.kind === 'grab', `floor one objective ${a.plan.objective.kind}`);
      if (floor % 3 === 0) assert(a.plan.job.boss && a.plan.job.payoutScale === 2, `boss pacing ${seed}/${floor}`);
    }
  }
  for (const [key, hash] of pinned) { const [seed, floor] = key.split('/').map(Number); const { plan, ...rest } = generateRun(seed, floor); const actual = crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex'); assert(actual === hash, `legacy layout changed ${key}: ${actual}`); }
  for (const key of ['grab', 'twin-levers', 'pylon-safe', 'fragile', 'relay']) assert((objectives[key] ?? 0) >= 10, `objective underrepresented: ${key}`);
  for (const key of ['classic', 'loading-dock', 'cubicle-farm', 'boardroom', 'rack-maze', 'cold-aisle', 'laser-vault', 'vent-crawl']) assert((archetypes[key] ?? 0) >= 10, `archetype underrepresented: ${key}`);
  for (const key of ['tripwire', 'sweeper', 'ice', 'gust', 'pulse-gate']) assert((hazards[key] ?? 0) >= 10, `hazard underrepresented: ${key}`);
  for (const key of ['twin-levers', 'pylon-safe', 'relay']) assert((objectivePositions.get(key)?.size ?? 0) >= 8, `objective positions lack variety: ${key}`);
  for (const key of ['loading-dock', 'cubicle-farm', 'boardroom', 'rack-maze', 'cold-aisle', 'laser-vault', 'vent-crawl']) assert((pieceLayouts.get(key)?.size ?? 0) >= 8, `piece layouts lack variety: ${key}`);
  assert(identicalConsecutive / consecutivePairs <= 0.05, `consecutive floors repeated too often: ${identicalConsecutive}/${consecutivePairs}`);
  assert(fullFallbacks < 18, `full fallback used too often: ${fullFallbacks}`);
  result.notes = {
    objectives,
    archetypes,
    hazards,
    objectivePositions: Object.fromEntries([...objectivePositions].map(([key, values]) => [key, values.size])),
    pieceLayouts: Object.fromEntries([...pieceLayouts].map(([key, values]) => [key, values.size])),
    identicalConsecutive,
    consecutivePairs,
    fullFallbacks,
    layouts: 1800,
  };
  result.pass = true;
} catch (error) { result.error = String(error?.message ?? error).slice(0, 1500); }
finally { result.seconds = Math.round((Date.now() - started) / 1000); console.log('QA_RESULT ' + JSON.stringify(result)); process.exitCode = result.pass ? 0 : 1; }
