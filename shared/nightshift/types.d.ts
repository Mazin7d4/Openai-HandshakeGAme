/**
 * Night Shift variety contract (floor plan = rooms + tether objective + hazards + job).
 * Pure data, generated deterministically by shared/nightshift/plan.mjs from (seed, floor)
 * and attached to RunLayout as `layout.plan`. Server and clients generate identical plans.
 * World units: same as RunLayout (drones ~1.2 wide, cord rest 7 / max 10, room height 14.4).
 */
export interface Vec3 { x: number; y: number; z: number }
export type DroneRoleId = 'pix' | 'nee';
export type RoomSlot = 'arrival' | 'office' | 'server' | 'vault' | 'escape';

// ── Rooms ────────────────────────────────────────────────────────────────────
export type RoomArchetype =
  | 'classic'        // no extra pieces (floor 1 arrival/office default)
  | 'loading-dock'   // arrival: pallet + crate stacks, cones
  | 'cubicle-farm'   // office: grid of desks with low partitions + rolling chairs
  | 'boardroom'      // office: long table, chairs, glass partitions
  | 'rack-maze'      // server: extra rack segments forming lanes (fly over or weave)
  | 'cold-aisle'     // server: twin rack rows with a narrow centre aisle + cable trays overhead
  | 'laser-vault'    // vault: pillars + glass cases, pairs with tripwire hazards
  | 'vent-crawl';    // escape: low duct ceiling segments + baffles in the spine

export type PieceMat = 'desk' | 'partition' | 'chair' | 'rack' | 'crate' | 'pallet' | 'glass' | 'metal' | 'duct' | 'plant' | 'pylon' | 'cone';

/** A box or cylinder; centre position, full sizes, yaw in radians. */
export interface RoomPiece {
  kind: 'box' | 'cyl';
  mat: PieceMat;
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  rotY: number;
  /** Has a static physics body (drones collide). Non-solid = decoration only. */
  solid: boolean;
  /** Optional kit GLB name from src/level/kit/kit-manifest.json to render instead of the primitive. */
  asset?: string;
}

export interface RoomPlan {
  slot: RoomSlot;
  archetype: RoomArchetype;
  /** Short human label, e.g. "Cubicle farm". */
  label: string;
  pieces: RoomPiece[];
}

// ── Tether objectives ────────────────────────────────────────────────────────
export type ObjectiveKind = 'grab' | 'twin-levers' | 'pylon-safe' | 'fragile' | 'relay';

export interface ObjectivePlan {
  kind: ObjectiveKind;
  /** HUD pill label, <= 22 chars, e.g. "Pull both levers". */
  label: string;
  /** One-sentence hint for the expanded objective card / floor card. */
  hint: string;
  /** twin-levers: two lever plates; both drones must hover within leverRadius at the same time. */
  levers?: [Vec3, Vec3];
  leverRadius?: number;
  holdSeconds?: number;
  /** pylon-safe: one drone at the safe hook, the cord wrapped round the pylon, strain pulls the safe. */
  pylon?: Vec3;
  safe?: Vec3;
  hookRadius?: number;
  pullsRequired?: number;
  /** pylon-safe: where the anchoring partner should hover (far side of the pylon, overstretching the cord). */
  anchor?: Vec3;
  /** fragile: hard yanks / slams on the carrier crack the loot; this many cracks shatters it. */
  cracksToShatter?: number;
  /** relay: pads touched in order by the matching role, each within stepSeconds of the previous. */
  pads?: Array<Vec3 & { role: DroneRoleId }>;
  padRadius?: number;
  stepSeconds?: number;
}

/** Mutable runtime state (server-authoritative in co-op, local in solo). JSON-serialisable. */
export interface ObjectiveState {
  kind: ObjectiveKind;
  done: boolean;
  /** 0..1 for HUD. */
  progress: number;
  /** relay: next pad index. twin-levers/pylon: unused (0). */
  step: number;
  /** twin-levers: seconds both held. pylon-safe: seconds of qualifying strain this pull. relay: seconds since last pad. */
  timer: number;
  pulls: number;
  cracks: number;
  shatters: number;
  /** Bumped on every event so clients can diff/animate. */
  seq: number;
  lastEvent: ObjectiveEvent['type'] | null;
}

export interface ObjectiveEvent {
  type: 'lever-on' | 'lever-off' | 'pull' | 'crack' | 'shatter' | 'step' | 'reset' | 'done';
  role?: DroneRoleId;
}

export interface ObjectivePlayerInput { role: DroneRoleId; x: number; y: number; z: number; tetherPull: number }

export interface ObjectiveInput {
  dt: number;
  players: ObjectivePlayerInput[];
  /** Role holding the loot, or null. */
  carrier: DroneRoleId | null;
  /** Roles that fired a tether yank this tick (yanker roles). */
  yanks: DroneRoleId[];
}

// ── Hazards ──────────────────────────────────────────────────────────────────
export type HazardKind =
  | 'tripwire'    // laser beam a→b, blinks on/off (period, duty, phase); drone OR cord crossing it while on trips
  | 'sweeper'     // sweeping security eye at `center`: cone of `range`/`halfAngle`, yaw = baseYaw + sweep*sin(2πt/period + phase)
  | 'pulse-gate'  // vertical laser curtain in `rect` (thin slab), on/off duty cycle; drone inside while on trips
  | 'ice'         // slippery floor rect: low damping for drones inside (client physics only)
  | 'gust';       // fan vent rect: constant push `force` for drones inside (client physics only)

export interface HazardPlan {
  id: string;
  kind: HazardKind;
  slot: RoomSlot;
  a?: Vec3; b?: Vec3;
  center?: Vec3; range?: number; halfAngle?: number; baseYaw?: number; sweep?: number;
  rect?: { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number };
  force?: Vec3;
  /** Seconds per cycle (tripwire/pulse-gate/sweeper) and fraction of the cycle that is "on". */
  period?: number; duty?: number; phase?: number;
}

export interface HazardTrip { id: string; kind: HazardKind; role: DroneRoleId; via: 'drone' | 'cord' }

// ── Job / pacing ─────────────────────────────────────────────────────────────
export interface JobPlan {
  id: string;
  /** Floor card title, e.g. "The Cold Aisle Job" / "VAULT: The Twin-Lever Lockbox". */
  name: string;
  /** Every 3rd floor (floor % 3 === 0). */
  boss: boolean;
  /** Floor points multiplier (1 normal, 2 boss). */
  payoutScale: number;
  /** One line under the name. */
  blurb: string;
  /** Floor 1 only: teaching tips shown on the card. */
  tutorial: boolean;
}

export interface FloorPlan {
  version: 1;
  job: JobPlan;
  rooms: RoomPlan[];
  objective: ObjectivePlan;
  hazards: HazardPlan[];
}
