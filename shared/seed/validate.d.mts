import type { RunLayout, Vec3 } from './index';
export declare function validateRunLayout(layout: RunLayout): { ok: boolean; reason?: string };
export declare function dist(a: Vec3, b: Vec3): number;
export declare function distXZ(a: Vec3, b: Vec3): number;
