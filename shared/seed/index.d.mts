export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface Opening {
  id: string;
  kind: 'door' | 'vent' | 'wall-gap';
  center: Vec3;
  halfExtents: Vec3;
}

export interface CoverProp {
  id: string;
  kind: 'cover' | 'prop' | 'crate';
  position: Vec3;
  yaw?: number;
}

export type LevelSlot = 'arrival' | 'office' | 'server' | 'vault' | 'escape';

export interface RoomVariant {
  id: string;
  slot: string;
  label: string;
  bounds: Bounds;
  openings: Opening[];
  cover: CoverProp[];
  spawnPoints: Vec3[];
}

export type TwistId =
  | 'lights_out'
  | 'short_cord'
  | 'slippery_floor'
  | 'nervous_nee'
  | 'rush_hour';

export interface TwistParams {
  id: TwistId;
  label: string;
  cordMaxScale: number;
  cordRestScale: number;
  lightScale: number;
  gripScale: number;
  neeNervousness: number;
  hasteScale: number;
  extraGuards: number;
  timerScale: number;
  cameraSweepScale: number;
  patrolSpeedScale: number;
}

export interface FloorEscalation {
  floor: number;
  guardCount: number;
  patrolSpeed: number;
  cameraSweepScale: number;
  timerSeconds: number;
  detectionRateScale: number;
  hasteScale: number;
}

export interface PatrolRoute {
  id: string;
  waypoints: Vec3[];
  speed: number;
}

export interface CameraPlacement {
  id: string;
  origin: Vec3;
  forward: Vec3;
  sweepAngle: number;
  range: number;
  sweepPeriod: number;
}

export interface RunLayout {
  seed: number;
  floor: number;
  variants: Record<string, RoomVariant>;
  spawn: Vec3;
  loot: Vec3;
  extraction: Vec3;
  terminals: Record<'terminal-a' | 'terminal-b' | 'terminal-c', Vec3>;
  terminalSetId: string;
  patrolRoutes: PatrolRoute[];
  cameras: CameraPlacement[];
  twist: TwistParams;
  escalation: FloorEscalation;
  cord: { restLength: number; maxLength: number };
}

export interface RunSeed {
  seed: number;
  floor: number;
}

export interface ApplyRunLayoutTargets {
  spawn?: Vec3;
  extraction?: Vec3;
  loot?: Vec3 | { position: Vec3 };
  terminals?: Partial<Record<'terminal-a' | 'terminal-b' | 'terminal-c', Vec3 | { position: Vec3 }>>;
  objects?: Map<string, { position: Vec3 }> | Record<string, { position: Vec3 } | Vec3>;
  security?: {
    applyLayout?(layout: RunLayout): void;
    setPatrolHomes?(homes: Array<Vec3 & { index: number }>): void;
    setPatrolRoutes?(routes: PatrolRoute[]): void;
    setCameras?(cameras: CameraPlacement[]): void;
    setTuning?(tuning: {
      patrolSpeed: number;
      cameraSweepScale: number;
      detectionRateScale: number;
      guardCount: number;
    }): void;
  };
  tether?: { restLength?: number; maxLength?: number };
  twist?: Record<string, unknown>;
  onApplied?(layout: RunLayout): void;
}

export declare function mulberry32(seed: number): () => number;
export declare function mixSeed(seed: number, floor: number): number;
export declare function pick<T>(rand: () => number, items: readonly T[]): T;
export declare function intRange(rand: () => number, min: number, max: number): number;

export declare const LEVEL_SLOTS: readonly LevelSlot[];
export declare const VARIANTS_BY_SLOT: Record<string, readonly RoomVariant[]>;
export declare const LOOT_CANDIDATES: readonly Vec3[];
export declare const EXTRACTION_CANDIDATES: readonly Vec3[];
export declare const TERMINAL_CANDIDATE_SETS: readonly Array<{
  id: string;
  'terminal-a': Vec3;
  'terminal-b': Vec3;
  'terminal-c': Vec3;
}>;
export declare const PATROL_ROUTE_CANDIDATES: readonly Array<{ id: string; waypoints: readonly Vec3[] }>;
export declare const CAMERA_CANDIDATES: readonly CameraPlacement[];

export declare const TWISTS: readonly TwistParams[];
export declare const BASE_CORD: { readonly restLength: number; readonly maxLength: number };
export declare const BASE_TIMER_SECONDS: number;
export declare function escalateFloor(floor: number, twist: TwistParams): FloorEscalation;
export declare function cordForTwist(twist: TwistParams): { restLength: number; maxLength: number };

export declare function validateRunLayout(layout: RunLayout): { ok: boolean; reason?: string };
export declare function dist(a: Vec3, b: Vec3): number;
export declare function distXZ(a: Vec3, b: Vec3): number;

export declare function generateRun(seed: number, floor?: number): RunLayout;
export declare function applyRunLayout(layout: RunLayout, targets?: ApplyRunLayoutTargets): RunLayout;
export declare function getRunSeed(override?: { seed?: number; floor?: number } | null): RunSeed;
export declare function nextFloorSeed(current: RunSeed): RunSeed;
export declare function stashRunSeed(value: RunSeed): void;
export declare function setRunSeedGetter(getter: (() => RunSeed | null | undefined) | null): void;
export declare function dailySeed(date?: Date | string): number;
