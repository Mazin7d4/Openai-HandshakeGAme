import { intRange, mixSeed, mulberry32, pick } from '../seed/prng.mjs';
import {
  ANCHOR_POOLS,
  ROOM_BOUNDS,
  STATIC_BLOCKERS,
  DOORWAYS,
  aabbOverlap,
  pointInAabb,
} from './levelGeometry.mjs';

export const PLAN_LIMITS = Object.freeze({
  maxPieces: 40,
  maxSolidPieces: 32,
  maxHazards: 5,
});

export const ARCHETYPES_BY_SLOT = Object.freeze({
  arrival: ['classic', 'loading-dock'],
  office: ['classic', 'cubicle-farm', 'boardroom'],
  server: ['classic', 'rack-maze', 'cold-aisle'],
  vault: ['classic', 'laser-vault'],
  escape: ['classic', 'vent-crawl'],
});

export const JOB_NAMES = Object.freeze([
  'The Cold Aisle Job',
  'Cubicle Shuffle',
  'The Lockbox Lift',
  'After-Hours Alibi',
  'The Quiet Relay',
  'Pylon Panic',
  'The Glassy Getaway',
  'Server Room Sprint',
  'The Crate Escape',
  'Night-Desk Dash',
  'The Frosted Vault',
  'Two Drones, One Job',
  'The Long Way Out',
  'The Last Access Badge',
]);

const SLOTS = ['arrival', 'office', 'server', 'vault', 'escape'];
const TERMINALS = ['terminal-a', 'terminal-b', 'terminal-c'];
const PLAN_SEED = 0x5eed9a11;
const JOB_ORDER_SEED = 0x4a6f6253;
const EPSILON = 1e-6;

function r3(value) {
  return Math.round(value * 1000) / 1000;
}

function vec(x, y, z) {
  return { x: r3(x), y: r3(y), z: r3(z) };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a, amount) {
  return { x: a.x * amount, y: a.y * amount, z: a.z * amount };
}

function distanceXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function jobCycleSuffix(cycle) {
  if (cycle === 0) return '';
  const numerals = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return ` ${numerals[cycle] ?? cycle + 1}`;
}

/**
 * Choose the job order once per run seed, rather than once per floor. This
 * keeps the floor cards varied without coupling a floor's plan generation to
 * any other floor's random stream.
 */
function jobNameFor(seed, floor) {
  if (floor === 1) return 'The Night Shift Tryout';
  const names = JOB_NAMES.slice();
  const rand = mulberry32(mixSeed(seed, JOB_ORDER_SEED));
  for (let index = names.length - 1; index > 0; index--) {
    const other = intRange(rand, 0, index + 1);
    [names[index], names[other]] = [names[other], names[index]];
  }
  const offset = floor - 2;
  const cycle = Math.floor(offset / names.length);
  return `${names[offset % names.length]}${jobCycleSuffix(cycle)}`;
}

function randomBetween(rand, min, max) {
  return min + rand() * (max - min);
}

function randomJitter(rand, amount) {
  return (rand() * 2 - 1) * amount;
}

function keyPoints(layout) {
  return [
    layout.spawn,
    layout.loot,
    layout.extraction,
    ...TERMINALS.map((id) => layout.terminals[id]),
    ...(layout.patrolRoutes ?? []).flatMap((route) => route.waypoints),
  ];
}

function objectivePoints(objective) {
  if (objective.kind === 'twin-levers') return objective.levers;
  if (objective.kind === 'pylon-safe') return [objective.pylon, objective.safe, objective.anchor];
  if (objective.kind === 'relay') return objective.pads;
  return [];
}

function boundsForPiece(pieceData) {
  return {
    min: {
      x: pieceData.x - pieceData.sx / 2,
      y: pieceData.y - pieceData.sy / 2,
      z: pieceData.z - pieceData.sz / 2,
    },
    max: {
      x: pieceData.x + pieceData.sx / 2,
      y: pieceData.y + pieceData.sy / 2,
      z: pieceData.z + pieceData.sz / 2,
    },
  };
}

function expandedPointBox(point, radius, vertical = 0.8) {
  return {
    min: { x: point.x - radius, y: point.y - vertical, z: point.z - radius },
    max: { x: point.x + radius, y: point.y + vertical, z: point.z + radius },
  };
}

