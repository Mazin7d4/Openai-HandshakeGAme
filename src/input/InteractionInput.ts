import type { KeyBindings } from './KeyboardInput.ts';
import { zeroInteractionActions, type InteractionActions } from './InteractionActions.ts';

/** Edge-triggered gameplay buttons. Public request methods are the mobile-control seam. */
export class InteractionInput {
  private readonly actions = zeroInteractionActions();
  private readonly grabKeys: Set<string>;
  private readonly throwKeys: Set<string>;
  private readonly interactKeys: Set<string>;
  private readonly pauseKeys: Set<string>;
  private readonly switchKeys: Set<string>;
  private readonly pressed = new Set<string>();

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (
      event.repeat ||
      (!this.grabKeys.has(event.code) &&
        !this.throwKeys.has(event.code) &&
        !this.interactKeys.has(event.code) &&
        !this.pauseKeys.has(event.code) &&
        !this.switchKeys.has(event.code))
    ) {
      return;
    }
    event.preventDefault();
    this.pressed.add(event.code);
    if (this.grabKeys.has(event.code)) {
      this.actions.grabDrop = true;
    }
    if (this.throwKeys.has(event.code)) {
      this.actions.throwObject = true;
    }
    if (this.interactKeys.has(event.code)) this.actions.interact = true;
    if (this.pauseKeys.has(event.code)) this.actions.pause = true;
    if (this.switchKeys.has(event.code)) this.actions.switchDrone = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.code);
  };

  private readonly onBlur = () => {
    this.pressed.clear();
  };

  constructor(keys: KeyBindings) {
    this.grabKeys = new Set(keys.grabDrop);
    this.throwKeys = new Set(keys.throwObject);
    this.interactKeys = new Set(keys.interact);
    this.pauseKeys = new Set(keys.pause);
    this.switchKeys = new Set(keys.switchDrone);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  sample(): InteractionActions {
    const result = { ...this.actions };
    this.actions.grabDrop = false;
    this.actions.throwObject = false;
    this.actions.interact = false;
    this.actions.pause = false;
    this.actions.switchDrone = false;
    return result;
  }

  requestGrabDrop(): void {
    this.actions.grabDrop = true;
  }

  requestThrow(): void {
    this.actions.throwObject = true;
  }

  requestInteract(): void {
    this.actions.interact = true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }
}
