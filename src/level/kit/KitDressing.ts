import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Nullable } from '@babylonjs/core/types.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import type { Scene } from '@babylonjs/core/scene.js';
import '../../assets/registerGltf.ts';
import '../../assets/meshopt.ts';
import type { RunLayout } from '../../seed/index.ts';
import { mixSeed, mulberry32 } from '../../seed/index.ts';
import kitManifest from './kit-manifest.json';
import { DRESSING } from './dressingTable.ts';
import { applyFloorTint, applyTwistMood } from './TwistMood.ts';
import { getQuality } from '../../scene/createScene.ts';

export interface KitDressingHandle {
  dispose(): void;
  drawCalls: number;
  placed: number;
  skipped: number;
}

interface KitPart {
  mesh: Mesh;
  local: Matrix;
}

export interface KitAsset {
  name: string;
  parts: KitPart[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  footprint: { w: number; d: number };
}

export interface KitSources {
  assets: Map<string, KitAsset>;
  allPartMeshes: Mesh[];
}

function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

function distToSegmentSq(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) {
    const ex = px - x1;
    const ez = pz - z1;
    return ex * ex + ez * ez;
  }
  let t = ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + t * dx;
  const nz = z1 + t * dz;
  const fx = px - nx;
  const fz = pz - nz;
  return fx * fx + fz * fz;
}

function aabbIntersects(
  aMin: { x: number; y: number; z: number },
  aMax: { x: number; y: number; z: number },
  bMin: { x: number; y: number; z: number },
  bMax: { x: number; y: number; z: number },
): boolean {
  return (
    aMin.x <= bMax.x &&
    aMax.x >= bMin.x &&
    aMin.y <= bMax.y &&
    aMax.y >= bMin.y &&
    aMin.z <= bMax.z &&
    aMax.z >= bMin.z
  );
}

const kitLoadingPromises = new WeakMap<Scene, Promise<KitSources>>();
const activeHandles = new WeakMap<Scene, KitDressingHandle>();
const warnedMissingAssets = new Set<string>();

export async function loadKitSources(scene: Scene): Promise<KitSources> {
  const cached = kitLoadingPromises.get(scene);
  if (cached) return cached;

  const loadPromise = (async () => {
    const manifestMap = new Map<string, (typeof kitManifest.assets)[number]>();
    for (const a of kitManifest.assets) {
      manifestMap.set(a.name, a);
    }

    const materialRegistry = new Map<string, unknown>();
    const assetSources = new Map<string, KitAsset>();
    const allPartMeshes: Mesh[] = [];

    const fileEntries = Object.values(kitManifest.files);
    for (const file of fileEntries) {
      const rel = file.startsWith('/') ? file.slice(1) : file;
      const url = `${import.meta.env.BASE_URL}${rel}`;
      try {
        const result = await ImportMeshAsync(url, scene);

        for (const node of result.transformNodes) {
          if (!node.name.startsWith('Kit_')) continue;
          const assetName = node.name.slice(4);
          const parts: KitPart[] = [];
          const manifestEntry = manifestMap.get(assetName);
          const footprint = manifestEntry?.footprint ?? { w: 1, d: 1 };
          const isSmallClutter = Math.max(footprint.w, footprint.d) < 1.0;

          for (const child of node.getChildMeshes(false)) {
            if (!(child instanceof Mesh) || !child.getTotalVertices()) continue;

            // Deduplicate shared materials
            if (child.material) {
              const baseMatName = child.material.name.replace(/\.\d+$/, '');
              const existingMat = materialRegistry.get(baseMatName);
              if (existingMat) {
                child.material = existingMat as typeof child.material;
              } else {
                materialRegistry.set(baseMatName, child.material);
              }
            }

            // Bake the glTF handedness root + node transform into the vertices (flips faces when
            // the determinant is negative), so thin-instance matrices stay plain placements.
            child.computeWorldMatrix(true);
            const world = child.getWorldMatrix().clone();
            child.setParent(null);
            child.position.set(0, 0, 0);
            child.rotationQuaternion = null;
            child.rotation.set(0, 0, 0);
            child.scaling.set(1, 1, 1);
            child.bakeTransformIntoVertices(world);
            const local = Matrix.Identity();
            child.computeWorldMatrix(true);
            child.freezeWorldMatrix();

            child.isPickable = false;
            child.receiveShadows = true;
            child.alwaysSelectAsActiveMesh = false;
            child.isVisible = false;
            if (!isSmallClutter) {
              child.metadata = { ...child.metadata, castShadow: true };
            }

            parts.push({ mesh: child, local });
            allPartMeshes.push(child);
          }

          if (parts.length > 0) {
            const bounds = (manifestEntry?.bounds as {
              min: [number, number, number];
              max: [number, number, number];
            }) ?? {
              min: [-1, -1, -1],
              max: [1, 1, 1],
            };
            assetSources.set(assetName, {
              name: assetName,
              parts,
              bounds,
              footprint,
            });
          }
        }
      } catch (err) {
        console.warn(`[kit] Failed to load GLB: ${url}`, err);
      }
    }

    return { assets: assetSources, allPartMeshes };
  })();

  kitLoadingPromises.set(scene, loadPromise);
  return loadPromise;
}

