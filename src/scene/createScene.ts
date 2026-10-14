import {
  Color3,
  Color4,
  ColorCurves,
  DirectionalLight,
  Engine,
  GlowLayer,
  HemisphericLight,
  ImageProcessingConfiguration,
  Scene,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core';
import { createStudioEnvironment } from './studioEnvironment.ts';

/** `?scale=N` renders at 1/N resolution (low-end GPUs, software-render CI); `?lowfx` drops glow. */
const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
export const renderScale = Math.min(6, Math.max(1, Number(params.get('scale')) || 1));
export const lowFx = params.has('lowfx');

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const engine = new Engine(canvas, !lowFx, {
    adaptToDeviceRatio: renderScale === 1,
    antialias: !lowFx,
    powerPreference: 'high-performance',
  });
  if (renderScale > 1) engine.setHardwareScalingLevel(renderScale);
  return engine;
}

export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.72, 0.79, 0.79, 1);
  scene.ambientColor = new Color3(0.2, 0.2, 0.22);

  const fill = new HemisphericLight('fill', new Vector3(0.15, 1, 0.2), scene);
  fill.intensity = 0.48;
  fill.diffuse = new Color3(0.92, 0.95, 1);
  fill.groundColor = new Color3(0.38, 0.33, 0.3);
  fill.specular = new Color3(0.08, 0.08, 0.08);

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
  scene.onBeforeRenderObservable.addOnce(() => {
    for (const mesh of scene.meshes) {
      if (mesh.name.startsWith('Hero_') || mesh.metadata?.castShadow || mesh.name.includes('player-') && mesh.isVisible) shadows.addShadowCaster(mesh);
    }
  });
  // The shadow frustum used to be pinned over the lab; it now follows the camera (snapped to a 2 m grid
  // to avoid shimmer), so every mission area gets contact shadows from the same 1024 map.
  const sunDir = sun.direction.normalizeToNew();
  sun.shadowMaxZ = 75;
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera; if (!cam) return;
    const p = cam.globalPosition;
    const fx = Math.round(p.x / 2) * 2, fz = Math.round(p.z / 2) * 2;
    sun.position.set(fx - sunDir.x * 38, 4 - sunDir.y * 38, fz - sunDir.z * 38);
  });

  if (!lowFx) {
    const glow = new GlowLayer('glow', scene, { blurKernelSize: 32 });
    glow.intensity = 0.22;
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
