import type { VirtualControlInput } from '../input/VirtualControlInput.ts';
import { controlIcon } from './ControlGlyphs.ts';
import { isTouchPlayDevice } from './touchDetect.ts';

export interface TouchControlsHandlers {
  virtual: VirtualControlInput;
  onJumpBoost?: (down: boolean) => void;
  onGrab: () => void;
  onYank: () => void;
  onInteract: () => void;
  onPause: () => void;
  onSwitch?: () => void;
  /** Show Switch drone when solo (non-multiplayer). */
  solo: boolean;
}

interface StickState {
  pointerId: number;
  originX: number;
  originY: number;
}

const DEADZONE = 0.18;
const STICK_RADIUS = 56;

/**
 * On-screen flight stick + action buttons for coarse-pointer / touch devices.
 * Writes into VirtualControlInput and edge-triggers the same interaction requests
 * the keyboard uses, so solo and multiplayer share one input path.
 */
export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly stickPad: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly handlers: TouchControlsHandlers;
  private stick: StickState | null = null;
  private jumpBoostHeld = false;
  private disposed = false;

  private readonly onStickDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (this.stick) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = this.stickPad.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.stick = { pointerId: event.pointerId, originX: x, originY: y };
    this.stickPad.setPointerCapture(event.pointerId);
    this.stickBase.classList.add('active');
    this.placeStickVisual(x, y, 0, 0);
    this.applyStick(0, 0);
  };

  private readonly onStickMove = (event: PointerEvent) => {
    if (!this.stick || event.pointerId !== this.stick.pointerId) return;
    event.preventDefault();
    const rect = this.stickPad.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - this.stick.originX;
    const dy = y - this.stick.originY;
    const dist = Math.hypot(dx, dy);
    const max = STICK_RADIUS;
    const clamped = dist > max ? max / dist : 1;
    const cx = dx * clamped;
    const cy = dy * clamped;
    this.placeStickVisual(this.stick.originX, this.stick.originY, cx, cy);
    const nx = cx / max;
    const ny = cy / max;
    const mag = Math.hypot(nx, ny);
    if (mag < DEADZONE) {
      this.applyStick(0, 0);
      return;
    }
    const scale = (mag - DEADZONE) / (1 - DEADZONE);
    this.applyStick((nx / mag) * scale, (-ny / mag) * scale);
  };

  private readonly onStickUp = (event: PointerEvent) => {
    if (!this.stick || event.pointerId !== this.stick.pointerId) return;
    event.preventDefault();
    this.clearStick();
  };

  private readonly onContextMenu = (event: Event) => {
    event.preventDefault();
  };

  constructor(parent: HTMLElement, handlers: TouchControlsHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.dataset.testid = 'touch-controls';
    this.root.setAttribute('aria-label', 'Touch controls');

    this.stickPad = document.createElement('div');
    this.stickPad.className = 'touch-stick';
    this.stickPad.dataset.testid = 'touch-joystick';
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'touch-stick__base';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'touch-stick__knob';
    this.stickBase.append(this.stickKnob);
    this.stickPad.append(this.stickBase);

    const actions = document.createElement('div');
    actions.className = 'touch-actions';
    actions.append(
      this.holdButton('Jump', 'boost', 'touch-jump', (down) => {
        this.jumpBoostHeld = down;
        this.handlers.virtual.setAxes({ lift: down ? 1 : 0, boost: down });
        this.handlers.onJumpBoost?.(down);
      }),
      this.tapButton('Grab', 'grab', 'touch-grab', () => this.handlers.onGrab()),
      this.tapButton('Yank', 'yank', 'touch-yank', () => this.handlers.onYank()),
      this.tapButton('Hack', 'hack', 'touch-hack', () => this.handlers.onInteract()),
    );
    if (handlers.solo && handlers.onSwitch) {
      actions.append(this.tapButton('Switch', 'switch', 'touch-switch', () => this.handlers.onSwitch?.()));
    }

    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'touch-pause';
    pause.dataset.testid = 'touch-pause';
    pause.setAttribute('aria-label', 'Pause');
    pause.append(controlIcon('pause', 'glyph touch-btn__glyph'));
    pause.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onPause();
    });

    this.root.append(this.stickPad, actions, pause);
    parent.append(this.root);

    this.stickPad.addEventListener('pointerdown', this.onStickDown);
    this.stickPad.addEventListener('pointermove', this.onStickMove);
    this.stickPad.addEventListener('pointerup', this.onStickUp);
    this.stickPad.addEventListener('pointercancel', this.onStickUp);
    this.root.addEventListener('contextmenu', this.onContextMenu);
    // Block page scroll / pinch-zoom while the pad is up.
    this.root.style.touchAction = 'none';
  }

  static shouldShow(): boolean {
    return isTouchPlayDevice();
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('touch-controls--hidden', !visible);
    if (!visible) {
      this.clearStick();
      if (this.jumpBoostHeld) {
        this.jumpBoostHeld = false;
        this.handlers.virtual.setAxes({ lift: 0, boost: false });
      }
    }
  }

  /** Swap the virtual stick target after a local drone switch recreates HumanControlSource. */
  rebindVirtual(virtual: VirtualControlInput): void {
    this.handlers.virtual = virtual;
    this.clearStick();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearStick();
    this.stickPad.removeEventListener('pointerdown', this.onStickDown);
    this.stickPad.removeEventListener('pointermove', this.onStickMove);
    this.stickPad.removeEventListener('pointerup', this.onStickUp);
    this.stickPad.removeEventListener('pointercancel', this.onStickUp);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
    this.root.remove();
  }

  private applyStick(strafe: number, thrust: number): void {
    this.handlers.virtual.setAxes({ strafe, thrust });
  }

  private clearStick(): void {
    this.stick = null;
    this.stickBase.classList.remove('active');
    this.stickBase.style.left = '';
    this.stickBase.style.top = '';
    this.stickKnob.style.transform = '';
    this.applyStick(0, 0);
  }

  private placeStickVisual(originX: number, originY: number, cx: number, cy: number): void {
    this.stickBase.style.left = `${originX}px`;
    this.stickBase.style.top = `${originY}px`;
    this.stickKnob.style.transform = `translate(${cx}px, ${cy}px)`;
  }

  private tapButton(label: string, glyph: string, testId: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'touch-btn';
    button.dataset.testid = testId;
    button.setAttribute('aria-label', label);
    button.append(controlIcon(glyph, 'glyph touch-btn__glyph'));
    const caption = document.createElement('span');
    caption.className = 'touch-btn__label';
    caption.textContent = label;
    button.append(caption);
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.add('is-down');
      action();
    });
    const release = (event: PointerEvent) => {
      event.preventDefault();
      button.classList.remove('is-down');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
    return button;
  }

  private holdButton(
    label: string,
    glyph: string,
    testId: string,
    onHold: (down: boolean) => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'touch-btn touch-btn--hold';
    button.dataset.testid = testId;
    button.setAttribute('aria-label', label);
    button.append(controlIcon(glyph, 'glyph touch-btn__glyph'));
    const caption = document.createElement('span');
    caption.className = 'touch-btn__label';
    caption.textContent = label;
    button.append(caption);
    const down = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      button.setPointerCapture(event.pointerId);
      button.classList.add('is-down');
      onHold(true);
    };
    const up = (event: PointerEvent) => {
      event.preventDefault();
      button.classList.remove('is-down');
      onHold(false);
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    return button;
  }
}
