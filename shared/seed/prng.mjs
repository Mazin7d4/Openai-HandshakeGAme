/** Deterministic 32-bit mulberry32 PRNG. */

/**
 * @param {number} seed
 * @returns {() => number} float in [0, 1)
 */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {() => number} rand
 * @param {readonly T[]} items
 * @returns {T}
 */
export function pick(rand, items) {
  if (items.length === 0) throw new Error('pick: empty list');
  return items[Math.floor(rand() * items.length)] ?? items[0];
}

/**
 * @param {() => number} rand
 * @param {number} min inclusive
 * @param {number} max exclusive
 */
export function intRange(rand, min, max) {
  return min + Math.floor(rand() * (max - min));
}

/**
 * Mix seed with floor into a stable 32-bit value.
 * @param {number} seed
 * @param {number} floor
 */
export function mixSeed(seed, floor) {
  let h = (seed >>> 0) ^ Math.imul(floor | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
