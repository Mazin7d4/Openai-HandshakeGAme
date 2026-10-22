import type { CinematicCamera } from '../camera/CinematicCamera.ts';
import { controlIcon } from './ControlGlyphs.ts';
import { hapticTap } from './haptics.ts';
import { getSettings, subscribeSettings, type TouchHandedness } from './Settings.ts';
import type { VirtualControlInput } from '../input/VirtualControlInput.ts';
import { isTouchPlayDevice } from './touchDetect.ts';

export interface TouchControlsHandlers {
  virtual: VirtualControlInput;
  camera: CinematicCamera;
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

interface LookFinger {
  x: number;
  y: number;
}

const DEADZONE = 0.18;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_PX = 28;
const ROTATE_HINT_KEY = 'handshake.rotateHintDismissed';

/**
 * On-screen flight stick + action buttons + look pad for coarse-pointer / touch.
 * Joystick and look each track their own pointerId so both thumbs work together.
 */
export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly lookPad: HTMLDivElement;
  private readonly stickPad: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private readonly pause: HTMLButtonElement;
  private readonly rotateHint: HTMLDivElement;
  private readonly handlers: TouchControlsHandlers;
  private stick: StickState | null = null;
  private stickRadius = 56;
  private jumpBoostHeld = false;
  private disposed = false;
  private handedness: TouchHandedness = 'right';
  private readonly lookFingers = new Map<number, LookFinger>();
  private lookPrimaryId: number | null = null;
  private lastTapAt = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private readonly unsubSettings: () => void;

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
    hapticTap(8);
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
    const max = this.stickRadius;
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

  private readonly onLookDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // Buttons sit above the look pad and stopPropagation — we only get empty space.
    event.preventDefault();
    this.lookFingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.lookPad.setPointerCapture(event.pointerId);
    if (this.lookPrimaryId === null) this.lookPrimaryId = event.pointerId;
    this.handlers.camera.touchLookHold();

