import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
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

/** Matte reinforcement behind the vault. Its mechanical profile carries the room identity. */
function bossVaultDressing(scene: Scene, low: boolean, owned: AbstractMesh[], lights: SpotLight[]): void {
  const materials = floorMaterials(scene);
  const panels: Mesh[] = [], ribs: Mesh[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, parts: Mesh[]) => {
    const mesh = createRoundedBox('boss-vault-reinforcement', { width: w, height: h, depth: d, radius: 0.055, segments: 1 }, scene);
    mesh.position.set(x, y, z); parts.push(mesh);
  };
  for (const x of [-12.5, 12.5]) {
    box(x, 4.1, 26.5, 6, 8.1, 0.28, panels);
    for (let i = 0; i < 7; i++) box(x - 2.4 + i * 0.8, 4.1, 26.28, 0.19, 7.5, 0.27, ribs);
    box(x, 0.4, 26.17, 5.5, 0.3, 0.15, ribs);
  }
  const finished: Mesh[] = [];
  for (const [parts, name, material] of [[panels, 'boss-vault-panels', materials.vaultPanel], [ribs, 'boss-vault-ribs', materials.vaultGold]] as const) {
    const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!mesh) continue;
    mesh.name = name; mesh.material = material; finishStatic(mesh, false); owned.push(mesh); finished.push(mesh);
  }
  if (!low) {
    const key = new SpotLight('vault-spot', new Vector3(0, 8.6, 22), new Vector3(0, -2, 5), Math.PI * 0.6, 2, scene);
    key.diffuse.set(1, 0.97, 0.9); key.intensity = 0.6; key.range = 22;
    key.includedOnlyMeshes = finished; lights.push(key);
    // Hemi + sun + this vault key: omit room keys for the reinforced wall.
    for (const light of scene.lights) if (light.name.startsWith('hero-')) light.excludedMeshes.push(...finished);
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
