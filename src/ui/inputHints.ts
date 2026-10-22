import { isTouchPlayDevice } from './touchDetect.ts';

export type InputKind = 'keyboard' | 'touch' | 'gamepad';

let currentKind: InputKind = isTouchPlayDevice() ? 'touch' : 'keyboard';
let listenersInstalled = false;

function ensureListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;

  window.addEventListener('keydown', () => {
    currentKind = 'keyboard';
  }, { passive: true });

  window.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      currentKind = 'touch';
    } else if (e.pointerType === 'mouse') {
      currentKind = 'keyboard';
    }
  }, { passive: true });

  window.addEventListener('gamepadconnected', () => {
    currentKind = 'gamepad';
  }, { passive: true });
}

export function inputKind(): InputKind {
  ensureListeners();
  return currentKind;
}

export function byInput(text: { keyboard: string; touch: string; gamepad?: string }): string {
  const kind = inputKind();
  if (kind === 'gamepad') {
    return text.gamepad ?? text.touch;
  }
  return text[kind];
}
