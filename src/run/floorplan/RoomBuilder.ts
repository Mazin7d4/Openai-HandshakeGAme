import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { RoomPiece, RoomPlan } from '../../../shared/nightshift/types.d.ts';
import { addStaticBody } from '../../physics/staticBody.ts';
import { getQuality } from '../../scene/createScene.ts';
import { loadKitSources, placeKitAsset } from '../../level/kit/KitDressing.ts';
import { floorMaterials, pieceMaterial } from './materials.ts';
import { createRoundedBox } from '../../scene/roundedBox.ts';

export interface FloorBuildHandle {
  dispose(): void;
  drawCalls: number;
  bodies: number;
}

function themeMat(scene: Scene, room: RoomPlan, mat: RoomPiece['mat'], low: boolean) {
  const materials = floorMaterials(scene);
  const themed = room.archetype === 'rack-maze' || room.archetype === 'cold-aisle'
    ? (mat === 'rack' ? 'serverBlue' : mat === 'metal' ? 'vaultSteel' : null)
    : room.archetype === 'cubicle-farm' || room.archetype === 'boardroom'
      ? (mat === 'desk' ? 'officeWarm' : mat === 'partition' ? 'officeSage' : null)
      : room.archetype === 'vent-crawl'
        ? (mat === 'duct' || mat === 'metal' ? 'ventSteel' : null)
        : room.archetype === 'laser-vault'
          ? (mat === 'metal' ? 'vaultSteel' : mat === 'glass' ? 'vaultGold' : null)
          : null;
  return themed ? materials[themed] : pieceMaterial(scene, mat, low);
}

function bossVaultDressing(scene: Scene, low: boolean, owned: AbstractMesh[], lights: SpotLight[]): void {
  const materials = floorMaterials(scene);
  const gold: Mesh[] = [];
  const steel: Mesh[] = [];
  const marks: Mesh[] = [];
  const door = CreateCylinder('boss-vault-door', { diameter: 10.5, height: 0.42, tessellation: low ? 24 : 40 }, scene);
  // Keep the hero door just inside the rear wall so it is in the gameplay
  // camera's visible side of the wall rather than clipped outside the room.
  door.rotation.x = Math.PI / 2; door.position.set(0, 7, 24.22); door.material = materials.vaultGold; gold.push(door);
  const trim = CreateTorus('boss-vault-door-trim', { diameter: 10.7, thickness: 0.32, tessellation: low ? 24 : 40 }, scene);
  trim.rotation.x = Math.PI / 2; trim.position.set(0, 7, 24.04); trim.material = materials.vaultGoldBright; gold.push(trim);
  const dial = CreateTorus('boss-vault-dial', { diameter: 2.15, thickness: 0.16, tessellation: 24 }, scene);
  dial.rotation.x = Math.PI / 2; dial.position.set(0, 7, 23.94); dial.material = materials.vaultGoldBright; gold.push(dial);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const bolt = CreateCylinder('boss-vault-bolt', { diameter: 0.42, height: 0.12, tessellation: 10 }, scene);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(Math.cos(a) * 4.45, 7 + Math.sin(a) * 4.45, 23.92);
    bolt.material = materials.vaultGoldBright; gold.push(bolt);
  }
  for (const x of [-13.5, 13.5]) {
    const panel = createRoundedBox('boss-vault-wall-panel', { width: 1.4, height: 12, depth: 0.18, radius: 0.08, segments: 1 }, scene);
    panel.position.set(x, 7, 23.8); panel.material = materials.vaultPanel; steel.push(panel);
  }
  for (const z of [5, 12, 19]) {
    const stripe = createRoundedBox('boss-vault-floor-mark', { width: 0.16, height: 0.025, depth: 8, radius: 0.02, segments: 1 }, scene);
    stripe.position.set(-9, 0.035, z); stripe.material = materials.vaultGold; marks.push(stripe);
    const stripe2 = stripe.clone('boss-vault-floor-mark'); stripe2.position.x = 9; marks.push(stripe2);
  }
  const merge = (parts: Mesh[], name: string, material: AbstractMesh['material']): Mesh | null => {
    if (!parts.length) return null;
    const mesh = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!mesh) return null;
    mesh.name = name; mesh.material = material; finishStatic(mesh, false); owned.push(mesh);
    return mesh;
  };
  const goldMesh = merge(gold, 'boss-vault-gold', materials.vaultGoldBright);
  const steelMesh = merge(steel, 'boss-vault-panels', materials.vaultPanel);
  const marksMesh = merge(marks, 'boss-vault-floor-marks', materials.vaultGold);
  if (!low) {
    // Scope the single vault light to vault dressing only. Everything else keeps
    // the hemi + sun + nearest hero key/fill four-light budget.
    const key = new SpotLight('vault-spot', new Vector3(0, 12, 14), new Vector3(0, -5, 12), Math.PI * 0.52, 2, scene);
    key.diffuse.set(1, 0.82, 0.55); key.intensity = 1.1; key.range = 28;
    key.includedOnlyMeshes = [goldMesh, steelMesh, marksMesh].filter((mesh): mesh is Mesh => !!mesh);
    lights.push(key);
  }
}

