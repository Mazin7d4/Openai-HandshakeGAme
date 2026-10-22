/**
 * Seed-driven layout seam.
 *
 * Stubbed here so network/run plumbing can call a stable API.
 * The generator branch replaces this module with a real `generateRun` /
 * `applyRunLayout` implementation — keep these names and signatures.
 */

/** Opaque layout payload produced by the (future) seeded generator. */
export type RunLayout = unknown;

/** Build a layout for this floor from the run seed. No-op stub. */
export function generateRun(_seed: number, _floor: number): RunLayout {
  return null;
}

/** Apply a generated layout to the world. No-op stub (hook point for the generator). */
export function applyRunLayout(_layout: RunLayout): void {
  // Intentionally empty until the seeded level generator lands.
}
