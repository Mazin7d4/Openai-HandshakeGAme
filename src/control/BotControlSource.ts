import { zeroFlightAxes } from '../input/FlightAxes.ts';
import { zeroInteractionActions } from '../input/InteractionActions.ts';
import type { DroneControlFrame, DroneControlSource } from './DroneControlSource.ts';

/** Architectural placeholder for the future single-player CPU companion. */
export class BotControlSource implements DroneControlSource {
  readonly kind = 'bot' as const;

  private readonly frame: DroneControlFrame = {
    actions: zeroFlightAxes(),
    interactions: zeroInteractionActions(),
  };

  sample(_dt: number): DroneControlFrame {
    return this.frame;
  }

  dispose(): void {
    // No resources until the CPU companion is implemented.
  }
}
