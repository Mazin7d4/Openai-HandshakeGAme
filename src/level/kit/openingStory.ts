import type { DressRow } from './dressingTable.ts';

/**
 * Handcrafted world-space kit placements for the first ~90s of the authored heist
 * (spawn → delivery apron → reception → first office). Coordinates match PrototypeHeist.
 * Non-colliding decor only; clearance is relaxed for wall/ceiling mounts and desk-top clutter.
 * Keep per-area unique part count low so thin instances stay within ~30 extra draw calls.
 */
export const OPENING_STORY: DressRow[] = [
  // ── Delivery apron / spawn ──────────────────────────────────────────────
  // Perimeter cargo — east and west walls, clear of the center flight lane.
  { asset: 'CrateStack', wx: 15.2, wz: -64.2, ry: -0.2, chance: 1 },
  { asset: 'BoxSmall', wx: 14.4, wz: -62.8, ry: 0.4, chance: 1, clutter: true },
  { asset: 'CrateStack', wx: -15.4, wz: -63.8, ry: 0.35, chance: 1 },
  { asset: 'BoxSmall', wx: -14.6, wz: -62.4, ry: -0.5, chance: 1, clutter: true },
  { asset: 'Cone', wx: 10.5, wz: -58.5, ry: 0.2, chance: 1, clutter: true },
  { asset: 'WetFloorSign', wx: -10.2, wz: -57.8, ry: 0.6, chance: 1, clutter: true },
  { asset: 'PlantPot', wx: 16.6, wz: -56.2, chance: 1, clutter: true },
  { asset: 'PlantPot', wx: -16.8, wz: -56.5, chance: 1, clutter: true },
  // Ceiling trays + wall vents read as building systems, not floating props.
  { asset: 'CableTray', wx: 0, wz: -60, y: 11.8, ry: 0, chance: 1, mount: 'ceiling' },
  { asset: 'CableTray', wx: -5, wz: -52, y: 11.8, ry: 1.57, chance: 1, mount: 'ceiling' },
  { asset: 'Vent', wx: 8, wz: -66.2, y: 10.2, ry: 0, chance: 1, mount: 'wall' },
  { asset: 'Vent', wx: -8, wz: -66.2, y: 10.2, ry: 0, chance: 1, mount: 'wall' },
  { asset: 'CeilingLamp', wx: 0, wz: -61, y: 12.4, chance: 1, mount: 'ceiling' },
  { asset: 'CeilingLamp', wx: 6, wz: -56, y: 12.4, chance: 1, mount: 'ceiling' },
  { asset: 'ExitSign', wx: -12.2, wz: -58.5, y: 5.4, ry: 1.57, chance: 1, mount: 'wall' },

  // ── Reception / security desk storytelling ──────────────────────────────
  // Desk-top clutter rides the existing reception oak (y≈3.9); small footprints, elevated.
  { asset: 'Monitor', wx: -3.2, wz: -48.4, y: 3.95, ry: Math.PI, chance: 1, mount: 'wall', clutter: true },
  { asset: 'Keyboard', wx: -3.2, wz: -48.9, y: 3.95, ry: Math.PI, chance: 1, mount: 'wall', clutter: true },
  { asset: 'CoffeeMug', wx: -7.6, wz: -48.2, y: 3.95, chance: 1, mount: 'wall', clutter: true },
  { asset: 'DeskPhone', wx: -6.2, wz: -49.4, y: 3.95, ry: 0.4, chance: 1, mount: 'wall', clutter: true },
  { asset: 'DeskLamp', wx: -8.6, wz: -49.6, y: 3.95, ry: -0.5, chance: 1, mount: 'wall', clutter: true },
  // Security desk end-cap: filing + keycard + camera (amber lens owned by kit emissive).
  { asset: 'FilingCabinet', wx: 2.8, wz: -52.6, ry: Math.PI, chance: 1 },
  { asset: 'KeycardReader', wx: 3.6, wz: -54.7, y: 3.2, ry: Math.PI, chance: 1, mount: 'wall' },
  { asset: 'SecurityCamera', wx: 16.8, wz: -52.5, y: 10.5, ry: -2.4, chance: 1, mount: 'wall' },
  { asset: 'SecurityCamera', wx: -16.8, wz: -48, y: 10.5, ry: 0.9, chance: 1, mount: 'wall' },
  // Sticky-note / cork storytelling wall (whiteboard stand-in) on the east reception wall.
  { asset: 'Whiteboard', wx: 17.4, wz: -48.5, ry: -1.57, chance: 1 },
  { asset: 'PlantPot', wx: 15.8, wz: -52.2, chance: 1, clutter: true },
  { asset: 'TrashBin', wx: -9.8, wz: -51.2, chance: 1, clutter: true },
  { asset: 'Extinguisher', wx: 4.2, wz: -54.6, y: 1.4, ry: Math.PI, chance: 1, mount: 'wall' },
  { asset: 'CeilingLamp', wx: -4, wz: -49, y: 12.4, chance: 1, mount: 'ceiling' },
  { asset: 'CableTray', wx: -5, wz: -46, y: 11.6, ry: 1.57, chance: 1, mount: 'ceiling' },

  // ── Service vent approach ───────────────────────────────────────────────
  { asset: 'Vent', wx: -9.2, wz: -43.4, y: 7.2, ry: 0, chance: 1, mount: 'wall' },
  { asset: 'Vent', wx: -0.8, wz: -43.4, y: 7.2, ry: 0, chance: 1, mount: 'wall' },
  { asset: 'CableTray', wx: -5, wz: -43, y: 11.4, ry: 0, chance: 1, mount: 'ceiling' },
  { asset: 'Cone', wx: -8.8, wz: -45.2, ry: 0.3, chance: 1, clutter: true },

  // ── First office ────────────────────────────────────────────────────────
  // Perimeter furniture — desks already exist as collision; kit chairs/monitors are decor.
  { asset: 'OfficeChair', wx: -5.2, wz: -37.4, ry: Math.PI, chance: 1 },
  { asset: 'OfficeChair', wx: 7.6, wz: -35.6, ry: Math.PI + 0.35, chance: 1 },
  { asset: 'Monitor', wx: -4.2, wz: -32.4, y: 3.95, ry: Math.PI, chance: 1, mount: 'wall', clutter: true },
  { asset: 'Monitor', wx: 7.8, wz: -30.6, y: 3.95, ry: Math.PI, chance: 1, mount: 'wall', clutter: true },
  { asset: 'Keyboard', wx: -4.2, wz: -32.9, y: 3.95, ry: Math.PI, chance: 1, mount: 'wall', clutter: true },
  { asset: 'CoffeeMug', wx: -2.4, wz: -33.2, y: 3.95, chance: 1, mount: 'wall', clutter: true },
  { asset: 'CoffeeMug', wx: 9.2, wz: -30.8, y: 3.95, chance: 1, mount: 'wall', clutter: true },
  { asset: 'DeskLamp', wx: -7.4, wz: -33.6, y: 3.95, ry: 0.4, chance: 1, mount: 'wall', clutter: true },
  { asset: 'FilingCabinet', wx: -15.6, wz: -38.5, ry: 1.57, chance: 1 },
  { asset: 'Printer', wx: -15.4, wz: -30.5, ry: 1.57, chance: 1 },
  { asset: 'Whiteboard', wx: -17.2, wz: -35, ry: 1.57, chance: 1 },
  { asset: 'PlantPot', wx: 15.2, wz: -40.2, chance: 1, clutter: true },
  { asset: 'PlantPot', wx: 15.6, wz: -28.8, chance: 1, clutter: true },
  { asset: 'TrashBin', wx: -7.8, wz: -36.8, chance: 1, clutter: true },
  { asset: 'CableTray', wx: 1, wz: -34, y: 11.6, ry: 0, chance: 1, mount: 'ceiling' },
  { asset: 'Vent', wx: 0, wz: -26.4, y: 10.5, ry: Math.PI, chance: 1, mount: 'wall' },
  { asset: 'CeilingLamp', wx: -4, wz: -34, y: 12.4, chance: 1, mount: 'ceiling' },
  { asset: 'CeilingLamp', wx: 7, wz: -32, y: 12.4, chance: 1, mount: 'ceiling' },
  { asset: 'SecurityCamera', wx: 12.5, wz: -27.5, y: 10.8, ry: -2.6, chance: 1, mount: 'wall' },
  { asset: 'ExitSign', wx: -1, wz: -26.5, y: 7.2, ry: Math.PI, chance: 1, mount: 'wall' },
];
