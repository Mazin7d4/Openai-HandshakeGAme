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
  { x: 8.2, y: 2.2, z: -33.8, tolerance: 0.55 }, { x: 8.2, y: 2.2, z: -27.8 },
  { x: 2, y: 2.2, z: -28 }, { x: -1, y: 2.2, z: -24 },
  { x: 4, y: 2.2, z: -24 }, { x: 7, y: 2.2, z: -24 },
  { x: 7, y: 2.2, z: -19 }, { x: 7, y: 2.2, z: -17 },
  { x: 2, y: 2.2, z: -17 }, { x: -3, y: 2.2, z: -17 },
  { x: -8, y: 2.2, z: -17 }, { x: -8, y: 2.2, z: -11 },
  { x: -8, y: 8, z: -10 }, { x: -5.2, y: 7.4, z: -7.8 },
];
export const vault = [
  { x: 0, y: 7.5, z: -4 }, { x: 1, y: 7.5, z: -1 },
  { x: 0, y: 2.3, z: -1 }, { x: 0, y: 2.3, z: 4 },
  { x: 0, y: 2.3, z: 9 }, { x: 0, y: 3.5, z: 13 },
  { x: 0, y: 5.5, z: 16 }, { x: 2.7, y: 5.5, z: 18, tolerance: 0.45 },
];
export const clearCrate = {
  approach: [
    { x: 0, y: 4.5, z: 13 },
    { x: -5, y: 4.5, z: 13 },
    { x: -10, y: 4.5, z: 13 },
    { x: -12.2, y: 3.2, z: 12.5, tolerance: 0.8 },
  ],
  drag: [
    { x: -15.3, y: 3.2, z: 16, tolerance: 1.0 },
    { x: -15.3, y: 3.2, z: 19.5, tolerance: 1.0 },
  ],
};

export const escape = [
  { x: 0, y: 4.5, z: 13 }, { x: -5, y: 4.5, z: 13 },
  { x: -10, y: 4.5, z: 13 }, { x: -15.3, y: 4.5, z: 13 },
  ...[8, 3, -2, -7, -12, -17, -22, -27, -32, -37, -42, -47, -52, -57, -61]
    .map(z => ({ x: -15.3, y: z < -17 ? 2.2 : 4.5, z })),
];

