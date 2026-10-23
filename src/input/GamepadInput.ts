import { zeroFlightAxes, type FlightAxes } from './FlightAxes.ts';
import { zeroInteractionActions, type InteractionActions } from './InteractionActions.ts';
import type { CinematicCamera } from '../camera/CinematicCamera.ts';
import { noteGamepadActivity } from '../ui/inputHints.ts';

const DEADZONE = 0.18;
const PRESSURE = 0.5;
function radialDeadzone(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y);
  if (length <= DEADZONE) return [0, 0];
  const scale = (length - DEADZONE) / ((1 - DEADZONE) * length);
  return [x * scale, y * scale];
}

/** Standard-mapped gamepad source, polled once per gameplay sample. */
export class GamepadInput {
  readonly id = 'gamepad';
  private readonly axes = zeroFlightAxes();
  private readonly actions = zeroInteractionActions();
  private readonly previous = new Set<number>();
  private pad: Gamepad | null = null;

  poll(dt: number, camera: CinematicCamera | null): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    this.pad = null;
    for (const candidate of pads) {
      if (candidate?.connected && candidate.mapping === 'standard') { this.pad = candidate; break; }
    }
    if (!this.pad) {
      this.axes.strafe = 0; this.axes.thrust = 0; this.axes.lift = 0; this.axes.boost = false;
      return;
    }
    const [moveX, moveY] = radialDeadzone(this.pad.axes[0] ?? 0, this.pad.axes[1] ?? 0);
    const [lookX, lookY] = radialDeadzone(this.pad.axes[2] ?? 0, this.pad.axes[3] ?? 0);
    this.axes.strafe = moveX;
    this.axes.thrust = -moveY;
    this.axes.lift = this.held(0) ? 1 : this.active(6) ? -1 : 0;
    this.axes.boost = this.held(0);
    if (camera && (lookX || lookY)) camera.gamepadLook(lookX, lookY, dt);
    // D-pad (12-15) and R3 (11) are reserved for Netcode emotes and ping; never read them here.
    const edges = [1, 2, 3, 4, 5, 7, 9];
    for (const index of edges) if (this.active(index) && !this.previous.has(index)) {
      if (index === 1) this.actions.interact = true;
      if (index === 2) this.actions.grabDrop = true;
      if (index === 3) this.actions.throwObject = true;
      if (index === 4) this.actions.switchDrone = true;
      if (index === 5 || index === 7) this.actions.yank = true;
      if (index === 9) this.actions.pause = true;
    }
    this.previous.clear();
    for (const index of edges) if (this.active(index)) this.previous.add(index);
    if (lookX || lookY || edges.some((index) => this.active(index)) || Math.abs(moveX) > 0.5 || Math.abs(moveY) > 0.5) noteGamepadActivity();
  }
  sample(): FlightAxes { return this.axes; }
  sampleInteractions(): InteractionActions {
    const result = { ...this.actions };
    Object.assign(this.actions, zeroInteractionActions());
    return result;
  }
  dispose(): void { this.previous.clear(); this.pad = null; }
  private held(index: number): boolean { return Boolean(this.pad?.buttons[index]?.pressed); }
  private value(index: number): number { return this.pad?.buttons[index]?.value ?? 0; }
  private active(index: number): boolean { return this.held(index) && (index !== 7 && index !== 6 || this.value(index) > PRESSURE); }
}
