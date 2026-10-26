export interface Vec3 { x: number; y: number; z: number }
export interface Aabb { min: Vec3; max: Vec3 }
export interface RoomBounds extends Aabb { floorY: number; ceilingY: number }
export declare const ROOM_BOUNDS: Readonly<Record<'arrival'|'office'|'server'|'vault'|'escape', RoomBounds>>;
export declare const ANCHOR_POOLS: Readonly<Record<'arrival'|'office'|'server'|'vault'|'escape', readonly Vec3[]>>;
export declare const STATIC_BLOCKERS: readonly Aabb[];
export declare const DOORWAYS: readonly Aabb[];
export declare function aabbOverlap(a: Aabb, b: Aabb): boolean;
export declare function pointInAabb(p: Vec3, a: Aabb, margin?: number): boolean;
