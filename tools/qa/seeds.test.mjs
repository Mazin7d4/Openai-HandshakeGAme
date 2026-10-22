/**
 * Headless seed remix sweep: generateRun + validateRunLayout for 50 seeds × floors 1–5.
 * No browser. Asserts every layout is valid and that the same seed is deterministic.
 * Also checks dailySeed(UTC date) is stable.
 */
import { generateRun, validateRunLayout, dailySeed } from '../../shared/seed/index.mjs';

const SEED_COUNT = 50;
const FLOORS = [1, 2, 3, 4, 5];
const started = Date.now();
const result = { test: 'seeds', pass: false, notes: {} };

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  const day = new Date(Date.UTC(2026, 9, 22));
  const a = dailySeed(day);
  const b = dailySeed(new Date(Date.UTC(2026, 9, 22, 23, 59, 59)));
  const c = dailySeed(new Date(Date.UTC(2026, 9, 23)));
  assert(a === b, `dailySeed not stable within UTC day (${a} vs ${b})`);
  assert(a !== c, `dailySeed must change across UTC days (${a})`);
  assert((a >>> 0) === a, 'dailySeed must be uint32');
  result.notes.dailySeed = a;

  let validated = 0;
  for (let s = 0; s < SEED_COUNT; s++) {
    const seed = (s * 2654435761) >>> 0;
    for (const floor of FLOORS) {
      const a = generateRun(seed, floor);
      const b = generateRun(seed, floor);
      assert(JSON.stringify(a) === JSON.stringify(b), `determinism failed seed=${seed} floor=${floor}`);
      const check = validateRunLayout(a);
      assert(check.ok, `invalid layout seed=${seed} floor=${floor}: ${check.reason}`);
      assert(a.seed === (seed >>> 0), `seed echo mismatch seed=${seed}`);
      assert(a.floor === floor, `floor echo mismatch seed=${seed} floor=${floor}`);
      validated += 1;
    }
  }
  result.notes = { ...result.notes, validated, seeds: SEED_COUNT, floors: FLOORS };
  result.pass = true;
} catch (e) {
  result.error = String(e?.message ?? e).slice(0, 1500);
} finally {
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log('QA_RESULT ' + JSON.stringify(result));
  process.exitCode = result.pass ? 0 : 1;
}