    const now = performance.now();
    const dt = now - this.lastTapAt;
    const dist = Math.hypot(event.clientX - this.lastTapX, event.clientY - this.lastTapY);
    if (dt > 0 && dt < DOUBLE_TAP_MS && dist < DOUBLE_TAP_PX && this.lookFingers.size === 1) {
      this.handlers.camera.touchRecenter();
      this.lastTapAt = 0;
      hapticTap(10);
    } else {
      this.lastTapAt = now;
      this.lastTapX = event.clientX;
      this.lastTapY = event.clientY;
    }
  };

  private readonly onLookMove = (event: PointerEvent) => {
    const prev = this.lookFingers.get(event.pointerId);
    if (!prev) return;
    event.preventDefault();
    const next = { x: event.clientX, y: event.clientY };
    if (this.lookFingers.size >= 2) {
      const others = [...this.lookFingers.entries()].filter(([id]) => id !== event.pointerId);
      const other = others[0]?.[1];
      if (other) {
        const oldDist = Math.hypot(prev.x - other.x, prev.y - other.y);
        const newDist = Math.hypot(next.x - other.x, next.y - other.y);
        this.handlers.camera.touchZoom(oldDist - newDist);
      }
    } else if (event.pointerId === this.lookPrimaryId) {
      this.handlers.camera.touchLook(next.x - prev.x, next.y - prev.y);
    }
    this.lookFingers.set(event.pointerId, next);
  };

  private readonly onLookUp = (event: PointerEvent) => {
    if (!this.lookFingers.has(event.pointerId)) return;
    event.preventDefault();
    this.lookFingers.delete(event.pointerId);
    if (this.lookPrimaryId === event.pointerId) {
      this.lookPrimaryId = this.lookFingers.keys().next().value ?? null;
    }
    if (this.lookFingers.size === 0) {
      this.handlers.camera.touchLookRelease();
    }
  };

  private readonly onContextMenu = (event: Event) => {
    event.preventDefault();
  };

  private readonly onSelectStart = (event: Event) => {
    event.preventDefault();
  };

  constructor(parent: HTMLElement, handlers: TouchControlsHandlers) {
    this.handlers = handlers;
    const settings = getSettings();
    this.handedness = settings.touchHandedness;

    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.dataset.testid = 'touch-controls';
    this.root.setAttribute('aria-label', 'Touch controls');
    this.root.dataset.handedness = this.handedness;

    this.lookPad = document.createElement('div');
    this.lookPad.className = 'touch-look';
    this.lookPad.dataset.testid = 'touch-look';
    this.lookPad.setAttribute('aria-label', 'Look');

    this.stickPad = document.createElement('div');
    this.stickPad.className = 'touch-stick';
    this.stickPad.dataset.testid = 'touch-joystick';
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'touch-stick__base';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'touch-stick__knob';
    this.stickBase.append(this.stickKnob);
    this.stickPad.append(this.stickBase);

    this.actions = document.createElement('div');
    this.actions.className = 'touch-actions';
    this.actions.append(
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
      this.actions.append(this.tapButton('Switch', 'switch', 'touch-switch', () => this.handlers.onSwitch?.()));
    }

    this.pause = document.createElement('button');
    this.pause.type = 'button';
    this.pause.className = 'touch-pause';
    this.pause.dataset.testid = 'touch-pause';
    this.pause.setAttribute('aria-label', 'Pause');
    this.pause.append(controlIcon('pause', 'glyph touch-btn__glyph'));
    this.pause.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.pause.classList.add('is-down');
      hapticTap(12);
      this.handlers.onPause();
    });
    const pauseUp = () => this.pause.classList.remove('is-down');
    this.pause.addEventListener('pointerup', pauseUp);
    this.pause.addEventListener('pointercancel', pauseUp);

    this.rotateHint = document.createElement('div');
    this.rotateHint.className = 'touch-rotate-hint';
    this.rotateHint.dataset.testid = 'touch-rotate-hint';
    this.rotateHint.innerHTML = '<p>Rotate for best play</p>';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn btn--quiet touch-rotate-hint__dismiss';
    dismiss.textContent = 'Got it';
    dismiss.addEventListener('click', () => this.dismissRotateHint());
    this.rotateHint.append(dismiss);

    this.root.append(this.lookPad, this.stickPad, this.actions, this.pause, this.rotateHint);
    parent.append(this.root);

    this.applyLayout(settings.touchHandedness);
    this.applyOpacity(settings.touchOpacity);
    this.updateStickRadius();
    this.syncRotateHint();

    this.stickPad.addEventListener('pointerdown', this.onStickDown);
    this.stickPad.addEventListener('pointermove', this.onStickMove);
    this.stickPad.addEventListener('pointerup', this.onStickUp);
    this.stickPad.addEventListener('pointercancel', this.onStickUp);
    this.lookPad.addEventListener('pointerdown', this.onLookDown);
    this.lookPad.addEventListener('pointermove', this.onLookMove);
    this.lookPad.addEventListener('pointerup', this.onLookUp);
    this.lookPad.addEventListener('pointercancel', this.onLookUp);
    this.root.addEventListener('contextmenu', this.onContextMenu);
    this.root.addEventListener('selectstart', this.onSelectStart);
    this.root.style.touchAction = 'none';

    this.unsubSettings = subscribeSettings((next) => {
      this.applyLayout(next.touchHandedness);
      this.applyOpacity(next.touchOpacity);
    });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onOrientation);
  }

  private readonly onResize = () => {
    this.updateStickRadius();
    this.syncRotateHint();
  };

  private readonly onOrientation = () => {
    this.syncRotateHint();
  };

  static shouldShow(): boolean {
    return isTouchPlayDevice();
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('touch-controls--hidden', !visible);
    if (!visible) {
      this.clearStick();
      this.lookFingers.clear();
      this.lookPrimaryId = null;
      this.handlers.camera.touchLookRelease();
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
    this.unsubSettings();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onOrientation);
    this.stickPad.removeEventListener('pointerdown', this.onStickDown);
    this.stickPad.removeEventListener('pointermove', this.onStickMove);
    this.stickPad.removeEventListener('pointerup', this.onStickUp);
    this.stickPad.removeEventListener('pointercancel', this.onStickUp);
    this.lookPad.removeEventListener('pointerdown', this.onLookDown);
    this.lookPad.removeEventListener('pointermove', this.onLookMove);
    this.lookPad.removeEventListener('pointerup', this.onLookUp);
    this.lookPad.removeEventListener('pointercancel', this.onLookUp);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
    this.root.removeEventListener('selectstart', this.onSelectStart);
    this.root.remove();
  }

  private applyLayout(handedness: TouchHandedness): void {
    this.handedness = handedness;
    this.root.dataset.handedness = handedness;
    this.root.classList.toggle('touch-controls--left', handedness === 'left');
    this.root.classList.toggle('touch-controls--right', handedness === 'right');
  }

  private applyOpacity(opacity: number): void {
    this.root.style.setProperty('--touch-opacity', String(Math.max(0.35, Math.min(1, opacity))));
  }

  private updateStickRadius(): void {
    const btn = Number.parseFloat(getComputedStyle(this.root).getPropertyValue('--touch-btn')) || 56;
    this.stickRadius = Math.max(56, btn);
  }

  private syncRotateHint(): void {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(ROTATE_HINT_KEY) === '1';
    } catch {
      dismissed = false;
    }
    this.rotateHint.classList.toggle('visible', portrait && !dismissed);
  }

  private dismissRotateHint(): void {
    try {
      localStorage.setItem(ROTATE_HINT_KEY, '1');
    } catch {
      // Private mode
    }
    this.rotateHint.classList.remove('visible');
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
      hapticTap(12);
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
      hapticTap(10);
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