function segmentIntersectsRect(a, b, minX, maxX, minZ, maxZ) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const clips = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dz, a.z - minZ],
    [dz, maxZ - a.z],
  ];
  for (const [p, q] of clips) {
    if (Math.abs(p) < EPSILON) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

function segmentHitsAabb(a, b, blocker, margin = 0) {
  const yMin = Math.min(a.y, b.y);
  const yMax = Math.max(a.y, b.y);
  if (yMax < blocker.min.y - margin || yMin > blocker.max.y + margin) return false;
  return segmentIntersectsRect(
    a,
    b,
    blocker.min.x - margin,
    blocker.max.x + margin,
    blocker.min.z - margin,
    blocker.max.z + margin,
  );
}

function segmentBlocked(a, b, blockers = STATIC_BLOCKERS, margin = 0) {
  return blockers.some((blocker) => segmentHitsAabb(a, b, blocker, margin));
}

function pointIsFree(point, slot, layout, margin = 0.35, includeDoorways = true) {
  const bounds = ROOM_BOUNDS[slot];
  if (!bounds || !pointInAabb(point, bounds, -margin)) return false;
  const pointBox = expandedPointBox(point, margin);
  if (STATIC_BLOCKERS.some((blocker) => aabbOverlap(pointBox, blocker))) return false;
  if (includeDoorways && DOORWAYS.some((doorway) => aabbOverlap(pointBox, doorway))) return false;
  return true;
}

function clearOfPoints(point, points, radius = 2.5) {
  return points.every((other) => !other || distanceXZ(point, other) >= radius - EPSILON);
}

function pointClearForObjective(point, slot, layout, points) {
  return (
    pointIsFree(point, slot, layout, 1.2) &&
    clearOfPoints(point, keyPoints(layout), 2.5) &&
    clearOfPoints(point, points, 2.5)
  );
}

function jitteredAnchor(rand, slot, mirror = false, amount = 1) {
  const base = pick(rand, ANCHOR_POOLS[slot]);
  const bounds = ROOM_BOUNDS[slot];
  const mirroredX = mirror ? -base.x : base.x;
  const x = clamp(mirroredX + randomJitter(rand, amount), bounds.min.x + 1.3, bounds.max.x - 1.3);
  const z = clamp(base.z + randomJitter(rand, amount), bounds.min.z + 1.3, bounds.max.z - 1.3);
  return vec(x, base.y + randomJitter(rand, 0.3), z);
}

function labelForArchetype(archetype) {
  return archetype.replace('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function makePiece(mat, x, y, z, sx, sy, sz, solid, rotY, asset) {
  return {
    kind: 'box',
    mat,
    x: r3(x),
    y: r3(y),
    z: r3(z),
    sx: r3(sx),
    sy: r3(sy),
    sz: r3(sz),
    rotY: r3(rotY),
    solid,
    ...(asset ? { asset } : {}),
  };
}

function pieceFits(pieceData, slot, layout, objective, pieces) {
  const bounds = ROOM_BOUNDS[slot];
  const aabb = boundsForPiece(pieceData);
  if (
    aabb.min.x < bounds.min.x + 0.3 ||
    aabb.max.x > bounds.max.x - 0.3 ||
    aabb.min.z < bounds.min.z + 0.3 ||
    aabb.max.z > bounds.max.z - 0.3 ||
    aabb.min.y < bounds.floorY - EPSILON ||
    aabb.max.y > bounds.ceilingY - 4 + EPSILON
  ) {
    return false;
  }
  if (pieceData.solid && pieceData.sy > 3.5) return false;
  if (STATIC_BLOCKERS.some((blocker) => aabbOverlap(aabb, blocker))) return false;
  if (DOORWAYS.some((doorway) => aabbOverlap(aabb, doorway))) return false;
  const points = [...keyPoints(layout), ...objectivePoints(objective)];
  for (const point of points) {
    if (!point) continue;
    const exemptPylon = pieceData.mat === 'pylon' && objective.kind === 'pylon-safe' && point === objective.pylon;
    if (!exemptPylon && distanceXZ(pieceData, point) < 2.2 + Math.max(pieceData.sx, pieceData.sz) / 2) {
      return false;
    }
  }
  for (const route of layout.patrolRoutes ?? []) {
    for (const waypoint of route.waypoints) {
      if (distanceXZ(pieceData, waypoint) < 1.4 + Math.max(pieceData.sx, pieceData.sz) / 2) return false;
    }
  }
  return pieces.every((other) => !aabbOverlap(aabb, boundsForPiece(other)));
}

function roomPieces(slot, archetype, rand, layout, objective) {
  if (archetype === 'classic') return [];
  const pieces = [];
  const add = (mat, x, y, z, sx, sy, sz, solid, asset, rotY = randomBetween(rand, -Math.PI, Math.PI)) => {
    const pieceData = makePiece(mat, x, y, z, sx, sy, sz, solid, rotY, asset);
    const laneConflict = ['rack-maze', 'cold-aisle'].includes(archetype) && mat === 'rack' && pieces.some((other) => {
      if (other.mat !== 'rack' || Math.abs(other.z - pieceData.z) >= Math.max(other.sz, pieceData.sz)) return false;
      const gap = Math.abs(other.x - pieceData.x) - (other.sx + pieceData.sx) / 2;
      return gap > 0 && gap < 2.6;
    });
    if (!laneConflict && pieceFits(pieceData, slot, layout, objective, pieces)) pieces.push(pieceData);
    return pieceData;
  };
  const addAt = (mat, anchor, size, solid, asset) => add(
    mat,
    anchor.x,
    ROOM_BOUNDS[slot].floorY + size.sy / 2,
    anchor.z,
    size.sx,
    size.sy,
    size.sz,
    solid,
    asset,
  );

  if (archetype === 'loading-dock') {
    const spots = [
      { x: 7, z: -62 },
      { x: 13, z: -62 },
      { x: 7, z: -47 },
      { x: 14, z: -47 },
      { x: -14, z: -47 },
    ];
    const shift = randomJitter(rand, 0.8);
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[(i + intRange(rand, 0, spots.length)) % spots.length];
      const point = { x: spot.x + randomJitter(rand, 0.45), z: spot.z + shift + randomJitter(rand, 0.35) };
      if (i < 3) addAt('crate', point, { sx: 2.2, sy: 2.2, sz: 1.9 }, true, 'CrateStack');
      else addAt('cone', point, { sx: 0.65, sy: 0.9, sz: 0.65 }, false, 'Cone');
    }
    addAt('pallet', { x: 10, z: -50 }, { sx: 3.5, sy: 0.35, sz: 2 }, false);
  }

  if (archetype === 'cubicle-farm') {
    const rows = intRange(rand, 2, 4);
    const cols = intRange(rand, 2, 5);
    const rowGap = randomBetween(rand, 4.2, 5.5);
    const colGap = randomBetween(rand, 4.1, 5.3);
    const candidates = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        candidates.push({
          x: -11 + col * colGap + randomJitter(rand, 0.3),
          z: -39 + row * rowGap + randomJitter(rand, 0.3),
        });
      }
    }
    // Gaps are seeded, and the cap keeps the complete floor under 40 pieces.
    const wanted = Math.min(candidates.length, 4 + intRange(rand, 0, 3));
    for (let i = 0; i < wanted; i++) {
      const cell = candidates[(i * 3 + intRange(rand, 0, candidates.length)) % candidates.length];
      const desk = addAt('desk', cell, { sx: 2.8, sy: 1.8, sz: 1.5 }, true, 'Desk');
      if (pieces.includes(desk)) {
        addAt('partition', { x: cell.x, z: cell.z + 1.2 }, { sx: 2.5, sy: 1.8, sz: 0.12 }, true, 'GlassPartition');
        addAt('chair', { x: cell.x, z: cell.z - 1.6 }, { sx: 0.95, sy: 1, sz: 0.95 }, false, 'OfficeChair');
      }
    }
  }

  if (archetype === 'boardroom') {
    const length = randomBetween(rand, 8, 11.5);
    // The east-side table pocket stays clear of the authored terminal desks.
    const tableX = randomBetween(rand, 6, 6.8);
    const tableZ = randomBetween(rand, -40.5, -40);
    addAt('desk', { x: tableX, z: tableZ }, { sx: length, sy: 1.8, sz: 2.2 }, true, 'DeskL');
    const chairCount = intRange(rand, 6, 11);
    const angle = randomBetween(rand, -0.2, 0.2);
    for (let i = 0; i < chairCount; i++) {
      const along = -length / 2 + 0.8 + (length - 1.6) * (i / Math.max(1, chairCount - 1));
      // Keep the aisle side open for the tethered pair; six to ten chairs line
      // the opposite side of the seeded table.
      addAt('chair', { x: tableX + along, z: tableZ + 2.0 }, { sx: 0.7, sy: 0.9, sz: 0.7 }, false, 'OfficeChair');
    }
    addAt('glass', { x: -12, z: -37 }, { sx: 1.6, sy: 2.6, sz: 0.12 }, true, 'GlassPartition');
  }

  if (archetype === 'rack-maze') {
    const count = intRange(rand, 3, 7);
    const laneGap = randomBetween(rand, 4.6, 5.4);
    const bases = [
      { x: -9, z: -8 }, { x: -9 + laneGap, z: -8 }, { x: 2, z: -8 },
      { x: 7, z: -8 }, { x: -9, z: -2 }, { x: 7, z: -2 },
    ];
    for (let i = 0; i < count; i++) {
      const base = bases[(i + intRange(rand, 0, bases.length)) % bases.length];
      addAt('rack', { x: base.x + randomJitter(rand, 0.25), z: base.z + randomJitter(rand, 0.25) }, { sx: 1.8, sy: 3.2, sz: 1.6 }, true, pick(rand, ['ServerRackA', 'ServerRackB']));
    }
  }

  if (archetype === 'cold-aisle') {
    const count = intRange(rand, 4, 7);
    const zValues = [-8, -2];
    for (let i = 0; i < count; i++) {
      const side = i % 2;
      const x = side === 0 ? -9 : 4;
      const z = zValues[Math.floor(i / 2) % zValues.length] + randomJitter(rand, 0.35);
      addAt('rack', { x: x + randomJitter(rand, 0.35), z }, { sx: 1.8, sy: 3.2, sz: 1.7 }, true, pick(rand, ['ServerRackA', 'ServerRackB']));
    }
  }

  if (archetype === 'laser-vault') {
    const pillarCount = intRange(rand, 2, 5);
    const pillars = [{ x: -8, z: 5 }, { x: 8, z: 5 }, { x: -8, z: 13 }, { x: 8, z: 7 }];
    for (let i = 0; i < pillarCount; i++) {
      const base = pillars[(i + intRange(rand, 0, pillars.length)) % pillars.length];
      addAt('metal', { x: base.x + randomJitter(rand, 0.35), z: base.z + randomJitter(rand, 0.35) }, { sx: 0.9, sy: 3, sz: 0.9 }, true, 'Pillar');
    }
    const cases = intRange(rand, 1, 3);
    for (let i = 0; i < cases; i++) {
      addAt('glass', { x: i === 0 ? -9 : 9, z: 23 + randomJitter(rand, 0.4) }, { sx: 1.6, sy: 2.3, sz: 1.8 }, true, 'GlassPartition');
    }
    if (!pieces.some((pieceData) => pieceData.mat === 'glass')) {
      addAt('glass', { x: 12, z: 23 }, { sx: 1.2, sy: 1.8, sz: 1.4 }, true, 'GlassPartition');
    }
  }

  if (archetype === 'vent-crawl') {
    const count = intRange(rand, 2, 5);
    const zValues = [-56, -43, -27, -15, 3];
    for (let i = 0; i < count; i++) {
      const z = zValues[(i + intRange(rand, 0, zValues.length)) % zValues.length] + randomJitter(rand, 0.7);
      const x = rand() < 0.5 ? -16 : -11;
      addAt('duct', { x, z }, { sx: 0.9, sy: 2.2, sz: 2.2 }, true, 'GlassPartition');
    }
  }

  if (archetype === 'loading-dock') {
    const crateSpots = [{ x: 15, z: -50 }, { x: 15, z: -46 }, { x: 5, z: -46 }];
    for (const spot of crateSpots) {
      if (pieces.filter((pieceData) => pieceData.mat === 'crate').length >= 3) break;
      addAt('crate', spot, { sx: 1.2, sy: 1.2, sz: 1.2 }, true, 'CrateStack');
    }
  }

  if (archetype === 'cubicle-farm') {
    if (pieces.filter((pieceData) => pieceData.mat === 'desk').length < 2) {
      addAt('desk', { x: -10.5, z: -39 }, { sx: 1.8, sy: 1.4, sz: 1.2 }, true, 'Desk');
      addAt('desk', { x: 11, z: -39 }, { sx: 1.8, sy: 1.4, sz: 1.2 }, true, 'Desk');
    }
    if (!pieces.some((pieceData) => pieceData.mat === 'partition')) {
      addAt('partition', { x: -10.5, z: -37.3 }, { sx: 1.6, sy: 1.4, sz: 0.12 }, true, 'GlassPartition');
    }
  }

  // A few candidate points can be consumed by a terminal, patrol, or the
  // objective. Fill the remaining dressing budget with small, readable pieces
  // so every non-classic archetype still has a substantial 4-piece vignette.
  const filler = {
    'loading-dock': ['crate', { sx: 1.2, sy: 1.2, sz: 1.2 }, true, 'CrateStack'],
    'cubicle-farm': ['chair', { sx: 0.8, sy: 0.9, sz: 0.8 }, false, 'OfficeChair'],
    boardroom: ['chair', { sx: 0.8, sy: 0.9, sz: 0.8 }, false, 'OfficeChair'],
    'rack-maze': ['rack', { sx: 1.2, sy: 2.2, sz: 1.2 }, true, 'ServerRackA'],
    'cold-aisle': ['rack', { sx: 1.2, sy: 2.2, sz: 1.2 }, true, 'ServerRackA'],
    'laser-vault': ['metal', { sx: 0.8, sy: 2, sz: 0.8 }, true, 'Pillar'],
    'vent-crawl': ['duct', { sx: 0.7, sy: 1.6, sz: 1.2 }, true, 'GlassPartition'],
  }[archetype];
  if (filler) {
    for (let attempt = 0; pieces.length < 4 && attempt < 64; attempt++) {
      const anchor = jitteredAnchor(rand, slot, rand() < 0.5, 0.45);
      addAt(filler[0], anchor, filler[1], filler[2], filler[3]);
    }
  }

  if (objective.kind === 'pylon-safe' && ['server', 'vault'].includes(slot)) {
    const pylon = objective.pylon;
    if (pointInAabb(pylon, ROOM_BOUNDS[slot])) {
      addAt('pylon', pylon, { sx: 0.9, sy: 3, sz: 0.9 }, true, 'Pillar', 0);
    }
  }
  return pieces;
}

