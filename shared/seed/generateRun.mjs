/**
 * Seeded remix of handcrafted pieces. Not procedural map generation.
 * `generateRun(seed, floor)` → RunLayout (always solvable; sub-choices reroll on fail).
 */

import { intRange, mixSeed, mulberry32, pick } from './prng.mjs';
import {
  CAMERA_CANDIDATES,
  EXTRACTION_CANDIDATES,
  LEVEL_SLOTS,
  LOOT_CANDIDATES,
  PATROL_ROUTE_CANDIDATES,
  TERMINAL_CANDIDATE_SETS,
  VARIANTS_BY_SLOT,
} from './variants.mjs';
import { TWISTS, cordForTwist, escalateFloor } from './twists.mjs';
import { validateRunLayout } from './validate.mjs';

/**
 * @typedef {import('./variants.mjs').RoomVariant} RoomVariant
 * @typedef {import('./twists.mjs').TwistParams} TwistParams
 * @typedef {{ x: number, y: number, z: number }} Vec3
 *
 * @typedef {{
 *   id: string,
 *   waypoints: Vec3[],
 *   speed: number,
 * }} PatrolRoute
 *
 * @typedef {{
 *   id: string,
 *   origin: Vec3,
 *   forward: Vec3,
 *   sweepAngle: number,
 *   range: number,
 *   sweepPeriod: number,
 * }} CameraPlacement
 *
 * @typedef {{
 *   seed: number,
 *   floor: number,
 *   variants: Record<string, RoomVariant>,
 *   spawn: Vec3,
 *   loot: Vec3,
 *   extraction: Vec3,
 *   terminals: Record<'terminal-a' | 'terminal-b' | 'terminal-c', Vec3>,
 *   terminalSetId: string,
 *   patrolRoutes: PatrolRoute[],
 *   cameras: CameraPlacement[],
 *   twist: TwistParams,
 *   escalation: ReturnType<typeof escalateFloor>,
 *   cord: { restLength: number, maxLength: number },
 * }} RunLayout
 */

const MAX_ATTEMPTS = 48;

/**
 * @param {() => number} rand
 * @param {number} count
 * @param {readonly { id: string, waypoints: readonly Vec3[] }[]} pool
 * @param {number} speed
 * @returns {PatrolRoute[]}
 */
function pickPatrolRoutes(rand, count, pool, speed) {
  const chosen = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let guard = 0;
    let route;
    do {
      route = pick(rand, pool);
      guard += 1;
    } while (used.has(route.id) && used.size < pool.length && guard < 12);
    used.add(route.id);
    chosen.push(
      Object.freeze({
        id: route.id,
        waypoints: route.waypoints.map((w) => Object.freeze({ ...w })),
        speed,
      }),
    );
  }
  return chosen;
}

/**
 * @param {() => number} rand
 * @param {number} count
 * @param {number} sweepScale
 * @returns {CameraPlacement[]}
 */
function pickCameras(rand, count, sweepScale) {
  const chosen = [];
  const used = new Set();
  const n = Math.max(1, Math.min(count, CAMERA_CANDIDATES.length));
  for (let i = 0; i < n; i++) {
    let guard = 0;
    let cam;
    do {
      cam = pick(rand, CAMERA_CANDIDATES);
      guard += 1;
    } while (used.has(cam.id) && used.size < CAMERA_CANDIDATES.length && guard < 12);
    used.add(cam.id);
    chosen.push(
      Object.freeze({
        id: cam.id,
        origin: Object.freeze({ ...cam.origin }),
        forward: Object.freeze({ ...cam.forward }),
        sweepAngle: cam.sweepAngle,
        range: cam.range,
        sweepPeriod: +(cam.sweepPeriod / sweepScale).toFixed(3),
      }),
    );
  }
  return chosen;
}

/** Twists that are too harsh for a first floor (dark start); saved for floor 2+. */
const HARD_TWISTS = new Set(['lights_out']);
/**
 * Floor 1 never rolls a hard twist.
 * @param {number} floor
 */
function twistPoolForFloor(floor) {
  return (floor | 0) <= 1 ? TWISTS.filter((t) => !HARD_TWISTS.has(t.id)) : TWISTS;
}

