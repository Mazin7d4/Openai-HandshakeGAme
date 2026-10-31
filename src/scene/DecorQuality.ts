import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

const DECOR_MESH = /^(batch-|dressing-|decor-|Hero_|(?:Sofa|Chair|Plant|PlantSmall|Rack|Shelving|Cooling|Duct|Bookshelf|Monitor|Lockers|ParcelTrolley|AcousticPanel)_)/;

/** A diffuse shader for low/medium opaque decoration; interactive and mascot materials remain authored. */
export function installDecorQuality(scene: Scene): void {
  const fallbacks = new Map<PBRMaterial, StandardMaterial>();
  const originals = new Map<AbstractMesh, PBRMaterial>();
  const pending = [...scene.meshes];
  let previousLow: boolean | null = null;
  const fallback = (source: PBRMaterial) => {
    let result = fallbacks.get(source);
    if (result) return result;
    result = new StandardMaterial(`low-${source.name}`, scene);
    result.diffuseColor = source.albedoColor.clone(); result.diffuseTexture = source.albedoTexture;
    const specular = 0.035 + (source.metallic ?? 0) * 0.14;
    result.specularColor = new Color3(specular, specular, specular); result.specularPower = 24;
    result.maxSimultaneousLights = 4; result.backFaceCulling = source.backFaceCulling;
    fallbacks.set(source, result);
    return result;
  };
  scene.onNewMeshAddedObservable.add(mesh => pending.push(mesh));
  scene.onBeforeRenderObservable.add(() => {
    const low = document.documentElement.dataset.quality !== 'high';
    if (pending.length) {
      for (const mesh of pending.splice(0)) {
        const material = mesh.material;
        if (!(material instanceof PBRMaterial) || material.alpha < 1 || material.emissiveColor.r + material.emissiveColor.g + material.emissiveColor.b > 0) continue;
        if (!DECOR_MESH.test(mesh.name) && !/^Kit/.test(material.name)) continue;
        originals.set(mesh, material);
        if (low) mesh.material = fallback(material);
      }
    }
    if (previousLow === low) return;
    previousLow = low;
    for (const [mesh, material] of originals) {
      if (mesh.isDisposed()) { originals.delete(mesh); continue; }
      mesh.material = low ? fallback(material) : material;
    }
  });
  scene.onDisposeObservable.addOnce(() => { originals.clear(); fallbacks.clear(); });
}
