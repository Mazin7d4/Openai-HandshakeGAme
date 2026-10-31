import type { FloorPlan } from './types.d.ts';
export declare const DRAW_CALL_BUDGET: number;
export declare const MAX_HAZARDS_ALL_DRESSED: number;
export declare const KIT_PART_COUNTS: Readonly<Record<string, number>>;
export declare function estimateFloorDrawCalls(plan: FloorPlan): number;