function objectiveKindPool(floor, cord) {
  const canStretch = cord.maxLength - cord.restLength >= 2.2;
  if (floor === 1) return ['grab'];
  if (floor % 3 === 0) return canStretch ? ['twin-levers', 'pylon-safe'] : ['pylon-safe'];
  if (floor === 2) return canStretch ? ['twin-levers', 'relay', 'fragile'] : ['relay', 'fragile'];
  return canStretch ? ['twin-levers', 'pylon-safe', 'fragile', 'relay'] : ['pylon-safe', 'fragile', 'relay'];
}

function chooseObjectiveKind(seed, floor, layout, rand) {
  const pool = objectiveKindPool(floor, layout.cord);
  let kind = pick(rand, pool);
  if (floor > 1 && pool.length > 1) {
    const previousRand = mulberry32(mixSeed(mixSeed(seed, floor - 1), PLAN_SEED));
    const previousPool = objectiveKindPool(floor - 1, layout.cord);
    const previous = pick(previousRand, previousPool);
    if (kind === previous) kind = pool[(pool.indexOf(kind) + 1) % pool.length];
  }
  return kind;
}

function buildTwinLevers(rand, floor, layout) {
  const minDistance = layout.cord.restLength + 1;
  const maxDistance = layout.cord.maxLength - 1.2;
  const rooms = ['vault', 'server'];
  for (let attempt = 0; attempt < 32; attempt++) {
    const slot = pick(rand, rooms);
    const a = jitteredAnchor(rand, slot, rand() < 0.5, 0.8);
    const distance = randomBetween(rand, minDistance + 0.05, maxDistance - 0.05);
    const angle = randomBetween(rand, 0, Math.PI * 2);
    const b = vec(a.x + Math.cos(angle) * distance, a.y + randomJitter(rand, 0.15), a.z + Math.sin(angle) * distance);
    if (!pointClearForObjective(a, slot, layout, []) || !pointClearForObjective(b, slot, layout, [a])) continue;
    if (segmentBlocked(a, b, STATIC_BLOCKERS, 0.05)) continue;
    return {
      kind: 'twin-levers',
      label: 'Pull both levers',
      hint: 'Twin levers sit just past comfortable cord reach — stretch it taut and hold.',
      levers: [a, b],
      leverRadius: 1.5,
      holdSeconds: floor % 3 === 0 ? 1.8 : 1.2,
    };
  }
  return null;
}

function buildPylonSafe(rand, floor, layout) {
  const rooms = ['vault', 'server'];
  for (let attempt = 0; attempt < 32; attempt++) {
    const slot = pick(rand, rooms);
    const pylon = jitteredAnchor(rand, slot, rand() < 0.5, 0.6);
    const distance = randomBetween(rand, 3.5, 5);
    const angle = randomBetween(rand, 0, Math.PI * 2);
    const safe = vec(pylon.x + Math.cos(angle) * distance, randomBetween(rand, 1.8, 2.5), pylon.z + Math.sin(angle) * distance);
    const direction = sub(pylon, safe);
    const horizontal = Math.hypot(direction.x, direction.z);
    if (horizontal < EPSILON) continue;
    const anchorLength = clamp(layout.cord.maxLength - distance + 0.5, 3, layout.cord.maxLength - 1);
    const anchor = vec(
      pylon.x + (direction.x / horizontal) * anchorLength,
      randomBetween(rand, 1.8, 2.5),
      pylon.z + (direction.z / horizontal) * anchorLength,
    );
    const points = [pylon];
    if (
      !pointClearForObjective(pylon, slot, layout, []) ||
      !pointClearForObjective(safe, slot, layout, points) ||
      !pointClearForObjective(anchor, slot, layout, [...points, safe])
    ) continue;
    if (segmentBlocked(pylon, safe, STATIC_BLOCKERS, 0.05) || segmentBlocked(pylon, anchor, STATIC_BLOCKERS, 0.05)) continue;
    return {
      kind: 'pylon-safe',
      label: 'Wrap the pylon',
      hint: 'One drone hooks the safe while the other anchors on the far side of the pylon.',
      pylon,
      safe,
      hookRadius: 1.6,
      pullsRequired: floor % 3 === 0 ? 4 : 3,
      anchor,
    };
  }
  return null;
}

