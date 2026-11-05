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
  /**
   * Soft ceiling about 1.5 m under the heist cutaway roof collider (underside at 14.15; drone half-height 0.36).
   * Climb fades out from softCeilingY to hardCeilingY, so the drone glides just below the roof
   * instead of grinding against it and pinning in top corners.
   */
  softCeilingY: 11.6,
  hardCeilingY: 12.6,
};