/**
 * Attempt one full layout draw. Caller validates and may retry with a new stream.
 * @param {() => number} rand
 * @param {number} seed
 * @param {number} floor
 * @returns {RunLayout}
 */
function drawLayout(rand, seed, floor) {
  /** @type {Record<string, RoomVariant>} */
  const variants = {};
  for (const slot of LEVEL_SLOTS) {
    const pool = VARIANTS_BY_SLOT[slot];
    variants[slot] = pick(rand, pool);
  }

  const twist = pick(rand, twistPoolForFloor(floor));
  const escalation = escalateFloor(floor, twist);
  const cord = cordForTwist(twist);

  const arrival = variants.arrival;
  const spawn = pick(rand, arrival.spawnPoints);

  const terminalSet = pick(rand, TERMINAL_CANDIDATE_SETS);
  const terminals = Object.freeze({
    'terminal-a': Object.freeze({ ...terminalSet['terminal-a'] }),
    'terminal-b': Object.freeze({ ...terminalSet['terminal-b'] }),
    'terminal-c': Object.freeze({ ...terminalSet['terminal-c'] }),
  });

  const loot = pick(rand, LOOT_CANDIDATES);
  const extraction = pick(rand, EXTRACTION_CANDIDATES);

  const patrolRoutes = pickPatrolRoutes(
    rand,
    escalation.guardCount,
    PATROL_ROUTE_CANDIDATES,
    escalation.patrolSpeed,
  );

  // One camera on floor 0; add another every 2 floors (capped).
  const cameraCount = Math.min(3, 1 + Math.floor(floor / 2));
  const cameras = pickCameras(rand, cameraCount, escalation.cameraSweepScale);

  return Object.freeze({
    seed: seed >>> 0,
    floor: floor | 0,
    variants: Object.freeze(variants),
    spawn: Object.freeze({ ...spawn }),
    loot: Object.freeze({ ...loot }),
    extraction: Object.freeze({ ...extraction }),
    terminals,
    terminalSetId: terminalSet.id,
    patrolRoutes: Object.freeze(patrolRoutes),
    cameras: Object.freeze(cameras),
    twist,
    escalation,
    cord,
  });
}

/**
 * Reroll a single sub-choice family after a failed validation.
 * Keeps variants + twist when possible; reshuffles loot / terminals / routes / cameras / spawn.
 *
 * @param {() => number} rand
 * @param {RunLayout} previous
 * @param {string} [hint]
 * @returns {RunLayout}
 */
function rerollSubChoice(rand, previous, hint = '') {
  const next = { ...previous, variants: { ...previous.variants } };

  if (/spawn/i.test(hint)) {
    next.spawn = Object.freeze({ ...pick(rand, previous.variants.arrival.spawnPoints) });
  } else if (/terminal|cord/i.test(hint)) {
    const terminalSet = pick(rand, TERMINAL_CANDIDATE_SETS);
    next.terminals = Object.freeze({
      'terminal-a': Object.freeze({ ...terminalSet['terminal-a'] }),
      'terminal-b': Object.freeze({ ...terminalSet['terminal-b'] }),
      'terminal-c': Object.freeze({ ...terminalSet['terminal-c'] }),
    });
    next.terminalSetId = terminalSet.id;
  } else if (/loot/i.test(hint)) {
    next.loot = Object.freeze({ ...pick(rand, LOOT_CANDIDATES) });
  } else if (/extract/i.test(hint)) {
    next.extraction = Object.freeze({ ...pick(rand, EXTRACTION_CANDIDATES) });
  } else if (/patrol/i.test(hint)) {
    next.patrolRoutes = Object.freeze(
      pickPatrolRoutes(
        rand,
        previous.escalation.guardCount,
        PATROL_ROUTE_CANDIDATES,
        previous.escalation.patrolSpeed,
      ),
    );
  } else if (/camera/i.test(hint)) {
    next.cameras = Object.freeze(
      pickCameras(rand, previous.cameras.length, previous.escalation.cameraSweepScale),
    );
  } else if (/variant|opening|path|gap/i.test(hint)) {
    const slot = LEVEL_SLOTS[intRange(rand, 0, LEVEL_SLOTS.length)];
    next.variants = Object.freeze({
      ...previous.variants,
      [slot]: pick(rand, VARIANTS_BY_SLOT[slot]),
    });
    if (slot === 'arrival') {
      next.spawn = Object.freeze({ ...pick(rand, next.variants.arrival.spawnPoints) });
    }
  } else {
    // Generic: reshuffle loot + terminals + one patrol set.
    next.loot = Object.freeze({ ...pick(rand, LOOT_CANDIDATES) });
    const terminalSet = pick(rand, TERMINAL_CANDIDATE_SETS);
    next.terminals = Object.freeze({
      'terminal-a': Object.freeze({ ...terminalSet['terminal-a'] }),
      'terminal-b': Object.freeze({ ...terminalSet['terminal-b'] }),
      'terminal-c': Object.freeze({ ...terminalSet['terminal-c'] }),
    });
    next.terminalSetId = terminalSet.id;
    next.patrolRoutes = Object.freeze(
      pickPatrolRoutes(
        rand,
        previous.escalation.guardCount,
        PATROL_ROUTE_CANDIDATES,
        previous.escalation.patrolSpeed,
      ),
    );
  }

  return Object.freeze({
    ...next,
    variants: Object.freeze(next.variants),
    spawn: Object.freeze({ ...next.spawn }),
    loot: Object.freeze({ ...next.loot }),
    extraction: Object.freeze({ ...next.extraction }),
    terminals: next.terminals,
    patrolRoutes: Object.freeze(next.patrolRoutes),
    cameras: Object.freeze(next.cameras),
  });
}

