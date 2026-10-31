import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';
import '../assets/registerGltf.ts';
import '../assets/meshopt.ts';
import { finishDecorMaterial } from './DecorMaterials.ts';

export type PropName = 'Sofa' | 'Chair' | 'Rack' | 'Shelving' | 'Plant' | 'PlantSmall' | 'Cooling' | 'Duct' | 'Bookshelf' | 'Monitor' | 'Lockers' | 'ParcelTrolley' | 'AcousticPanel';
export interface PropPlacement { prop: PropName; x: number; y?: number; z: number; ry?: number; scale?: number | [number, number, number] }

/**
 * Blender-authored prop kit (tools/blender/build_props.py → public/assets/props/office-kit.glb).
 * Every prop+material part is a single source mesh; placements are thin instances, so a prop costs one
 * draw call per material no matter how many times it is placed. Decorative only; collision lives in level code.
 */
export async function loadPropKit(scene: Scene) {
  const result = await ImportMeshAsync(`${import.meta.env.BASE_URL}assets/props/office-kit.glb`, scene);
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
      finishDecorMaterial(child.material);
    }
    sources.set(node.name.slice(5), parts);
  }
  // Identity transform at the origin: thin-instance matrices are world-space and replace the master draw.
  for (const parts of sources.values()) {
    for (const { mesh } of parts) {
      mesh.setParent(null);
      mesh.position.setAll(0);
      mesh.rotation.setAll(0);
      if (mesh.rotationQuaternion) mesh.rotationQuaternion.set(0, 0, 0, 1);
      mesh.scaling.setAll(1);
      mesh.isPickable = false;
      mesh.isVisible = true;
    }
  }
  for (const root of result.meshes.filter(m => !m.parent)) if (root.name === '__root__') root.setEnabled(false);

  let count = 0;
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
      // local (authored part offset) then holder world — same as parenting an InstancedMesh.
      mesh.thinInstanceAdd(local.multiply(world), false);
    }
    holder.setEnabled(false);
    return holder;
  };

  /** Call after all place() calls so thin-instance buffers and bounds are final. */
  const commit = () => {
    for (const parts of sources.values()) {
      for (const { mesh } of parts) {
        if (mesh.thinInstanceCount === 0) {
          mesh.isVisible = false;
          continue;
        }
        mesh.thinInstanceBufferUpdated('matrix');
        mesh.thinInstanceRefreshBoundingInfo(true);
        mesh.computeWorldMatrix(true);
        mesh.freezeWorldMatrix();
        mesh.doNotSyncBoundingInfo = true;
        if (mesh.material && 'freeze' in mesh.material) {
          try { (mesh.material as { freeze: () => void }).freeze(); } catch { /* ok */ }
        }
      }
    }
  };

  return { place, commit, names: [...sources.keys()] };
}
