import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import type { Light } from '@babylonjs/core/Lights/light.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { TwistId } from '../../seed/index.ts';

export function applyTwistMood(scene: Scene, twist: TwistId | string): { dispose(): void } {
  const disposers: (() => void)[] = [];

  const sun = scene.getLightByName('sun');
  const fill = scene.getLightByName('fill');
  const glow = (scene.effectLayers?.find((l) => l.name === 'glow') as GlowLayer | undefined) ?? null;

  switch (twist) {
    case 'lights_out': {
      if (sun) {
        const origSunIntensity = sun.intensity;
        sun.intensity *= 0.35;
        disposers.push(() => {
          sun.intensity = origSunIntensity;
        });
      }
      if (fill) {
        const origFillIntensity = fill.intensity;
        fill.intensity *= 0.35;
        disposers.push(() => {
          fill.intensity = origFillIntensity;
        });
      }
      const heroLights = scene.lights.filter((light) => light.name.startsWith('hero-'));
      const originalHeroIntensities = heroLights.map((light) => ({ light, intensity: light.intensity }));
      for (const item of originalHeroIntensities) item.light.intensity *= 0.35;
      if (originalHeroIntensities.length > 0) {
        disposers.push(() => {
          for (const item of originalHeroIntensities) item.light.intensity = item.intensity;
        });
      }
      if (glow) {
        const origGlowIntensity = glow.intensity;
        glow.intensity *= 1.6;
        disposers.push(() => {
          glow.intensity = origGlowIntensity;
        });
      }
      const emissiveMats: { mat: PBRMaterial; orig: number }[] = [];
      for (const mat of scene.materials) {
        if (mat instanceof PBRMaterial && /kitemissive/i.test(mat.name)) {
          emissiveMats.push({ mat, orig: mat.emissiveIntensity });
          mat.emissiveIntensity *= 1.4;
        }
      }
      if (emissiveMats.length > 0) {
        disposers.push(() => {
          for (const item of emissiveMats) {
            item.mat.emissiveIntensity = item.orig;
          }
        });
      }
      break;
    }

    case 'short_cord': {
      const ipc = scene.imageProcessingConfiguration;
      if (ipc) {
        const origVignetteEnabled = ipc.vignetteEnabled;
        const origVignetteWeight = ipc.vignetteWeight;
        ipc.vignetteEnabled = true;
        ipc.vignetteWeight += 0.8;
        disposers.push(() => {
          ipc.vignetteEnabled = origVignetteEnabled;
          ipc.vignetteWeight = origVignetteWeight;
        });
      }
      break;
    }

    case 'slippery_floor': {
      const restoredMats: {
        mat: PBRMaterial;
        origRoughness: number;
        origClearCoatEnabled: boolean;
        origClearCoatIntensity: number;
        origClearCoatRoughness: number;
      }[] = [];
      for (const mesh of scene.meshes) {
        const nameMatches = /floor|ground|resin|apron/i.test(mesh.name);
        const matMatches = mesh.material && /floor|ground|resin|apron/i.test(mesh.material.name);
        if (nameMatches || matMatches) {
          if (mesh.material instanceof PBRMaterial) {
            const mat = mesh.material;
            if (!restoredMats.some((r) => r.mat === mat)) {
              restoredMats.push({
                mat,
                origRoughness: mat.roughness ?? 1,
                origClearCoatEnabled: mat.clearCoat.isEnabled,
                origClearCoatIntensity: mat.clearCoat.intensity,
                origClearCoatRoughness: mat.clearCoat.roughness,
              });
              mat.roughness = Math.min(mat.roughness ?? 1, 0.14);
              mat.clearCoat.isEnabled = true;
              mat.clearCoat.intensity = 0.6;
              mat.clearCoat.roughness = 0.05;
            }
          }
        }
      }
      if (restoredMats.length > 0) {
        disposers.push(() => {
          for (const r of restoredMats) {
            r.mat.roughness = r.origRoughness;
            r.mat.clearCoat.isEnabled = r.origClearCoatEnabled;
            r.mat.clearCoat.intensity = r.origClearCoatIntensity;
            r.mat.clearCoat.roughness = r.origClearCoatRoughness;
          }
        });
      }
      break;
    }

    case 'nervous_nee': {
      if (sun && sun.diffuse) {
        const origSunDiffuse = sun.diffuse.clone();
        sun.diffuse = Color3.Lerp(origSunDiffuse, new Color3(0.82, 0.90, 1.0), 0.25);
        disposers.push(() => {
          sun.diffuse = origSunDiffuse;
        });
      }
      if (fill && fill.diffuse) {
        const origFillDiffuse = fill.diffuse.clone();
        fill.diffuse = Color3.Lerp(origFillDiffuse, new Color3(0.82, 0.90, 1.0), 0.25);
        disposers.push(() => {
          fill.diffuse = origFillDiffuse;
        });
      }

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

      if (!prefersReducedMotion) {
        let flickering = false;
        let flickerRemainingMs = 0;
        const baseIntensities = new Map<Light, number>();

        const restoreFlicker = () => {
          for (const [light, base] of baseIntensities.entries()) {
            light.intensity = base;
          }
          baseIntensities.clear();
        };

        const obs: Observer<Scene> | null = scene.onBeforeRenderObservable.add(() => {
          const dt = scene.getEngine().getDeltaTime();
          if (flickering) {
            flickerRemainingMs -= dt;
            if (flickerRemainingMs <= 0) {
              flickering = false;
              restoreFlicker();
            }
          } else {
            // ~0.6% chance per frame at 60fps (dt ~16.6ms)
            const p = 0.006 * (dt / 16.667);
            if (Math.random() < p) {
              flickering = true;
              flickerRemainingMs = 60 + Math.random() * 80;
              if (sun) {
                baseIntensities.set(sun, sun.intensity);
                sun.intensity *= 0.75;
              }
              for (const light of scene.lights) {
                const className = light.getClassName();
                if (className === 'PointLight' || className === 'SpotLight') {
                  baseIntensities.set(light, light.intensity);
                  light.intensity *= 0.75;
                }
              }
            }
          }
        });

        disposers.push(() => {
          if (obs) scene.onBeforeRenderObservable.remove(obs);
          restoreFlicker();
        });
      }
      break;
    }

    case 'rush_hour': {
      if (sun && sun.diffuse) {
        const origSunDiffuse = sun.diffuse.clone();
        const origSunIntensity = sun.intensity;
        sun.diffuse = Color3.Lerp(origSunDiffuse, new Color3(1.0, 0.86, 0.66), 0.20);
        sun.intensity = origSunIntensity * 1.08;
        disposers.push(() => {
          sun.diffuse = origSunDiffuse;
          sun.intensity = origSunIntensity;
        });
      }
      break;
    }

    default:
      // unknown: no-op
      break;
  }

  return {
    dispose() {
      for (let i = disposers.length - 1; i >= 0; i--) {
        disposers[i]();
      }
      disposers.length = 0;
    },
  };
}

/** Night Shift floor 2+ tint: each later floor reads as a later hour (dusk amber, night blue, late violet). */
const FLOOR_TINTS: readonly [number, number, number][] = [
  [1.0, 0.86, 0.72],
  [0.8, 0.88, 1.0],
  [0.9, 0.82, 1.0],
];

export function applyFloorTint(scene: Scene, floor: number): { dispose(): void } {
  const f = floor | 0;
  if (f <= 1) return { dispose() {} };
  const [r, g, b] = FLOOR_TINTS[(f - 2) % FLOOR_TINTS.length];
  const restores: (() => void)[] = [];
  for (const name of ['sun', 'fill']) {
    const light = scene.getLightByName(name) as (Light & { diffuse?: Color3 }) | null;
    if (!light?.diffuse) continue;
    const original = light.diffuse.clone();
    light.diffuse = new Color3(original.r * r, original.g * g, original.b * b);
    restores.push(() => { light.diffuse = original; });
  }
  return { dispose() { for (const restore of restores) restore(); } };
}
