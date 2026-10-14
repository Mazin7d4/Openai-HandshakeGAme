import {
  ImportMeshAsync, Matrix, Mesh, PBRMaterial, Quaternion, TransformNode, Vector3, type Scene,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import '../assets/meshopt.ts';

export type PropName = 'Sofa' | 'Chair' | 'Rack' | 'Shelving' | 'Plant' | 'PlantSmall' | 'Cooling' | 'Duct' | 'Bookshelf' | 'Monitor';
export interface PropPlacement { prop: PropName; x: number; y?: number; z: number; ry?: number; scale?: number | [number, number, number] }

/**
 * Blender-authored prop kit (tools/blender/build_props.py → public/assets/props/office-kit.glb).
 * Every prop+material part is a single source mesh; placements are GPU instances, so a prop costs one
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
      child.isPickable = false; child.receiveShadows = true; child.metadata = { ...child.metadata, castShadow: true };
      if (child.material instanceof PBRMaterial) child.material.maxSimultaneousLights = 4;
    }
    sources.set(node.name.slice(5), parts);
  }
  // Source meshes stay in the scene (instances need them) but are parked far away and never rendered.
  for (const parts of sources.values()) for (const { mesh } of parts) { mesh.setParent(null); mesh.position.y = -1000; mesh.isVisible = true; }
  for (const root of result.meshes.filter(m => !m.parent)) if (root.name === '__root__') root.setEnabled(true);
  let count = 0;
  const place = (p: PropPlacement) => {
    const parts = sources.get(p.prop);
    if (!parts) throw new Error(`Unknown prop ${p.prop}`);
    const holder = new TransformNode(`prop-${p.prop}-${count++}`, scene);
    // Babylon's glTF handedness conversion turns the authored kit 180° (same as the lab hero kit).
    holder.position.set(p.x, p.y ?? 0, p.z); holder.rotation.y = (p.ry ?? 0) + Math.PI;
    if (Array.isArray(p.scale)) holder.scaling.set(...p.scale); else holder.scaling.setAll(p.scale ?? 1);
    for (const { mesh, local } of parts) {
      const inst = mesh.createInstance(`${holder.name}-${mesh.name}`);
      const s = new Vector3(), r = new Quaternion(), t = new Vector3();
      local.decompose(s, r, t);
      inst.scaling.copyFrom(s); inst.rotationQuaternion = r; inst.position.copyFrom(t);
      inst.parent = holder; inst.isPickable = false;
    }
    holder.computeWorldMatrix(true);
    for (const c of holder.getChildMeshes()) { c.computeWorldMatrix(true); c.freezeWorldMatrix(); }
    return holder;
  };
  return { place, names: [...sources.keys()] };
}
