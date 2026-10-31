import type { Scene } from '@babylonjs/core/scene.js';

/** Stable shared daylight. Emissive fixtures carry room identity without camera-switched lights. */
export function addHeroLighting(scene: Scene): void {
  // Only the display receives the vault accent: at most sun + hemisphere + one local light.
  const vault = scene.getLightByName('vault-spot');
  if (vault) vault.includedOnlyMeshes = scene.meshes.filter(mesh => /^(vault-belljar|p01-|vault-plinth)/.test(mesh.name));
}
