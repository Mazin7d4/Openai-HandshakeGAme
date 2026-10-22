export interface GameSettings {
  masterVolume: number; // 0..100
  lookSensitivity: number; // 0.25..2
  screenShake: boolean;
  graphicsQuality: GraphicsQualitySetting;
}

export type GraphicsQualitySetting = 'auto' | 'low' | 'medium' | 'high';

const STORAGE_KEY = 'handshake.settings';

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 80,
  lookSensitivity: 1.0,
  screenShake: true,
  graphicsQuality: 'auto',
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
      graphicsQuality: ['auto', 'low', 'medium', 'high'].includes(parsed?.graphicsQuality)
        ? parsed.graphicsQuality
        : DEFAULT_SETTINGS.graphicsQuality,
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
