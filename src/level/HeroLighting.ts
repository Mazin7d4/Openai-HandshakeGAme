import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';

// Warm and cool WHITES: colour belongs to interaction, never to an environmental light wash.
const ROOMS = [
  { id: 'apron', z: -61, y: 3, white: '#E8EDF0' },
  { id: 'reception', z: -49, y: 3, white: '#F4EFE4' },
  { id: 'office', z: -34, y: 3, white: '#EFF0E9' },
  { id: 'server', z: -13, y: 4, white: '#E5EBF1' },
  { id: 'lab', z: 17, y: 4, white: '#F6F0E5' },
  { id: 'dock', z: 39, y: 3, white: '#E9EDEF' },
] as const;

/** Nearest-room keys. Low tier uses only the shared hemisphere and sun. */
export function addHeroLighting(scene: Scene): void {
  const lights = ROOMS.map(room => {
    const key = new SpotLight(`hero-key-${room.id}`, new Vector3(4, 8.6, room.z + 3),
      new Vector3(-4, room.y - 8.6, -1), Math.PI * 0.8, 2, scene);
    key.diffuse = Color3.FromHexString(room.white);
    key.specular.set(0.14, 0.14, 0.14); key.intensity = 0.55; key.range = 26;
    const fill = new PointLight(`hero-fill-${room.id}`, new Vector3(-8, 7.5, room.z), scene);
    fill.diffuse.set(0.91, 0.94, 0.97); fill.specular.setAll(0);
    fill.intensity = 0.12; fill.range = 22;
    key.setEnabled(false); fill.setEnabled(false);
    return { key, fill };
  });
  // Scope the existing vault accent so no surface receives hemi + sun + two keys + vault.
  const vault = scene.getLightByName('vault-spot');
  if (vault) vault.includedOnlyMeshes = scene.meshes.filter(mesh => /^(vault-belljar|p01-|vault-plinth)/.test(mesh.name));
  const keysExcluded = scene.meshes.filter(mesh => /^(vault-belljar|p01-|vault-plinth|alarm-beacon)/.test(mesh.name));
  for (const { key, fill } of lights) { key.excludedMeshes = keysExcluded; fill.excludedMeshes = keysExcluded; }
  let active = -2;
  scene.onBeforeRenderObservable.add(() => {
    const camera = scene.activeCamera;
    const low = document.documentElement.dataset.quality === 'low';
    // Follow camera target (crew), rather than the eye that trails a room behind.
    const focusZ = camera && 'getTarget' in camera ? (camera as typeof camera & { getTarget(): Vector3 }).getTarget().z : camera?.globalPosition.z ?? -61;
    let nearest = -1, distance = Infinity;
    if (camera && !low) for (let i = 0; i < ROOMS.length; i++) {
      const d = Math.abs(focusZ - ROOMS[i].z);
      if (d < distance) { nearest = i; distance = d; }
    }
    if (active === nearest) return;
    active = nearest;
    for (let i = 0; i < lights.length; i++) {
      lights[i].key.setEnabled(i === nearest); lights[i].fill.setEnabled(i === nearest);
    }
  });
}
