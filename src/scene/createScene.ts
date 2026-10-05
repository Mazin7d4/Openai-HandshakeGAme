import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  GlowLayer,
  HemisphericLight,
  Scene,
  Vector3,
} from '@babylonjs/core';
import { createStudioEnvironment } from './studioEnvironment.ts';

export function createEngine(canvas: HTMLCanvasElement): Engine {
  return new Engine(canvas, true, {
    adaptToDeviceRatio: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
}

export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.76, 0.84, 0.9, 1);
  scene.ambientColor = new Color3(0.2, 0.2, 0.22);

  const fill = new HemisphericLight('fill', new Vector3(0.15, 1, 0.2), scene);
  fill.intensity = 0.7;
  fill.diffuse = new Color3(0.92, 0.95, 1);
  fill.groundColor = new Color3(0.38, 0.33, 0.3);
  fill.specular = new Color3(0.08, 0.08, 0.08);

  const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, 0.45), scene);
  sun.intensity = 0.85;
  sun.diffuse = new Color3(1, 0.95, 0.88);
  sun.position.set(12, 24, -10);

  const glow = new GlowLayer('glow', scene, { blurKernelSize: 32 });
  glow.intensity = 0.55;

  // Image-based lighting for the PBR drone model only (StandardMaterials ignore it).
  scene.environmentTexture = createStudioEnvironment(scene);
  scene.environmentIntensity = 0.9;

  return scene;
}
