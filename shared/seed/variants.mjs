/**
 * Handcrafted room variants per level slot.
 * Bounds are world-space AABB dressing envelopes for the art team.
 * Openings / cover / props / spawns remix existing heist pieces — not procedural maps.
 */

/** @typedef {{ x: number, y: number, z: number }} Vec3 */
/** @typedef {{ min: Vec3, max: Vec3 }} Bounds */
/** @typedef {{ id: string, kind: 'door' | 'vent' | 'wall-gap', center: Vec3, halfExtents: Vec3 }} Opening */
/** @typedef {{ id: string, kind: 'cover' | 'prop' | 'crate', position: Vec3, yaw?: number }} CoverProp */
/**
 * @typedef {{
 *   id: string,
 *   slot: string,
 *   label: string,
 *   bounds: Bounds,
 *   openings: Opening[],
 *   cover: CoverProp[],
 *   spawnPoints: Vec3[],
 * }} RoomVariant
 */

/** @type {readonly string[]} */
export const LEVEL_SLOTS = Object.freeze([
  'arrival',
  'office',
  'server',
  'vault',
  'escape',
]);

/** Bump when authored level bounds invalidate previously generated layouts. */
export const SEED_FORMAT_VERSION = 2;

/** @type {Record<string, readonly RoomVariant[]>} */
export const VARIANTS_BY_SLOT = {
  arrival: Object.freeze([
    Object.freeze({
      id: 'arrival.open-apron',
      slot: 'arrival',
      label: 'Open apron',
      bounds: Object.freeze({
        min: Object.freeze({ x: -18, y: 0, z: -66 }),
        max: Object.freeze({ x: 18, y: 12, z: -44 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'arrival.service-vent',
          kind: 'vent',
          center: Object.freeze({ x: -5, y: 6.4, z: -43 }),
          halfExtents: Object.freeze({ x: 2.4, y: 1.5, z: 0.8 }),
        }),
        Object.freeze({
          id: 'arrival.under-desk',
          kind: 'wall-gap',
          center: Object.freeze({ x: -4.5, y: 1.2, z: -49 }),
          halfExtents: Object.freeze({ x: 3.5, y: 1.1, z: 2 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'arrival.reception-desk', kind: 'cover', position: Object.freeze({ x: -4.5, y: 1.8, z: -49 }) }),
        Object.freeze({ id: 'arrival.cargo-core', kind: 'prop', position: Object.freeze({ x: -5.5, y: 0.65, z: -50 }) }),
      ]),
      spawnPoints: Object.freeze([
        Object.freeze({ x: 0, y: 2.15, z: -62 }),
        Object.freeze({ x: -2.5, y: 2.15, z: -60 }),
        Object.freeze({ x: 2.5, y: 2.15, z: -60 }),
      ]),
    }),
    Object.freeze({
      id: 'arrival.tight-delivery',
      slot: 'arrival',
      label: 'Tight delivery',
      bounds: Object.freeze({
        min: Object.freeze({ x: -14, y: 0, z: -66 }),
        max: Object.freeze({ x: 12, y: 11, z: -44 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'arrival.service-vent-narrow',
          kind: 'vent',
          center: Object.freeze({ x: -5, y: 6.5, z: -43 }),
          halfExtents: Object.freeze({ x: 1.8, y: 1.3, z: 0.8 }),
        }),
        Object.freeze({
          id: 'arrival.side-gap',
          kind: 'wall-gap',
          center: Object.freeze({ x: 6, y: 2.2, z: -48 }),
          halfExtents: Object.freeze({ x: 2.2, y: 1.8, z: 1.5 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'arrival.stack-left', kind: 'crate', position: Object.freeze({ x: -8, y: 1.2, z: -56 }) }),
        Object.freeze({ id: 'arrival.stack-right', kind: 'crate', position: Object.freeze({ x: 7, y: 1.2, z: -54 }) }),
        Object.freeze({ id: 'arrival.desk-block', kind: 'cover', position: Object.freeze({ x: -3, y: 1.8, z: -50 }) }),
      ]),
      spawnPoints: Object.freeze([
        Object.freeze({ x: 0, y: 2.15, z: -61 }),
        Object.freeze({ x: -1.8, y: 2.15, z: -59.5 }),
      ]),
    }),
    Object.freeze({
      id: 'arrival.side-ramp',
      slot: 'arrival',
      label: 'Side ramp',
      bounds: Object.freeze({
        min: Object.freeze({ x: -18, y: 0, z: -66 }),
        max: Object.freeze({ x: 16, y: 12, z: -43 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'arrival.high-vent',
          kind: 'vent',
          center: Object.freeze({ x: -5, y: 7.2, z: -43 }),
          halfExtents: Object.freeze({ x: 2.2, y: 1.6, z: 0.8 }),
        }),
        Object.freeze({
          id: 'arrival.west-crawl',
          kind: 'wall-gap',
          center: Object.freeze({ x: -12, y: 1.4, z: -52 }),
          halfExtents: Object.freeze({ x: 1.5, y: 1.2, z: 3 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'arrival.ramp-prop', kind: 'prop', position: Object.freeze({ x: 4, y: 0.8, z: -57 }) }),
        Object.freeze({ id: 'arrival.reception-low', kind: 'cover', position: Object.freeze({ x: -5, y: 1.6, z: -49 }) }),
      ]),
      spawnPoints: Object.freeze([
        Object.freeze({ x: 1, y: 2.15, z: -62 }),
        Object.freeze({ x: -3, y: 2.15, z: -61 }),
      ]),
    }),
  ]),

  office: Object.freeze([
    Object.freeze({
      id: 'office.split-desks',
      slot: 'office',
      label: 'Split desks',
      bounds: Object.freeze({
        min: Object.freeze({ x: -16, y: 0, z: -42 }),
        max: Object.freeze({ x: 16, y: 12, z: -26 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'office.access-shutter',
          kind: 'door',
          center: Object.freeze({ x: -1, y: 3, z: -26 }),
          halfExtents: Object.freeze({ x: 2.8, y: 2.8, z: 0.6 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'office.pix-desk', kind: 'cover', position: Object.freeze({ x: -5, y: 1.8, z: -33 }) }),
        Object.freeze({ id: 'office.nee-desk', kind: 'cover', position: Object.freeze({ x: 7, y: 1.8, z: -31 }) }),
        Object.freeze({ id: 'office.rug-clutter', kind: 'prop', position: Object.freeze({ x: 1, y: 0.2, z: -35 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
    Object.freeze({
      id: 'office.aisle-cluster',
      slot: 'office',
      label: 'Aisle cluster',
      bounds: Object.freeze({
        min: Object.freeze({ x: -14, y: 0, z: -42 }),
        max: Object.freeze({ x: 14, y: 11, z: -26 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'office.access-shutter-wide',
          kind: 'door',
          center: Object.freeze({ x: -1, y: 3.2, z: -26 }),
          halfExtents: Object.freeze({ x: 3.2, y: 3, z: 0.6 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'office.cluster-a', kind: 'cover', position: Object.freeze({ x: -6, y: 1.8, z: -34 }) }),
        Object.freeze({ id: 'office.cluster-b', kind: 'cover', position: Object.freeze({ x: 5, y: 1.8, z: -32 }) }),
        Object.freeze({ id: 'office.mid-crate', kind: 'crate', position: Object.freeze({ x: 0, y: 1, z: -36 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
    Object.freeze({
      id: 'office.gallery-rail',
      slot: 'office',
      label: 'Gallery rail',
      bounds: Object.freeze({
        min: Object.freeze({ x: -15, y: 0, z: -42 }),
        max: Object.freeze({ x: 15, y: 12, z: -26 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'office.access-shutter-high',
          kind: 'door',
          center: Object.freeze({ x: -1, y: 4, z: -26 }),
          halfExtents: Object.freeze({ x: 2.6, y: 3.2, z: 0.6 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'office.rail-left', kind: 'cover', position: Object.freeze({ x: -7, y: 2, z: -35 }) }),
        Object.freeze({ id: 'office.rail-right', kind: 'cover', position: Object.freeze({ x: 8, y: 2, z: -30 }) }),
        Object.freeze({ id: 'office.glass-prop', kind: 'prop', position: Object.freeze({ x: 11, y: 3, z: -35 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
  ]),

  server: Object.freeze([
    Object.freeze({
      id: 'server.opposing-racks',
      slot: 'server',
      label: 'Opposing racks',
      bounds: Object.freeze({
        min: Object.freeze({ x: -16, y: 0, z: -25 }),
        max: Object.freeze({ x: 16, y: 12, z: 1 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'server.lower-aisle',
          kind: 'wall-gap',
          center: Object.freeze({ x: 0, y: 2.5, z: -17 }),
          halfExtents: Object.freeze({ x: 4, y: 2.2, z: 3 }),
        }),
        Object.freeze({
          id: 'server.high-shelf',
          kind: 'wall-gap',
          center: Object.freeze({ x: -5, y: 7, z: -5.8 }),
          halfExtents: Object.freeze({ x: 4, y: 1.5, z: 2 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'server.rack-south', kind: 'cover', position: Object.freeze({ x: -4, y: 3.9, z: -21 }) }),
        Object.freeze({ id: 'server.rack-north', kind: 'cover', position: Object.freeze({ x: 7, y: 3.9, z: -13 }) }),
        Object.freeze({ id: 'server.shelf', kind: 'prop', position: Object.freeze({ x: -5, y: 5.7, z: -5.8 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
    Object.freeze({
      id: 'server.cold-aisle',
      slot: 'server',
      label: 'Cold aisle',
      bounds: Object.freeze({
        min: Object.freeze({ x: -14, y: 0, z: -25 }),
        max: Object.freeze({ x: 14, y: 11, z: 1 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'server.mid-gap',
          kind: 'wall-gap',
          center: Object.freeze({ x: 2, y: 3, z: -15 }),
          halfExtents: Object.freeze({ x: 3.5, y: 2.5, z: 2.5 }),
        }),
        Object.freeze({
          id: 'server.memory-shelf',
          kind: 'wall-gap',
          center: Object.freeze({ x: -4, y: 7.1, z: -6 }),
          halfExtents: Object.freeze({ x: 3.5, y: 1.4, z: 2 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'server.bank-a', kind: 'cover', position: Object.freeze({ x: -5, y: 3.9, z: -20 }) }),
        Object.freeze({ id: 'server.bank-b', kind: 'cover', position: Object.freeze({ x: 6, y: 3.9, z: -12 }) }),
        Object.freeze({ id: 'server.tray-prop', kind: 'prop', position: Object.freeze({ x: 0, y: 1.2, z: -10 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
  ]),

  vault: Object.freeze([
    Object.freeze({
      id: 'vault.central-dais',
      slot: 'vault',
      label: 'Central dais',
      bounds: Object.freeze({
        min: Object.freeze({ x: -14, y: 0, z: 2 }),
        max: Object.freeze({ x: 16, y: 13, z: 26 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'vault.lab-shutter',
          kind: 'door',
          center: Object.freeze({ x: 0, y: 3, z: 2 }),
          halfExtents: Object.freeze({ x: 2.5, y: 2.8, z: 0.6 }),
        }),
        Object.freeze({
          id: 'vault.relief',
          kind: 'door',
          center: Object.freeze({ x: 0, y: 3, z: 27 }),
          halfExtents: Object.freeze({ x: 5.5, y: 2.8, z: 0.6 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'vault.bench-west', kind: 'cover', position: Object.freeze({ x: -7, y: 1.8, z: 8 }) }),
        Object.freeze({ id: 'vault.bench-east', kind: 'cover', position: Object.freeze({ x: 9, y: 1.8, z: 11 }) }),
        Object.freeze({ id: 'vault.plinth', kind: 'prop', position: Object.freeze({ x: 0, y: 2.3, z: 18 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
    Object.freeze({
      id: 'vault.side-approach',
      slot: 'vault',
      label: 'Side approach',
      bounds: Object.freeze({
        min: Object.freeze({ x: -14, y: 0, z: 2 }),
        max: Object.freeze({ x: 16, y: 13, z: 26 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'vault.lab-shutter',
          kind: 'door',
          center: Object.freeze({ x: 0, y: 3, z: 2 }),
          halfExtents: Object.freeze({ x: 2.5, y: 2.8, z: 0.6 }),
        }),
        Object.freeze({
          id: 'vault.relief',
          kind: 'door',
          center: Object.freeze({ x: 0, y: 3, z: 27 }),
          halfExtents: Object.freeze({ x: 5.5, y: 2.8, z: 0.6 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'vault.side-crate', kind: 'crate', position: Object.freeze({ x: -4.5, y: 0.65, z: 10.5 }) }),
        Object.freeze({ id: 'vault.heavy-crate', kind: 'crate', position: Object.freeze({ x: -14.8, y: 1.8, z: 12.5 }) }),
        Object.freeze({ id: 'vault.plinth-offset', kind: 'prop', position: Object.freeze({ x: 1.5, y: 2.3, z: 17.5 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
    Object.freeze({
      id: 'vault.low-cradle',
      slot: 'vault',
      label: 'Low cradle',
      bounds: Object.freeze({
        min: Object.freeze({ x: -14, y: 0, z: 2 }),
        max: Object.freeze({ x: 16, y: 12, z: 26 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'vault.lab-shutter',
          kind: 'door',
          center: Object.freeze({ x: 0, y: 3, z: 2 }),
          halfExtents: Object.freeze({ x: 2.5, y: 2.8, z: 0.6 }),
        }),
        Object.freeze({
          id: 'vault.relief',
          kind: 'door',
          center: Object.freeze({ x: 0, y: 3, z: 27 }),
          halfExtents: Object.freeze({ x: 5.5, y: 2.8, z: 0.6 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'vault.bench-pair', kind: 'cover', position: Object.freeze({ x: -6, y: 1.8, z: 9 }) }),
        Object.freeze({ id: 'vault.low-plinth', kind: 'prop', position: Object.freeze({ x: 0, y: 1.8, z: 17 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
  ]),

  escape: Object.freeze([
    Object.freeze({
      id: 'escape.dock-west',
      slot: 'escape',
      label: 'Dock west lane',
      bounds: Object.freeze({
        min: Object.freeze({ x: -18.5, y: 0, z: 27 }),
        max: Object.freeze({ x: 18.5, y: 9.2, z: 47 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'escape.dock-underpass',
          kind: 'wall-gap',
          center: Object.freeze({ x: -4, y: 1.8, z: 34 }),
          halfExtents: Object.freeze({ x: 4, y: 1.6, z: 1.2 }),
        }),
        Object.freeze({
          id: 'escape.dock-east-end',
          kind: 'wall-gap',
          center: Object.freeze({ x: 8, y: 3, z: 34 }),
          halfExtents: Object.freeze({ x: 2, y: 2.5, z: 1.5 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'escape.conveyor', kind: 'cover', position: Object.freeze({ x: -5, y: 1.2, z: 34 }) }),
        Object.freeze({ id: 'escape.cage-west', kind: 'prop', position: Object.freeze({ x: -10, y: 2.2, z: 41 }) }),
        Object.freeze({ id: 'escape.cage-east', kind: 'prop', position: Object.freeze({ x: 2, y: 2.2, z: 40 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
    Object.freeze({
      id: 'escape.dock-run',
      slot: 'escape',
      label: 'Dock run',
      bounds: Object.freeze({
        min: Object.freeze({ x: -18.5, y: 0, z: 27 }),
        max: Object.freeze({ x: 18.5, y: 9.2, z: 47 }),
      }),
      openings: Object.freeze([
        Object.freeze({
          id: 'escape.dock-low-lane',
          kind: 'wall-gap',
          center: Object.freeze({ x: -8, y: 1.8, z: 34 }),
          halfExtents: Object.freeze({ x: 4, y: 1.6, z: 1.2 }),
        }),
        Object.freeze({
          id: 'escape.dock-pad-approach',
          kind: 'wall-gap',
          center: Object.freeze({ x: 10, y: 3, z: 40 }),
          halfExtents: Object.freeze({ x: 4, y: 2.5, z: 3 }),
        }),
      ]),
      cover: Object.freeze([
        Object.freeze({ id: 'escape.conveyor-run', kind: 'cover', position: Object.freeze({ x: -5, y: 1.2, z: 34 }) }),
        Object.freeze({ id: 'escape.cage-east', kind: 'prop', position: Object.freeze({ x: 2, y: 2.2, z: 40 }) }),
        Object.freeze({ id: 'escape.pad-lamp', kind: 'prop', position: Object.freeze({ x: 11, y: 0.2, z: 43.5 }) }),
      ]),
      spawnPoints: Object.freeze([]),
    }),
  ]),
};

/** Candidate loot positions inside the vault (safe flight bounds). */
export const LOOT_CANDIDATES = Object.freeze([
  Object.freeze({ x: 0, y: 5.25, z: 18 }),
  Object.freeze({ x: 1.2, y: 5.1, z: 17.2 }),
  Object.freeze({ x: -1.2, y: 5.1, z: 17.4 }),
  Object.freeze({ x: 0.4, y: 4.6, z: 16.5 }),
  Object.freeze({ x: -0.6, y: 5.4, z: 18.6 }),
]);

/** Candidate extraction pads. */
export const EXTRACTION_CANDIDATES = Object.freeze([
  Object.freeze({ x: 11, y: 2, z: 43.5 }),
  Object.freeze({ x: 12.5, y: 2, z: 44 }),
  Object.freeze({ x: 9.5, y: 2, z: 43 }),
]);

/** Hack terminal candidate sets (a/b/c must stay role-reachable and cord-compatible). */
export const TERMINAL_CANDIDATE_SETS = Object.freeze([
  Object.freeze({
    id: 'terminals.classic',
    'terminal-a': Object.freeze({ x: -5.2, y: 5.1, z: -33 }),
    'terminal-b': Object.freeze({ x: 5.2, y: 2, z: -31 }),
    'terminal-c': Object.freeze({ x: -4, y: 7.1, z: -5.8 }),
  }),
  Object.freeze({
    id: 'terminals.close-pair',
    'terminal-a': Object.freeze({ x: -4.2, y: 5.0, z: -32 }),
    'terminal-b': Object.freeze({ x: 3.8, y: 2.2, z: -31.5 }),
    'terminal-c': Object.freeze({ x: -3.5, y: 7.0, z: -6.2 }),
  }),
  Object.freeze({
    id: 'terminals.gallery-shift',
    'terminal-a': Object.freeze({ x: -5.8, y: 5.2, z: -34 }),
    'terminal-b': Object.freeze({ x: 4.5, y: 2.1, z: -30 }),
    'terminal-c': Object.freeze({ x: -4.5, y: 7.2, z: -5.2 }),
  }),
]);

/** Guard / drone patrol waypoint sets (loading dock pocket). */
export const PATROL_ROUTE_CANDIDATES = Object.freeze([
  Object.freeze({
    id: 'patrol.dock-west-lane',
    waypoints: Object.freeze([
      Object.freeze({ x: -15, y: 2.2, z: 30 }),
      Object.freeze({ x: -8, y: 2.2, z: 32 }),
      Object.freeze({ x: -15, y: 2.2, z: 38 }),
      Object.freeze({ x: -8, y: 2.2, z: 44 }),
    ]),
  }),
  Object.freeze({
    id: 'patrol.dock-east-lane',
    waypoints: Object.freeze([
      Object.freeze({ x: 7, y: 2.2, z: 30 }),
      Object.freeze({ x: 14, y: 2.2, z: 36 }),
      Object.freeze({ x: 7, y: 2.2, z: 44 }),
      Object.freeze({ x: 14, y: 2.2, z: 46 }),
    ]),
  }),
  Object.freeze({
    id: 'patrol.dock-crossing',
    waypoints: Object.freeze([
      Object.freeze({ x: -15, y: 2.4, z: 45 }),
      Object.freeze({ x: -5, y: 2.4, z: 37 }),
      Object.freeze({ x: 8, y: 2.4, z: 37 }),
      Object.freeze({ x: 14, y: 2.4, z: 45 }),
    ]),
  }),
  Object.freeze({
    id: 'patrol.dock-pad-ring',
    waypoints: Object.freeze([
      Object.freeze({ x: 8, y: 2.5, z: 39 }),
      Object.freeze({ x: 11, y: 2.5, z: 37 }),
      Object.freeze({ x: 15, y: 2.5, z: 43 }),
      Object.freeze({ x: 11, y: 2.5, z: 46 }),
    ]),
  }),
]);

/** Camera placements with sweep half-angles (radians). */
export const CAMERA_CANDIDATES = Object.freeze([
  Object.freeze({
    id: 'camera.dock-south',
    origin: Object.freeze({ x: 0, y: 3.7, z: 29.5 }),
    forward: Object.freeze({ x: 0, y: -0.08, z: 1 }),
    sweepAngle: Math.PI / 5,
    range: 10,
    sweepPeriod: 6,
  }),
  Object.freeze({
    id: 'camera.dock-west',
    origin: Object.freeze({ x: -15, y: 4.2, z: 36 }),
    forward: Object.freeze({ x: 0.85, y: -0.1, z: 0.2 }),
    sweepAngle: Math.PI / 6,
    range: 9,
    sweepPeriod: 5.5,
  }),
  Object.freeze({
    id: 'camera.dock-high',
    origin: Object.freeze({ x: 2, y: 5.5, z: 42 }),
    forward: Object.freeze({ x: -0.15, y: -0.25, z: -0.9 }),
    sweepAngle: Math.PI / 4.5,
    range: 11,
    sweepPeriod: 7,
  }),
  Object.freeze({
    id: 'camera.roller-watch',
    origin: Object.freeze({ x: 14, y: 4, z: 43 }),
    forward: Object.freeze({ x: -0.6, y: -0.05, z: -0.7 }),
    sweepAngle: Math.PI / 5.5,
    range: 8.5,
    sweepPeriod: 5,
  }),
]);
