// Deterministic foreground-overload regression: slow real frames must not starve measurements.
import assert from 'node:assert/strict';

const result = { test: 'governor-unit', pass: false, notes: {} };
try {
  let now = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  globalThis.window = { location: { search: '?govtest=1' }, devicePixelRatio: 1, dispatchEvent: () => true, matchMedia: () => ({ matches: false }) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Android', hardwareConcurrency: 8 } });
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  globalThis.screen = { width: 360, height: 640 };
  globalThis.document = { hidden: false, documentElement: { dataset: {}, style: { setProperty() {} } }, createElement: () => ({ getContext: () => ({ getExtension: () => null, getParameter: () => 'Adreno 642L' }) }) };
  const observable = () => ({ listeners: [], add(fn) { this.listeners.push(fn); return fn; }, addOnce(fn) { return this.add(fn); }, remove(fn) { this.listeners = this.listeners.filter((f) => f !== fn); } });
  let scaling;
  const scene = { getEngine: () => ({ setHardwareScalingLevel: (value) => { scaling = value; } }), lights: [], onAfterRenderObservable: observable(), onNewLightAddedObservable: observable(), onDisposeObservable: observable() };
  const { QualityManager } = await import('../../src/scene/Quality.ts');
  const quality = new QualityManager(scene, { sun: {}, shadows: { getShadowMap: () => null }, glow: null });
  const frame = (ms) => { now += ms; for (const callback of scene.onAfterRenderObservable.listeners) callback(); };
  // Foreground 500ms renders previously returned before every measurement, forever.
  for (let i = 0; i < 16; i++) frame(500);
  assert.ok(quality.status.changes.some((s) => /\bdown\b/.test(s)), JSON.stringify(quality.status));
  assert.ok(quality.status.scaleStep > 0 && scaling > 1.75, 'overload did not reduce rendering resolution');
  const down = quality.status;
  window.__pixQualityTest.injectFrameMs(8);
  for (let i = 0; i < 40; i++) frame(500);
  assert.ok(quality.status.changes.some((s) => /\bup\b/.test(s)), 'injected recovery was discarded because real renders were slow');
  assert.equal(quality.status.tier, 'low', 'recovery exceeded the phone tier ceiling');
  quality.dispose();
  assert.equal(scene.onAfterRenderObservable.listeners.length, 0, 'render observer leaked');
  result.notes = { down, recovered: quality.status };
  result.pass = true;
} catch (e) { result.error = String(e?.stack ?? e); }
console.log('QA_RESULT ' + JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
