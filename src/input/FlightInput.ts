import { zeroFlightAxes, type FlightAxes } from './FlightAxes.ts';
import { KeyboardInput } from './KeyboardInput.ts';
import type { InputSource } from './InputSource.ts';
import { VirtualControlInput } from './VirtualControlInput.ts';

/** Merges device sources into one flight intent. The strongest axis wins so two sources do not stack. */
export class FlightInput {
  private readonly sources: InputSource[] = [];
  private readonly axes = zeroFlightAxes();
  private virtual: VirtualControlInput | null = null;

  constructor() {
    this.sources.push(new KeyboardInput());
  }

  /** Creates the mobile source once. Call this when the touch controls are built. */
  enableVirtualControls(): VirtualControlInput {
    if (!this.virtual) {
      this.virtual = new VirtualControlInput();
      this.sources.push(this.virtual);
    }
    return this.virtual;
  }

  sample(): FlightAxes {
    let strafe = 0;
    let thrust = 0;
    let lift = 0;
    let boost = false;

    for (const source of this.sources) {
      const sample = source.sample();
      if (Math.abs(sample.strafe) > Math.abs(strafe)) {
        strafe = sample.strafe;
      }
      if (Math.abs(sample.thrust) > Math.abs(thrust)) {
        thrust = sample.thrust;
      }
      if (Math.abs(sample.lift) > Math.abs(lift)) {
        lift = sample.lift;
      }
      boost = boost || sample.boost;
    }

    this.axes.strafe = strafe;
    this.axes.thrust = thrust;
    this.axes.lift = lift;
    this.axes.boost = boost;
    return this.axes;
  }

  dispose(): void {
    for (const source of this.sources) {
      source.dispose();
    }
    this.sources.length = 0;
    this.virtual = null;
  }
}
