import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import type { Engine } from '@babylonjs/core/Engines/engine.js';
import type { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import type { Light } from '@babylonjs/core/Lights/light.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { getSettings, subscribeSettings, type GraphicsQualitySetting } from '../ui/Settings.ts';

/**
 * Desktop visuals are selected once at boot: no automatic shadow, light, material or glow toggles.
 * A sustained slow sample may reduce resolution once; desktop never automatically steps back up.
 * Phones retain the adaptive resolution ladder. Explicit settings and URL overrides remain available.
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

export interface QualityStatus {
  tier: QualityTier;
  auto: boolean;
  reason: string;
  renderer: string;
  avgFps: number;
  changes: string[];
  dynScale: number;
  frameMs: number;
  scale: number;
  scaleStep: number;
  phase: 'settle' | 'probe' | 'monitor';
  pinned: 'none' | 'tier' | 'all';
  lastAction: string | null;
  ceiling: QualityTier;
  stability: 'desktop-fixed' | 'adaptive';
}

const SCALE_STEPS = [1, 1.15, 1.3, 1.5] as const;
type QualityTestHook = { injectFrameMs: (ms: number | null) => void };

export class QualityManager {
  private tier: QualityTier;
  private auto: boolean;
  private ceiling: QualityTier;
  private reason: string;
  private readonly guess: DeviceGuess;
  private readonly changes: string[] = [];
  private scaleStep = 0;
  private emaMs = 0;
  private lastFrame = 0;
  private startedAt = 0;
  private probeHandled = false;
  private lastMonitorAt = 0;
  private lowCount = 0;
  private highCount = 0;
  private lastStepUp = -1e9;
  private upHoldSec = 5;
  private avgFps = 0;
  private appliedScale = 1;
  private lastAction: string | null = null;
  private cooldownUntil = 0;
  private injectedFrameMs: number | null = null;
  private pinned: 'none' | 'tier' | 'all';
  private readonly testHook: QualityTestHook | null;
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
    this.ceiling = this.tier;
    this.pinned = urlTier || forcedScale > 1 ? 'all' : this.auto ? 'none' : 'tier';
    this.apply();
    const now = performance.now();
    this.restartProbe(now);
    if (params.get('govtest') === '1') {
      this.testHook = { injectFrameMs: (ms) => {
        this.injectedFrameMs = typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
      } };
      (window as unknown as { __pixQualityTest?: QualityTestHook }).__pixQualityTest = this.testHook;
    } else {
      this.testHook = null;
    }
    this.frameObserver = scene.onAfterRenderObservable.add(() => this.sample());
    this.lightObserver = scene.onNewLightAddedObservable.add((light) => this.applyLight(light));
    this.unsubscribe = subscribeSettings((s) => this.setSetting(s.graphicsQuality));
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  get status(): QualityStatus {
    const now = performance.now();
    const elapsed = now - this.startedAt;
    const phase = elapsed < 1000 ? 'settle' : elapsed < 6000 ? 'probe' : 'monitor';
    return {
      tier: this.tier,
      auto: this.auto,
      reason: this.reason,
      renderer: this.guess.renderer,
      avgFps: Math.round(this.avgFps * 10) / 10,
      changes: [...this.changes],
      dynScale: SCALE_STEPS[this.scaleStep],
      frameMs: Math.round(this.emaMs * 10) / 10,
      scale: Math.round(this.appliedScale * 100) / 100,
      scaleStep: this.scaleStep,
      phase,
      pinned: this.pinned,
      lastAction: this.lastAction,
      ceiling: this.ceiling,
      stability: this.guess.mobile ? 'adaptive' : 'desktop-fixed',
    };
  }

  /** Start measurement after loading and shader warmup, so boot stalls never drive the governor. */
  beginPlay(): void { this.restartProbe(performance.now()); }

  setSetting(setting: GraphicsQualitySetting): void {
    if (urlTier) return;
    const scalePinned = forcedScale > 1;
    if (setting === 'auto') {
      if (this.auto) return;
      this.auto = true;
      this.pinned = scalePinned ? 'all' : 'none';
      this.ceiling = this.guess.tier;
      this.reason = `auto: ${this.guess.reason}`;
      this.setTier(this.guess.tier);
      this.restartProbe(performance.now());
    } else {
      this.auto = false; this.pinned = scalePinned ? 'all' : 'tier'; this.reason = 'settings';
      this.ceiling = setting;
      this.setTier(setting);
      this.resetMeasurement(performance.now());
    }
  }

  private setTier(tier: QualityTier): void {
    this.tier = tier;
    this.scaleStep = 0;
    this.apply();
  }

  private restartProbe(now: number): void {
    this.startedAt = now;
    this.probeHandled = false;
    this.resetMeasurement(now);
  }

  private resetMeasurement(now: number): void {
    this.emaMs = 0;
    this.avgFps = 0;
    this.lastFrame = now;
    this.lastMonitorAt = now;
    this.lowCount = 0;
    this.highCount = 0;
    this.cooldownUntil = 0;
  }

  private get maxStep(): number { return this.guess.mobile ? (this.auto ? 3 : 2) : 1; }

  private apply(): void {
    const { engine, tier } = { engine: this.scene.getEngine() as Engine, tier: this.tier };
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const base = forcedScale > 1
      ? forcedScale
      : !this.guess.mobile && tier !== 'low'
        // CSS pixels are the desktop ceiling, including Retina laptops. Large monitors get a
        // fixed boot cap instead of rendering a 4K/Retina framebuffer behind a 1080p game.
        ? Math.max(1, Math.min(1.5, Math.sqrt(window.innerWidth * window.innerHeight / (1920 * 1080))))
        : tier === 'high'
        ? 1 / Math.min(dpr, 2)
        : tier === 'medium'
          ? 1 / Math.min(dpr, 1.25)
          : this.guess.software ? 2 : Math.max(1.25, 1.75 / Math.max(1, dpr / 1.5));
    const scaling = base * SCALE_STEPS[this.scaleStep];
    this.appliedScale = scaling;
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
    if (ACCENT_LIGHTS.has(light.name)) {
      light.setEnabled(this.tier !== 'low');
    }
  }

  private sample(): void {
    const now = performance.now();
    const realDt = now - this.lastFrame;
    this.lastFrame = now;
    // A foreground frame slower than 250 ms is evidence of overload too.
    // Cap its weight instead of dropping every sample on a struggling device.
    if (document.hidden || !Number.isFinite(realDt) || realDt <= 0) return;
    const dt = this.injectedFrameMs ?? Math.min(realDt, 250);
    if (!Number.isFinite(dt) || dt <= 0 || dt > 250) return;
    const elapsed = now - this.startedAt;
    if (elapsed < 1000) return;
    if (this.cooldownUntil !== 0) {
      if (now < this.cooldownUntil) return;
      this.cooldownUntil = 0;
      this.emaMs = 0;
      this.avgFps = 0;
      this.lowCount = 0;
      this.highCount = 0;
      this.lastMonitorAt = now;
      return;
    }

    this.emaMs = this.emaMs ? this.emaMs + (dt - this.emaMs) * 0.1 : dt;
    this.avgFps = 1000 / this.emaMs;
    if (elapsed < 6000) return;

    if (!this.probeHandled) {
      this.probeHandled = true;
      this.lastMonitorAt = now;
      if (this.avgFps < 50) this.stepDown('probe');
      return;
    }
    if (now - this.lastMonitorAt < 1000) return;
    this.lastMonitorAt = now;
    if (this.avgFps < 50) { this.lowCount++; this.highCount = 0; }
    else if (this.avgFps > 58) { this.highCount++; this.lowCount = 0; }
    else { this.lowCount = 0; this.highCount = 0; }
    if (this.lowCount >= 2) {
      this.stepDown('monitor');
    } else if (this.highCount >= this.upHoldSec) {
      this.stepUp('monitor');
    }
  }

  private stepDown(why: 'probe' | 'monitor'): boolean {
    if (this.pinned === 'all') return false;
    const oldStep = this.scaleStep; const oldTier = this.tier;
    if (this.scaleStep < this.maxStep) this.scaleStep++;
    else if (this.guess.mobile && this.auto && TIERS.indexOf(this.tier) > 0) {
      this.tier = TIERS[TIERS.indexOf(this.tier) - 1];
      this.scaleStep = 0;
    } else return false;
    this.recordStep('down', oldTier, oldStep, why);
    return true;
  }

  private stepUp(why: 'monitor'): boolean {
    if (!this.guess.mobile || this.pinned === 'all') return false;
    const oldStep = this.scaleStep; const oldTier = this.tier;
    if (this.scaleStep > 0) this.scaleStep--;
    else if (this.auto && TIERS.indexOf(this.tier) < TIERS.indexOf(this.ceiling)) {
      this.tier = TIERS[TIERS.indexOf(this.tier) + 1];
      this.scaleStep = this.maxStep;
    } else return false;
    this.lastStepUp = performance.now();
    this.recordStep('up', oldTier, oldStep, why);
    return true;
  }

  private recordStep(direction: 'down' | 'up', oldTier: QualityTier, oldStep: number, why: 'probe' | 'monitor'): void {
    const now = performance.now();
    if (direction === 'down' && now - this.lastStepUp < 20_000) this.upHoldSec = Math.min(40, this.upHoldSec * 2);
    const action = `${Math.round(now / 1000)}s ${direction} ${oldTier === this.tier ? this.tier : `${oldTier}->${this.tier}`} x${SCALE_STEPS[oldStep].toFixed(2)}->x${SCALE_STEPS[this.scaleStep].toFixed(2)} (${this.avgFps.toFixed(1)} fps, ${why})`;
    this.changes.push(action);
    if (this.changes.length > 12) this.changes.shift();
    this.lastAction = action;
    this.apply();
    this.cooldownUntil = now + 3000;
    this.lowCount = 0;
    this.highCount = 0;
  }

  dispose(): void {
    this.scene.onAfterRenderObservable.remove(this.frameObserver);
    this.scene.onNewLightAddedObservable.remove(this.lightObserver);
    this.unsubscribe();
    if (this.testHook && (window as unknown as { __pixQualityTest?: QualityTestHook }).__pixQualityTest === this.testHook) {
      delete (window as unknown as { __pixQualityTest?: QualityTestHook }).__pixQualityTest;
    }
  }
}