function slotForRelayPad(point) {
  for (const slot of ['server', 'vault']) {
    if (pointInAabb(point, ROOM_BOUNDS[slot])) return slot;
  }
  return null;
}

// Relay pads are a seeded random walk through the server room and vault: each
// hop is between 4 m and (cord max - 1.5) m, so the pad-to-pad cord always reaches.
function buildRelay(rand, floor, layout) {
  const count = floor % 3 === 0 ? 6 : 4;
  const minStep = 4.2;
  const maxStep = layout.cord.maxLength - 1.5;
  for (let attempt = 0; attempt < 48; attempt++) {
    const startSlot = rand() < 0.65 ? 'server' : 'vault';
    const first = jitteredAnchor(rand, startSlot, rand() < 0.5, 1);
    first.y = randomBetween(rand, 1.8, 2.5);
    if (!pointClearForObjective(first, startSlot, layout, [])) continue;
    const pads = [{ ...first, role: 'pix' }];
    let heading = randomBetween(rand, 0, Math.PI * 2);
    while (pads.length < count) {
      const previous = pads[pads.length - 1];
      let placed = null;
      for (let hop = 0; hop < 24 && !placed; hop++) {
        const angle = heading + randomJitter(rand, Math.PI * 0.75);
        const step = randomBetween(rand, minStep, maxStep - 0.05);
        const candidate = vec(
          previous.x + Math.cos(angle) * step,
          randomBetween(rand, 1.8, 2.5),
          previous.z + Math.sin(angle) * step,
        );
        const slot = slotForRelayPad(candidate);
        if (!slot) continue;
        if (distance3(previous, candidate) > maxStep) continue;
        if (!pointClearForObjective(candidate, slot, layout, pads)) continue;
        if (segmentBlocked(previous, candidate, STATIC_BLOCKERS, 0.05)) continue;
        placed = candidate;
        heading = angle;
      }
      if (!placed) break;
      pads.push({ ...placed, role: pads.length % 2 === 0 ? 'pix' : 'nee' });
    }
    if (pads.length === count) {
      return {
        kind: 'relay',
        label: 'Relay the pads',
        hint: 'PIX and NEE alternate pad touches before the relay timer runs out.',
        pads,
        padRadius: 1.4,
        stepSeconds: floor >= 6 ? 7 : 9,
      };
    }
  }
  return null;
}

function buildObjective(kind, rand, floor, layout) {
  if (kind === 'grab') {
    return {
      kind,
      label: 'Grab the prototype',
      hint: 'Warm up: the cord is your tool. Grab the prototype together.',
    };
  }
  if (kind === 'fragile') {
    return {
      kind,
      label: 'Fragile: no yanks',
      hint: 'One drone carries carefully while the other keeps the tether steady and avoids yanks.',
      cracksToShatter: floor >= 6 ? 2 : 3,
    };
  }
  if (kind === 'twin-levers') return buildTwinLevers(rand, floor, layout);
  if (kind === 'pylon-safe') return buildPylonSafe(rand, floor, layout);
  return buildRelay(rand, floor, layout);
}

function lineCandidates(slot) {
  const lines = {
    arrival: [
      [{ x: 7, y: 2, z: -62 }, { x: 14, y: 2, z: -62 }],
      [{ x: 7, y: 2, z: -47 }, { x: 14, y: 2, z: -47 }],
    ],
    office: [
      [{ x: -12, y: 2, z: -39 }, { x: -5, y: 2, z: -39 }],
      [{ x: 7, y: 2, z: -39 }, { x: 13, y: 2, z: -39 }],
    ],
    server: [
      [{ x: 8, y: 2, z: -9 }, { x: 8, y: 2, z: -3 }],
      [{ x: 5, y: 2, z: -8 }, { x: 11, y: 2, z: -8 }],
    ],
    vault: [
      [{ x: -10, y: 2, z: 5 }, { x: -3, y: 2, z: 5 }],
      [{ x: 8, y: 2, z: 4 }, { x: 8, y: 2, z: 10 }],
    ],
    escape: [
      [{ x: -16, y: 2, z: -57 }, { x: -16, y: 2, z: -50 }],
      [{ x: -11, y: 2, z: -25 }, { x: -11, y: 2, z: -18 }],
    ],
  };
  return lines[slot];
}

function rectCandidates(slot) {
  const rects = {
    arrival: [{ x: 8, z: -51, sx: 4, sz: 3 }],
    office: [{ x: -11, z: -38, sx: 4, sz: 3 }, { x: 9, z: -38, sx: 4, sz: 3 }],
    server: [{ x: 8, z: -7, sx: 4, sz: 3 }, { x: 8, z: -2, sx: 4, sz: 3 }],
    vault: [{ x: -9, z: 4.5, sx: 4, sz: 3 }, { x: 9, z: 4.5, sx: 4, sz: 3 }],
    escape: [{ x: -16, z: -51, sx: 3, sz: 4 }, { x: -11, z: -20, sx: 3, sz: 4 }],
  };
  return rects[slot];
}

function hazardRect(candidate, y1) {
  return {
    x0: r3(candidate.x - candidate.sx / 2),
    z0: r3(candidate.z - candidate.sz / 2),
    x1: r3(candidate.x + candidate.sx / 2),
    z1: r3(candidate.z + candidate.sz / 2),
    y0: 0,
    y1: r3(y1),
  };
}

function rectToAabb(rect) {
  return { min: { x: rect.x0, y: rect.y0, z: rect.z0 }, max: { x: rect.x1, y: rect.y1, z: rect.z1 } };
}

function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < EPSILON) return distanceXZ(point, a);
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
}

function hazardTouchesPoint(hazard, point, radius = 2.5) {
  if (hazard.kind === 'tripwire') return pointToSegmentDistance(point, hazard.a, hazard.b) < radius;
  if (hazard.kind === 'sweeper') return distanceXZ(point, hazard.center) < radius;
  if (hazard.rect) {
    const closestX = clamp(point.x, hazard.rect.x0, hazard.rect.x1);
    const closestZ = clamp(point.z, hazard.rect.z0, hazard.rect.z1);
    return Math.hypot(point.x - closestX, point.z - closestZ) < radius;
  }
  return false;
}