/**
 * Generate a solvable RunLayout for `seed` at `floor`.
 * Deterministic: same (seed, floor) always yields the same layout.
 *
 * @param {number} seed
 * @param {number} [floor=0]
 * @returns {RunLayout}
 */
export function generateRun(seed, floor = 0) {
  const mixed = mixSeed(seed, floor);
  const rand = mulberry32(mixed);

  let layout = drawLayout(rand, seed, floor);
  let check = validateRunLayout(layout);
  let attempts = 0;

  while (!check.ok && attempts < MAX_ATTEMPTS) {
    attempts += 1;
    // Prefer surgical rerolls; after several fails, redraw everything from the same stream.
    if (attempts % 5 === 0) {
      layout = drawLayout(rand, seed, floor);
    } else {
      layout = rerollSubChoice(rand, layout, check.reason ?? '');
    }
    check = validateRunLayout(layout);
  }

  if (!check.ok) {
    // Last resort: classic safe layout with the already-chosen twist / escalation.
    const twist = layout.twist;
    const escalation = escalateFloor(floor, twist);
    layout = Object.freeze({
      seed: seed >>> 0,
      floor: floor | 0,
      variants: Object.freeze({
        arrival: VARIANTS_BY_SLOT.arrival[0],
        office: VARIANTS_BY_SLOT.office[0],
        server: VARIANTS_BY_SLOT.server[0],
        vault: VARIANTS_BY_SLOT.vault[0],
        escape: VARIANTS_BY_SLOT.escape[0],
      }),
      spawn: Object.freeze({ x: 0, y: 2.15, z: -62 }),
      loot: Object.freeze({ ...LOOT_CANDIDATES[0] }),
      extraction: Object.freeze({ ...EXTRACTION_CANDIDATES[0] }),
      terminals: Object.freeze({
        'terminal-a': Object.freeze({ ...TERMINAL_CANDIDATE_SETS[0]['terminal-a'] }),
        'terminal-b': Object.freeze({ ...TERMINAL_CANDIDATE_SETS[0]['terminal-b'] }),
        'terminal-c': Object.freeze({ ...TERMINAL_CANDIDATE_SETS[0]['terminal-c'] }),
      }),
      terminalSetId: TERMINAL_CANDIDATE_SETS[0].id,
      patrolRoutes: Object.freeze(
        pickPatrolRoutes(rand, escalation.guardCount, PATROL_ROUTE_CANDIDATES, escalation.patrolSpeed),
      ),
      cameras: Object.freeze(pickCameras(rand, 1, escalation.cameraSweepScale)),
      twist,
      escalation,
      cord: cordForTwist(twist),
    });
    check = validateRunLayout(layout);
    if (!check.ok) {
      throw new Error(`generateRun failed to produce a solvable layout: ${check.reason}`);
    }
  }

  return layout;
}

export { validateRunLayout, LEVEL_SLOTS, TWISTS, VARIANTS_BY_SLOT };
