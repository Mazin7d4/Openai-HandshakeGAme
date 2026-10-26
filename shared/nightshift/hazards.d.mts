import type { HazardPlan, HazardTrip, Vec3 } from './types.js';

export declare const DRONE_RADIUS: 0.6;
export declare const HAZARD_COLORS: {
  readonly danger: '#ff4d5a'; readonly warn: '#ffb03f'; readonly safe: '#39e6a5';
  readonly gust: '#9ad8ff'; readonly ice: '#bfe9ff';
};
export interface HazardPhase { on: boolean; cycle01: number; warn: boolean; yaw?: number }
export declare function hazardPhase(hazard: HazardPlan, t: number): HazardPhase;
export declare function checkHazardTrips(hazards: HazardPlan[], t: number, players: Array<Vec3 & { role: 'pix' | 'nee'; captured?: boolean }>, cordPoints: readonly Vec3[] | null | undefined): HazardTrip[];
export declare class HazardTripGate {
  constructor(cooldown?: number);
  filter(trips: HazardTrip[], t: number): HazardTrip[];
}
export interface HazardForce { ax: number; ay: number; az: number; slip: number }
export declare function hazardForceAt(hazards: HazardPlan[], t: number, x: number, y: number, z: number, out: HazardForce): HazardForce;
export declare function hazardSummary(hazards: HazardPlan[]): string[];
export declare function describeHazardKind(kind: string): { name: string; tip: string };
