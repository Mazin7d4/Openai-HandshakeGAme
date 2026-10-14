import { FlightInput } from '../input/FlightInput.ts';
import type { KeyBindings } from '../input/KeyboardInput.ts';
import type { VirtualControlInput } from '../input/VirtualControlInput.ts';
import { InteractionInput } from '../input/InteractionInput.ts';
import type { DroneControlFrame, DroneControlSource } from './DroneControlSource.ts';

/** Human keyboard/touch aggregation behind the common drone-control seam. */
export class HumanControlSource implements DroneControlSource {
  readonly kind = 'human' as const;

  private readonly input: FlightInput;
  private readonly interactions: InteractionInput;
  private readonly frame: DroneControlFrame;

  constructor(keys: KeyBindings) {
    this.input = new FlightInput(keys);
    this.interactions = new InteractionInput(keys);
    this.frame = { actions: this.input.sample(), interactions: this.interactions.sample() };
  }

  sample(_dt: number): DroneControlFrame {
    this.input.sample();
    const interactions = this.interactions.sample();
    this.frame.interactions.grabDrop = interactions.grabDrop;
    this.frame.interactions.throwObject = interactions.throwObject;
    this.frame.interactions.interact = interactions.interact;
    this.frame.interactions.pause = interactions.pause;
    this.frame.interactions.switchDrone = interactions.switchDrone;
    this.frame.interactions.yank = interactions.yank;
    return this.frame;
  }

  enableVirtualControls(): VirtualControlInput {
    return this.input.enableVirtualControls();
  }

  requestGrabDrop(): void {
    this.interactions.requestGrabDrop();
  }

  requestThrow(): void {
    this.interactions.requestThrow();
  }

  requestYank(): void {
    this.interactions.requestYank();
  }

  dispose(): void {
    this.input.dispose();
    this.interactions.dispose();
  }
}
