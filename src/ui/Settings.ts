/** Persisted player preferences. Applied live via subscribeSettings / applyDocumentSettings. */

export type TouchHandedness = 'right' | 'left';
export type GraphicsQualitySetting = 'auto' | 'low' | 'medium' | 'high';
/** @deprecated Prefer GraphicsQualitySetting — alias kept for SettingsMenu call sites. */
export type GraphicsQuality = GraphicsQualitySetting;
export type UiScale = 100 | 125 | 150;

export interface GameSettings {
  // Audio (0..100) — master syncs with AudioManager; music/sfx/ui live on the hub
  masterVolume: number;
  lookSensitivity: number;
  screenShake: boolean;
  graphicsQuality: GraphicsQualitySetting;
  /** Stick on the left (right) or right (left-handed). */
  touchHandedness: TouchHandedness;
  /** On-screen control opacity 0.35..1. */
  touchOpacity: number;
  /** Multiplier on cinematic FOV (0.85..1.2). */
  fovScale: number;
  /** Multiplier on follow distance (0.85..1.25). */
  cameraDistance: number;
  /**
   * Reduced motion: also respects prefers-reduced-motion when unset.
   * Persisted under pixnee.a11y.reducedMotion.
   */
  reducedMotion: boolean;
  /** UI text size 100 / 125 / 150%. Persisted under pixnee.a11y.uiScale. */
  uiScale: UiScale;
  /** Short in-run objective banner. Persisted under pixnee.ui.objectives. */
  objectives: boolean;
  highContrastHud: boolean;
  // Accessibility
  /** Colourblind-safe alarm / security cues. Persisted under pixnee.a11y.colourBlindSafe. */
  colourBlindSafe: boolean;
  /** Existing visual alerts option — not duplicated under pixnee.a11y.*. */
  visualAudioAlerts: boolean;
  subtitles: boolean;
  /** Boost becomes toggle; grab becomes hold-to-grab / release-to-drop. */
  holdToToggle: boolean;
  /** Mouse look invert Y (touch invert lives in CameraTouchSettings). */
  invertY: boolean;
}

const STORAGE_KEY = 'handshake.settings';

/** Dedicated a11y keys (acceptance: pixnee.a11y.*). */
export const A11Y_KEYS = {
  reducedMotion: 'pixnee.a11y.reducedMotion',
  colourBlindSafe: 'pixnee.a11y.colourBlindSafe',
  uiScale: 'pixnee.a11y.uiScale',
} as const;
export const UI_KEYS = { objectives: 'pixnee.ui.objectives' } as const;

const OS_REDUCED_MOTION = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 80,
  lookSensitivity: 1,
  screenShake: true,
  graphicsQuality: 'auto',
  touchHandedness: 'right',
  touchOpacity: 0.85,
  fovScale: 1,
  cameraDistance: 1,
  reducedMotion: false,
  uiScale: 100,
  objectives: true,
  highContrastHud: false,
  colourBlindSafe: false,
  visualAudioAlerts: false,
  subtitles: false,
  holdToToggle: false,
  invertY: false,
};

type SettingsListener = (settings: GameSettings) => void;
const listeners = new Set<SettingsListener>();

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function parseQuality(v: unknown): GraphicsQualitySetting {
  return v === 'auto' || v === 'low' || v === 'medium' || v === 'high' ? v : DEFAULT_SETTINGS.graphicsQuality;
}

function parseUiScale(v: unknown): UiScale {
  const n = typeof v === 'string' ? Number(v) : v;
  return n === 100 || n === 125 || n === 150 ? n : DEFAULT_SETTINGS.uiScale;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / storage quota
  }
}