interface TrackedBody {
  dispose(): void;
}

function validPiece(piece: RoomPiece): boolean {
  return Number.isFinite(
    piece.x + piece.y + piece.z + piece.sx + piece.sy + piece.sz + piece.rotY,
  ) && piece.sx > 0 && piece.sy > 0 && piece.sz > 0;
}

/** Keep server racks below the normal over-the-shoulder sightline. Colliders keep authored size. */
function visualPieceHeight(piece: RoomPiece): number {
  return piece.mat === 'rack' ? Math.min(piece.sy, 1.8) : piece.sy;
}

function finishStatic(mesh: Mesh, occluder: boolean): void {
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  if (occluder) {
    mesh.metadata = { ...(mesh.metadata ?? {}), cameraOccluder: true };
  }
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
}

export async function buildRooms(scene: Scene, rooms: RoomPlan[], boss = false): Promise<FloorBuildHandle> {
  const quality = getQuality(scene)?.status.tier;
  const low = quality === 'low';
  const useKits = !low;
  const materials = floorMaterials(scene);
  const visualGroups = new Map<string, Mesh[]>();
  const ownedMeshes: AbstractMesh[] = [];
  const bodies: TrackedBody[] = [];
  const kitSources = new Set<Mesh>();
  const accentLights: SpotLight[] = [];
  let kitPlacements = 0;

  if (useKits) {
    await loadKitSources(scene);
  }

  const addVisual = (mesh: Mesh, materialName: string, occluder: boolean, override?: AbstractMesh['material']): void => {
    mesh.material = override ?? (materialName === 'glass' && low ? materials.glassOpaque : materials[materialName] ?? pieceMaterial(scene, materialName as RoomPiece['mat'], low));
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    const key = `${materialName}:${occluder ? 'occluder' : 'ordinary'}:${mesh.material?.name ?? materialName}`;
    const group = visualGroups.get(key) ?? [];
    group.push(mesh);
    visualGroups.set(key, group);
  };

  const addPrimitive = (piece: RoomPiece, room: RoomPlan): void => {
    const visualSy = visualPieceHeight(piece);
    const mesh = piece.kind === 'cyl'
      ? CreateCylinder(`room-${piece.mat}`, {
        diameter: piece.sx,
        height: visualSy,
        tessellation: 12,
      }, scene)
      : CreateBox(`room-${piece.mat}`, {
        width: piece.sx,
        height: visualSy,
        depth: piece.sz,
      }, scene);
    mesh.position.set(piece.x, piece.y - (piece.sy - visualSy) * 0.5, piece.z);
    mesh.rotation.y = piece.rotY;
    addVisual(mesh, piece.mat, piece.sy > 2.2 && piece.mat !== 'pylon', themeMat(scene, room, piece.mat, low));
  };

  for (const room of rooms ?? []) {
    for (const piece of room.pieces ?? []) {
      if (!piece || !validPiece(piece)) {
        continue;
      }

      let kitMeshes: AbstractMesh[] = [];
      // Rack kit pivots are authored for full-level dressing rather than centred plan pieces;
      // use the sized primitive for these sightline-critical blockers.
      if (useKits && piece.asset && piece.mat !== 'rack' && kitPlacements < 16) {
        const visualSy = visualPieceHeight(piece);
        kitMeshes = await placeKitAsset(
          scene,
          piece.asset,
          new Vector3(piece.x, piece.y - (piece.sy - visualSy) * 0.5, piece.z),
          piece.rotY,
          new Vector3(piece.sx, piece.sy, piece.sz),
        );
        if (visualSy < piece.sy) {
          const heightScale = visualSy / piece.sy;
          for (const kitMesh of kitMeshes) {
            kitMesh.scaling.y *= heightScale;
          }
        }
        // Kit assets use authored pivots rather than the plan's centre convention. Re-centre
        // the placed bounds so a rack's requested height really clears the drone sightline.
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const kitMesh of kitMeshes) {
          kitMesh.computeWorldMatrix(true);
          const bounds = kitMesh.getBoundingInfo().boundingBox;
          minY = Math.min(minY, bounds.minimumWorld.y);
          maxY = Math.max(maxY, bounds.maximumWorld.y);
        }
        const visualCenterY = piece.y - (piece.sy - visualSy) * 0.5;
        const centerOffset = visualCenterY - (minY + maxY) * 0.5;
        for (const kitMesh of kitMeshes) kitMesh.position.y += centerOffset;
        if (kitMeshes.length > 0) {
          kitPlacements++;
          for (const kitMesh of kitMeshes) {
            kitMesh.isPickable = false;
            kitMesh.receiveShadows = true;
            kitMesh.freezeWorldMatrix();
            kitMesh.doNotSyncBoundingInfo = true;
            if (piece.sy > 2.2) {
              kitMesh.metadata = { ...(kitMesh.metadata ?? {}), cameraOccluder: true };
            }
            ownedMeshes.push(kitMesh);
            const source = (kitMesh as { sourceMesh?: Mesh }).sourceMesh;
            if (source) {
              kitSources.add(source);
            }
          }
        }
      }

      if (kitMeshes.length === 0) {
        addPrimitive(piece, room);
      }

      if (piece.solid) {
        const proxy = CreateBox(`room-collider-${piece.mat}`, {
          width: piece.sx,
          height: piece.sy,
          depth: piece.sz,
        }, scene);
        proxy.position.set(piece.x, piece.y, piece.z);
        proxy.rotation.y = piece.rotY;
        proxy.isVisible = false;
        proxy.isPickable = false;
        proxy.doNotSyncBoundingInfo = true;
        bodies.push(addStaticBody(proxy, scene));
        ownedMeshes.push(proxy);
      }
    }
  }

  if (boss && rooms.some((room) => room.slot === 'vault')) {
    bossVaultDressing(scene, low, ownedMeshes, accentLights);
  }

  const visualMeshes: Mesh[] = [];
  for (const [key, list] of visualGroups) {
    const [materialName, occluderName] = key.split(':');
    const occluder = occluderName === 'occluder';
    const groupMaterial = list[0].material;
    if (list.length === 1) {
      finishStatic(list[0], occluder);
      visualMeshes.push(list[0]);
      continue;
    }

    const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
    if (!merged) {
      for (const mesh of list) {
        finishStatic(mesh, occluder);
        visualMeshes.push(mesh);
      }
      continue;
    }
    merged.name = `room-merged-${materialName}-${occluder ? 'occluder' : 'static'}`;
    merged.material = groupMaterial;
    finishStatic(merged, occluder);
    visualMeshes.push(merged);
  }

  ownedMeshes.push(...visualMeshes);
  const drawCalls = kitSources.size + visualMeshes.length;
  let disposed = false;
  const handle: FloorBuildHandle = {
    drawCalls,
    bodies: bodies.length,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const body of bodies) {
        body.dispose();
      }
      for (const mesh of ownedMeshes) {
        mesh.dispose(false, false);
      }
      for (const light of accentLights) light.dispose();
    },
  };
  scene.onDisposeObservable.addOnce(() => handle.dispose());
  return handle;
}
