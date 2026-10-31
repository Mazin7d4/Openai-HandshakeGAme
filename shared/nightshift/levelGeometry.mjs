/**
 * Coarse collision envelope for the authored PrototypeHeist level.
 *
 * The plan generator is deliberately conservative. These boxes describe the
 * low-flight-space blockers that matter to dressing and objectives; the
 * browser still owns the authoritative Havok geometry.
 */

const box = (x, y, z, sx, sy, sz) => ({
  min: { x: x - sx / 2, y: y - sy / 2, z: z - sz / 2 },
  max: { x: x + sx / 2, y: y + sy / 2, z: z + sz / 2 },
});

const room = (minX, maxX, minZ, maxZ) => ({
  min: { x: minX, y: 0, z: minZ },
  max: { x: maxX, y: 9.2, z: maxZ },
  floorY: 0,
  ceilingY: 9.2,
});

export const ROOM_BOUNDS = Object.freeze({
  arrival: room(-18.5, 18.5, -66, -44),
  office: room(-18.5, 18.5, -42, -26),
  server: room(-18.5, 18.5, -25, 1),
  vault: room(-18.5, 18.5, 2, 26),
  escape: room(-18.5, 18.5, 27, 47),
});

/**
 * Four or more hand-checked open low-floor points per room. The points are
 * intentionally away from the authored reception desk, rack banks, vault
 * benches/dais, and the dock conveyor/cages. Generation adds seeded jitter and
 * may mirror a point when the surrounding room permits it.
 */
export const ANCHOR_POOLS = Object.freeze({
  arrival: Object.freeze([
    { x: -14, y: 2.1, z: -62 },
    { x: 7, y: 2.1, z: -62 },
    { x: -14, y: 2.1, z: -47 },
    { x: 7, y: 2.1, z: -47 },
    { x: 14, y: 2.1, z: -60 },
  ]),
  office: Object.freeze([
    { x: -12, y: 2.1, z: -39 },
    { x: 8, y: 2.1, z: -39 },
    { x: -12, y: 2.1, z: -28.5 },
    { x: 11, y: 2.1, z: -28.5 },
    { x: 2, y: 2.1, z: -39 },
  ]),
  server: Object.freeze([
    { x: -9, y: 2.1, z: -8 },
    { x: 7, y: 2.1, z: -8 },
    { x: -9, y: 2.1, z: -2 },
    { x: 7, y: 2.1, z: -2 },
    { x: 12, y: 2.1, z: -6 },
  ]),
  vault: Object.freeze([
    { x: -8, y: 2.1, z: 5 },
    { x: 8, y: 2.1, z: 5 },
    { x: -8, y: 2.1, z: 13 },
    { x: 8, y: 2.1, z: 7 },
    { x: -1, y: 2.1, z: 5 },
    { x: 4, y: 2.1, z: 13 },
  ]),
  escape: Object.freeze([
    { x: -15, y: 2.1, z: 30 },
    { x: 8, y: 2.1, z: 30 },
    { x: -15, y: 2.1, z: 38 },
    { x: 14, y: 2.1, z: 38 },
    { x: -15, y: 2.1, z: 45 },
    { x: 4, y: 2.1, z: 46 },
  ]),
});

// All boxes below are centred AABBs matching the box() calls in
// src/level/PrototypeHeist.ts. Decorative meshes that have no physics body are
// intentionally omitted, while desks, benches, glass, and racks are included.
export const STATIC_BLOCKERS = Object.freeze([
  // Building shell. The service spine was removed from the authored level.
  box(-19, 4.5, -10, 0.6, 9, 114),
  box(19, 4.5, -10, 0.6, 9, 114),
  box(0, 4.5, 47, 38, 9, 0.6),
  box(0, 4.5, -67, 38, 9, 0.6),

  // Arrival reception and the divider around the high service vent.
  box(-4.5, 1.8, -49, 11, 3.8, 4.3),
  box(3, 2.35, -43, 30, 4.7, 0.6),
  box(3, 11, -43, 30, 6, 0.6),
  box(-9, 4.5, -55, 6, 9, 0.5),
  box(11, 4.5, -55, 16, 9, 0.5),
  box(-1.5, 6.7, -55, 9, 4.6, 0.5),
  box(-7.6, 6.4, -43, 0.2, 3.4, 5),
  box(-2.4, 6.4, -43, 0.2, 3.4, 5),

  // Office desks, glass, and the full-height shutter wall.
  box(-5, 3.75, -33, 9, 4.0, 4.3),
  box(7, 3.75, -31, 8, 4.0, 4.3),
  box(13, 4.5, -35, 0.14, 9, 15),
  box(-8, 4.5, -26, 8, 9, 0.6),
  box(10.5, 4.5, -26, 17, 9, 0.6),
  box(-1, 6.7, -26, 6, 4.6, 0.6),

  // The authored rack banks are about 7.8 units tall. New plan racks are
  // deliberately half-height rack carts so drones can always fly over them.
  box(-4, 3.9, -21, 16, 7.8, 2.6),
  box(7, 3.9, -13, 22, 7.8, 2.6),
  box(-5, 5.7, -5.8, 10, 0.25, 5),

  // Vault shutter, benches, plinth, dais, and the two solid glass cases.
  box(-7.4, 4.5, 2, 9.2, 9, 0.7),
  box(10.4, 4.5, 2, 15.2, 9, 0.7),
  box(0, 6.7, 2, 5.6, 4.6, 0.7),
  box(-7, 3.75, 8, 7.5, 4, 3.5),
  box(9, 3.75, 11, 7.5, 4, 3.5),
  box(0, 0.18, 18, 11.5, 0.36, 9),
  box(0, 2.3, 18, 3.4, 4.6, 3.4),
  box(-6.2, 4, 20, 0.1, 8, 8),
  box(6.2, 4, 20, 0.1, 8, 8),

  // Loading dock conveyor and cages.
  box(-5, 1.2, 34, 22, 2.4, 1.6),
  box(-10, 2.2, 41, 3, 4.4, 3),
  box(2, 2.2, 40, 3, 4.4, 3),
]);

// Keep-out envelopes around routes. Relay segments may cross these openings,
// but solid dressing and objective endpoints may not occupy them.
export const DOORWAYS = Object.freeze([
  box(-5, 6.4, -43, 4.8, 3, 1.6),
  box(-1, 3, -26, 6, 6, 1.2),
  box(0, 3, 2, 5.6, 6, 1.2),
  box(0, 3, 27, 11.2, 6, 1.2),
  box(0, 2.5, 34, 5, 4, 3),
]);

export function aabbOverlap(a, b) {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

export function pointInAabb(p, a, margin = 0) {
  return (
    p.x >= a.min.x - margin &&
    p.x <= a.max.x + margin &&
    p.y >= a.min.y - margin &&
    p.y <= a.max.y + margin &&
    p.z >= a.min.z - margin &&
    p.z <= a.max.z + margin
  );
}
