import { FlightInput } from '../input/FlightInput.ts';
import type { KeyBindings } from '../input/KeyboardInput.ts';
import type { VirtualControlInput } from '../input/VirtualControlInput.ts';
import type { DroneControlFrame, DroneControlSource } from './DroneControlSource.ts';

/** Human keyboard/touch aggregation behind the common drone-control seam. */
export class HumanControlSource implements DroneControlSource {
  readonly kind = 'human' as const;

  private readonly input: FlightInput;
  private readonly frame: DroneControlFrame;

  constructor(keys: KeyBindings) {
    this.input = new FlightInput(keys);
    this.frame = { actions: this.input.sample() };
  }

  sample(_dt: number): DroneControlFrame {
    this.input.sample();
    return this.frame;
  }

  enableVirtualControls(): VirtualControlInput {
    return this.input.enableVirtualControls();
  }

  dispose(): void {
    this.input.dispose();
  }
}
