import type { FlightAxes } from '../input/FlightAxes.ts';
import type { InteractionActions } from '../input/InteractionActions.ts';
import type { DroneNetworkState } from '../network/NetworkTypes.ts';

export type DroneControlKind = 'human' | 'remote' | 'bot';

/**
 * One control frame consumed by GameApp. Every controller exposes the same
 * movement actions. Network controllers may additionally provide a smoothed
 * replicated pose instead of asking the local flight simulation to advance.
 */
export interface DroneControlFrame {
  readonly actions: FlightAxes;
  readonly interactions: InteractionActions;
  readonly remoteState?: DroneNetworkState;
}

export interface DroneControlSource {
  readonly kind: DroneControlKind;
  sample(dt: number): DroneControlFrame;
  dispose(): void;
}
