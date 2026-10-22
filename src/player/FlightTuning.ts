export const FLIGHT_TUNING = {
  cruiseSpeed: 9,
  boostMultiplier: 1.85,
  verticalSpeed: 6.5,
  acceleration: 34,
  deceleration: 16,
  /** Multiplier on acceleration while steering against current velocity. */
  counterSteerBoost: 1.6,
  maxBankRoll: 0.48,
  maxBankPitch: 0.26,
  bankResponse: 8,
  idleSpeed: 0.35,
  /** One-shot dash added along the stick when boost is first pressed. */
  boostBurst: 7,
  boostBurstCooldown: 0.7,
  /** Share of the velocity lost to a wall that comes back as a springy bounce. */
  bounce: 0.42,
  maxBounce: 7.5,
};