function roomCentre(slot) {
  const bounds = ROOM_BOUNDS[slot];
  return { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
}

function gustPointsOutOfRoom(hazard) {
  const centre = roomCentre(hazard.slot);
  const towardCentre = { x: centre.x - hazard.rectCentre.x, z: centre.z - hazard.rectCentre.z };
  return hazard.force.x * towardCentre.x + hazard.force.z * towardCentre.z < -EPSILON;
}

function gustPointsIntoBeam(hazard, existing) {
  const magnitude = Math.hypot(hazard.force.x, hazard.force.z);
  if (magnitude < EPSILON) return true;
  const fx = hazard.force.x / magnitude;
  const fz = hazard.force.z / magnitude;
  const origin = hazard.rectCentre;
  return existing.some((other) => {
    if (other.kind !== 'tripwire' && other.kind !== 'pulse-gate') return false;
    const target = other.kind === 'tripwire'
      ? { x: (other.a.x + other.b.x) / 2, z: (other.a.z + other.b.z) / 2 }
      : { x: (other.rect.x0 + other.rect.x1) / 2, z: (other.rect.z0 + other.rect.z1) / 2 };
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const ahead = dx * fx + dz * fz;
    return ahead > 0 && ahead < 8 && Math.abs(dx * fz - dz * fx) < 2.5;
  });
}

function hazardCandidateSlots(kind, rand) {
  if (kind === 'ice') return [pick(rand, ['office', 'server', 'vault', 'escape'])];
  if (kind === 'gust') return [pick(rand, ['escape', 'office', 'server', 'vault'])];
  if (kind === 'tripwire' || kind === 'pulse-gate') return [pick(rand, ['server', 'vault', 'office', 'escape'])];
  return [pick(rand, ['server', 'vault', 'office', 'escape'])];
}

function makeHazard(kind, slot, index, rand, floor, layout, objective, existing) {
  const points = [...keyPoints(layout), ...objectivePoints(objective)];
  for (let attempt = 0; attempt < 32; attempt++) {
    if (kind === 'tripwire') {
      const base = pick(rand, lineCandidates(slot));
      const a = vec(base[0].x + randomJitter(rand, 0.35), randomBetween(rand, 0.8, 3.5), base[0].z + randomJitter(rand, 0.35));
      const b = vec(base[1].x + randomJitter(rand, 0.35), a.y, base[1].z + randomJitter(rand, 0.35));
      const candidate = {
        id: `tripwire-${index}`,
        kind,
        slot,
        a,
        b,
        period: r3(randomBetween(rand, 2.5, 5)),
        duty: r3(randomBetween(rand, floor === 1 ? 0.25 : 0.35, floor === 1 ? 0.4 : 0.58)),
        phase: r3(rand()),
      };
      const length = distanceXZ(a, b);
      if (length < 3 || length > 10 || segmentBlocked(a, b, STATIC_BLOCKERS, 0.05)) continue;
      if (!pointIsFree(a, slot, layout, 0.25) || !pointIsFree(b, slot, layout, 0.25)) continue;
      if (points.some((point) => hazardTouchesPoint(candidate, point))) continue;
      return candidate;
    }

    if (kind === 'pulse-gate') {
      const base = pick(rand, rectCandidates(slot));
      const candidate = {
        id: `pulse-gate-${index}`,
        kind,
        slot,
        rect: hazardRect({ ...base, x: base.x + randomJitter(rand, 0.35), z: base.z + randomJitter(rand, 0.35) }, 4),
        period: r3(randomBetween(rand, 2.5, 5)),
        duty: r3(randomBetween(rand, 0.35, 0.58)),
        phase: r3(rand()),
      };
      if (STATIC_BLOCKERS.some((blocker) => aabbOverlap(rectToAabb(candidate.rect), blocker))) continue;
      if (points.some((point) => hazardTouchesPoint(candidate, point))) continue;
      return candidate;
    }

    if (kind === 'sweeper') {
      const anchor = jitteredAnchor(rand, slot, rand() < 0.5, 0.45);
      const centre = vec(anchor.x, randomBetween(rand, 3, 5), anchor.z);
      const candidate = {
        id: `sweeper-${index}`,
        kind,
        slot,
        center: centre,
        range: r3(randomBetween(rand, 6, 10)),
        halfAngle: r3(randomBetween(rand, 0.35, 0.6)),
        baseYaw: r3(randomBetween(rand, -Math.PI, Math.PI)),
        sweep: r3(randomBetween(rand, 0.5, 1.1)),
        period: r3(randomBetween(rand, 4, 7)),
        phase: r3(rand()),
      };
      if (!pointIsFree(centre, slot, layout, 0.35) || points.some((point) => hazardTouchesPoint(candidate, point))) continue;
      return candidate;
    }

    const base = pick(rand, rectCandidates(slot));
    const centre = { x: base.x + randomJitter(rand, 0.3), z: base.z + randomJitter(rand, 0.3) };
    const candidate = {
      id: `${kind}-${index}`,
      kind,
      slot,
      rect: hazardRect({ ...base, x: centre.x, z: centre.z }, kind === 'gust' ? 4 : 0.2),
      rectCentre: centre,
    };
    if (STATIC_BLOCKERS.some((blocker) => aabbOverlap(rectToAabb(candidate.rect), blocker))) continue;
    if (points.some((point) => hazardTouchesPoint(candidate, point))) continue;
    if (kind === 'gust') {
      const angle = randomBetween(rand, -Math.PI, Math.PI);
      const forceMagnitude = randomBetween(rand, 4, 9);
      candidate.force = vec(Math.cos(angle) * forceMagnitude, 0, Math.sin(angle) * forceMagnitude);
      if (gustPointsOutOfRoom(candidate) || gustPointsIntoBeam(candidate, existing)) continue;
    }
    delete candidate.rectCentre;
    return candidate;
  }
  return null;
}

function hazardCount(floor, rand) {
  if (floor === 1) return intRange(rand, 0, 2);
  if (floor === 2) return 1;
  if (floor === 3) return 2 + 1;
  return Math.min(PLAN_LIMITS.maxHazards, 1 + Math.floor(floor / 2) + (floor % 3 === 0 ? 1 : 0));
}

function buildHazards(rand, floor, layout, objective, rooms) {
  let count = hazardCount(floor, rand);
  const unlocked = ['tripwire', 'sweeper'];
  if (floor >= 2 && layout.twist?.id !== 'slippery_floor') unlocked.push('ice');
  if (floor >= 3) unlocked.push('gust');
  if (floor >= 4) unlocked.push('pulse-gate');
  const out = [];
  const indexes = { tripwire: 0, sweeper: 0, ice: 0, gust: 0, 'pulse-gate': 0 };
  if (floor > 1 && rooms.some((roomPlan) => roomPlan.archetype === 'laser-vault') && count > 0) {
    const slot = 'vault';
    const forced = makeHazard('tripwire', slot, indexes.tripwire, rand, floor, layout, objective, out);
    if (forced) {
      out.push(forced);
      indexes.tripwire += 1;
    }
    count -= forced ? 1 : 0;
  }
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 16 && !placed; attempt++) {
      const kind = pick(rand, unlocked);
      const slot = floor === 1 ? 'server' : hazardCandidateSlots(kind, rand)[0];
      const index = indexes[kind];
      const candidate = makeHazard(kind, slot, index, rand, floor, layout, objective, out);
      if (candidate) {
        out.push(candidate);
        indexes[kind] += 1;
        placed = true;
      }
    }
  }
  return out;
}

function selectArchetypes(rand, floor) {
  const archetypes = SLOTS.map((slot) => {
    if (floor === 1 && ['arrival', 'office'].includes(slot)) return 'classic';
    return pick(rand, ARCHETYPES_BY_SLOT[slot]);
  });
  if (floor > 1) {
    let nonClassic = archetypes.filter((archetype) => archetype !== 'classic').length;
    while (nonClassic < 3) {
      const index = intRange(rand, 0, SLOTS.length);
      if (archetypes[index] === 'classic' && ARCHETYPES_BY_SLOT[SLOTS[index]].length > 1) {
        archetypes[index] = pick(rand, ARCHETYPES_BY_SLOT[SLOTS[index]].slice(1));
        nonClassic++;
      }
    }
  }
  return archetypes;
}

