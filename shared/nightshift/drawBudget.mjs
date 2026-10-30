// Upper-bound draw-call estimate for a generated floor plan, mirroring the
// client builders (RoomBuilder, ObjectiveVisuals, HazardVisuals). The generator
// rejects plans over budget and variety-solo checks the estimate against the
// measured scene, so this stays honest as the builders change.

export const DRAW_CALL_BUDGET = 25;

/** Hazards on floors where every room is dressed (the heaviest room builds). */
export const MAX_HAZARDS_ALL_DRESSED = 3;

/** Mesh parts per kit asset (src/level/kit GLBs); each distinct part is one draw. */
export const KIT_PART_COUNTS = Object.freeze({
  CrateStack: 1,
  Cone: 1,
  Desk: 1,
  DeskL: 1,
  OfficeChair: 1,
  GlassPartition: 2,
  ServerRackA: 2,
  Pillar: 1,
});
const KIT_PLACEMENT_LIMIT = 16;

/** Nodes per hazard at the heaviest (non-low) quality tier. */
const HAZARD_NODES = Object.freeze({ tripwire: 2, 'pulse-gate': 2, sweeper: 3, ice: 3, gust: 2 });

function themedMaterial(archetype, mat) {
  if (archetype === 'rack-maze' || archetype === 'cold-aisle') return mat === 'rack' ? 'serverBlue' : mat === 'metal' ? 'vaultSteel' : mat;
  if (archetype === 'cubicle-farm' || archetype === 'boardroom') return mat === 'desk' ? 'officeWarm' : mat === 'partition' ? 'officeSage' : mat;
  if (archetype === 'vent-crawl') return mat === 'duct' || mat === 'metal' ? 'ventSteel' : mat;
  if (archetype === 'laser-vault') return mat === 'metal' ? 'vaultSteel' : mat === 'glass' ? 'vaultGold' : mat;
  return mat;
}

function roomDrawCalls(rooms, useKits) {
  const kitAssets = new Set();
  const groups = new Set();
  let placements = 0;
  for (const room of rooms ?? []) {
    for (const piece of room.pieces ?? []) {
      const kit = useKits && piece.asset && piece.mat !== 'rack' && placements < KIT_PLACEMENT_LIMIT && KIT_PART_COUNTS[piece.asset];
      if (kit) {
        placements++;
        kitAssets.add(piece.asset);
        continue;
      }
      const occluder = piece.sy > 2.2 && piece.mat !== 'pylon';
      groups.add(`${piece.mat}:${occluder}:${themedMaterial(room.archetype, piece.mat)}`);
    }
  }
  let calls = groups.size;
  for (const asset of kitAssets) calls += KIT_PART_COUNTS[asset];
  return calls;
}

function objectiveDrawCalls(objective, campaign = false) {
  if (campaign && objective?.levers) return objective.levers.length * 5 + 1;
  if (campaign && objective?.pads) return objective.pads.length * 5 + 1;
  switch (objective?.kind) {
    case 'twin-levers': return 7;
    case 'pylon-safe': return 9;
    case 'relay': return (objective.pads?.length ?? 0) + 2;
    case 'fragile': return 7;
    default: return 0;
  }
}

export function estimateFloorDrawCalls(plan) {
  const rooms = Math.max(roomDrawCalls(plan.rooms, true), roomDrawCalls(plan.rooms, false));
  const hazards = (plan.hazards ?? []).reduce((sum, hazard) => sum + (HAZARD_NODES[hazard.kind] ?? 3), 0);
  return rooms + Math.max(...(plan.phases ?? [plan.objective]).map((objective) => objectiveDrawCalls(objective, Boolean(plan.campaign)))) + hazards;
}
