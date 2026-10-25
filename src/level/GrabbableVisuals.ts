import { mergeRigidChildren } from '../scene/mergeChildren.ts';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

/**
 * Cargo Core: a hand-carry power cell fitting a diameter-1 sphere.
 * Porcelain capsule body, graphite end caps with alu lips, an alu carry handle,
 * and a warm-diffuser emissive status band.
 */
export function dressCargoCore(body: Mesh, scene: Scene): void {
  body.isVisible = false;
  const root = new TransformNode('cargo-core-root', scene);
  root.parent = body;

  const add = (m: Mesh, mat: PBRMaterial | StandardMaterial) => {
    m.parent = root;
    m.isPickable = false;
    m.material = mat;
    return m;
  };

  // House palette: porcelain #E5E1D5, graphite #263737, brushed alu #A7B6B5, warm diffuser #FFF1D6
  const porcelain = new PBRMaterial('cargo-porcelain', scene);
  porcelain.albedoColor = Color3.FromHexString('#E5E1D5');
  porcelain.metallic = 0.05;
  porcelain.roughness = 0.35;

  const graphite = new PBRMaterial('cargo-graphite', scene);
  graphite.albedoColor = Color3.FromHexString('#263737');
  graphite.metallic = 0.15;
  graphite.roughness = 0.65;

  const alu = new PBRMaterial('cargo-alu', scene);
  alu.albedoColor = Color3.FromHexString('#A7B6B5');
  alu.metallic = 0.9;
  alu.roughness = 0.3;

  const status = new StandardMaterial('cargo-status', scene);
  status.disableLighting = true;
  status.emissiveColor = Color3.FromHexString('#FFF1D6');

  // Porcelain capsule body: cylinder d0.62 h0.62 plus two hemispheres
  add(CreateCylinder('cargo-cylinder', { height: 0.62, diameter: 0.62, tessellation: 36 }, scene), porcelain);
  const hemiTop = add(CreateSphere('cargo-hemi-top', { diameter: 0.62, slice: 0.5, segments: 24 }, scene), porcelain);
  hemiTop.position.y = 0.31;
  const hemiBottom = add(CreateSphere('cargo-hemi-bottom', { diameter: 0.62, slice: 0.5, segments: 24 }, scene), porcelain);
  hemiBottom.rotation.x = Math.PI;
  hemiBottom.position.y = -0.31;

  // Graphite end caps with alu lips (top and bottom)
  for (const y of [-1, 1]) {
    const cap = add(
      CreateCylinder('cargo-cap', {
        height: 0.12,
        diameterTop: y > 0 ? 0.44 : 0.56,
        diameterBottom: y > 0 ? 0.56 : 0.44,
        tessellation: 32,
      }, scene),
      graphite,
    );
    cap.position.y = y * 0.48;

    const junctionLip = add(
      CreateTorus('cargo-junction-lip', { diameter: 0.57, thickness: 0.035, tessellation: 32 }, scene),
      alu,
    );
    junctionLip.position.y = y * 0.42;

    const rimLip = add(
      CreateTorus('cargo-rim-lip', { diameter: 0.45, thickness: 0.03, tessellation: 32 }, scene),
      alu,
    );
    rimLip.position.y = y * 0.54;
  }

  // Carry handle: alu torus arc on top
  const handle = add(
    CreateTorus('cargo-handle', { diameter: 0.28, thickness: 0.045, tessellation: 32 }, scene),
    alu,
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.y = 0.58;

  // Emissive status band: warm-diffuser #FFF1D6 thin torus around the middle
  add(
    CreateTorus('cargo-status-band', { diameter: 0.63, thickness: 0.02, tessellation: 36 }, scene),
    status,
  );

  root.computeWorldMatrix(true);
  mergeRigidChildren(root);
}

/**
 * Coolant Cell: a coolant canister fitting a 0.9 cylinder.
 * Brushed-alu cylinder with graphite rubber bands top and bottom,
 * paper-white printed label band mid-height, and a graphite valve knob on top.
 */
export function dressCoolantCell(body: Mesh, scene: Scene): void {
  body.isVisible = false;
  const root = new TransformNode('coolant-cell-root', scene);
  root.parent = body;

  const add = (m: Mesh, mat: PBRMaterial | StandardMaterial) => {
    m.parent = root;
    m.isPickable = false;
    m.material = mat;
    return m;
  };

  // House palette: brushed alu #A7B6B5, graphite #263737, paper #F4EFE6
  const alu = new PBRMaterial('coolant-alu', scene);
  alu.albedoColor = Color3.FromHexString('#A7B6B5');
  alu.metallic = 0.9;
  alu.roughness = 0.3;

  const graphite = new PBRMaterial('coolant-graphite', scene);
  graphite.albedoColor = Color3.FromHexString('#263737');
  graphite.metallic = 0.05;
  graphite.roughness = 0.8;

  const paper = new PBRMaterial('coolant-paper', scene);
  paper.albedoColor = Color3.FromHexString('#F4EFE6');
  paper.metallic = 0.0;
  paper.roughness = 0.65;

  // Brushed-alu main canister fitting 0.9 cylinder
  add(CreateCylinder('coolant-body', { height: 0.95, diameter: 0.82, tessellation: 36 }, scene), alu);

  // Softened alu edges top and bottom
  for (const y of [-0.47, 0.47]) {
    const rim = add(CreateTorus('coolant-rim', { diameter: 0.80, thickness: 0.035, tessellation: 36 }, scene), alu);
    rim.position.y = y;
  }

  // Graphite rubber bands top and bottom (tori)
  for (const y of [-0.35, 0.35]) {
    const band = add(
      CreateTorus('coolant-rubber-band', { diameter: 0.835, thickness: 0.055, tessellation: 36 }, scene),
      graphite,
    );
    band.position.y = y;
  }

  // Paper-white printed label band (cylinder slightly larger, mid-height)
  add(CreateCylinder('coolant-label', { height: 0.38, diameter: 0.835, tessellation: 36 }, scene), paper);

  // Graphite print accent stripe on the label band
  const stripe = add(
    CreateCylinder('coolant-label-stripe', { height: 0.04, diameter: 0.84, tessellation: 36 }, scene),
    graphite,
  );
  stripe.position.y = 0.11;

  // Graphite valve knob on top
  const neck = add(
    CreateCylinder('coolant-valve-neck', { height: 0.08, diameter: 0.14, tessellation: 16 }, scene),
    graphite,
  );
  neck.position.y = 0.51;

  const hub = add(
    CreateCylinder('coolant-valve-hub', { height: 0.06, diameter: 0.28, tessellation: 24 }, scene),
    graphite,
  );
  hub.position.y = 0.56;

  const wheelRim = add(
    CreateTorus('coolant-valve-rim', { diameter: 0.28, thickness: 0.045, tessellation: 24 }, scene),
    graphite,
  );
  wheelRim.position.y = 0.56;

  const grip = add(
    CreateBox('coolant-valve-grip', { width: 0.3, height: 0.05, depth: 0.07 }, scene),
    graphite,
  );
  grip.position.y = 0.56;

  root.computeWorldMatrix(true);
  mergeRigidChildren(root);
}
