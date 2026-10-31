// Authored traversal waypoints shared by the existing local and multiplayer heist checks.
// Keep these explicit: they verify actual furniture/vent clearances, not teleportation.
export const arrival = [
  { x: 0, z: -58 }, { x: -3, z: -53 }, { x: -4, z: -49 },
  { x: -4, z: -45.5, tolerance: 0.45 }, { x: 2.5, z: -45.5, tolerance: 0.45 },
  { x: 2.5, y: 6.5, z: -47, tolerance: 0.45 }, { x: -4, y: 6.5, z: -46 },
  { x: -4, y: 6.5, z: -42 }, { x: -4, y: 6.5, z: -38 },
  { x: -4, y: 5.3, z: -35.5 },
];
export const toNee = [
  { x: 0, y: 5.4, z: -36 }, { x: 4.7, y: 2.2, z: -34.5 },
  // PIX parks first and can take the exact spot; the patch bay's 3.2 m reach covers a 1 m arrival.
  { x: 4.7, y: 2.2, z: -32.8 },
];
export const servers = [
  // Leave the under-desk patch bay east of the console, then north clear of the shutter jamb.
  { x: 7.5, y: 2.2, z: -32.8 }, { x: 7.5, y: 2.2, z: -27.5 }, { x: 0, y: 2.2, z: -27.5 },
  { x: 0, y: 2.2, z: -24 }, { x: 0, y: 2.2, z: -16 }, { x: 0, y: 2.2, z: -10 },
  // Climb east of the ramp steps, then cross above them onto the catwalk (waypoints stay clear of the step slabs).
  { x: 0, y: 6.8, z: -10 }, { x: -3, y: 6.8, z: -9.5 },
  // Park beside the memory console (its body fills the station point), inside its 3.2 m reach.
  { x: -3, y: 7, z: -6.9 }, { x: -2.6, y: 7.1, z: -5.8 },
];
export const vault = [
  { x: -2.6, y: 7.1, z: -5.8 }, { x: 0, y: 7.1, z: -2 },
  { x: 0, y: 2.3, z: 2 }, { x: 0, y: 2.3, z: 9 },
  { x: 0, y: 3.5, z: 13 }, { x: 0, y: 5.25, z: 18, tolerance: 0.45 },
];
export const clearCrate = {
  approach: [
    // Clear the pedestal above its 4.6-unit top, then descend beyond it into the dock.
    { x: 0, y: 6.4, z: 10 }, { x: 0, y: 6.4, z: 15 }, { x: 0, y: 6.4, z: 20 },
    { x: 0, y: 3, z: 24 }, { x: 0, y: 3, z: 30 },
    // Park separately south of the crate: stacking both drones at the pickup
    // point repels NEE into the crate and pushes it beyond PIX's grab radius.
    { x: 8, y: 3, z: 32 },
    { x: 8, y: 3, z: 34, tolerance: 0.5, partner: { x: 5, y: 3, z: 34, tolerance: 0.5 } },
  ],
  drag: [
    { x: 8, y: 3, z: 37, tolerance: 1.0 },
    { x: 3, y: 3, z: 38, tolerance: 1.0 },
    // Park it in open dock space, away from the extraction pad and every exterior wall.
    { x: -3, y: 3, z: 40, tolerance: 0.5 },
  ],
  exit: [
    { x: 0, y: 3, z: 40 }, { x: 7, y: 3, z: 40 },
    { x: 10.5, y: 3, z: 38 }, { x: 11, y: 2, z: 43.5, tolerance: 0.8 },
  ],
};

export const escape = [
  { x: 0, y: 3, z: 20 }, { x: 0, y: 3, z: 30 },
  { x: 9, y: 3, z: 32 }, { x: 10.5, y: 3, z: 38 },
  { x: 11, y: 2, z: 43.5, tolerance: 0.8 },
];

