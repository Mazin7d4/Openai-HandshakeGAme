/**
 * Headless seed remix check: 50 seeds × 5 floors must validate and be deterministic.
 * No browser. Run: `node tools/verify-seeds.mjs`
 */
import {
  generateRun,
  validateRunLayout,
  LEVEL_SLOTS,
  VARIANTS_BY_SLOT,
  TWISTS,
} from '../shared/seed/index.mjs';

const SEED_COUNT = 50;
const FLOOR_COUNT = 5;
const errors = [];

function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

function freezeCheck(a, b, label) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  assert(ja === jb, `determinism failed for ${label}`);
}

console.log(`[verify-seeds] ${SEED_COUNT} seeds × ${FLOOR_COUNT} floors`);

// Catalog sanity for the art team.
for (const slot of LEVEL_SLOTS) {
  const list = VARIANTS_BY_SLOT[slot];
  assert(list && list.length >= 2 && list.length <= 3, `slot ${slot} needs 2–3 variants (got ${list?.length})`);
  for (const v of list) {
    assert(v.bounds?.min && v.bounds?.max, `${v.id} missing bounds`);
    assert(Array.isArray(v.openings) && v.openings.length > 0, `${v.id} missing openings`);
  }
}
assert(TWISTS.length === 5, `expected 5 twists, got ${TWISTS.length}`);

let validated = 0;
const twistHits = Object.fromEntries(TWISTS.map((t) => [t.id, 0]));

for (let s = 0; s < SEED_COUNT; s++) {
  const seed = (s * 2654435761) >>> 0;
  for (let floor = 0; floor < FLOOR_COUNT; floor++) {
    const a = generateRun(seed, floor);
    const b = generateRun(seed, floor);
    freezeCheck(a, b, `seed=${seed} floor=${floor}`);

    const check = validateRunLayout(a);
    assert(check.ok, `invalid layout seed=${seed} floor=${floor}: ${check.reason}`);
    assert(a.seed === (seed >>> 0), `seed echo mismatch`);
    assert(a.floor === floor, `floor echo mismatch`);
    assert(a.patrolRoutes.length === a.escalation.guardCount, `guard count mismatch`);
    assert(a.cameras.length >= 1, `missing cameras`);
    assert(a.twist?.id, `missing twist`);
    assert(a.cord.maxLength > 0 && a.cord.restLength > 0, `bad cord`);
    for (const slot of LEVEL_SLOTS) {
      assert(a.variants[slot]?.id, `missing variant for ${slot}`);
    }
    twistHits[a.twist.id] = (twistHits[a.twist.id] ?? 0) + 1;
    validated += 1;
  }
}

// Escalation: higher floors get more pressure.
const low = generateRun(42, 0);
const high = generateRun(42, 4);
assert(high.escalation.guardCount >= low.escalation.guardCount, 'guards should not drop with floor');
assert(high.escalation.patrolSpeed >= low.escalation.patrolSpeed, 'patrol speed should rise with floor');
assert(high.escalation.timerSeconds <= low.escalation.timerSeconds, 'timers should tighten with floor');

if (errors.length) {
  console.error('[verify-seeds] FAILED');
  for (const e of errors.slice(0, 40)) console.error(' -', e);
  if (errors.length > 40) console.error(` …and ${errors.length - 40} more`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  validated,
  twistHits,
  sample: {
    seed: low.seed,
    floor0: {
      twist: low.twist.id,
      variants: Object.fromEntries(LEVEL_SLOTS.map((s) => [s, low.variants[s].id])),
      guards: low.escalation.guardCount,
      cord: low.cord,
      timer: low.escalation.timerSeconds,
    },
    floor4: {
      twist: high.twist.id,
      guards: high.escalation.guardCount,
      patrolSpeed: +high.escalation.patrolSpeed.toFixed(3),
      timer: high.escalation.timerSeconds,
    },
  },
}, null, 2));
