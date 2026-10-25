import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import './babylonSideEffects.ts';
import { createStudioEnvironment } from './studioEnvironment.ts';
import { initialTier, QualityManager } from './Quality.ts';

/** `?scale=N` renders at 1/N resolution (low-end GPUs, software-render CI); `?lowfx` drops glow. */
const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
export const renderScale = Math.min(6, Math.max(1, Number(params.get('scale')) || 1));
export const lowFx = params.has('lowfx');

export function createEngine(canvas: HTMLCanvasElement): Engine {
  // MSAA can only be chosen at context creation: weak devices (auto low tier) start without it.
  const aa = !lowFx && initialTier() !== 'low';
  const engine = new Engine(canvas, aa, {
    adaptToDeviceRatio: renderScale === 1,
    antialias: aa,
    powerPreference: 'high-performance',
  });
  if (renderScale > 1) engine.setHardwareScalingLevel(renderScale);
  return engine;
}

// Intentional glow include-list (prod-art): core, screens, face-screens, security lenses, alarm/objective beacons.
const GLOW_NAMES = /^(p01-core|p01-core-halo|alarm-beacon-lamp|alarm-beacon-beam|security-camera|security-drone-\d+-eye|instrument-screen|.*-beacon)$/;
/** Glow include-list: face-screens, lenses, beacons and the core only. */
function isGlowMesh(mesh: AbstractMesh): boolean {
  if (GLOW_NAMES.test(mesh.name)) return true;
  const mat = mesh.material;
  if (!mat) return false;
  // Mascot face-screens: the drone GLB's 'Screen' material carries the animated face texture.
  if (mat.name === 'Screen' && !!(mat as { emissiveTexture?: unknown }).emissiveTexture) return true;
  return false;
}

const qualityManagers = new WeakMap<Scene, QualityManager>();
/** The scene's automatic quality tier manager (see Quality.ts). */
export function getQuality(scene: Scene): QualityManager | undefined { return qualityManagers.get(scene); }

export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.72, 0.79, 0.79, 1);
  scene.ambientColor = new Color3(0.2, 0.2, 0.22);

  const fill = new HemisphericLight('fill', new Vector3(0.15, 1, 0.2), scene);
  fill.intensity = 0.48;
  fill.diffuse = new Color3(0.92, 0.95, 1);
  fill.groundColor = new Color3(0.38, 0.33, 0.3);
  fill.specular = new Color3(0.08, 0.08, 0.08);

  scene.skipPointerMovePicking = true; // gameplay never hovers; avoids a per-move ray cast
  const sun = new DirectionalLight('sun', new Vector3(0.38, -1, 0.48), scene);
  sun.intensity = 1.65;
  sun.diffuse = new Color3(1, 0.95, 0.88);
  sun.position.set(-10, 25, 3);
  sun.autoCalcShadowZBounds = false;
  sun.shadowMinZ = 1; sun.shadowMaxZ = 65;
  sun.orthoLeft = -24; sun.orthoRight = 24; sun.orthoBottom = -24; sun.orthoTop = 24;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
  shadows.bias = 0.0005; shadows.normalBias = 0.035; shadows.setDarkness(0.25);
  const staticCasters: { mesh: AbstractMesh; x: number; z: number; r: number }[] = [];
  const dynamicCasters: AbstractMesh[] = [];
  scene.onBeforeRenderObservable.addOnce(() => {
    for (const mesh of scene.meshes) {
      if (mesh.name.includes('player-') && mesh.isVisible) { shadows.addShadowCaster(mesh); dynamicCasters.push(mesh, ...mesh.getChildMeshes()); continue; }
      if (!(mesh.name.startsWith('Hero_') || mesh.metadata?.castShadow)) continue;
      // Draw-call budget: only big props cast into the shadow pass; small clutter just receives.
      mesh.computeWorldMatrix(true);
      const sphere = mesh.getBoundingInfo().boundingSphere;
      if (sphere.radiusWorld >= 0.45) staticCasters.push({ mesh, x: sphere.centerWorld.x, z: sphere.centerWorld.z, r: sphere.radiusWorld });
    }
  });
  // Shadow-pass culling: only static casters overlapping the camera-following 48 m shadow box are
  // rendered into the shadow map (rebuilt only when the 2 m-snapped centre moves).
  let castersKey = '';
  const refreshCasters = (fx: number, fz: number) => {
    const key = `${fx},${fz}`;
    if (key === castersKey || staticCasters.length === 0) return;
    castersKey = key;
    const list = shadows.getShadowMap()!.renderList!;
    list.length = 0;
    for (const m of dynamicCasters) list.push(m);
    for (const c of staticCasters) if (Math.abs(c.x - fx) < 27 + c.r && Math.abs(c.z - fz) < 27 + c.r) list.push(c.mesh);
  };
  // The shadow frustum used to be pinned over the lab; it now follows the camera (snapped to a 2 m grid
  // to avoid shimmer), so every mission area gets contact shadows from the same 1024 map.
  const sunDir = sun.direction.normalizeToNew();
  sun.shadowMaxZ = 75;
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera; if (!cam) return;
    const p = cam.globalPosition;
    const fx = Math.round(p.x / 2) * 2, fz = Math.round(p.z / 2) * 2;
    sun.position.set(fx - sunDir.x * 38, 4 - sunDir.y * 38, fz - sunDir.z * 38);
    refreshCasters(fx, fz);
  });

  let glow: GlowLayer | null = null;
  if (!lowFx) {
    // Glow discipline: include-list only (prod-art) plus strong decorative materials — not every faint emissive.
    glow = new GlowLayer('glow', scene, { blurKernelSize: 16, mainTextureRatio: 0.5 });
    glow.intensity = 0.5;
    const layer = glow;
    const pending: AbstractMesh[] = [];
    scene.onNewMeshAddedObservable.add((mesh) => pending.push(mesh));
    // Materials are often assigned after creation, so classify on the next frame.
    scene.onBeforeRenderObservable.add(() => {
      if (pending.length === 0) return;
      for (const mesh of pending.splice(0)) if (isGlowMesh(mesh)) layer.addIncludedOnlyMesh(mesh as Mesh);
    });
  }
  const qualityManager = new QualityManager(scene, { sun, shadows, glow });
  qualityManagers.set(scene, qualityManager);
  if (params.get('fps') === '1') {
    let disposed = false;
    let disposeOverlay = () => {};
    scene.onDisposeObservable.addOnce(() => {
      disposed = true;
      disposeOverlay();
    });
    void import('../ui/FpsOverlay.ts').then(({ mountFpsOverlay }) => {
      if (!disposed) disposeOverlay = mountFpsOverlay(() => qualityManager.status);
    });
  }

  // Shared soft daylight reflections on painted surfaces, glass, metal and drones.
  scene.environmentTexture = createStudioEnvironment(scene);
  scene.environmentIntensity = 0.72;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.12;
  scene.imageProcessingConfiguration.contrast = 1.12;

  // Cheap filmic framing for the miniature look: soft warm vignette, gentle saturation lift.
  const ip = scene.imageProcessingConfiguration;
  ip.vignetteEnabled = true; ip.vignetteWeight = 1.6; ip.vignetteStretch = 0.4;
  ip.vignetteColor = new Color4(0.12, 0.08, 0.05, 0);
  ip.colorCurvesEnabled = true;
  const curves = new ColorCurves(); curves.globalSaturation = 18; curves.highlightsHue = 40; curves.highlightsDensity = 8;
  ip.colorCurves = curves;

  return scene;
}
