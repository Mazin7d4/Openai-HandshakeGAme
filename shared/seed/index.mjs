export { mulberry32, mixSeed, pick, intRange } from './prng.mjs';
export {
  LEVEL_SLOTS,
  VARIANTS_BY_SLOT,
  LOOT_CANDIDATES,
  EXTRACTION_CANDIDATES,
  TERMINAL_CANDIDATE_SETS,
  PATROL_ROUTE_CANDIDATES,
  CAMERA_CANDIDATES,
  SEED_FORMAT_VERSION,
} from './variants.mjs';
export {
  TWISTS,
  BASE_CORD,
  BASE_TIMER_SECONDS,
  escalateFloor,
  cordForTwist,
} from './twists.mjs';
export { validateRunLayout, dist, distXZ } from './validate.mjs';
import { generateRun as generateRunBase } from './generateRun.mjs';
import { generateFloorPlan, validateFloorPlan } from '../nightshift/plan.mjs';

/** Generate the authoritative layout, including its Night Shift floor plan. */
export function generateRun(seed, floor = 0) {
  const layout = generateRunBase(seed, floor);
  return Object.freeze({ ...layout, plan: generateFloorPlan(seed, floor, layout) });
}

export { generateFloorPlan, validateFloorPlan };
export { applyRunLayout } from './applyRunLayout.mjs';
export { getRunSeed, nextFloorSeed, stashRunSeed, setRunSeedGetter } from './getRunSeed.mjs';
export { dailySeed } from './dailySeed.mjs';
