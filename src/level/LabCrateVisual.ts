import { mergeRigidChildren } from '../scene/mergeChildren.ts';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

/** Heavy Lab Crate: a rugged aluminium/plastic flight case with handles, latches and a hazard label. */
export function dressLabCrate(body: Mesh, size: number, scene: Scene): void {
  body.isVisible = false;
  const root = new TransformNode('labcrate-root', scene); root.parent = body;
  const s = size / 2;
  const add = (m: Mesh, mat: PBRMaterial | StandardMaterial) => { m.parent = root; m.isPickable = false; m.material = mat; m.freezeNormals(); return m; };
  const shell = new PBRMaterial('labcrate-shell', scene);
  shell.albedoColor = Color3.FromHexString('#3E4A52'); shell.metallic = 0.05; shell.roughness = 0.62;
  const alu = new PBRMaterial('labcrate-alu', scene);
  alu.albedoColor = Color3.FromHexString('#C3C8CC'); alu.metallic = 0.9; alu.roughness = 0.3;
  const rubber = new PBRMaterial('labcrate-rubber', scene);
  rubber.albedoColor = Color3.FromHexString('#1C1E20'); rubber.metallic = 0; rubber.roughness = 0.9;
  const hazard = new PBRMaterial('labcrate-hazard', scene);
  hazard.albedoColor = Color3.FromHexString('#F2B630'); hazard.metallic = 0; hazard.roughness = 0.5;
  const label = new PBRMaterial('labcrate-label', scene);
  label.albedoColor = Color3.FromHexString('#EDE8DC'); label.metallic = 0; label.roughness = 0.55;
  const led = new StandardMaterial('labcrate-led', scene);
  led.disableLighting = true; led.emissiveColor = Color3.FromHexString('#FFB347');

  add(CreateBox('labcrate-body', { width: size * 0.96, height: size * 0.9, depth: size * 0.96 }, scene), shell);
  // Lid seam band + aluminium edge extrusions.
  const seam = add(CreateBox('labcrate-seam', { width: size * 0.99, height: size * 0.06, depth: size * 0.99 }, scene), alu);
  seam.position.y = s * 0.45;
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const edge = add(CreateBox('labcrate-edge', { width: size * 0.07, height: size * 0.92, depth: size * 0.07 }, scene), alu);
    edge.position.set(x * s * 0.97, 0, z * s * 0.97);
    for (const y of [-1, 1]) {
      const corner = add(CreateBox('labcrate-corner', { size: size * 0.12 }, scene), rubber);
      corner.position.set(x * s * 0.96, y * s * 0.88, z * s * 0.96);
    }
  }
  // Recessed handles and latches on the two long sides.
  for (const z of [-1, 1]) {
    const handle = add(CreateCylinder('labcrate-handle', { height: size * 0.34, diameter: size * 0.045, tessellation: 10 }, scene), rubber);
    handle.rotation.z = Math.PI / 2; handle.position.set(0, s * 0.15, z * s * 1.02);
    for (const x of [-1, 1]) {
      const bracket = add(CreateBox('labcrate-bracket', { width: size * 0.05, height: size * 0.1, depth: size * 0.06 }, scene), alu);
      bracket.position.set(x * size * 0.17, s * 0.15, z * s * 0.99);
      const latch = add(CreateBox('labcrate-latch', { width: size * 0.09, height: size * 0.12, depth: size * 0.04 }, scene), alu);
      latch.position.set(x * s * 0.62, s * 0.38, z * s * 0.99);
    }
    // Hazard stripe + cream ID label.
    const stripe = add(CreateBox('labcrate-stripe', { width: size * 0.6, height: size * 0.08, depth: size * 0.02 }, scene), hazard);
    stripe.position.set(0, -s * 0.35, z * s * 0.975);
    const tag = add(CreateBox('labcrate-label', { width: size * 0.32, height: size * 0.16, depth: size * 0.02 }, scene), label);
    tag.position.set(0, -s * 0.12, z * s * 0.975);
  }
  const sticker = add(CreateBox('labcrate-hazard-top', { width: size * 0.3, height: size * 0.02, depth: size * 0.3 }, scene), hazard);
  sticker.position.set(s * 0.4, s * 0.47, s * 0.4); sticker.rotation.y = Math.PI / 4;
  const lamp = add(CreateBox('labcrate-led', { width: size * 0.05, height: size * 0.03, depth: size * 0.02 }, scene), led);
  lamp.position.set(s * 0.6, s * 0.15, s * 0.99);
  root.computeWorldMatrix(true);
  mergeRigidChildren(root);
  // The carry case can sit between the camera and a drone at extraction. Fade the prop,
  // just like a rack; architectural walls retain their permanent cutaway geometry.
  for (const mesh of root.getChildMeshes()) mesh.metadata = { ...mesh.metadata, cameraOccluder: true };
}
