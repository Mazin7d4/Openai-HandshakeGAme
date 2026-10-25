import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import type { Engine } from '@babylonjs/core/Engines/engine.js';
import type { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import type { Light } from '@babylonjs/core/Lights/light.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { getSettings, subscribeSettings, type GraphicsQualitySetting } from '../ui/Settings.ts';

/**
 * Automatic graphics tiers. Judges play on unknown laptops and phones, often without a GPU, so we
 * (1) guess a starting tier from the device at boot and (2) run a slow FPS governor that steps down
 * fast and up cautiously. Only render cost changes: resolution, shadows, glow, accent lights.
 * Gameplay, physics, camera and mascot materials are untouched.
 *
 * Overrides, strongest first: `?lowfx` (low, locked) · `?quality=low|medium|high` (locked) ·
 * Settings → GRAPHICS QUALITY (low/medium/high locks, AUTO = governor). `?scale=N` still forces
 * the resolution divisor in every tier.
 */
export type QualityTier = 'low' | 'medium' | 'high';
const TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

export interface DeviceGuess { tier: QualityTier; reason: string; renderer: string; software: boolean; mobile: boolean }

const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
const forcedScale = Math.min(6, Math.max(1, Number(params.get('scale')) || 1));
const urlTier = ((): QualityTier | null => {
  if (params.has('lowfx')) return 'low';
  const q = params.get('quality');
  return q === 'low' || q === 'medium' || q === 'high' ? q : null;
})();

let cachedGuess: DeviceGuess | null = null;

/** Boot-time device guess. Reads the unmasked renderer string from a throwaway WebGL context. */
export function guessDeviceTier(): DeviceGuess {
  if (cachedGuess) return cachedGuess;
  let renderer = 'unknown';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? 'unknown');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* keep unknown */ }
  const r = renderer.toLowerCase();
  const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen/.test(r);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 8;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(screen.width || 1920, screen.height || 1080);
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (coarse && shortSide < 900);
  const integrated = /intel|iris|uhd|hd graphics|mali|adreno|powervr|apple gpu|videocore/.test(r);
  let tier: QualityTier; let reason: string;
  if (software) { tier = 'low'; reason = 'software renderer'; }
  else if (mobile) { tier = 'low'; reason = 'phone/touch device'; }
  else if (cores <= 2 || memory <= 2) { tier = 'low'; reason = `weak cpu/memory (${cores}c/${memory}GB)`; }
  else if (integrated || cores <= 4 || memory <= 4) { tier = 'medium'; reason = integrated ? 'integrated gpu' : `${cores}c/${memory}GB`; }
  else { tier = 'high'; reason = 'discrete-class gpu'; }
  cachedGuess = { tier, reason, renderer, software, mobile };
  return cachedGuess;
}

/** Tier the engine is created with (antialias can only be chosen at context creation). */
export function initialTier(): QualityTier {
  const setting = getSettings().graphicsQuality;
  return urlTier ?? (setting !== 'auto' ? setting : guessDeviceTier().tier);
}

export interface QualityHooks { sun: DirectionalLight; shadows: ShadowGenerator; glow: GlowLayer | null }

/** Accent lights a level may add; disabled on low (emissive cues carry the look instead). */
const ACCENT_LIGHTS = new Set(['vault-spot', 'alarm-light']);

export interface QualityStatus { tier: QualityTier; auto: boolean; reason: string; renderer: string; avgFps: number; changes: string[] }

export class QualityManager {
  private tier: QualityTier;
  private auto: boolean;
  private ceiling: QualityTier = 'high';
  private reason: string;
  private readonly guess: DeviceGuess;
  private readonly changes: string[] = [];
  private frames = 0;
  private windowStart = 0;
  private warmupUntil = 0;
  private lowWindows = 0;
  private highWindows = 0;
  private lastStepUp = -1e9;
  private avgFps = 0;
  private readonly frameObserver: Observer<Scene>;
  private readonly lightObserver: Observer<Light>;
  private readonly unsubscribe: () => void;

  private readonly scene: Scene;
  private readonly hooks: QualityHooks;

