import {
  type AbstractMesh,
  ImportMeshAsync,
  Matrix,
  Mesh,
  type Nullable,
  Quaternion,
  Ray,
  type Scene,
  Vector3,
} from '@babylonjs/core';
import '../../assets/registerGltf.ts';
import '../../assets/meshopt.ts';
import type { RunLayout, RoomVariant } from '../../seed/index.ts';
import { mixSeed, mulberry32, VARIANTS_BY_SLOT, TWISTS, BASE_CORD } from '../../seed/index.ts';
import { initialTier } from '../../scene/Quality.ts';
import kitManifest from './kit-manifest.json';
import { DRESSING, type DressRow } from './dressingTable.ts';
import { OPENING_STORY } from './openingStory.ts';
import { applyTwistMood } from './TwistMood.ts';

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

interface KitAsset {
  name: string;
  parts: KitPart[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  footprint: { w: number; d: number };
}

interface KitSources {
  assets: Map<string, KitAsset>;
  allPartMeshes: Mesh[];
}

type Aabb = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

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

function aabbIntersects(aMin: Aabb['min'], aMax: Aabb['max'], bMin: Aabb['min'], bMax: Aabb['max']): boolean {
  return (
    aMin.x <= bMax.x &&
    aMax.x >= bMin.x &&
    aMin.y <= bMax.y &&
    aMax.y >= bMin.y &&
    aMin.z <= bMax.z &&
    aMax.z >= bMin.z
  );
}

/** Low / auto-low boot tier skips purely decorative clutter (mugs, plants, trash, desk toppers). */
function skipDecorativeClutter(_scene: Scene): boolean {
  return initialTier() === 'low';
}

/** Authored first-mission layout: open apron + split desks so opening story shares Night Shift dressing. */
export function openingDressLayout(): RunLayout {
  const pick = <T,>(list: readonly T[]): T => list[0];
  const arrival = pick(VARIANTS_BY_SLOT.arrival);
  const office = pick(VARIANTS_BY_SLOT.office);
  const server = pick(VARIANTS_BY_SLOT.server);
  const vault = pick(VARIANTS_BY_SLOT.vault);
  const escape = pick(VARIANTS_BY_SLOT.escape);
  const twist = TWISTS.find((t) => t.id === 'nervous_nee') ?? TWISTS[0];
  return {
    seed: 0xa71c001,
    floor: 0,
    variants: { arrival, office, server, vault, escape },
    spawn: { ...arrival.spawnPoints[0] },
    loot: { x: 0, y: 5.2, z: 18 },
    extraction: { x: -15, y: 1.2, z: -61 },
    terminals: {
      'terminal-a': { x: -5, y: 4.2, z: -33 },
      'terminal-b': { x: 7, y: 1.2, z: -31 },
      'terminal-c': { x: -5, y: 5.2, z: -5.8 },
    },
    terminalSetId: 'opening-authored',
    patrolRoutes: [],
    cameras: [],
    twist,
    escalation: {
      floor: 0,
      guardCount: 0,
      patrolSpeed: 1,
      cameraSweepScale: 1,
      timerSeconds: 0,
      detectionRateScale: 1,
      hasteScale: 1,
    },
    cord: { ...BASE_CORD },
  };
}

const kitLoadingPromises = new WeakMap<Scene, Promise<KitSources>>();
const activeHandles = new WeakMap<Scene, KitDressingHandle>();
const warnedMissingAssets = new Set<string>();

async function loadKitSources(scene: Scene): Promise<KitSources> {
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

            if (child.material) {
              const baseMatName = child.material.name.replace(/\.\d+$/, '');
              const existingMat = materialRegistry.get(baseMatName);
              if (existingMat) {
                child.material = existingMat as typeof child.material;
              } else {
                materialRegistry.set(baseMatName, child.material);
              }
            }

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

function tryPlaceRow(opts: {
  scene: Scene;
  kit: KitSources;
  row: DressRow;
  rand: () => number;
  twistId: string;
  skipClutter: boolean;
  variant: RoomVariant | null;
  layout: RunLayout | null;
  physicsMeshes: { mesh: AbstractMesh; min: Vector3; max: Vector3 }[];
  placedBoxes: Aabb[];
  partMatrices: Map<Mesh, Matrix[]>;
  worldSpace: boolean;
}): 'placed' | 'skipped' {
  const { scene, kit, row, rand, twistId, skipClutter, variant, layout, physicsMeshes, placedBoxes, partMatrices, worldSpace } = opts;

  if (row.twist && row.twist !== twistId) return 'skipped';
  if (skipClutter && row.clutter) return 'skipped';
  if (row.chance !== undefined && rand() > row.chance) return 'skipped';

  const asset = kit.assets.get(row.asset);
  if (!asset) {
    if (!warnedMissingAssets.has(row.asset)) {
      warnedMissingAssets.add(row.asset);
      console.warn(`[kit] Asset not in manifest or kit sources: ${row.asset}`);
    }
    return 'skipped';
  }

  const mount = row.mount ?? 'floor';
  const elevated = mount === 'wall' || mount === 'ceiling';

  let wx: number;
  let wz: number;
  let floorY: number;
  let floorMesh: Nullable<AbstractMesh> = null;
  const vBounds = variant?.bounds;

  if (worldSpace || row.wx !== undefined) {
    wx = row.wx ?? 0;
    wz = row.wz ?? 0;
    if (row.jitter) {
      wx += (rand() * 2 - 1) * row.jitter;
      wz += (rand() * 2 - 1) * row.jitter;
    }
    // Absolute rows: y is world height when elevated; otherwise offset from floor ray.
    if (elevated && row.y !== undefined) {
      floorY = 0;
    } else {
      const rayOrigin = new Vector3(wx, 16, wz);
      const ray = new Ray(rayOrigin, new Vector3(0, -1, 0), 20);
      const hit = scene.pickWithRay(ray, (m) => m.isEnabled() && m.isVisible && !!m.physicsBody);
      floorY = hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : 0;
      floorMesh = hit?.pickedMesh ?? null;
    }
  } else {
    if (!vBounds || row.x === undefined || row.z === undefined) return 'skipped';
    wx = vBounds.min.x + row.x * (vBounds.max.x - vBounds.min.x);
    wz = vBounds.min.z + row.z * (vBounds.max.z - vBounds.min.z);
    if (row.jitter) {
      wx += (rand() * 2 - 1) * row.jitter;
      wz += (rand() * 2 - 1) * row.jitter;
    }
    wx = Math.max(vBounds.min.x, Math.min(vBounds.max.x, wx));
    wz = Math.max(vBounds.min.z, Math.min(vBounds.max.z, wz));

    const rayOrigin = new Vector3(wx, vBounds.max.y + 2, wz);
    const rayLen = vBounds.max.y - vBounds.min.y + 4;
    const ray = new Ray(rayOrigin, new Vector3(0, -1, 0), rayLen);
    const hit = scene.pickWithRay(ray, (m) => m.isEnabled() && m.isVisible && !!m.physicsBody);
    floorY = vBounds.min.y;
    if (hit?.hit && hit.pickedPoint) {
      floorY = hit.pickedPoint.y;
      floorMesh = hit.pickedMesh;
    }
  }

  let ry = row.ry ?? 0;
  if (row.jitterRy) ry += (rand() * 2 - 1) * row.jitterRy;
  const rotY = ry + Math.PI;
  const scale = row.scale ?? 1;

  const finalY = elevated && row.y !== undefined && (worldSpace || row.wx !== undefined)
    ? row.y
    : floorY + (row.y ?? 0);

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
  const pad = elevated ? 0.15 : 1.0;
  const expandedAABB: Aabb = {
    min: { x: wx + rotMinX - pad, y: minY - pad, z: wz + rotMinZ - pad },
    max: { x: wx + rotMaxX + pad, y: maxY + pad, z: wz + rotMaxZ + pad },
  };

  if (!elevated) {
    for (const pm of physicsMeshes) {
      if (pm.mesh === floorMesh) continue;
      if (pm.max.y <= floorY + 0.05) continue;
      if (aabbIntersects(expandedAABB.min, expandedAABB.max, pm.min, pm.max)) return 'skipped';
    }

    if (variant) {
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
        if (aabbIntersects(expandedAABB.min, expandedAABB.max, opMin, opMax)) return 'skipped';
      }

      const rSq = 16.0;
      for (const sp of variant.spawnPoints) {
        const dx = wx - sp.x;
        const dz = wz - sp.z;
        if (dx * dx + dz * dz < rSq) return 'skipped';
      }
      for (const cp of variant.cover) {
        const dx = wx - cp.position.x;
        const dz = wz - cp.position.z;
        if (dx * dx + dz * dz < rSq) return 'skipped';
      }
    }

    if (layout) {
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
        if (dx * dx + dz * dz < 16) return 'skipped';
      }
      for (const route of layout.patrolRoutes ?? []) {
        for (let i = 0; i < route.waypoints.length - 1; i++) {
          const p1 = route.waypoints[i];
          const p2 = route.waypoints[i + 1];
          if (distToSegmentSq(wx, wz, p1.x, p1.z, p2.x, p2.z) < 6.25) return 'skipped';
        }
      }
    }
  }

