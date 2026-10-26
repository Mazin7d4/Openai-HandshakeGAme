import { generateRun as generateBaseRun } from '../../shared/seed/generateRun.mjs';
import { generateFloorPlan } from '../../shared/nightshift/plan.mjs';
import type { RunLayout } from './index.ts';

/** Full Night Shift layout, intentionally reachable only from the lazy game chunk. */
export function generateNightShiftRun(seed: number, floor = 0): RunLayout {
  const layout = generateBaseRun(seed, floor);
  return Object.freeze({ ...layout, plan: generateFloorPlan(seed, floor, layout) });
}
