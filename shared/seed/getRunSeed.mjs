/**
 * Stub seed source for Night Shift / HUD / next-floor wiring.
 * Netcode (prod-net) replaces this with the room-authoritative getter at merge time.
 *
 * Default: random 32-bit seed, floor 0.
 * Optional browser session key `pixnee.runSeed` carries a pending next-floor intent.
 */

/**
 * @typedef {{ seed: number, floor: number }} RunSeed
 */

const SESSION_KEY = 'pixnee.runSeed';

/**
 * @returns {RunSeed | null}
 */
function readSessionIntent() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.seed)) return null;
    sessionStorage.removeItem(SESSION_KEY);
    return {
      seed: parsed.seed >>> 0,
      floor: Math.max(0, (parsed.floor ?? 0) | 0),
    };
  } catch {
    return null;
  }
}

/**
 * @param {RunSeed} value
 */
export function stashRunSeed(value) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      seed: value.seed >>> 0,
      floor: Math.max(0, value.floor | 0),
    }));
  } catch {
    /* private mode */
  }
}

/**
 * @param {{ seed?: number, floor?: number } | null | undefined} [override]
 * @returns {RunSeed}
 */
export function getRunSeed(override) {
  if (override && Number.isFinite(override.seed)) {
    return {
      seed: override.seed >>> 0,
      floor: Math.max(0, (override.floor ?? 0) | 0),
    };
  }
  const pending = readSessionIntent();
  if (pending) return pending;
  const seed = (Math.random() * 0x100000000) >>> 0;
  return { seed, floor: 0 };
}

/**
 * Advance to the next Night Shift floor (same seed, floor+1).
 * Thin stub — capture counting / run end lives on prod-net.
 *
 * @param {RunSeed} current
 * @returns {RunSeed}
 */
export function nextFloorSeed(current) {
  return {
    seed: current.seed >>> 0,
    floor: Math.max(0, (current.floor | 0) + 1),
  };
}
