import type { CameraPlacement, LevelSlot, RoomVariant, Vec3 } from './index';
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
export declare const SEED_FORMAT_VERSION: number;
