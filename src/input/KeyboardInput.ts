import { clampAxis, zeroFlightAxes, type FlightAxes } from './FlightAxes.ts';
import type { InputSource } from './InputSource.ts';

const HANDLED_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
]);

export class KeyboardInput implements InputSource {
  readonly id = 'keyboard';

  private readonly pressed = new Set<string>();
  private readonly axes = zeroFlightAxes();
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!HANDLED_CODES.has(event.code)) {
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

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  sample(): FlightAxes {
    const thrust =
      (this.pressed.has('KeyW') || this.pressed.has('ArrowUp') ? 1 : 0) +
      (this.pressed.has('KeyS') || this.pressed.has('ArrowDown') ? -1 : 0);
    const strafe =
      (this.pressed.has('KeyD') || this.pressed.has('ArrowRight') ? 1 : 0) +
      (this.pressed.has('KeyA') || this.pressed.has('ArrowLeft') ? -1 : 0);
    const lift =
      (this.pressed.has('Space') ? 1 : 0) +
      (this.pressed.has('ControlLeft') || this.pressed.has('ControlRight') ? -1 : 0);

    this.axes.thrust = clampAxis(thrust);
    this.axes.strafe = clampAxis(strafe);
    this.axes.lift = clampAxis(lift);
    this.axes.boost = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
    return this.axes;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }
}
