/**
 * Exactly one twist per run. Each maps to concrete gameplay parameters.
 * Floor escalation stacks on top (more guards, faster sweeps, tighter timers).
 */

/** @typedef {'lights_out' | 'short_cord' | 'slippery_floor' | 'nervous_nee' | 'rush_hour'} TwistId */

/**
 * @typedef {{
 *   id: TwistId,
 *   label: string,
 *   cordMaxScale: number,
 *   cordRestScale: number,
 *   lightScale: number,
 *   gripScale: number,
 *   neeNervousness: number,
 *   hasteScale: number,
 *   extraGuards: number,
 *   timerScale: number,
 *   cameraSweepScale: number,
 *   patrolSpeedScale: number,
 * }} TwistParams
 */

/** Baseline cord lengths matching `TETHER_TUNING` in the client. */
export const BASE_CORD = Object.freeze({ restLength: 7, maxLength: 10 });

/** Base mission timer (seconds) before twist / floor scaling. */
export const BASE_TIMER_SECONDS = 480;

/** @type {readonly TwistParams[]} */
export const TWISTS = Object.freeze([
  Object.freeze({
    id: 'lights_out',
    label: 'Lights out',
    cordMaxScale: 1,
    cordRestScale: 1,
    lightScale: 0.35,
    gripScale: 1,
    neeNervousness: 0.15,
    hasteScale: 1,
    extraGuards: 0,
    timerScale: 1,
    cameraSweepScale: 0.85,
    patrolSpeedScale: 1,
  }),
  Object.freeze({
    id: 'short_cord',
    label: 'Short cord',
    cordMaxScale: 0.72,
    cordRestScale: 0.75,
    lightScale: 1,
    gripScale: 1,
    neeNervousness: 0.1,
    hasteScale: 1,
    extraGuards: 0,
    timerScale: 1,
    cameraSweepScale: 1,
    patrolSpeedScale: 1,
  }),
  Object.freeze({
    id: 'slippery_floor',
    label: 'Slippery floor',
    cordMaxScale: 1,
    cordRestScale: 1,
    lightScale: 1,
    gripScale: 0.55,
    neeNervousness: 0.05,
    hasteScale: 1.05,
    extraGuards: 0,
    timerScale: 1,
    cameraSweepScale: 1,
    patrolSpeedScale: 1,
  }),
  Object.freeze({
    id: 'nervous_nee',
    label: 'Nervous NEE',
    cordMaxScale: 1,
    cordRestScale: 1,
    lightScale: 1,
    gripScale: 1,
    neeNervousness: 0.85,
    hasteScale: 1,
    extraGuards: 0,
    timerScale: 0.95,
    cameraSweepScale: 1,
    patrolSpeedScale: 1,
  }),
  Object.freeze({
    id: 'rush_hour',
    label: 'Rush hour',
    cordMaxScale: 1,
    cordRestScale: 1,
    lightScale: 1,
    gripScale: 1,
    neeNervousness: 0.2,
    hasteScale: 1.25,
    extraGuards: 1,
    timerScale: 0.78,
    cameraSweepScale: 1.2,
    patrolSpeedScale: 1.18,
  }),
]);

/**
 * Floor escalation: more guards, faster sweeps, tighter timers.
 * Floor 0 is the baseline heist; each step up stacks difficulty.
 *
 * @param {number} floor
 * @param {TwistParams} twist
 */
export function escalateFloor(floor, twist) {
  const f = Math.max(0, floor | 0);
  const baseGuards = 2;
  const guardCount = Math.min(6, baseGuards + twist.extraGuards + Math.floor(f * 0.75));
  const patrolSpeed = 3.1 * twist.patrolSpeedScale * (1 + f * 0.08);
  const cameraSweepScale = twist.cameraSweepScale * (1 + f * 0.1);
  const timerSeconds = Math.max(
    180,
    Math.round(BASE_TIMER_SECONDS * twist.timerScale * (1 - f * 0.07)),
  );
  const detectionRateScale = 1 + f * 0.06;
  return Object.freeze({
    floor: f,
    guardCount,
    patrolSpeed,
    cameraSweepScale,
    timerSeconds,
    detectionRateScale,
    hasteScale: twist.hasteScale * (1 + f * 0.05),
  });
}

/**
 * @param {TwistParams} twist
 */
export function cordForTwist(twist) {
  return Object.freeze({
    restLength: +(BASE_CORD.restLength * twist.cordRestScale).toFixed(3),
    maxLength: +(BASE_CORD.maxLength * twist.cordMaxScale).toFixed(3),
  });
}