/** Place one cached kit asset as ordinary instances. Presentation callers own the returned meshes. */
export async function placeKitAsset(
  scene: Scene,
  name: string,
  position: Vector3,
  yaw: number,
  targetSize?: Vector3,
): Promise<AbstractMesh[]> {
  const kit = await loadKitSources(scene);
  const asset = kit.assets.get(name);
  if (!asset) return [];
  const sx = asset.bounds.max[0] - asset.bounds.min[0];
  const sy = asset.bounds.max[1] - asset.bounds.min[1];
  const sz = asset.bounds.max[2] - asset.bounds.min[2];
  const wanted = targetSize ?? new Vector3(sx, sy, sz);
  const scale = Math.min(
    sx > 0 ? wanted.x / sx : 1,
    sy > 0 ? wanted.y / sy : 1,
    sz > 0 ? wanted.z / sz : 1,
  );
  const out: AbstractMesh[] = [];
  for (const part of asset.parts) {
    const instance = part.mesh.createInstance(`${name}-instance`);
    instance.position.copyFrom(position);
    instance.rotation.set(0, yaw, 0);
    instance.scaling.setAll(scale);
    instance.isPickable = false;
    instance.receiveShadows = true;
    out.push(instance);
  }
  return out;
}

export async function dressRunLayout(scene: Scene, layout: RunLayout): Promise<KitDressingHandle> {
  const previousHandle = activeHandles.get(scene);
  if (previousHandle) {
    previousHandle.dispose();
    activeHandles.delete(scene);
  }

  const kit = await loadKitSources(scene);

  let placed = 0;
  let skipped = 0;

  // Gather gameplay physics meshes for clearance check (a)
  const physicsMeshes: { mesh: AbstractMesh; min: Vector3; max: Vector3 }[] = [];
  for (const m of scene.meshes) {
    if (m.isEnabled() && m.isVisible && m.physicsBody) {
      m.computeWorldMatrix(true);
      const bi = m.getBoundingInfo();
      physicsMeshes.push({
        mesh: m,
        min: bi.boundingBox.minimumWorld,
        max: bi.boundingBox.maximumWorld,
      });
    }
  }

  const placedBoxes: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }[] = [];

  const partMatrices = new Map<Mesh, Matrix[]>();
  for (const mesh of kit.allPartMeshes) {
    partMatrices.set(mesh, []);
  }

  // Iterate over variants
  for (const variant of Object.values(layout.variants)) {
    const rows = DRESSING[variant.id] ?? [];
    const vBounds = variant.bounds;
    const rand = mulberry32(mixSeed(layout.seed, hash(variant.id)));

    for (const row of rows) {
      if (row.low && getQuality(scene)?.status.tier === 'low') {
        skipped++;
        continue;
      }
      if (row.twist && row.twist !== layout.twist.id) {
        continue;
      }

      if (row.chance !== undefined && rand() > row.chance) {
        skipped++;
        continue;
      }

      const asset = kit.assets.get(row.asset);
      if (!asset) {
        if (!warnedMissingAssets.has(row.asset)) {
          warnedMissingAssets.add(row.asset);
          console.warn(`[kit] Asset not in manifest or kit sources: ${row.asset}`);
        }
        skipped++;
        continue;
      }

      let wx = vBounds.min.x + row.x * (vBounds.max.x - vBounds.min.x);
      let wz = vBounds.min.z + row.z * (vBounds.max.z - vBounds.min.z);

      if (row.jitter) {
        wx += (rand() * 2 - 1) * row.jitter;
        wz += (rand() * 2 - 1) * row.jitter;
      }

      // Clamp inside variant bounds
      wx = Math.max(vBounds.min.x, Math.min(vBounds.max.x, wx));
      wz = Math.max(vBounds.min.z, Math.min(vBounds.max.z, wz));

      let ry = row.ry ?? 0;
      if (row.jitterRy) {
        ry += (rand() * 2 - 1) * row.jitterRy;
      }
      const rotY = ry + Math.PI;

      const scale = row.scale ?? 1;

      // Ray down from bounds.max.y at (wx, wz) to find floor y
      const rayOrigin = new Vector3(wx, vBounds.max.y + 2, wz);
      const rayDirection = new Vector3(0, -1, 0);
      const rayLen = vBounds.max.y - vBounds.min.y + 4;
      const ray = new Ray(rayOrigin, rayDirection, rayLen);
      const hit = scene.pickWithRay(
        ray,
        (m) => m.isEnabled() && m.isVisible && !!m.physicsBody,
      );

      let floorY = vBounds.min.y;
      let floorMesh: Nullable<AbstractMesh> = null;
      if (hit && hit.hit && hit.pickedPoint) {
        floorY = hit.pickedPoint.y;
        floorMesh = hit.pickedMesh;
      }

      const finalY = floorY + (row.y ?? 0);

      // Compute footprint AABB rotated by rotY and scaled, expanded by 1.0 unit
      const bMin = asset.bounds.min;
      const bMax = asset.bounds.max;
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);

      const corners = [
        { x: bMin[0] * scale, z: bMin[2] * scale },
        { x: bMin[0] * scale, z: bMax[2] * scale },
        { x: bMax[0] * scale, z: bMin[2] * scale },
        { x: bMax[0] * scale, z: bMax[2] * scale },
      ];

      let rotMinX = Infinity;
      let rotMaxX = -Infinity;
      let rotMinZ = Infinity;
      let rotMaxZ = -Infinity;

      for (const c of corners) {
        const rx = c.x * cosR - c.z * sinR;
        const rz = c.x * sinR + c.z * cosR;
        if (rx < rotMinX) rotMinX = rx;
        if (rx > rotMaxX) rotMaxX = rx;
        if (rz < rotMinZ) rotMinZ = rz;
        if (rz > rotMaxZ) rotMaxZ = rz;
      }

      const minY = finalY + Math.min(bMin[1], bMax[1]) * scale;
      const maxY = finalY + Math.max(bMin[1], bMax[1]) * scale;

      const expandedAABB = {
        min: {
          x: wx + rotMinX - 1.0,
          y: minY - 1.0,
          z: wz + rotMinZ - 1.0,
        },
        max: {
          x: wx + rotMaxX + 1.0,
          y: maxY + 1.0,
          z: wz + rotMaxZ + 1.0,
        },
      };

      // Clearance check (a): physics bodies
      let collidesPhysics = false;
      for (const pm of physicsMeshes) {
        if (pm.mesh === floorMesh) continue;
        if (pm.max.y <= floorY + 0.05) continue;
        if (aabbIntersects(expandedAABB.min, expandedAABB.max, pm.min, pm.max)) {
          collidesPhysics = true;
          break;
        }
      }
      if (collidesPhysics) {
        skipped++;
        continue;
      }

      // Clearance check (b): variant openings (center ± halfExtents + 1.5)
      let collidesOpening = false;
      for (const op of variant.openings) {
        const opMin = {
          x: op.center.x - op.halfExtents.x - 1.5,
          y: op.center.y - op.halfExtents.y - 1.5,
          z: op.center.z - op.halfExtents.z - 1.5,
        };
        const opMax = {
          x: op.center.x + op.halfExtents.x + 1.5,
          y: op.center.y + op.halfExtents.y + 1.5,
          z: op.center.z + op.halfExtents.z + 1.5,
        };
        if (aabbIntersects(expandedAABB.min, expandedAABB.max, opMin, opMax)) {
          collidesOpening = true;
          break;
        }
      }
      if (collidesOpening) {
        skipped++;
        continue;
      }

      // Clearance check (c): circles r=4 around key locations
      const rSq = 16.0;
      let collidesCircle = false;
      for (const sp of variant.spawnPoints) {
        const dx = wx - sp.x;
        const dz = wz - sp.z;
        if (dx * dx + dz * dz < rSq) {
          collidesCircle = true;
          break;
        }
      }
      if (!collidesCircle) {
        for (const cp of variant.cover) {
          const dx = wx - cp.position.x;
          const dz = wz - cp.position.z;
          if (dx * dx + dz * dz < rSq) {
            collidesCircle = true;
            break;
          }
        }
      }
      if (!collidesCircle) {
        const points = [
          layout.loot,
          layout.extraction,
          ...Object.values(layout.terminals ?? {}),
          ...(layout.cameras ?? []).map((c) => c.origin),
        ];
        for (const pt of points) {
          if (!pt) continue;
          const dx = wx - pt.x;
          const dz = wz - pt.z;
          if (dx * dx + dz * dz < rSq) {
            collidesCircle = true;
            break;
          }
        }
      }
      if (collidesCircle) {
        skipped++;
        continue;
      }

      // Clearance check (d): corridor half-width 2.5 around patrol routes
      const corridorSq = 6.25;
      let collidesPatrol = false;
      for (const route of layout.patrolRoutes ?? []) {
        for (let i = 0; i < route.waypoints.length - 1; i++) {
          const p1 = route.waypoints[i];
          const p2 = route.waypoints[i + 1];
          if (distToSegmentSq(wx, wz, p1.x, p1.z, p2.x, p2.z) < corridorSq) {
            collidesPatrol = true;
            break;
          }
        }
        if (collidesPatrol) break;
      }
      if (collidesPatrol) {
        skipped++;
        continue;
      }

      // Clearance check (e): previously placed dressing
      let collidesPlaced = false;
      for (const placedBox of placedBoxes) {
        if (aabbIntersects(expandedAABB.min, expandedAABB.max, placedBox.min, placedBox.max)) {
          collidesPlaced = true;
          break;
        }
      }
      if (collidesPlaced) {
        skipped++;
        continue;
      }

      placedBoxes.push(expandedAABB);
      placed++;

      // Handedness: like PropKit, rotY already includes Math.PI
      const propMatrix = Matrix.Compose(
        new Vector3(scale, scale, scale),
        Quaternion.FromEulerAngles(0, rotY, 0),
        new Vector3(wx, finalY, wz),
      );

      for (const part of asset.parts) {
        const instMatrix = part.local.multiply(propMatrix);
        partMatrices.get(part.mesh)!.push(instMatrix);
      }
    }
  }

  // Populate thin instance buffers
  let drawCalls = 0;
  const activePartMeshes: Mesh[] = [];

  for (const mesh of kit.allPartMeshes) {
    const matrices = partMatrices.get(mesh);
    if (matrices && matrices.length > 0) {
      const buffer = new Float32Array(matrices.length * 16);
      for (let i = 0; i < matrices.length; i++) {
        matrices[i].copyToArray(buffer, i * 16);
      }
      mesh.thinInstanceSetBuffer('matrix', buffer, 16, true);
      mesh.thinInstanceRefreshBoundingInfo(true);
      mesh.freezeWorldMatrix();
      mesh.alwaysSelectAsActiveMesh = false;
      mesh.isVisible = true;
      activePartMeshes.push(mesh);
      drawCalls++;
    } else {
      mesh.thinInstanceSetBuffer('matrix', null);
      mesh.thinInstanceCount = 0;
      mesh.isVisible = false;
    }
  }

  console.info(`[kit] dressed ${placed} props (${skipped} skipped), +${drawCalls} draw calls`);

  // Apply twist mood
  const twistMood = applyTwistMood(scene, layout.twist.id);
  const floorTint = applyFloorTint(scene, layout.floor);

  const handle: KitDressingHandle = {
    drawCalls,
    placed,
    skipped,
    dispose() {
      twistMood.dispose();
      floorTint.dispose();
      for (const mesh of activePartMeshes) {
        mesh.thinInstanceSetBuffer('matrix', null);
        mesh.thinInstanceCount = 0;
        mesh.isVisible = false;
      }
      if (activeHandles.get(scene) === handle) {
        activeHandles.delete(scene);
      }
    },
  };

  activeHandles.set(scene, handle);
  return handle;
}
