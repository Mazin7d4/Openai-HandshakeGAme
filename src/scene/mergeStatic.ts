import { Mesh, type AbstractMesh, type Material, type Scene } from '@babylonjs/core';

export interface MergeStaticOptions {
  /** Return true for meshes that may be baked into a per-material static batch. */
  include: (mesh: Mesh) => boolean;
  /** Name prefix for merged outputs. */
  namePrefix?: string;
}

/**
 * Collapse static decoration into one mesh per material.
 * Meshes that carry a physics body stay as invisible colliders; a world-baked visual
 * clone is merged instead so collision keeps working. Camera-occluder meshes must be
 * excluded by the caller — occlusion fades mesh.visibility per wall.
 * Returns the number of render meshes removed (≈ draw calls saved).
 */
export function mergeStaticByMaterial(scene: Scene, options: MergeStaticOptions): number {
  const prefix = options.namePrefix ?? 'static';
  const byMat = new Map<Material, Mesh[]>();

  for (const mesh of scene.meshes.slice()) {
    if (!(mesh instanceof Mesh)) continue;
    if (!mesh.isVisible || !mesh.material) continue;
    if (mesh.instances?.length) continue;
    if ((mesh.thinInstanceCount ?? 0) > 0) continue;
    if (!mesh.getTotalVertices()) continue;
    if (!options.include(mesh)) continue;
    const list = byMat.get(mesh.material) ?? [];
    list.push(mesh);
    byMat.set(mesh.material, list);
  }

  let removed = 0;
  for (const [material, meshes] of byMat) {
    if (meshes.length < 2) continue;

    const toMerge: Mesh[] = [];
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      if (mesh.physicsBody) {
        const viz = mesh.clone(`${mesh.name}-viz`, null, true);
        if (!viz) continue;
        // Clones do not keep the Havok body; originals stay as invisible colliders.
        viz.setParent(null);
        viz.bakeCurrentTransformIntoVertices();
        viz.position.setAll(0);
        viz.rotation.setAll(0);
        if (viz.rotationQuaternion) viz.rotationQuaternion.set(0, 0, 0, 1);
        viz.scaling.setAll(1);
        viz.isPickable = false;
        viz.receiveShadows = mesh.receiveShadows;
        viz.metadata = { ...(viz.metadata ?? {}), castShadow: mesh.metadata?.castShadow };
        mesh.isVisible = false;
        toMerge.push(viz);
      } else {
        mesh.setParent(null);
        mesh.bakeCurrentTransformIntoVertices();
        mesh.position.setAll(0);
        mesh.rotation.setAll(0);
        if (mesh.rotationQuaternion) mesh.rotationQuaternion.set(0, 0, 0, 1);
        mesh.scaling.setAll(1);
        toMerge.push(mesh);
      }
    }

    if (toMerge.length < 2) {
      for (const m of toMerge) if (m.name.endsWith('-viz')) m.dispose(false, false);
      continue;
    }

    const merged = Mesh.MergeMeshes(toMerge, true, true, undefined, false, false);
    if (!merged) continue;
    removed += toMerge.length - 1;
    merged.name = `${prefix}-${material.name}`;
    merged.material = material;
    merged.isPickable = false;
    merged.receiveShadows = true;
    if (toMerge.some((m) => m.metadata?.castShadow)) {
      merged.metadata = { ...(merged.metadata ?? {}), castShadow: true };
    }
    merged.freezeWorldMatrix();
    merged.doNotSyncBoundingInfo = true;
  }
  return removed;
}

/** True when a mesh is a drone / mascot part (PIX/NEE). Never batch these. */
export function isMascotMesh(mesh: AbstractMesh): boolean {
  const n = mesh.name;
  return n.includes('player-')
    || n.startsWith('HoverPod_')
    || n.startsWith('Antenna')
    || n.startsWith('Face')
    || n.startsWith('TetherSocket')
    || n.startsWith('node9')
    || n === 'DarkMetal'
    || n === 'Glow'
    || n === 'Accent'
    || n === 'Shell'
    || n === 'FaceRim'
    || n === 'FaceScreen';
}

/** Names / prefixes that stay separate (animated, interactive, networked, or gameplay-critical). */
export function isDynamicOrInteractive(mesh: AbstractMesh): boolean {
  const n = mesh.name;
  if (mesh.metadata?.cameraOccluder) return true;
  if (isMascotMesh(mesh)) return true;
  return n.startsWith('escape-route-light')
    || n.startsWith('exit-sign') // scales on alarm
    || n.startsWith('vault-belljar')
    || n.startsWith('vault-halo')
    || n.startsWith('vault-beam') // alarm/vault reveal alpha
    || n.startsWith('plinth-ring')
    || n.startsWith('alarm-beacon')
    || n.includes('beacon')
    || n.startsWith('office-access-shutter')
    || n.startsWith('pressure-relief-shutter')
    || n.startsWith('p01-')
    || n.startsWith('labcrate-')
    || n.startsWith('terminal-')
    || n.startsWith('security-')
    || n.startsWith('tether')
    || n.startsWith('cargo-')
    || n.startsWith('crate-')
    || n.includes('collider')
    || n.startsWith('prop-collider')
    || n.startsWith('__root__')
    || n.startsWith('Hero_'); // keep hero art separate from lab kit batches
}
