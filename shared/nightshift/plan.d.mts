import type { FloorPlan } from './types';
import type { RunLayout } from '../seed/index';
export declare const PLAN_LIMITS: { readonly maxPieces: 40; readonly maxSolidPieces: 32; readonly maxHazards: 5 };
export declare const ARCHETYPES_BY_SLOT: Record<string, readonly string[]>;
export declare const JOB_NAMES: readonly string[];
export declare function generateFloorPlan(seed: number, floor: number, layout: RunLayout): FloorPlan;
export declare function validateFloorPlan(plan: FloorPlan, layout: RunLayout): { ok: boolean; reason?: string };