function buildPlan(seed, floor, layout, rand, options = {}) {
  const boss = floor % 3 === 0;
  const archetypes = selectArchetypes(rand, floor);
  const requestedKind = options.objectiveKind ?? chooseObjectiveKind(seed, floor, layout, rand);
  let objective = buildObjective(requestedKind, rand, floor, layout);
  if (!objective && requestedKind !== 'fragile' && !boss) objective = buildObjective('fragile', rand, floor, layout);
  if (!objective && boss) objective = buildObjective('pylon-safe', rand, floor, layout);
  if (!objective) objective = buildObjective(floor === 1 ? 'grab' : 'fragile', rand, floor, layout);
  const rooms = SLOTS.map((slot, index) => ({
    slot,
    archetype: archetypes[index],
    label: labelForArchetype(archetypes[index]),
    pieces: roomPieces(slot, archetypes[index], rand, layout, objective),
  }));
  const hazards = options.noHazards ? [] : buildHazards(rand, floor, layout, objective, rooms);
  const name = floor === 1 ? 'The Night Shift Tryout' : `${boss ? 'VAULT: ' : ''}${jobNameFor(seed, floor)}`;
  const objectiveText = objective.kind === 'grab' ? 'grab the prototype' : objective.kind.replace('-', ' ');
  const blurb = floor === 1
    ? 'Warm up: the cord is your tool. Grab the prototype together.'
    : `${boss ? 'Boss lock: ' : ''}Work together to ${objectiveText} before the night shift notices.`;
  return {
    version: 1,
    job: {
      id: `job-${floor}`,
      name,
      boss,
      payoutScale: boss ? 2 : 1,
      blurb,
      tutorial: floor === 1,
    },
    rooms,
    objective,
    hazards,
  };
}

function safeFallbackObjective(floor, layout) {
  if (floor === 1) return buildObjective('grab', mulberry32(1), floor, layout);
  if (floor % 3 !== 0) return buildObjective('grab', mulberry32(2), floor, layout);
  const pylon = vec(8, 2.1, 5);
  const safe = vec(4, 2.1, 5);
  const distance = distanceXZ(pylon, safe);
  const length = clamp(layout.cord.maxLength - distance + 0.5, 3, layout.cord.maxLength - 1);
  return {
    kind: 'pylon-safe',
    label: 'Wrap the pylon',
    hint: 'One drone hooks the safe while the other anchors on the far side of the pylon.',
    pylon,
    safe,
    hookRadius: 1.6,
    pullsRequired: 4,
    anchor: vec(pylon.x + length, 2.1, pylon.z),
  };
}

function classicFallback(floor, layout) {
  const boss = floor % 3 === 0;
  return {
    version: 1,
    job: {
      id: `job-${floor}`,
      name: floor === 1 ? 'The Night Shift Tryout' : `${boss ? 'VAULT: ' : ''}The Quiet Job`,
      boss,
      payoutScale: boss ? 2 : 1,
      blurb: floor === 1
        ? 'Warm up: the cord is your tool. Grab the prototype together.'
        : 'Stay together and complete the tether job before the night shift notices.',
      tutorial: floor === 1,
    },
    rooms: SLOTS.map((slot) => ({ slot, archetype: 'classic', label: 'Classic', pieces: [] })),
    objective: safeFallbackObjective(floor, layout),
    hazards: [],
  };
}

export function generateFloorPlan(seed, floor, layout) {
  const f = floor | 0;
  const baseSeed = mixSeed(mixSeed(seed, f), PLAN_SEED);
  const rand = mulberry32(baseSeed);
  try {
    const plan = buildPlan(seed, f, layout, rand);
    const firstCheck = validateFloorPlan(plan, layout);
    if (firstCheck.ok) return plan;

    // Degrade one component before using the classic emergency plan. This is
    // especially useful when a twist makes a particular objective geometry
    // impossible after all bounded placement attempts.
    const reduced = buildPlan(seed, f, layout, mulberry32(mixSeed(baseSeed, 0x11)), {
      objectiveKind: f === 1 ? 'grab' : (f % 3 === 0 ? 'pylon-safe' : 'fragile'),
      noHazards: true,
    });
    const reducedCheck = validateFloorPlan(reduced, layout);
    if (reducedCheck.ok) return reduced;
  } catch {
    // Return the deterministic safe plan below. Generation must never throw.
  }
  return classicFallback(f, layout);
}

function validateRoomPiece(pieceData, room, slot, layout, objective, pieces) {
  if (!pieceData || pieceData.kind !== 'box' && pieceData.kind !== 'cyl') return 'piece kind invalid';
  if (!['desk', 'partition', 'chair', 'rack', 'crate', 'pallet', 'glass', 'metal', 'duct', 'plant', 'pylon', 'cone'].includes(pieceData.mat)) return 'piece material invalid';
  if (![pieceData.x, pieceData.y, pieceData.z, pieceData.sx, pieceData.sy, pieceData.sz, pieceData.rotY].every(Number.isFinite)) return 'piece number invalid';
  if (!(pieceData.sx > 0 && pieceData.sy > 0 && pieceData.sz > 0)) return 'piece size invalid';
  if (pieceData.solid && pieceData.sy > 3.5) return `piece too tall in ${slot}`;
  const aabb = boundsForPiece(pieceData);
  const bounds = ROOM_BOUNDS[slot];
  if (
    aabb.min.x < bounds.min.x + 0.3 - EPSILON ||
    aabb.max.x > bounds.max.x - 0.3 + EPSILON ||
    aabb.min.z < bounds.min.z + 0.3 - EPSILON ||
    aabb.max.z > bounds.max.z - 0.3 + EPSILON ||
    aabb.min.y < bounds.floorY - EPSILON ||
    aabb.max.y > bounds.ceilingY - 4 + EPSILON
  ) return `piece outside ${slot}`;
  if (STATIC_BLOCKERS.some((blocker) => aabbOverlap(aabb, blocker))) return `piece blocker overlap in ${slot}`;
  if (DOORWAYS.some((doorway) => aabbOverlap(aabb, doorway))) return `piece doorway overlap in ${slot}`;
  for (const point of [...keyPoints(layout), ...objectivePoints(objective)]) {
    if (!point) continue;
    const support = pieceData.mat === 'pylon' && objective.kind === 'pylon-safe' && distanceXZ(pieceData, objective.pylon) < 0.01;
    if (!support && distanceXZ(pieceData, point) < 2.2 + Math.max(pieceData.sx, pieceData.sz) / 2 - EPSILON) return 'piece clearance';
  }
  for (const route of layout.patrolRoutes ?? []) {
    for (const waypoint of route.waypoints) {
      if (distanceXZ(pieceData, waypoint) < 1.4 + Math.max(pieceData.sx, pieceData.sz) / 2 - EPSILON) return 'patrol clearance';
    }
  }
  for (const other of pieces) {
    if (aabbOverlap(aabb, boundsForPiece(other))) return 'piece overlap';
  }
  return null;
}