  // Soft overlap for floor props; elevated mounts only avoid stacking identical pads.
  for (const placedBox of placedBoxes) {
    if (aabbIntersects(expandedAABB.min, expandedAABB.max, placedBox.min, placedBox.max)) {
      return 'skipped';
    }
  }

  placedBoxes.push(expandedAABB);

  const propMatrix = Matrix.Compose(
    new Vector3(scale, scale, scale),
    Quaternion.FromEulerAngles(0, rotY, 0),
    new Vector3(wx, finalY, wz),
  );
  for (const part of asset.parts) {
    partMatrices.get(part.mesh)!.push(part.local.multiply(propMatrix));
  }
  return 'placed';
}

export async function dressRunLayout(
  scene: Scene,
  layout: RunLayout,
  opts: { openingOnly?: boolean } = {},
): Promise<KitDressingHandle> {
  const previousHandle = activeHandles.get(scene);
  if (previousHandle) {
    previousHandle.dispose();
    activeHandles.delete(scene);
  }

  const kit = await loadKitSources(scene);
  const skipClutter = skipDecorativeClutter(scene);

  let placed = 0;
  let skipped = 0;

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

  const placedBoxes: Aabb[] = [];
  const partMatrices = new Map<Mesh, Matrix[]>();
  for (const mesh of kit.allPartMeshes) {
    partMatrices.set(mesh, []);
  }

  // Handcrafted opening story (spawn → apron → reception → first office).
  {
    const storyRand = mulberry32(mixSeed(layout.seed, hash('opening-story')));
    for (const row of OPENING_STORY) {
      const result = tryPlaceRow({
        scene,
        kit,
        row,
        rand: storyRand,
        twistId: layout.twist.id,
        skipClutter,
        variant: null,
        layout,
        physicsMeshes,
        placedBoxes,
        partMatrices,
        worldSpace: true,
      });
      if (result === 'placed') placed++;
      else skipped++;
    }
  }

  if (!opts.openingOnly) {
    for (const variant of Object.values(layout.variants)) {
      const rows = DRESSING[variant.id] ?? [];
      const rand = mulberry32(mixSeed(layout.seed, hash(variant.id)));

      for (const row of rows) {
        const result = tryPlaceRow({
          scene,
          kit,
          row,
          rand,
          twistId: layout.twist.id,
          skipClutter,
          variant,
          layout,
          physicsMeshes,
          placedBoxes,
          partMatrices,
          worldSpace: false,
        });
        if (result === 'placed') placed++;
        else skipped++;
      }
    }
  }

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

  console.info(
    `[kit] dressed ${placed} props (${skipped} skipped), +${drawCalls} draw calls`
    + (skipClutter ? ' [low: clutter skipped]' : ''),
  );

  const twistMood = applyTwistMood(scene, layout.twist.id);

  const handle: KitDressingHandle = {
    drawCalls,
    placed,
    skipped,
    dispose() {
      twistMood.dispose();
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

/** Dress the authored first-mission opening with the Blender kit (story / solo / co-op). */
export async function dressOpeningKit(scene: Scene): Promise<KitDressingHandle> {
  return dressRunLayout(scene, openingDressLayout(), { openingOnly: true });
}
