import { Color3, StandardMaterial, type Mesh, type Scene } from '@babylonjs/core';

export function applySolidColor(mesh: Mesh, color: Color3, scene: Scene): void {
  const material = new StandardMaterial(`${mesh.name}-mat`, scene);
  material.diffuseColor = color.clone();
  material.specularColor = new Color3(0.05, 0.05, 0.05);
  mesh.material = material;
  mesh.isPickable = false;
}
