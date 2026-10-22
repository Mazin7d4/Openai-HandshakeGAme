/**
 * Deterministic UTC calendar seed. Same UTC date → same 32-bit seed everywhere.
 * Shared by client UI (Daily Heist) and headless QA.
 *
 * @param {Date} [date=new Date()]
 * @returns {number}
 */
export function dailySeed(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  let h = (y * 10_000 + m * 100 + d) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
