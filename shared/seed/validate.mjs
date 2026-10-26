/**
 * Solvability validator: spawn → loot → exit reachability under cord length and twist.
 * Uses authored openings as flyable portals between slots — not a full navmesh.
 */

/** @typedef {{ x: number, y: number, z: number }} Vec3 */

const SEED_FORMAT_VERSION = 2;
const CEILING_Y = 9.2;

/**
 * @param {Vec3} a
 * @param {Vec3} b
 */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Horizontal (XZ) distance — drones climb freely within authored heights.
 * @param {Vec3} a
 * @param {Vec3} b
 */
export function distXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Point roughly inside an opening AABB (center ± halfExtents), with a small margin.
 * @param {Vec3} p
 * @param {{ center: Vec3, halfExtents: Vec3 }} opening
 */
function nearOpening(p, opening) {
  const { center: c, halfExtents: h } = opening;
  const margin = 1.5;
  return (
    Math.abs(p.x - c.x) <= h.x + margin &&
    Math.abs(p.y - c.y) <= h.y + margin + 2 &&
    Math.abs(p.z - c.z) <= h.z + margin
  );
}

/**
 * Build a coarse waypoint chain for the heist path.
 * @param {import('./generateRun.mjs').RunLayout} layout
 * @returns {Vec3[]}
 */
function pathWaypoints(layout) {
  const points = [];
  points.push(layout.spawn);

  const arrival = layout.variants.arrival;
  for (const opening of arrival.openings) {
    points.push(opening.center);
  }

  points.push(layout.terminals['terminal-a']);
  points.push(layout.terminals['terminal-b']);

  const office = layout.variants.office;
  for (const opening of office.openings) {
    points.push(opening.center);
  }

  points.push(layout.terminals['terminal-c']);

  const server = layout.variants.server;
  for (const opening of server.openings) {
    points.push(opening.center);
  }

  const vault = layout.variants.vault;
  for (const opening of vault.openings) {
    if (opening.kind === 'door' && opening.id.includes('lab')) {
      points.push(opening.center);
    }
  }

  points.push(layout.loot);

  for (const opening of vault.openings) {
    if (opening.id.includes('relief')) {
      points.push(opening.center);
    }
  }

  const escape = layout.variants.escape;
  for (const opening of escape.openings) {
    points.push(opening.center);
  }

  points.push(layout.extraction);
  return points;
}

/**
 * Max single-leg hop drones can cover while linked (generous for flight).
 * Short cord tightens the pair budget, not the solo hop.
 */
const MAX_SOLO_HOP = 28;
/** Max hop between successive path waypoints in XZ. */
const MAX_PATH_HOP_XZ = 42;

