import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Scene } from '@babylonjs/core/scene.js';
import '../assets/registerGltf.ts';
import '../assets/meshopt.ts';
import { finishDecorMaterial } from './DecorMaterials.ts';

export type PropName = 'Sofa' | 'Chair' | 'Rack' | 'Shelving' | 'Plant' | 'PlantSmall' | 'Cooling' | 'Duct' | 'Bookshelf' | 'Monitor' | 'Lockers' | 'ParcelTrolley' | 'AcousticPanel' | 'LabInstrument' | 'MailSorter' | 'OfficeArchive';
export interface PropPlacement { prop: PropName; x: number; y?: number; z: number; ry?: number; scale?: number | [number, number, number] }

/**
 * Blender-authored prop kit (tools/blender/build_props.py → public/assets/props/office-kit.glb).
 * Placements are baked into one vertex-coloured batch per room and material, so repeated props
 * share a draw while distant rooms can still be culled. Decorative only; collision lives in level code.
 */
export async function loadPropKit(scene: Scene) {
  const results = await Promise.all(['office-kit.glb', 'room-setpieces.glb'].map(file =>
    ImportMeshAsync(`${import.meta.env.BASE_URL}assets/props/${file}`, scene)));
  const result = { meshes: results.flatMap(item => item.meshes), transformNodes: results.flatMap(item => item.transformNodes) };
  const neutralMaterial = result.meshes.find(mesh => mesh.material?.name === 'DecorMatte')?.material;
  const sources = new Map<string, { mesh: Mesh; local: Matrix }[]>();
  for (const node of result.transformNodes) {
    if (!node.name.startsWith('Prop_')) continue;
    const parts: { mesh: Mesh; local: Matrix }[] = [];
    for (const child of node.getChildMeshes(false)) {
      if (!(child instanceof Mesh) || !child.getTotalVertices()) continue;
      child.computeWorldMatrix(true);
      parts.push({ mesh: child, local: child.getWorldMatrix().clone() });
      child.isPickable = false;
      child.receiveShadows = true;
      child.metadata = { ...child.metadata, castShadow: true };
      if (neutralMaterial) child.material = neutralMaterial;
      finishDecorMaterial(child.material);
    }
    sources.set(node.name.slice(5), parts);
  }
  // Sources keep their authored geometry; each placement bakes the captured import transform once.
  for (const parts of sources.values()) {
    for (const { mesh } of parts) {
      mesh.setParent(null);
      mesh.position.setAll(0);
      mesh.rotation.setAll(0);
      if (mesh.rotationQuaternion) mesh.rotationQuaternion.set(0, 0, 0, 1);
      mesh.scaling.setAll(1);
      mesh.isPickable = false;
      mesh.isVisible = false;
    }
  }
  for (const root of result.meshes.filter(m => !m.parent)) if (root.name === '__root__') root.setEnabled(false);

  let count = 0;
  const batches = new Map<string, Map<Material, Mesh[]>>();
  // Spatial batches preserve room culling and avoid a building-wide shadow caster.
  const roomAt = (z: number) => z < -55 ? 'apron' : z < -43 ? 'reception'
    : z < -26 ? 'office' : z < 2 ? 'server' : z < 27 ? 'lab' : 'dock';
  const place = (p: PropPlacement) => {
    const parts = sources.get(p.prop);
    if (!parts) throw new Error(`Unknown prop ${p.prop}`);
    const holder = new TransformNode(`prop-${p.prop}-${count++}`, scene);
    // Babylon's glTF handedness conversion turns the authored kit 180° (same as the lab hero kit).
    holder.position.set(p.x, p.y ?? 0, p.z); holder.rotation.y = (p.ry ?? 0) + Math.PI;
    if (Array.isArray(p.scale)) holder.scaling.set(...p.scale); else holder.scaling.setAll(p.scale ?? 1);
    holder.computeWorldMatrix(true);
    const world = holder.getWorldMatrix();
    for (const { mesh, local } of parts) {
      if (!mesh.material) continue;
      const copy = mesh.clone(`decor-prop-${p.prop}`, null, true);
      copy.makeGeometryUnique();
      copy.bakeTransformIntoVertices(local.multiply(world));
      copy.isVisible = true; copy.isPickable = false;
      const materials = batches.get(roomAt(p.z)) ?? new Map<Material, Mesh[]>();
      const group = materials.get(mesh.material) ?? [];
      group.push(copy); materials.set(mesh.material, group); batches.set(roomAt(p.z), materials);
    }
    holder.setEnabled(false);
    return holder;
  };

  /** Finalize static room batches after all placements. Collision never comes from furniture. */
  const commit = () => {
    for (const [room, materials] of batches) for (const [material, parts] of materials) {
      const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
      if (!mesh) continue;
      mesh.name = `decor-props-${room}-${material.name}`;
      mesh.material = material; mesh.isPickable = false; mesh.receiveShadows = true;
      mesh.metadata = { castShadow: true, decorRoom: room };
      mesh.freezeWorldMatrix();
    }
    batches.clear();
  };

  return { place, commit, names: [...sources.keys()] };
}