  constructor(scene: Scene, hooks: QualityHooks) {
    this.scene = scene; this.hooks = hooks;
    this.guess = guessDeviceTier();
    const setting = getSettings().graphicsQuality;
    this.auto = !urlTier && setting === 'auto';
    this.tier = initialTier();
    this.reason = urlTier ? 'url override' : this.auto ? `auto: ${this.guess.reason}` : 'settings';
    // Never auto-climb above the guess by more than one step.
    if (this.auto) this.ceiling = TIERS[Math.min(2, TIERS.indexOf(this.tier) + 1)];
    this.apply();
    const now = performance.now();
    this.windowStart = now; this.warmupUntil = now + 6000;
    this.frameObserver = scene.onAfterRenderObservable.add(() => this.sample());
    this.lightObserver = scene.onNewLightAddedObservable.add((light) => this.applyLight(light));
    this.unsubscribe = subscribeSettings((s) => this.setSetting(s.graphicsQuality));
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  get status(): QualityStatus {
    return { tier: this.tier, auto: this.auto, reason: this.reason, renderer: this.guess.renderer, avgFps: Math.round(this.avgFps * 10) / 10, changes: [...this.changes] };
  }

  setSetting(setting: GraphicsQualitySetting): void {
    if (urlTier) return;
    if (setting === 'auto') {
      if (this.auto) return;
      this.auto = true; this.ceiling = 'high'; this.reason = 'auto: settings';
      this.setTier(this.guess.tier, 'auto selected');
    } else {
      this.auto = false; this.reason = 'settings';
      this.setTier(setting, 'manual');
    }
  }

  private setTier(tier: QualityTier, why: string): void {
    if (tier === this.tier) return;
    this.changes.push(`${Math.round(performance.now() / 1000)}s ${this.tier}->${tier} (${why}, ${this.avgFps.toFixed(1)} fps)`);
    if (this.changes.length > 12) this.changes.shift();
    this.tier = tier;
    this.apply();
    // Shader recompiles after a tier change make the next frames slow; don't judge them.
    this.warmupUntil = performance.now() + 4000; this.lowWindows = 0; this.highWindows = 0;
  }

  private apply(): void {
    const { engine, tier } = { engine: this.scene.getEngine() as Engine, tier: this.tier };
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    let scaling: number;
    if (forcedScale > 1) scaling = forcedScale;
    else if (tier === 'high') scaling = 1 / Math.min(dpr, 2);
    else if (tier === 'medium') scaling = 1 / Math.min(dpr, 1.25);
    else scaling = this.guess.software ? 2 : Math.max(1.25, 1.75 / Math.max(1, dpr / 1.5));
    engine.setHardwareScalingLevel(scaling);
    const { sun, shadows, glow } = this.hooks;
    sun.shadowEnabled = tier !== 'low';
    const map = shadows.getShadowMap();
    const size = tier === 'high' ? 1024 : 512;
    if (map && map.getSize().width !== size) map.resize(size);
    if (glow) glow.isEnabled = tier !== 'low';
    for (const light of this.scene.lights) this.applyLight(light);
    if (typeof document !== 'undefined') document.documentElement.dataset.quality = tier;
    (window as unknown as { __pixQuality?: () => QualityStatus }).__pixQuality = () => this.status;
  }

  private applyLight(light: Light): void {
    if (ACCENT_LIGHTS.has(light.name) || light.name.startsWith('hero-key-') || light.name.startsWith('hero-fill-')) {
      light.setEnabled(this.tier !== 'low');
    }
  }

  private sample(): void {
    const now = performance.now();
    this.frames++;
    const span = now - this.windowStart;
    if (span < 2000) return;
    const fps = (this.frames * 1000) / span;
    this.frames = 0; this.windowStart = now;
    // A hidden tab, a breakpoint or an asset stall is not a performance verdict.
    if (document.hidden || fps < 0.5) { this.lowWindows = 0; this.highWindows = 0; return; }
    this.avgFps = this.avgFps ? this.avgFps * 0.5 + fps * 0.5 : fps;
    if (!this.auto || now < this.warmupUntil) return;
    const i = TIERS.indexOf(this.tier);
    if (fps < 26) { this.lowWindows++; this.highWindows = 0; } else if (fps > 52) { this.highWindows++; this.lowWindows = 0; } else { this.lowWindows = 0; this.highWindows = 0; }
    if (this.lowWindows >= 2 && i > 0) {
      // Dropping straight after a climb means the climb was wrong: stop climbing for this session.
      if (now - this.lastStepUp < 30000) this.ceiling = this.tier === 'high' ? 'medium' : 'low';
      this.setTier(TIERS[i - 1], 'fps low');
    } else if (this.highWindows >= 6 && i < TIERS.indexOf(this.ceiling)) {
      this.lastStepUp = now;
      this.setTier(TIERS[i + 1], 'fps headroom');
    }
  }

  dispose(): void {
    this.scene.onAfterRenderObservable.remove(this.frameObserver);
    this.scene.onNewLightAddedObservable.remove(this.lightObserver);
    this.unsubscribe();
  }
}