function validateArchetypePieces(room) {
  const count = (mat) => room.pieces.filter((pieceData) => pieceData.mat === mat).length;
  if (room.archetype === 'loading-dock' && count('crate') < 3) return 'loading dock needs three crate stacks';
  if (room.archetype === 'cubicle-farm' && (count('desk') < 2 || count('partition') < 1)) return 'cubicle farm needs desks and partitions';
  if (room.archetype === 'boardroom' && (count('desk') < 1 || count('chair') < 6 || count('chair') > 10)) return 'boardroom chair/table count invalid';
  if (room.archetype === 'rack-maze' && (count('rack') < 3 || count('rack') > 6)) return 'rack maze segment count invalid';
  if (room.archetype === 'cold-aisle' && (count('rack') < 4 || count('rack') > 6)) return 'cold aisle rack count invalid';
  if (room.archetype === 'laser-vault') {
    const pillars = room.pieces.filter((pieceData) => pieceData.asset === 'Pillar').length;
    if (pillars < 2 || pillars > 4 || count('glass') < 1 || count('glass') > 2) return 'laser vault prop count invalid';
  }
  if (room.archetype === 'vent-crawl' && (count('duct') < 2 || count('duct') > 4)) return 'vent crawl baffle count invalid';
  if (['rack-maze', 'cold-aisle'].includes(room.archetype)) {
    const racks = room.pieces.filter((pieceData) => pieceData.mat === 'rack');
    for (let i = 0; i < racks.length; i++) {
      for (let j = i + 1; j < racks.length; j++) {
        const a = racks[i];
        const b = racks[j];
        const closeInZ = Math.abs(a.z - b.z) < Math.max(a.sz, b.sz);
        const gap = Math.abs(a.x - b.x) - (a.sx + b.sx) / 2;
        if (closeInZ && gap > 0 && gap < 2.6) return 'rack maze lane too narrow';
      }
    }
  }
  return null;
}

function validateObjective(objective, floor, layout) {
  if (!objective || typeof objective !== 'object') return 'missing objective';
  if (typeof objective.label !== 'string' || objective.label.length === 0 || objective.label.length > 22) return 'objective label invalid';
  if (typeof objective.hint !== 'string' || !objective.hint.endsWith('.')) return 'objective hint invalid';
  const key = keyPoints(layout);
  if (objective.kind === 'grab') return null;
  if (objective.kind === 'fragile') {
    if (![2, 3].includes(objective.cracksToShatter) || (floor < 6 && objective.cracksToShatter !== 3) || (floor >= 6 && objective.cracksToShatter !== 2)) return 'fragile cracks invalid';
    return null;
  }
  if (objective.kind === 'twin-levers') {
    if (!Array.isArray(objective.levers) || objective.levers.length !== 2) return 'lever points missing';
    const [a, b] = objective.levers;
    const slot = SLOTS.find((candidate) => pointInAabb(a, ROOM_BOUNDS[candidate]) && pointInAabb(b, ROOM_BOUNDS[candidate]));
    if (!slot) return 'levers not in one room';
    if (!(objective.leverRadius >= 1 && objective.leverRadius <= 2) || !(objective.holdSeconds >= 1.2 && objective.holdSeconds <= 1.8)) return 'lever parameters invalid';
    const separation = distanceXZ(a, b);
    if (separation < layout.cord.restLength + 1 - EPSILON || separation > layout.cord.maxLength - 1.2 + EPSILON) return 'lever cord distance invalid';
    if (!pointClearForObjective(a, slot, layout, []) || !pointClearForObjective(b, slot, layout, [a])) return 'lever clearance invalid';
    if (segmentBlocked(a, b, STATIC_BLOCKERS, 0.05)) return 'lever segment blocked';
    return null;
  }
  if (objective.kind === 'pylon-safe') {
    const { pylon, safe, anchor } = objective;
    if (!pylon || !safe || !anchor) return 'pylon points missing';
    const slot = SLOTS.find((candidate) => [pylon, safe, anchor].every((point) => pointInAabb(point, ROOM_BOUNDS[candidate])));
    if (!slot) return 'pylon points not in one room';
    if (!(objective.hookRadius >= 1 && objective.hookRadius <= 2) || !Number.isInteger(objective.pullsRequired) || objective.pullsRequired < 3 || objective.pullsRequired > 4) return 'pylon parameters invalid';
    if ([pylon, safe, anchor].some((point) => point.y < 1.8 - EPSILON || point.y > 2.5 + EPSILON)) return 'pylon hover height invalid';
    const safeDistance = distanceXZ(pylon, safe);
    const anchorDistance = distanceXZ(pylon, anchor);
    if (safeDistance < 3.5 - EPSILON || safeDistance > 5 + EPSILON) return 'safe distance invalid';
    if (anchorDistance < 2.99 || anchorDistance > layout.cord.maxLength - 1 + 0.01) return 'anchor distance invalid';
    const expectedLength = clamp(layout.cord.maxLength - safeDistance + 0.5, 3, layout.cord.maxLength - 1);
    const far = sub(pylon, safe);
    const farLength = Math.hypot(far.x, far.z);
    const expected = { x: pylon.x + (far.x / farLength) * expectedLength, z: pylon.z + (far.z / farLength) * expectedLength };
    if (distanceXZ(anchor, expected) > 0.02) return 'anchor formula invalid';
    if ([pylon, safe, anchor].some((point) => !pointClearForObjective(point, slot, layout, [pylon, safe, anchor].filter((other) => other !== point)))) return 'pylon clearance invalid';
    if (segmentBlocked(pylon, safe, STATIC_BLOCKERS, 0.05) || segmentBlocked(pylon, anchor, STATIC_BLOCKERS, 0.05)) return 'pylon segment blocked';
    const wrap = { x: anchor.x - pylon.x, z: anchor.z - pylon.z };
    if (wrap.x * far.x + wrap.z * far.z <= 0) return 'anchor is not on far side';
    return null;
  }
  if (objective.kind === 'relay') {
    const expectedCount = floor % 3 === 0 ? 6 : 4;
    if (!Array.isArray(objective.pads) || objective.pads.length !== expectedCount) return 'relay pad count invalid';
    if (!(objective.padRadius >= 1 && objective.padRadius <= 2) || !(objective.stepSeconds >= 7 && objective.stepSeconds <= 9)) return 'relay parameters invalid';
    for (let i = 0; i < objective.pads.length; i++) {
      const pad = objective.pads[i];
      const slot = pad.z < 2 ? 'server' : 'vault';
      if (pad.role !== (i % 2 === 0 ? 'pix' : 'nee') || !pointClearForObjective(pad, slot, layout, objective.pads.slice(0, i))) return 'relay pad clearance invalid';
      if (i > 0) {
        const step = distance3(objective.pads[i - 1], pad);
        if (step < 4 - EPSILON || step > layout.cord.maxLength - 1.5 + EPSILON) return 'relay cord distance invalid';
        if (segmentBlocked(objective.pads[i - 1], pad, STATIC_BLOCKERS, 0.05)) return 'relay segment blocked';
      }
    }
    return null;
  }
  return 'unknown objective kind';
}

