import { clampAxis, zeroFlightAxes, type FlightAxes } from './FlightAxes.ts';
import type { InputSource } from './InputSource.ts';

/** KeyboardEvent.code values for each flight action. */
export interface KeyBindings {
  forward: readonly string[];
  back: readonly string[];
  left: readonly string[];
  right: readonly string[];
  up: readonly string[];
  down: readonly string[];
  boost: readonly string[];
}

export const PLAYER_ONE_KEYS: KeyBindings = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['Space'],
  down: ['ControlLeft', 'KeyC'],
  boost: ['ShiftLeft'],
};

export const PLAYER_TWO_KEYS: KeyBindings = {
  forward: ['ArrowUp'],
  back: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['Period', 'Numpad0'],
  down: ['Comma', 'ControlRight', 'NumpadDecimal'],
  boost: ['ShiftRight', 'Slash', 'NumpadEnter'],
};

export class KeyboardInput implements InputSource {
  readonly id = 'keyboard';

  private readonly pressed = new Set<string>();
  private readonly axes = zeroFlightAxes();
  private readonly handled: Set<string>;
  private readonly keys: KeyBindings;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.handled.has(event.code)) {
      return;
    }
    event.preventDefault();
    this.pressed.add(event.code);
  };
  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.code);
  };
  private readonly onBlur = () => {
    this.pressed.clear();
  };

  constructor(keys: KeyBindings = PLAYER_ONE_KEYS) {
    this.keys = keys;
    this.handled = new Set([
      ...keys.forward,
      ...keys.back,
      ...keys.left,
      ...keys.right,
      ...keys.up,
      ...keys.down,
      ...keys.boost,
    ]);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  sample(): FlightAxes {
    const k = this.keys;
    this.axes.thrust = clampAxis(this.any(k.forward) - this.any(k.back));
    this.axes.strafe = clampAxis(this.any(k.right) - this.any(k.left));
    this.axes.lift = clampAxis(this.any(k.up) - this.any(k.down));
    this.axes.boost = this.any(k.boost) === 1;
    return this.axes;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }

  private any(codes: readonly string[]): number {
    for (const code of codes) {
      if (this.pressed.has(code)) {
        return 1;
      }
    }
    return 0;
  }
}
