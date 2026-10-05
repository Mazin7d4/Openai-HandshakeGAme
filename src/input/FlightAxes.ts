/** Analog flight intent. Keyboard fills this with -1, 0, or 1. Touch sticks can use the full range. */
export interface FlightAxes {
  /** -1 left, +1 right */
  strafe: number;
  /** -1 backward, +1 forward */
  thrust: number;
  /** -1 descend, +1 ascend */
  lift: number;
  boost: boolean;
}

export function zeroFlightAxes(): FlightAxes {
  return { strafe: 0, thrust: 0, lift: 0, boost: false };
}

export function clampAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(-1, value));
}
