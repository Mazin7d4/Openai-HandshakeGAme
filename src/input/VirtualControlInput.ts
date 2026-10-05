import { clampAxis, zeroFlightAxes, type FlightAxes } from './FlightAxes.ts';
import type { InputSource } from './InputSource.ts';

/**
 * Stand-in for a future on-screen stick and buttons.
 * A touch UI writes axes here; it does not need to know about the keyboard.
 */
export class VirtualControlInput implements InputSource {
  readonly id = 'virtual';

  private readonly axes = zeroFlightAxes();

  setAxes(next: Partial<FlightAxes>): void {
    if (next.strafe !== undefined) {
      this.axes.strafe = clampAxis(next.strafe);
    }
    if (next.thrust !== undefined) {
      this.axes.thrust = clampAxis(next.thrust);
    }
    if (next.lift !== undefined) {
      this.axes.lift = clampAxis(next.lift);
    }
    if (next.boost !== undefined) {
      this.axes.boost = next.boost;
    }
  }

  sample(): FlightAxes {
    return this.axes;
  }

  dispose(): void {
    this.axes.strafe = 0;
    this.axes.thrust = 0;
    this.axes.lift = 0;
    this.axes.boost = false;
  }
}
