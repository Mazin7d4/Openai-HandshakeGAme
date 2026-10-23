export interface NightShiftStats {
  elapsedSeconds?: number;
  timesSpotted?: number;
  tetherSaves?: number;
  cordTwangs?: number;
}

export interface FloorScoreEntry {
  points: number;
  clean: boolean;
}

export type NightShiftFloors = Record<number, FloorScoreEntry>;

export interface NightShiftSummary {
  total: number;
  streak: number;
  multiplier: number;
  lastFloor: number;
}

export interface PureScoreFloorResult {
  points: number;
  base: number;
  multiplier: number;
  streak: number;
  total: number;
  floors: NightShiftFloors;
}

export declare function floorBase(stats?: NightShiftStats): number;
export declare function dropFloorsFrom(floors?: NightShiftFloors, floor?: number): NightShiftFloors;
export declare function summarize(floors?: NightShiftFloors): NightShiftSummary;
export declare function scoreFloorPure(stats?: NightShiftStats, floor?: number, floors?: NightShiftFloors): PureScoreFloorResult;
