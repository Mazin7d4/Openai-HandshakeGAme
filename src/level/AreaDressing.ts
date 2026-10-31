import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { createRoundedBox } from '../scene/roundedBox.ts';
import type { createLabPalette } from './LabPalette.ts';
import type { PropPlacement } from './PropKit.ts';
import { dressRoomFinishes } from './RoomFinishes.ts';

type Palette = ReturnType<typeof createLabPalette>;

/** Collision-free everyday objects. All colour is quiet; only gameplay objects advertise interaction. */
export function dressMissionAreas(scene: Scene, p: Palette, kit: { place(p: PropPlacement): unknown }): Mesh[] {
  const groups = new Map<Material, Mesh[]>();
  const add = (mesh: Mesh, material: Material) => {
    mesh.isPickable = false;
    const list = groups.get(material) ?? [];
    list.push(mesh); groups.set(material, list);
    return mesh;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat: Material, ry = 0) => {
    const mesh = createRoundedBox('decor', { width: w, height: h, depth: d, radius: Math.min(0.065, h / 4), segments: 1 }, scene);
    mesh.position.set(x, y, z); mesh.rotation.y = ry;
    return add(mesh, mat);
  };
  const cyl = (x: number, y: number, z: number, h: number, diameter: number, mat: Material) => {
    const mesh = CreateCylinder('decor', { height: h, diameter, tessellation: 12 }, scene);
    mesh.position.set(x, y, z); return add(mesh, mat);
  };
  const keyboard = (x: number, z: number) => {
    box(x, 3.97, z, 1.8, 0.1, 0.65, p.dark);
    for (let i = 0; i < 4; i++) box(x, 4.028, z - 0.22 + i * 0.145, 1.6, 0.02, 0.08, p.metal);
  };
  const cup = (x: number, y: number, z: number) => {
    cyl(x, y + 0.22, z, 0.44, 0.34, p.paint);
    cyl(x, y + 0.445, z, 0.008, 0.27, p.dark);
  };
  // Shallow, wall-side diffusers stay out of the flying crew's central sightline.
  const fixture = (x: number, z: number, len = 4) => {
    box(x, 8.45, z, 0.7, 0.24, len, p.metal);
    box(x, 8.31, z, 0.5, 0.04, len - 0.2, p.light);
  };

  // Apron: delivery staging, a parcel shelf and a recessed, printed notice board.
  kit.place({ prop: 'Shelving', x: 17.7, z: -62, scale: 0.7 });
  kit.place({ prop: 'ParcelTrolley', x: -15, z: -62.5, scale: 0.85, ry: 0.2 });
  box(18.61, 5.7, -58.3, 0.09, 2, 3.2, p.wood);
  box(18.54, 5.7, -58.3, 0.04, 1.78, 2.98, p.coral);
  for (let i = 0; i < 3; i++) box(18.505, 5.9 - i * 0.12, -59.2 + i * 0.85, 0.02, 0.85, 0.6, p.paint);
  fixture(17, -60); fixture(-17, -60);

  // Reception: a quiet lounge on the perimeter; nothing floats outside the reduced desk.
  kit.place({ prop: 'Sofa', x: 16.3, z: -48.8, ry: -Math.PI / 2, scale: 0.85 });
  kit.place({ prop: 'Plant', x: 14.8, z: -53, scale: 0.76 });
  kit.place({ prop: 'Plant', x: -15.8, z: -45, scale: 0.8 });
  box(11.8, 1.5, -48.8, 3.6, 0.24, 4.4, p.wood);
  for (const x of [10.3, 13.3]) for (const z of [-50.6, -47]) cyl(x, 0.69, z, 1.38, 0.13, p.metal);
  box(11.3, 1.69, -49.1, 1.35, 0.14, 1.8, p.coral);
  box(11.4, 1.81, -49, 1.2, 0.1, 1.65, p.paint);
  cup(12.6, 1.62, -47.8); keyboard(-3.1, -48.5); cup(-6.7, 3.92, -49.8);
  kit.place({ prop: 'PlantSmall', x: -7, y: 3.92, z: -48.5, scale: 0.6 });
  box(-1.5, 0.038, -53, 7, 0.025, 2.1, p.dark);
  // Far wall has a fluted wall panel, distinguished by profile instead of illumination.
  for (let i = 0; i < 13; i++) box(5.2 + i * 0.62, 2.35, -43.36, 0.25, 4.5, 0.16, p.wood);
  fixture(17, -48); fixture(-17, -49);

  // Vent: a shallow, lighter duct below the wall cut; no floor stripes or hazard decals.
  kit.place({ prop: 'Duct', x: -5, y: 7.65, z: -43, ry: Math.PI / 2, scale: 0.72 });
  for (let y = 5.4; y < 8; y += 0.45) for (const x of [-9.6, -0.6]) box(x, y, -43.35, 3.6, 0.08, 0.16, p.metal);

  // Office: low-contrast chairs and work objects on the existing desktops.
  kit.place({ prop: 'Chair', x: -5, z: -37.1, ry: Math.PI, scale: 0.85 });
  kit.place({ prop: 'Chair', x: 10.9, z: -34, ry: Math.PI + 0.35, scale: 0.85 });
  keyboard(-6, -34); keyboard(7.2, -32.4);
  cup(-1.8, 3.92, -33.6); cup(9.7, 3.92, -30.4);
  box(-8.1, 4.005, -33.8, 1.4, 0.16, 1.9, p.coral, 0.1);
  box(9.5, 4.005, -32, 1.3, 0.16, 1.7, p.paint, -0.1);
  kit.place({ prop: 'Bookshelf', x: 17.3, z: -36, scale: 0.92 });
  kit.place({ prop: 'Lockers', x: 12, z: -27.3, scale: 0.85 });
  kit.place({ prop: 'Plant', x: -15.8, z: -28.8, scale: 0.8 });
  box(-18.61, 5.8, -35, 0.1, 3.8, 6.8, p.metal);
  box(-18.54, 5.8, -35, 0.04, 3.55, 6.55, p.paint);
  for (let i = 0; i < 3; i++) box(-18.507, 6.4 - i * 0.65, -35.5, 0.02, 0.07, 3.8 - i * 0.6, p.coral);
  fixture(17, -31); fixture(-17, -36);

  // Server gallery: clear central aisle; no glowing status bars or overhead rails across the view.
  for (const x of [-8.5, 8.5]) {
    for (let z = -22.5; z <= -9.5; z += 2.4) {
      box(x, 3.65, z - 1.08, 1.9, 0.12, 0.06, p.metal);
    }
  }
  for (const z of [-22, -9]) kit.place({ prop: 'Cooling', x: 17.4, z, scale: 0.88 });
  kit.place({ prop: 'AcousticPanel', x: 11.5, z: -0.8, scale: 0.85 });
  for (const y of [6.8, 7.3]) {
    const run = cyl(18.35, y, -15, 20, 0.13, p.metal);
    run.rotation.x = Math.PI / 2;
  }
  fixture(17, -16, 7); fixture(-17, -16, 7);

  // Dock: service storage, a parked trolley, and matte parcel labels.
  kit.place({ prop: 'ParcelTrolley', x: -15, z: 30.8, ry: Math.PI / 2 });
  kit.place({ prop: 'Shelving', x: -17.7, z: 42, scale: 0.9 });
  for (const [x, z, w, d] of [[-12, 38.5, 2.4, 1.6], [-8, 43, 2.8, 2], [3.8, 30, 2.2, 1.6]] as const) {
    box(x, 1, z, w, 2, d, p.coral);
    box(x, 2.02, z, 0.2, 0.03, d, p.paint);
    box(x, 1.2, z - d / 2 - 0.015, w * 0.38, 0.42, 0.02, p.paint);
  }
  fixture(17, 34, 6); fixture(-17, 37, 6);
  dressRoomFinishes(scene);

  const merged: Mesh[] = [];
  for (const [material, meshes] of groups) {
    const mesh = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!mesh) continue;
    mesh.name = `dressing-${material.name}`; mesh.material = material;
    mesh.isPickable = false; mesh.receiveShadows = true;
    mesh.freezeWorldMatrix(); mesh.doNotSyncBoundingInfo = true;
    mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
    merged.push(mesh);
  }
  return merged;
}

/** Collapse noninteractive physics-free trim before the main static batch. */
export function mergeDecorative(scene: Scene, names: readonly string[]): number {
  const groups = new Map<Material, Mesh[]>();
  for (const mesh of scene.meshes) {
    if (!(mesh instanceof Mesh) || !names.includes(mesh.name) || mesh.physicsBody || !mesh.material) continue;
    const list = groups.get(mesh.material) ?? []; list.push(mesh); groups.set(mesh.material, list);
  }
  let removed = 0;
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const mesh = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!mesh) continue;
    removed += meshes.length - 1; mesh.name = `merged-${material.name}`; mesh.material = material;
    mesh.isPickable = false; mesh.receiveShadows = true; mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
  }
  return removed;
}
