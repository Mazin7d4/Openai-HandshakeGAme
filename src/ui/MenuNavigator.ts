/**
 * Keyboard + Gamepad focus for modal menus (title, pause, settings, heist report).
 * Tab / Shift-Tab walk focusables; Enter / Space activate; Esc backs out.
 * Standard Gamepad: D-pad / left stick move focus, A confirms, B backs out.
 */
import { markGamepadActivity } from './inputHints.ts';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const BTN_A = 0;
const BTN_B = 1;
const BTN_UP = 12;
const BTN_DOWN = 13;
const BTN_LEFT = 14;
const BTN_RIGHT = 15;
const AXIS_DEADZONE = 0.55;
const REPEAT_MS = 220;

export interface MenuNavigatorOptions {
  /** Esc / B — return to previous screen. */
  onBack?: () => void;
  /** Prefer this element (or first matching selector) when the screen opens. */
  initialFocus?: HTMLElement | string | null;
  /** When true (default), Tab wraps within the root instead of leaving the dialog. */
  trapTab?: boolean;
}

export class MenuNavigator {
  private root: HTMLElement | null = null;
  private options: MenuNavigatorOptions = {};
  private raf = 0;
  private lastNavAt = 0;
  private prevPressed = new Set<number>();
  private prevAxisActive = false;
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKey(event);

  attach(root: HTMLElement, options: MenuNavigatorOptions = {}): void {
    this.detach();
    this.root = root;
    this.options = options;
    window.addEventListener('keydown', this.onKeyDown, true);
    this.focusInitial();
    this.raf = window.requestAnimationFrame(() => this.pollGamepad());
  }

  detach(): void {
    this.root?.classList.remove('menu-gamepad-focus');
    window.removeEventListener('keydown', this.onKeyDown, true);
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.root = null;
    this.options = {};
    this.prevPressed.clear();
    this.prevAxisActive = false;
  }

  /** Re-focus the primary control after the panel contents change. */
  focusInitial(): void {
    if (!this.root) return;
    const prefer = this.options.initialFocus;
    let target: HTMLElement | null = null;
    if (typeof prefer === 'string') {
      target = this.root.querySelector(prefer);
    } else if (prefer instanceof HTMLElement && this.root.contains(prefer)) {
      target = prefer;
    }
    if (!target) {
      target = this.root.querySelector<HTMLElement>('.btn--primary, [data-primary-focus]')
        ?? this.focusables()[0]
        ?? null;
    }
    target?.focus();
  }

  private focusables(): HTMLElement[] {
    if (!this.root) return [];
    return [...this.root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
      if (el.tabIndex < 0) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      return el.checkVisibility({ visibilityProperty: true }) && !el.hasAttribute('disabled');
    });
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.root?.isConnected) return;
    this.root.classList.remove('menu-gamepad-focus');
    const active = document.activeElement;

    if (event.code === 'Escape') {
      if (!this.options.onBack) return;
      event.preventDefault();
      event.stopPropagation();
      this.options.onBack();
      return;
    }

    if (event.code === 'Tab' && this.options.trapTab !== false) {
      const items = this.focusables();
      if (items.length === 0) return;
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        const prev = index <= 0 ? items[items.length - 1]! : items[index - 1]!;
        prev.focus();
      } else {
        const next = index < 0 || index >= items.length - 1 ? items[0]! : items[index + 1]!;
        next.focus();
      }
    }
  }

  private pollGamepad(): void {
    if (!this.root?.isConnected) {
      this.raf = 0;
      return;
    }
    this.raf = window.requestAnimationFrame(() => this.pollGamepad());

    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate?.connected) {
        pad = candidate;
        break;
      }
    }
    if (!pad) return;

    const pressed = (i: number) => Boolean(pad!.buttons[i]?.pressed);
    const nowPressed = new Set<number>();
    for (const i of [BTN_A, BTN_B, BTN_UP, BTN_DOWN, BTN_LEFT, BTN_RIGHT]) {
      if (pressed(i)) nowPressed.add(i);
    }
    const rose = (i: number) => nowPressed.has(i) && !this.prevPressed.has(i);

    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    let dirX = 0;
    let dirY = 0;
    if (nowPressed.has(BTN_LEFT) || axisX < -AXIS_DEADZONE) dirX = -1;
    else if (nowPressed.has(BTN_RIGHT) || axisX > AXIS_DEADZONE) dirX = 1;
    if (nowPressed.has(BTN_UP) || axisY < -AXIS_DEADZONE) dirY = -1;
    else if (nowPressed.has(BTN_DOWN) || axisY > AXIS_DEADZONE) dirY = 1;

    const axisActive = Math.abs(axisX) > AXIS_DEADZONE || Math.abs(axisY) > AXIS_DEADZONE;
    const axisEdge = axisActive && !this.prevAxisActive;
    const dpadEdge = rose(BTN_UP) || rose(BTN_DOWN) || rose(BTN_LEFT) || rose(BTN_RIGHT);
    const aPress = rose(BTN_A);
    const bPress = rose(BTN_B);

    this.prevPressed = nowPressed;
    this.prevAxisActive = axisActive;

    if (!(aPress || bPress || dpadEdge || axisEdge || (axisActive && (dirX || dirY)))) return;
    markGamepadActivity();
    this.root.classList.add('menu-gamepad-focus');

    if (bPress && this.options.onBack) {
      this.options.onBack();
      return;
    }

    if (aPress) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.root.contains(active)) {
        active.click();
      }
      return;
    }

    const now = performance.now();
    const shouldStep = dpadEdge || axisEdge || (axisActive && now - this.lastNavAt > REPEAT_MS);
    if ((dirX || dirY) && shouldStep) {
      if (dirX && !dirY && this.adjustControl(dirX)) {
        this.lastNavAt = now;
        return;
      }
      const delta = dirY !== 0 ? dirY : dirX;
      if (delta !== 0) {
        this.moveFocus(delta);
        this.lastNavAt = now;
      }
    }
  }

  /** Horizontal gamepad input edits native settings without moving focus away. */
  private adjustControl(delta: number): boolean {
    const active = document.activeElement;
    if (!active || !this.root?.contains(active)) return false;
    if (active instanceof HTMLInputElement && active.type === 'range') {
      if (delta > 0) active.stepUp(); else active.stepDown();
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (active instanceof HTMLSelectElement) {
      active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + delta));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  private moveFocus(delta: number): void {
    const items = this.focusables();
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    let index = active && this.root?.contains(active) ? items.indexOf(active) : -1;
    if (index < 0) index = delta > 0 ? -1 : 0;
    const next = items[(index + delta + items.length * 8) % items.length]!;
    next.focus();
  }
}

/** Shared navigator for title-screen menus (one active at a time). */
export const titleMenuNav = new MenuNavigator();
