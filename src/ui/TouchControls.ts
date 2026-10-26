import type { CinematicCamera } from '../camera/CinematicCamera.ts';
import { controlIcon } from './ControlGlyphs.ts';
import { hapticTap } from './haptics.ts';
import { getSettings, subscribeSettings, type TouchHandedness } from './Settings.ts';
import type { VirtualControlInput } from '../input/VirtualControlInput.ts';
import { isTouchPlayDevice } from './touchDetect.ts';
import type { EmoteId } from '../network/NetworkTypes.ts';

export interface TouchControlsHandlers {
  virtual: VirtualControlInput;
  camera: CinematicCamera;
  onJumpBoost?: (down: boolean) => void;
  onGrab: () => void;
  onThrow?: () => void;
  onYank: () => void;
  onInteract: () => void;
  onPause: () => void;
  onSwitch?: () => void;
  onPing?: () => void;
  onEmote?: (id: EmoteId) => void;
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
  private readonly radial: HTMLDivElement;
  private readonly carryButton: HTMLButtonElement;
  private readonly throwButton: HTMLButtonElement;
  private readonly liftHolds = new Set<HTMLButtonElement>();
  private emotePointer: { id: number; started: number; moved: boolean; selected: EmoteId | null } | null = null;

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
    this.carryButton = this.tapButton('Grab', 'grab', 'touch-grab', () => this.handlers.onGrab());
    this.throwButton = this.tapButton('Throw', 'grab', 'touch-throw', () => this.handlers.onThrow?.());
    this.throwButton.classList.add('touch-carry-throw');
    this.throwButton.hidden = true;
    this.actions.append(
      this.holdButton('Jump', 'boost', 'touch-jump', (down) => {
        this.jumpBoostHeld = down;
        this.handlers.virtual.setAxes({ lift: down ? 1 : 0, boost: down });
        this.handlers.onJumpBoost?.(down);
      }),
      this.holdButton('Up', 'updown', 'touch-up', (down) => this.setLiftHold('touch-up', down, 1)),
      this.holdButton('Down', 'updown', 'touch-down', (down) => this.setLiftHold('touch-down', down, -1)),
      this.carryButton,
      this.throwButton,
      this.tapButton('Yank', 'yank', 'touch-yank', () => this.handlers.onYank()),
      this.tapButton('Hack', 'hack', 'touch-hack', () => this.handlers.onInteract()),
      this.tapButton('Ping', 'ping', 'touch-ping', () => this.handlers.onPing?.()),
      this.emoteButton(),
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
    this.rotateHint.innerHTML = '<div class="touch-rotate-hint__icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M14 19a15 15 0 1 1-1 13"/><path d="M14 10v9h9"/></svg></div><strong>Rotate your phone</strong><p>PIX &amp; NEE play best sideways</p>';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn btn--quiet touch-rotate-hint__dismiss';
    dismiss.textContent = 'Got it';
    dismiss.addEventListener('click', () => this.dismissRotateHint());
    this.rotateHint.append(dismiss);

    this.radial = document.createElement('div');
    this.radial.className = 'emote-radial';
    this.radial.dataset.testid = 'emote-radial';
    this.radial.setAttribute('aria-label', 'Emotes');
    for (const [id, label] of [['here', 'Here!'], ['wait', 'Wait'], ['go', 'Go!'], ['yay', 'Yay']] as const) {
      const item = document.createElement('button');
      item.type = 'button'; item.className = `emote-radial__item emote-radial__item--${id}`;
      item.dataset.testid = `emote-${id}`; item.setAttribute('aria-label', label); item.textContent = label;
      item.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); this.handlers.onEmote?.(id); this.closeRadial(); });
      this.radial.append(item);
    }

    this.root.append(this.lookPad, this.stickPad, this.actions, this.pause);
    // Radial and rotate hint live outside the touch layer's stacking context: the
    // radial must remain tappable, while the rotate hint must sit above every HUD card.
    parent.append(this.radial);
    document.addEventListener('pointerdown', this.onOutsidePointer, true);
    parent.append(this.root);
    parent.append(this.rotateHint);

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
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onResize = () => {
    this.updateStickRadius();
    this.syncRotateHint();
  };

  private readonly onOrientation = () => {
    this.syncRotateHint();
  };

  private readonly onVisibilityChange = () => {
    if (document.hidden) this.clearLiftHolds();
  };

  static shouldShow(): boolean {
    return isTouchPlayDevice();
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('touch-controls--hidden', !visible);
    this.rotateHint.classList.toggle('touch-rotate-hint--hidden', !visible);
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

  /** Keep carry actions in the touch action cluster instead of the world prompt. */
  setCarryState(carrying: boolean, pass = false): void {
    this.root.classList.toggle('touch-controls--carrying', carrying);
    const label = pass ? 'Pass' : 'Drop';
    this.carryButton.hidden = false;
    this.carryButton.dataset.carrying = carrying ? '1' : '0';
    this.carryButton.setAttribute('aria-label', carrying ? label : 'Grab');
    const caption = this.carryButton.querySelector('.touch-btn__label');
    if (caption) caption.textContent = carrying ? label : 'Grab';
    this.carryButton.querySelector('.touch-btn__glyph')?.setAttribute('data-carry', carrying ? label.toLowerCase() : 'grab');
    this.throwButton.hidden = !carrying;
  }

  /** Swap the virtual stick target after a local drone switch recreates HumanControlSource. */
  rebindVirtual(virtual: VirtualControlInput): void {
    this.handlers.virtual = virtual;
    this.clearStick();
  }

  dispose(): void {
    document.removeEventListener('pointerdown', this.onOutsidePointer, true);
    this.radial.remove();
    this.rotateHint.remove();
    if (this.disposed) return;
    this.disposed = true;
    this.clearStick();
    this.unsubSettings();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onOrientation);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
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

  private setLiftHold(testId: string, down: boolean, value: number): void {
    const button = this.root.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (!button) return;
    button.dataset.lift = value < 0 ? 'down' : 'up';
    if (down) this.liftHolds.add(button); else this.liftHolds.delete(button);
    const current = [...this.liftHolds].reduce((sum, item) => sum + (item.dataset.lift === 'down' ? -1 : 1), 0);
    this.handlers.virtual.setAxes({ lift: Math.max(-1, Math.min(1, current)) });
  }

  private clearLiftHolds(): void {
    this.liftHolds.clear();
    this.root.querySelectorAll<HTMLButtonElement>('[data-testid="touch-up"], [data-testid="touch-down"]').forEach((button) => {
      button.classList.remove('is-down');
      delete button.dataset.lift;
    });
    this.handlers.virtual.setAxes({ lift: 0 });
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

  private emoteButton(): HTMLButtonElement {
    const button = this.tapButton('Emote', 'happy', 'touch-emote', () => this.openRadial(true));
    // No stopPropagation here: in the capture pass it would skip tapButton's own pointerdown (which opens the radial).
    button.addEventListener('pointerdown', (event) => {
      this.emotePointer = { id: event.pointerId, started: performance.now(), moved: false, selected: null };
      try { button.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
      window.setTimeout(() => { if (this.emotePointer?.id === event.pointerId && performance.now() - this.emotePointer.started >= 250) this.openRadial(false); }, 260);
    }, { capture: true });
    button.addEventListener('pointermove', (event) => {
      if (!this.emotePointer || event.pointerId !== this.emotePointer.id) return;
      const dx = event.clientX - button.getBoundingClientRect().left - button.offsetWidth / 2;
      const dy = event.clientY - button.getBoundingClientRect().top - button.offsetHeight / 2;
      if (Math.hypot(dx, dy) < 18) return;
      this.emotePointer.moved = true;
      const angle = Math.atan2(dy, dx);
      this.emotePointer.selected = angle > -Math.PI / 4 && angle <= Math.PI / 4 ? 'go' : angle > Math.PI / 4 && angle <= 3 * Math.PI / 4 ? 'wait' : angle < -Math.PI / 4 && angle >= -3 * Math.PI / 4 ? 'here' : 'yay';
    });
    const up = (event: PointerEvent) => {
      if (!this.emotePointer || event.pointerId !== this.emotePointer.id) return;
      const state = this.emotePointer; this.emotePointer = null;
      const over = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('.emote-radial__item');
      const overId = over?.dataset.testid?.replace('emote-', '') as EmoteId | undefined;
      const choice = overId ?? (state.moved ? state.selected : null);
      if (choice && this.radial.classList.contains('visible')) this.handlers.onEmote?.(choice);
      if (choice) { this.closeRadial(); return; }
      if (state.moved || performance.now() - state.started >= 250) this.closeRadial();
    };
    button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up);
    return button;
  }

  private readonly onOutsidePointer = (event: PointerEvent) => {
    if (!this.radial.classList.contains('visible') || this.radial.dataset.sticky !== '1') return;
    const target = event.target as Node | null;
    if (target && (this.radial.contains(target) || (target as HTMLElement).closest?.('[data-testid="touch-emote"]'))) return;
    this.closeRadial();
  };

  private openRadial(sticky: boolean): void { this.radial.classList.add('visible'); this.radial.dataset.sticky = sticky ? '1' : '0'; }
  private closeRadial(): void { this.radial.classList.remove('visible'); }

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
      try { button.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
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
    button.addEventListener('lostpointercapture', up);
    if (testId === 'touch-up' || testId === 'touch-down') {
      button.dataset.lift = testId === 'touch-down' ? 'down' : 'up';
    }
    return button;
  }
}
