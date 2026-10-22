export type TouchHandedness = 'right' | 'left';

export interface GameSettings {
  masterVolume: number; // 0..100
  lookSensitivity: number; // 0.25..2
  screenShake: boolean;
  /** Stick on the left (right) or right (left-handed). */
  touchHandedness: TouchHandedness;
  /** On-screen control opacity 0.35..1. */
  touchOpacity: number;
}

const STORAGE_KEY = 'handshake.settings';

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 80,
  lookSensitivity: 1.0,
  screenShake: true,
  touchHandedness: 'right',
  touchOpacity: 0.85,
};

type SettingsListener = (settings: GameSettings) => void;
const listeners = new Set<SettingsListener>();

let currentSettings: GameSettings = loadSettings();

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      masterVolume: typeof parsed?.masterVolume === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.masterVolume)))
        : DEFAULT_SETTINGS.masterVolume,
      lookSensitivity: typeof parsed?.lookSensitivity === 'number'
        ? Math.max(0.25, Math.min(2, Number(parsed.lookSensitivity)))
        : DEFAULT_SETTINGS.lookSensitivity,
      screenShake: typeof parsed?.screenShake === 'boolean'
        ? parsed.screenShake
        : DEFAULT_SETTINGS.screenShake,
      touchHandedness: parsed?.touchHandedness === 'left' || parsed?.touchHandedness === 'right'
        ? parsed.touchHandedness
        : DEFAULT_SETTINGS.touchHandedness,
      touchOpacity: typeof parsed?.touchOpacity === 'number'
        ? Math.max(0.35, Math.min(1, Number(parsed.touchOpacity)))
        : DEFAULT_SETTINGS.touchOpacity,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function getSettings(): GameSettings {
  return { ...currentSettings };
}

export function saveSettings(partial: Partial<GameSettings>): GameSettings {
  currentSettings = { ...currentSettings, ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  } catch {
    // Private mode / storage quota exceeded
  }
  for (const listener of listeners) {
    try {
      listener(currentSettings);
    } catch {
      // Listener error
    }
  }
  return { ...currentSettings };
}

export function subscribeSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
