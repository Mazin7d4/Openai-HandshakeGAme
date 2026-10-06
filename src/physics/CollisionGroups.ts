/** Collision categories used to keep controlled carry bodies out of drone response. */
export const COLLISION_GROUP = {
  world: 1 << 0,
  pix: 1 << 1,
  nee: 1 << 2,
  grabbable: 1 << 3,
  all: 0xffffffff,
} as const;
