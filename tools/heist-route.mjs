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
  { x: 4.7, y: 2.2, z: -32.8, tolerance: 0.6 },
];
export const servers = [
  { x: 0, y: 2.2, z: -24 }, { x: 0, y: 2.2, z: -16 }, { x: 0, y: 2.2, z: -10 },
  { x: -3, y: 4.6, z: -8.9 }, { x: -3, y: 5.8, z: -7.9 },
  { x: -3, y: 7, z: -6.9 }, { x: -4, y: 7.1, z: -5.8, tolerance: 0.55 },
];
export const vault = [
  { x: -4, y: 7.1, z: -5.8, tolerance: 0.55 }, { x: 0, y: 7.1, z: -2 },
  { x: 0, y: 2.3, z: 2 }, { x: 0, y: 2.3, z: 9 },
  { x: 0, y: 3.5, z: 13 }, { x: 0, y: 5.25, z: 18, tolerance: 0.45 },
];
export const clearCrate = {
  approach: [
    { x: 0, y: 3, z: 20 }, { x: 0, y: 3, z: 30 },
    { x: 8, y: 3, z: 32 }, { x: 8, y: 3, z: 37, tolerance: 0.8 },
  ],
  drag: [
    { x: 8, y: 3, z: 37, tolerance: 1.0 },
    { x: 10, y: 3, z: 38, tolerance: 1.0 },
    { x: 10, y: 3, z: 40, tolerance: 1.0 },
  ],
};

export const escape = [
  { x: 0, y: 3, z: 20 }, { x: 0, y: 3, z: 30 },
  { x: 9, y: 3, z: 32 }, { x: 10.5, y: 3, z: 38 },
  { x: 11, y: 2, z: 43.5, tolerance: 0.8 },
];