function validateHazard(hazard, floor, layout, objective, hazards) {
  if (!hazard || typeof hazard.id !== 'string' || !['tripwire', 'sweeper', 'pulse-gate', 'ice', 'gust'].includes(hazard.kind)) return 'hazard malformed';
  if (!SLOTS.includes(hazard.slot)) return 'hazard slot invalid';
  const bounds = ROOM_BOUNDS[hazard.slot];
  const points = [...keyPoints(layout), ...objectivePoints(objective)];
  if (hazard.phase !== undefined && (!Number.isFinite(hazard.phase) || hazard.phase < 0 || hazard.phase >= 1)) return 'hazard phase invalid';
  if (hazard.kind === 'tripwire') {
    if (!hazard.a || !hazard.b || hazard.a.y < 0.8 || hazard.a.y > 3.5 || Math.abs(hazard.a.y - hazard.b.y) > 0.01) return 'tripwire endpoints invalid';
    if (!pointInAabb(hazard.a, bounds, -0.2) || !pointInAabb(hazard.b, bounds, -0.2) || !pointIsFree(hazard.a, hazard.slot, layout, 0.2) || !pointIsFree(hazard.b, hazard.slot, layout, 0.2)) return 'tripwire endpoint blocked';
    const length = distanceXZ(hazard.a, hazard.b);
    if (length < 3 - EPSILON || length > 10 + EPSILON || segmentBlocked(hazard.a, hazard.b, STATIC_BLOCKERS, 0.05)) return 'tripwire length or blocker invalid';
    if (!(hazard.period >= 2.5 && hazard.period <= 5) || !(hazard.duty > 0 && hazard.duty <= 0.6) || (1 - hazard.duty) * hazard.period < 1.2 - EPSILON) return 'tripwire timing invalid';
  } else if (hazard.kind === 'sweeper') {
    if (!hazard.center || hazard.center.y < 3 || hazard.center.y > 5 || !pointInAabb(hazard.center, bounds, -0.3) || !pointIsFree(hazard.center, hazard.slot, layout, 0.3)) return 'sweeper mount invalid';
    if (![hazard.baseYaw, hazard.sweep, hazard.period].every(Number.isFinite) || !(hazard.range >= 6 && hazard.range <= 10) || !(hazard.halfAngle >= 0.35 && hazard.halfAngle <= 0.6) || !(hazard.sweep >= 0.5 && hazard.sweep <= 1.1) || !(hazard.period >= 4 && hazard.period <= 7)) return 'sweeper parameters invalid';
  } else {
    if (!hazard.rect || hazard.rect.x0 >= hazard.rect.x1 || hazard.rect.z0 >= hazard.rect.z1 || hazard.rect.y0 > hazard.rect.y1) return 'hazard rectangle invalid';
    const rect = rectToAabb(hazard.rect);
    if (!pointInAabb(rect.min, bounds, 0) || !pointInAabb(rect.max, bounds, 0) || STATIC_BLOCKERS.some((blocker) => aabbOverlap(rect, blocker))) return 'hazard rectangle blocked';
    if (hazard.kind === 'ice' || hazard.kind === 'gust') {
      const width = hazard.rect.x1 - hazard.rect.x0;
      const depth = hazard.rect.z1 - hazard.rect.z0;
      if (width < 2.99 || width > 8.01 || depth < 2.99 || depth > 6.01) return 'floor hazard size invalid';
    }
    if (hazard.kind === 'pulse-gate') {
      if (!(hazard.period >= 2.5 && hazard.period <= 5) || !(hazard.duty > 0 && hazard.duty <= 0.6) || (1 - hazard.duty) * hazard.period < 1.2 - EPSILON) return 'pulse timing invalid';
    }
    if (hazard.kind === 'gust') {
      const magnitude = Math.hypot(hazard.force?.x ?? 0, hazard.force?.z ?? 0);
      if (!hazard.force || Math.abs(hazard.force.y) > EPSILON || magnitude < 4 || magnitude > 9) return 'gust force invalid';
      const centre = { x: (hazard.rect.x0 + hazard.rect.x1) / 2, z: (hazard.rect.z0 + hazard.rect.z1) / 2 };
      if ((hazard.force.x * (roomCentre(hazard.slot).x - centre.x) + hazard.force.z * (roomCentre(hazard.slot).z - centre.z)) < -EPSILON) return 'gust points out of room';
    }
  }
  if (points.some((point) => hazardTouchesPoint(hazard, point))) return 'hazard key clearance';
  if (hazards.some((other) => other.kind === 'tripwire' && hazard.kind === 'gust' && gustPointsIntoBeam({ ...hazard, rectCentre: { x: (hazard.rect.x0 + hazard.rect.x1) / 2, z: (hazard.rect.z0 + hazard.rect.z1) / 2 } }, [other]))) return 'gust points into beam';
  return null;
}

export function validateFloorPlan(plan, layout) {
  if (!plan || plan.version !== 1 || !plan.job || !Array.isArray(plan.rooms) || plan.rooms.length !== SLOTS.length || !plan.objective || !Array.isArray(plan.hazards)) return { ok: false, reason: 'malformed floor plan' };
  const floor = layout.floor | 0;
  const boss = floor % 3 === 0;
  const campaign = plan.campaign?.index >= 1 && plan.campaign?.index <= 5;
  if (!campaign && (plan.job.boss !== boss || plan.job.payoutScale !== (boss ? 2 : 1) || plan.job.tutorial !== (floor === 1))) return { ok: false, reason: 'job pacing mismatch' };
  if (typeof plan.job.name !== 'string' || typeof plan.job.blurb !== 'string' || !plan.job.blurb.endsWith('.')) return { ok: false, reason: 'job text invalid' };
  const roomsBySlot = new Map();
  let allPieces = [];
  for (const room of plan.rooms) {
    if (!SLOTS.includes(room.slot) || roomsBySlot.has(room.slot) || !ARCHETYPES_BY_SLOT[room.slot].includes(room.archetype) || !Array.isArray(room.pieces)) return { ok: false, reason: 'room catalog invalid' };
    roomsBySlot.set(room.slot, room);
    if (room.archetype !== 'classic' && (room.pieces.length < 4 || room.pieces.length > 12)) return { ok: false, reason: `piece count invalid in ${room.slot}` };
    for (const pieceData of room.pieces) {
      const reason = validateRoomPiece(pieceData, room, room.slot, layout, plan.objective, room.pieces.filter((other) => other !== pieceData));
      if (reason) return { ok: false, reason };
    }
    const archetypeReason = validateArchetypePieces(room);
    if (archetypeReason) return { ok: false, reason: archetypeReason };
    allPieces = allPieces.concat(room.pieces);
  }
  if (roomsBySlot.size !== 5 || allPieces.length > PLAN_LIMITS.maxPieces || allPieces.filter((pieceData) => pieceData.solid).length > PLAN_LIMITS.maxSolidPieces) return { ok: false, reason: 'piece limits exceeded' };

  const objectiveReason = validateObjective(plan.objective, floor, layout);
  if (objectiveReason) return { ok: false, reason: objectiveReason };
  if (Array.isArray(plan.phases)) {
    if (!plan.phases.length || plan.phases.length > 5) return { ok: false, reason: 'campaign phases invalid' };
    for (const phase of plan.phases) {
      const phaseReason = validateObjective(phase, floor, layout);
      if (phaseReason) return { ok: false, reason: `campaign phase: ${phaseReason}` };
    }
  }
  if (!campaign) {
    if (floor === 1 && (plan.objective.kind !== 'grab' || plan.rooms.find((room) => room.slot === 'arrival').archetype !== 'classic' || plan.rooms.find((room) => room.slot === 'office').archetype !== 'classic' || plan.hazards.length > 1 || plan.hazards.some((hazard) => ['pulse-gate', 'gust'].includes(hazard.kind)))) return { ok: false, reason: 'floor one rules violated' };
    if (boss && !['twin-levers', 'pylon-safe'].includes(plan.objective.kind)) return { ok: false, reason: 'boss objective invalid' };
    if (floor > 1 && plan.rooms.filter((room) => room.archetype !== 'classic').length < 3) return { ok: false, reason: 'not enough room variety' };
  }
  const hazardIds = new Set();
  for (const hazard of plan.hazards) {
    if (hazardIds.has(hazard.id)) return { ok: false, reason: 'duplicate hazard id' };
    hazardIds.add(hazard.id);
    const reason = validateHazard(hazard, floor, layout, plan.objective, plan.hazards);
    if (reason) return { ok: false, reason };
  }
  if (plan.hazards.length > PLAN_LIMITS.maxHazards) return { ok: false, reason: 'hazard limit exceeded' };
  return { ok: true };
}
