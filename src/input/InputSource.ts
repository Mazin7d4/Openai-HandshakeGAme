import type { FlightAxes } from './FlightAxes.ts';

/** One device or on-screen control that can produce flight intent. */
export interface InputSource {
  readonly id: string;
  sample(): FlightAxes;
  dispose(): void;
}