/** Read a dedicated a11y flag; null means “not set in pixnee.a11y.*”. */
function readA11yBool(key: string): boolean | null {
  const raw = readStorage(key);
  if (raw === null) return null;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

function readA11yUiScale(): UiScale | null {
  const raw = readStorage(A11Y_KEYS.uiScale);
  if (raw === null) return null;
  return parseUiScale(raw);
}

function persistA11yKeys(settings: GameSettings): void {
  writeStorage(A11Y_KEYS.reducedMotion, settings.reducedMotion ? '1' : '0');
  writeStorage(A11Y_KEYS.colourBlindSafe, settings.colourBlindSafe ? '1' : '0');
  writeStorage(A11Y_KEYS.uiScale, String(settings.uiScale));
}

function persistUiKeys(settings: GameSettings): void {
  writeStorage(UI_KEYS.objectives, settings.objectives ? '1' : '0');
}

export function loadSettings(): GameSettings {
  const reducedDefault = OS_REDUCED_MOTION();
  let fromBlob: Partial<GameSettings> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      fromBlob = {
        masterVolume: Math.round(num(parsed.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 100)),
        lookSensitivity: num(parsed.lookSensitivity, DEFAULT_SETTINGS.lookSensitivity, 0.25, 2),
        screenShake: bool(parsed.screenShake, DEFAULT_SETTINGS.screenShake),
        graphicsQuality: parseQuality(parsed.graphicsQuality),
        touchHandedness: parsed.touchHandedness === 'left' || parsed.touchHandedness === 'right'
          ? parsed.touchHandedness
          : DEFAULT_SETTINGS.touchHandedness,
        touchOpacity: num(parsed.touchOpacity, DEFAULT_SETTINGS.touchOpacity, 0.35, 1),
        fovScale: num(parsed.fovScale, DEFAULT_SETTINGS.fovScale, 0.85, 1.2),
        cameraDistance: num(parsed.cameraDistance, DEFAULT_SETTINGS.cameraDistance, 0.85, 1.25),
        reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : reducedDefault,
        uiScale: parseUiScale(parsed.uiScale),
        objectives: bool(parsed.objectives, DEFAULT_SETTINGS.objectives),
        highContrastHud: bool(parsed.highContrastHud, DEFAULT_SETTINGS.highContrastHud),
        colourBlindSafe: bool(parsed.colourBlindSafe, DEFAULT_SETTINGS.colourBlindSafe),
        visualAudioAlerts: bool(parsed.visualAudioAlerts, DEFAULT_SETTINGS.visualAudioAlerts),
        subtitles: bool(parsed.subtitles, DEFAULT_SETTINGS.subtitles),
        holdToToggle: bool(parsed.holdToToggle, DEFAULT_SETTINGS.holdToToggle),
        invertY: bool(parsed.invertY, DEFAULT_SETTINGS.invertY),
      };
    }
  } catch {
    fromBlob = {};
  }

  const a11yReduced = readA11yBool(A11Y_KEYS.reducedMotion);
  const a11yColour = readA11yBool(A11Y_KEYS.colourBlindSafe);
  const a11yScale = readA11yUiScale();
  const uiObjectives = readA11yBool(UI_KEYS.objectives);

  return {
    ...DEFAULT_SETTINGS,
    ...fromBlob,
    reducedMotion: a11yReduced ?? fromBlob.reducedMotion ?? reducedDefault,
    colourBlindSafe: a11yColour ?? fromBlob.colourBlindSafe ?? DEFAULT_SETTINGS.colourBlindSafe,
    uiScale: a11yScale ?? fromBlob.uiScale ?? DEFAULT_SETTINGS.uiScale,
    objectives: uiObjectives ?? fromBlob.objectives ?? DEFAULT_SETTINGS.objectives,
  };
}

let currentSettings: GameSettings = loadSettings();

export function getSettings(): GameSettings {
  return { ...currentSettings };
}

/** Effective reduced motion: settings flag OR OS preference. */
export function effectiveReducedMotion(settings: GameSettings = currentSettings): boolean {
  return settings.reducedMotion || OS_REDUCED_MOTION();
}

/** DOM / CSS side-effects for settings that do not need a game systems subscriber. */
export function applyDocumentSettings(settings: GameSettings = currentSettings): void {
  const root = document.documentElement;
  const reduced = effectiveReducedMotion(settings);
  root.dataset.uiScale = String(settings.uiScale);
  root.dataset.highContrast = settings.highContrastHud ? '1' : '0';
  root.dataset.colourBlind = settings.colourBlindSafe ? '1' : '0';
  root.dataset.reducedMotion = reduced ? '1' : '0';
  root.style.setProperty('--ui-scale', String(settings.uiScale / 100));
  window.dispatchEvent(new CustomEvent('handshake:graphics-quality', {
    detail: { quality: settings.graphicsQuality },
  }));
  window.dispatchEvent(new CustomEvent('handshake:settings', { detail: settings }));
}

export function saveSettings(partial: Partial<GameSettings>): GameSettings {
  currentSettings = { ...currentSettings, ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  } catch {
    // Private mode / storage quota
  }
  persistA11yKeys(currentSettings);
  persistUiKeys(currentSettings);
  applyDocumentSettings(currentSettings);
  for (const listener of listeners) {
    try {
      listener(currentSettings);
    } catch {
      // Listener error must not break saves
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

// Apply once on module load so title screen / early UI pick up saved prefs.
persistA11yKeys(currentSettings);
persistUiKeys(currentSettings);
applyDocumentSettings(currentSettings);
