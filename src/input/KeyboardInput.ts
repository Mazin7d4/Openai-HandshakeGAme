import { clampAxis, zeroFlightAxes, type FlightAxes } from './FlightAxes.ts';
import type { InputSource } from './InputSource.ts';
import { getSettings, subscribeSettings } from '../ui/Settings.ts';

/** KeyboardEvent.code values for each flight action. */
export interface KeyBindings {
  forward: readonly string[];
  back: readonly string[];
  left: readonly string[];
  right: readonly string[];
  up: readonly string[];
  down: readonly string[];
  boost: readonly string[];
  grabDrop: readonly string[];
  throwObject: readonly string[];
  interact: readonly string[];
  pause: readonly string[];
  switchDrone: readonly string[];
  yank: readonly string[];
}

export const PLAYER_ONE_KEYS: KeyBindings = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['Space'],
  down: ['ControlLeft', 'KeyC'],
  boost: ['ShiftLeft'],
  grabDrop: ['KeyE'],
  throwObject: ['KeyQ'],
  interact: ['KeyF'],
  pause: ['Escape'],
  switchDrone: ['Tab'],
  yank: ['KeyR'],
};

export const PLAYER_TWO_KEYS: KeyBindings = {
  forward: ['ArrowUp'],
  back: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['Period', 'Numpad0'],
  down: ['Comma', 'ControlRight', 'NumpadDecimal'],
  boost: ['ShiftRight', 'Slash', 'NumpadEnter'],
  grabDrop: ['KeyO', 'Numpad1'],
  throwObject: ['KeyP', 'Numpad2'],
  interact: ['KeyI', 'Numpad3'],
  pause: ['Escape'],
  switchDrone: ['Tab'],
  yank: ['KeyU', 'Numpad4'],
};

export class KeyboardInput implements InputSource {
  readonly id = 'keyboard';

  private readonly pressed = new Set<string>();
  private readonly axes = zeroFlightAxes();
  private readonly handled: Set<string>;
  private readonly keys: KeyBindings;
  private holdToToggle = getSettings().holdToToggle;
  private boostLatched = false;
  private readonly unsubSettings: () => void;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.handled.has(event.code)) {
      return;
    }
    event.preventDefault();
    const wasDown = this.pressed.has(event.code);
    this.pressed.add(event.code);
    if (this.holdToToggle && !wasDown && !event.repeat && this.keys.boost.includes(event.code)) {
      this.boostLatched = !this.boostLatched;
    }
  };
  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.code);
  };
  private readonly onBlur = () => {
    this.pressed.clear();
    this.boostLatched = false;
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
    this.unsubSettings = subscribeSettings((s) => {
      this.holdToToggle = s.holdToToggle;
      if (!s.holdToToggle) this.boostLatched = false;
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  sample(): FlightAxes {
    const k = this.keys;
    this.axes.thrust = clampAxis(this.any(k.forward) - this.any(k.back));
    this.axes.strafe = clampAxis(this.any(k.right) - this.any(k.left));
    this.axes.lift = clampAxis(this.any(k.up) - this.any(k.down));
    this.axes.boost = this.holdToToggle ? this.boostLatched : this.any(k.boost) === 1;
    return this.axes;
  }

  dispose(): void {
    this.unsubSettings();
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
