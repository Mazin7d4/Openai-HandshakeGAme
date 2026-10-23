import { Color3, SpotLight, Vector3, type Scene } from '@babylonjs/core';
import { initialTier } from '../scene/Quality.ts';

/**
 * Warm key spots along the first-objective path (apron → reception under-desk → vent → office).
 * Cool hemispheric fill already lives in createScene; these accents make the route readable.
 * Disabled on graphicsQuality low / auto-low via QualityManager ACCENT_LIGHTS.
 */
export function addOpeningPathLights(scene: Scene): SpotLight[] {
  const warm = Color3.FromHexString('#FFE2B0');
  const softCool = Color3.FromHexString('#C8D8E8');
  const mk = (
    name: string,
    pos: [number, number, number],
    dir: [number, number, number],
    angle: number,
    intensity: number,
    diffuse: Color3,
  ) => {
    const light = new SpotLight(name, new Vector3(...pos), new Vector3(...dir), angle, 2, scene);
    light.diffuse = diffuse;
    light.intensity = intensity;
    light.shadowEnabled = false;
    return light;
  };

  const lights = [
    // Apron: warm key from SW, pulling the eye toward the entry doorway.
    mk('opening-path-apron', [4, 11, -64], [-0.25, -0.85, 0.55], 0.85, 1.15, warm),
    // Reception desk + under-desk crawl: warm pool on the oak and the low gap.
    mk('opening-path-reception', [-4.5, 10.5, -52], [0.05, -0.9, 0.35], 0.7, 1.35, warm),
    // Service vent mouth: slightly cooler so the climb reads as a different beat.
    mk('opening-path-vent', [-5, 11, -46], [0, -0.55, 0.7], 0.55, 1.05, softCool),
    // First office: warm key on PIX desk / NEE bay split.
    mk('opening-path-office', [1, 11.5, -36], [0, -0.85, 0.2], 0.9, 1.2, warm),
  ];

  if (initialTier() === 'low') {
    for (const light of lights) light.setEnabled(false);
  }
  return lights;
}
