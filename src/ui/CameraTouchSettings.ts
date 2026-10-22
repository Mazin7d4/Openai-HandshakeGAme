/**
 * Touch-camera look settings. Persisted under dedicated keys so the settings-menu
 * PR can bind sliders without colliding with handshake.settings.
 *
 * Keys: `pixnee.touch.camSensitivity`, `pixnee.touch.invertY`
 */
export interface CameraTouchSettingsState {
  camSensitivity: number; // 0.25..2
  invertY: boolean;
}

const KEY_SENSITIVITY = 'pixnee.touch.camSensitivity';
const KEY_INVERT_Y = 'pixnee.touch.invertY';

export const DEFAULT_CAMERA_TOUCH: CameraTouchSettingsState = {
  camSensitivity: 1,
  invertY: false,
};

type Listener = (settings: CameraTouchSettingsState) => void;
const listeners = new Set<Listener>();

let current: CameraTouchSettingsState = loadCameraTouchSettings();

function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function loadCameraTouchSettings(): CameraTouchSettingsState {
  return {
    camSensitivity: readNumber(KEY_SENSITIVITY, DEFAULT_CAMERA_TOUCH.camSensitivity, 0.25, 2),
    invertY: readBool(KEY_INVERT_Y, DEFAULT_CAMERA_TOUCH.invertY),
  };
}

export function getCameraTouchSettings(): CameraTouchSettingsState {
  return { ...current };
}

export function saveCameraTouchSettings(partial: Partial<CameraTouchSettingsState>): CameraTouchSettingsState {
  current = {
    camSensitivity: partial.camSensitivity !== undefined
      ? Math.min(2, Math.max(0.25, Number(partial.camSensitivity)))
      : current.camSensitivity,
    invertY: partial.invertY !== undefined ? Boolean(partial.invertY) : current.invertY,
  };
  try {
    localStorage.setItem(KEY_SENSITIVITY, String(current.camSensitivity));
    localStorage.setItem(KEY_INVERT_Y, current.invertY ? '1' : '0');
  } catch {
    // Private mode / quota
  }
  const snapshot = { ...current };
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // Listener error
    }
  }
  // DOM-friendly change event for external binders.
  try {
    window.dispatchEvent(new CustomEvent('pixnee:touch-camera-settings', { detail: snapshot }));
  } catch {
    // SSR / no window
  }
  return snapshot;
}

export function subscribeCameraTouchSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
