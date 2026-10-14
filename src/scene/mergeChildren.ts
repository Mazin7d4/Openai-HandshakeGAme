import { Mesh, type Material, type TransformNode } from '@babylonjs/core';

/**
 * Collapse a rigid visual rig (many small child meshes) into one mesh per material, still parented
 * to `root` so it follows the physics body. Animated parts are passed in `keep` and left alone.
 * Returns the number of meshes (≈ draw calls) removed.
 */
export function mergeRigidChildren(root: TransformNode, keep: Mesh[] = []): number {
  const byMat = new Map<Material, Mesh[]>();
  for (const m of root.getChildMeshes(false)) {
    if (!(m instanceof Mesh) || keep.includes(m) || !m.material) continue;
    const list = byMat.get(m.material) ?? []; list.push(m); byMat.set(m.material, list);
  }
  let removed = 0;
  for (const [material, meshes] of byMat) {
    if (meshes.length < 2) continue;
    for (const m of meshes) m.computeWorldMatrix(true);
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = `${root.name}-${material.name}`; merged.material = material; merged.isPickable = false;
    merged.setParent(root);
    removed += meshes.length - 1;
  }
  return removed;
}
