import { Color3, CreateSphere, CreateTorus, PBRMaterial, type Mesh, type Scene } from '@babylonjs/core';

/** Decorative shell only. The verified grabbable body and replication stay intact. */
export function dressPrototype(body: Mesh, scene: Scene): void {
  body.isVisible = false;
  const shell = new PBRMaterial('prototype-ceramic', scene);
  shell.albedoColor = Color3.FromHexString('#EEE5D1'); shell.metallic = 0.18; shell.roughness = 0.24;
  const lens = new PBRMaterial('prototype-optics', scene);
  lens.albedoColor = Color3.FromHexString('#154C49'); lens.metallic = 0.55; lens.roughness = 0.17;
  lens.emissiveColor = Color3.FromHexString('#73C9A5').scale(0.4);
  const core = CreateSphere('adaptive-core', { diameter: 0.9, segments: 32 }, scene);
  core.scaling.set(1, 0.76, 1); core.parent = body; core.material = lens; core.isPickable = false;
  for (const y of [-0.28, 0.28]) {
    const cap = CreateSphere('core-ceramic-cap', { diameter: 1, segments: 32 }, scene);
    cap.scaling.set(1, 0.32, 1); cap.position.y = y; cap.parent = body; cap.material = shell; cap.isPickable = false;
  }
  const ring = CreateTorus('core-grip-ring', { diameter: 1.03, thickness: 0.1, tessellation: 48 }, scene);
  ring.parent = body; ring.material = shell; ring.isPickable = false;
}
