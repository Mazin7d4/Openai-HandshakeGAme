import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
} from '@babylonjs/core';

export function createEngine(canvas: HTMLCanvasElement): Engine {
  return new Engine(canvas, true, {
    adaptToDeviceRatio: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
}

export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.74, 0.81, 0.86, 1);

  const fill = new HemisphericLight('fill', new Vector3(0.15, 1, 0.2), scene);
  fill.intensity = 0.72;
  fill.groundColor = new Color3(0.32, 0.3, 0.28);
  fill.specular = new Color3(0.04, 0.04, 0.04);

  const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, 0.45), scene);
  sun.intensity = 0.78;
  sun.position.set(12, 24, -10);

  return scene;
}
