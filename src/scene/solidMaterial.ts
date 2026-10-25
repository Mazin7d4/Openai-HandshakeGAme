import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

export function applySolidColor(mesh: Mesh, color: Color3, scene: Scene): void {
  const material = new StandardMaterial(`${mesh.name}-mat`, scene);
  material.diffuseColor = color.clone();
  material.specularColor = new Color3(0.05, 0.05, 0.05);
  mesh.material = material;
  mesh.isPickable = false;
}
