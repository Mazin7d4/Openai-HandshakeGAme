// Every generated Night Shift floor must fit the client draw-call budget. Sweeps floors 1-12
// for a contiguous seed block plus a hashed spread across the 32-bit seed space (all 2^32
// seeds is not tractable); the generator enforces the same bound by construction.
import { generateRun, validateFloorPlan } from '../../shared/seed/index.mjs';
import { DRAW_CALL_BUDGET, MAX_HAZARDS_ALL_DRESSED, estimateFloorDrawCalls } from '../../shared/nightshift/drawBudget.mjs';

const started = Date.now();
const result = { test: 'drawcall-sweep', pass: false, notes: {}, error: undefined };
function assert(ok, message) { if (!ok) throw new Error(message); }

try {
  const seeds = [];
  for (let s = 0; s < 1500; s++) seeds.push(s);
  for (let s = 0; s < 1500; s++) seeds.push((s * 2654435761 + 12345) >>> 0);
  seeds.push(4294967295);
  let plans = 0, worst = 0, worstKey = '', allDressed = 0;
  for (const seed of seeds) {
    for (let floor = 1; floor <= 12; floor++) {
      const run = generateRun(seed, floor);
      const check = validateFloorPlan(run.plan, run);
      assert(check.ok, `invalid plan ${seed}/${floor}: ${check.reason}`);
      const calls = estimateFloorDrawCalls(run.plan);
      assert(calls <= DRAW_CALL_BUDGET, `draw calls over budget ${seed}/${floor}: ${calls}`);
      if (run.plan.rooms.every((room) => room.archetype !== 'classic')) {
        allDressed += 1;
        assert(run.plan.hazards.length <= MAX_HAZARDS_ALL_DRESSED, `fully dressed floor has ${run.plan.hazards.length} hazards ${seed}/${floor}`);
      }
      if (calls > worst) { worst = calls; worstKey = `${seed}/${floor}`; }
      plans += 1;
    }
  }
  result.notes = { plans, worst, worstKey, allDressed, budget: DRAW_CALL_BUDGET };
  result.pass = true;
} catch (error) { result.error = String(error?.message ?? error).slice(0, 1500); }
finally { result.seconds = Math.round((Date.now() - started) / 1000); console.log('QA_RESULT ' + JSON.stringify(result)); process.exitCode = result.pass ? 0 : 1; }