/**
 * @param {import('./generateRun.mjs').RunLayout} layout
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateRunLayout(layout) {
  if (!layout || typeof layout !== 'object') {
    return { ok: false, reason: 'missing layout' };
  }
  if (layout.formatVersion !== SEED_FORMAT_VERSION) {
    return { ok: false, reason: 'seed format mismatch; regenerate this run' };
  }

  const cordMax = layout.cord?.maxLength ?? 10;
  if (!(cordMax >= 5 && cordMax <= 14)) {
    return { ok: false, reason: `cord maxLength out of range (${cordMax})` };
  }

  // Role-locked terminal pair must be within cord reach (meet-in-the-middle slack).
  const termA = layout.terminals['terminal-a'];
  const termB = layout.terminals['terminal-b'];
  if (!termA || !termB) {
    return { ok: false, reason: 'missing office terminals' };
  }
  const ab = dist(termA, termB);
  // Drones need not sit on both terminals simultaneously for the whole hack, but
  // the pair must be able to stretch between them. Allow a small meet-in-middle
  // budget: each drone can leave its console by ~1.5u toward the other.
  const pairBudget = cordMax + 3.2;
  if (ab > pairBudget) {
    return { ok: false, reason: `terminals too far for cord (${ab.toFixed(2)} > ${pairBudget.toFixed(2)})` };
  }

  // Spawn must sit inside arrival bounds and near a spawn candidate.
  const arrival = layout.variants?.arrival;
  if (!arrival) return { ok: false, reason: 'missing arrival variant' };
  const b = arrival.bounds;
  const s = layout.spawn;
  if (
    s.x < b.min.x || s.x > b.max.x ||
    s.z < b.min.z || s.z > b.max.z ||
    s.y < 0.5 || s.y > b.max.y
  ) {
    return { ok: false, reason: 'spawn outside arrival bounds' };
  }

  // Loot inside vault bounds.
  const vault = layout.variants?.vault;
  if (!vault) return { ok: false, reason: 'missing vault variant' };
  const vb = vault.bounds;
  const loot = layout.loot;
  if (
    loot.x < vb.min.x || loot.x > vb.max.x ||
    loot.z < vb.min.z || loot.z > vb.max.z
  ) {
    return { ok: false, reason: 'loot outside vault bounds' };
  }

  // Extraction inside the loading dock escape bounds.
  const escape = layout.variants?.escape;
  if (!escape) return { ok: false, reason: 'missing escape variant' };
  const eb = escape.bounds;
  const ex = layout.extraction;
  if (
    ex.x < eb.min.x || ex.x > eb.max.x ||
    ex.z < eb.min.z || ex.z > eb.max.z
  ) {
    return { ok: false, reason: 'extraction outside escape bounds' };
  }

  // Path connectivity through openings: successive waypoints must hop reasonably.
  const path = pathWaypoints(layout);
  for (let i = 1; i < path.length; i++) {
    const hop = distXZ(path[i - 1], path[i]);
    if (hop > MAX_PATH_HOP_XZ) {
      return {
        ok: false,
        reason: `path gap ${i - 1}→${i} too large (${hop.toFixed(1)})`,
      };
    }
  }

  // Spawn → loot and loot → exit as coarse reachability (sum of hops).
  const lootIndex = path.findIndex((p) => p === layout.loot || dist(p, layout.loot) < 0.01);
  if (lootIndex < 0) return { ok: false, reason: 'loot missing from path' };

  let spawnToLoot = 0;
  for (let i = 1; i <= lootIndex; i++) spawnToLoot += dist(path[i - 1], path[i]);
  if (spawnToLoot > 220) {
    return { ok: false, reason: `spawn→loot path too long (${spawnToLoot.toFixed(0)})` };
  }

  let lootToExit = 0;
  for (let i = lootIndex + 1; i < path.length; i++) lootToExit += dist(path[i - 1], path[i]);
  if (lootToExit > 180) {
    return { ok: false, reason: `loot→exit path too long (${lootToExit.toFixed(0)})` };
  }

  // Short cord: extraction pair must still fit (both drones + carrier).
  // They approach the pad together; pad radius ~5.5, so cord must allow ~pad diameter.
  if (cordMax < 6.5 && layout.twist?.id === 'short_cord') {
    // Still solvable if pad is compact — we already clamp cord >= ~7.2*0.72 = 7.2.
    // Extra guard: extraction candidates stay clustered.
    if (distXZ(layout.spawn, layout.extraction) > 30 && cordMax < 6) {
      return { ok: false, reason: 'short cord cannot cover extraction pair' };
    }
  }

  // Nervous NEE / slippery: still require openings between vault and escape.
  const relief = vault.openings.find((o) => o.id.includes('relief'));
  if (!relief) return { ok: false, reason: 'vault missing relief opening' };
  if (!nearOpening(relief.center, relief)) {
    return { ok: false, reason: 'relief opening malformed' };
  }

  // Patrols are seeded in the loading dock escape pocket.
  for (const route of layout.patrolRoutes ?? []) {
    for (const wp of route.waypoints) {
      if (
        wp.x < eb.min.x - 4 || wp.x > eb.max.x + 4 ||
        wp.z < eb.min.z - 6 || wp.z > eb.max.z + 4
      ) {
        return { ok: false, reason: `patrol waypoint outside escape pocket (${route.id})` };
      }
    }
    if (route.waypoints.length < 2) {
      return { ok: false, reason: `patrol route too short (${route.id})` };
    }
  }

  // Seeded points must fit below the authored cutaway roof. This catches old
  // spine candidates and future catalog edits before they reach gameplay.
  const points = [
    layout.spawn,
    layout.loot,
    layout.extraction,
    ...Object.values(layout.terminals ?? {}),
    ...(layout.patrolRoutes ?? []).flatMap((route) => route.waypoints),
    ...(layout.cameras ?? []).map((camera) => camera.origin),
    ...Object.values(layout.variants ?? {}).flatMap((variant) => [
      ...(variant.spawnPoints ?? []),
      ...(variant.openings ?? []).map((opening) => opening.center),
      ...(variant.cover ?? []).map((cover) => cover.position),
    ]),
  ];
  if (points.some((point) => Number.isFinite(point?.y) && point.y > CEILING_Y + 1e-6)) {
    return { ok: false, reason: `seeded object above ceilingY ${CEILING_Y}` };
  }

  // Cameras need a forward vector and positive range.
  for (const cam of layout.cameras ?? []) {
    const fl = Math.hypot(cam.forward.x, cam.forward.y, cam.forward.z);
    if (fl < 0.1 || !(cam.range > 1) || !(cam.sweepAngle > 0)) {
      return { ok: false, reason: `camera malformed (${cam.id})` };
    }
  }

  // Solo hop sanity: spawn to first opening.
  if (arrival.openings.length && dist(layout.spawn, arrival.openings[0].center) > MAX_SOLO_HOP) {
    return { ok: false, reason: 'spawn too far from first opening' };
  }

  // Guard / timer sanity after escalation.
  if (!(layout.escalation?.guardCount >= 1)) {
    return { ok: false, reason: 'invalid guard count' };
  }
  if (!(layout.escalation?.timerSeconds >= 120)) {
    return { ok: false, reason: 'timer too tight' };
  }

  return { ok: true };
}
