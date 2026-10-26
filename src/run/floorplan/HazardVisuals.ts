import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { HazardPlan } from '../../../shared/nightshift/types.d.ts';
import { getQuality } from '../../scene/createScene.ts';
import { floorMaterials } from './materials.ts';

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

interface HazardRecord {
  plan: HazardPlan;
  nodes: AbstractMesh[];
  roots: TransformNode[];
  active?: AbstractMesh;
  frame?: AbstractMesh;
  curtain?: AbstractMesh;
  wedge?: AbstractMesh;
  head?: AbstractMesh;
  lens?: AbstractMesh;
  streak?: AbstractMesh;
  streakOffset: number;
  streakSpeed: number;
  forceX: number;
  forceZ: number;
  streakSpan: number;
  flash: number;
}

function normalRect(rect: HazardPlan['rect']): Rect {
  const x0 = rect ? Math.min(rect.x0, rect.x1) : 0;
  const x1 = rect ? Math.max(rect.x0, rect.x1) : 0;
  const z0 = rect ? Math.min(rect.z0, rect.z1) : 0;
  const z1 = rect ? Math.max(rect.z0, rect.z1) : 0;
  const y0 = rect ? Math.min(rect.y0, rect.y1) : 0;
  const y1 = rect ? Math.max(rect.y0, rect.y1) : 0;
  return { x0, x1, z0, z1, y0, y1 };
}

function gateRect(hazard: HazardPlan): Rect {
  if (hazard.rect) {
    return normalRect(hazard.rect);
  }
  const a = hazard.a;
  const b = hazard.b;
  if (!a || !b) {
    return normalRect(undefined);
  }
  return {
    x0: Math.min(a.x, b.x),
    x1: Math.max(a.x, b.x),
    z0: Math.min(a.z, b.z) - 0.08,
    z1: Math.max(a.z, b.z) + 0.08,
    y0: 0,
    y1: Math.max(3.5, a.y, b.y + 1),
  };
}

function mergeStatic(meshes: Mesh[], name: string, material: AbstractMesh['material']): Mesh | null {
  if (meshes.length === 0) {
    return null;
  }
  for (const mesh of meshes) {
    mesh.material = material;
    mesh.isPickable = false;
  }
  const merged = meshes.length === 1
    ? meshes[0]
    : Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
  if (!merged) {
    return null;
  }
  merged.name = name;
  merged.material = material;
  merged.isPickable = false;
  merged.receiveShadows = true;
  merged.freezeWorldMatrix();
  merged.doNotSyncBoundingInfo = true;
  return merged;
}

function makeWedge(scene: Scene, radius: number, halfAngle: number): Mesh {
  const segments = 20;
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = -halfAngle + (2 * halfAngle * i) / segments;
    positions.push(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    if (i > 0) {
      indices.push(0, i, i + 1);
    }
  }
  const normals: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    normals.push(0, 1, 0);
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  const mesh = new Mesh('hazard-sweeper-wedge', scene);
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

export class HazardVisuals {
  readonly drawCalls: number;

  private readonly scene: Scene;
  private readonly materials: ReturnType<typeof floorMaterials>;
  private readonly records: HazardRecord[] = [];
  private lastT = 0;

  constructor(scene: Scene, hazards: HazardPlan[]) {
    this.scene = scene;
    this.materials = floorMaterials(scene);
    const low = getQuality(scene)?.status.tier === 'low';
    for (const plan of hazards ?? []) {
      const record: HazardRecord = {
        plan,
        nodes: [],
        roots: [],
        streakOffset: 0,
        streakSpeed: 0,
        forceX: 1,
        forceZ: 0,
        streakSpan: 1,
        flash: 0,
      };
      if (plan.kind === 'tripwire' && plan.a && plan.b) {
        this.buildTripwire(record, plan);
      } else if (plan.kind === 'pulse-gate') {
        this.buildPulseGate(record, plan, low);
      } else if (plan.kind === 'sweeper' && plan.center) {
        this.buildSweeper(record, plan, low);
      } else if (plan.kind === 'ice' && plan.rect) {
        this.buildIce(record, plan);
      } else if (plan.kind === 'gust' && plan.rect) {
        this.buildGust(record, plan);
      }
      this.records.push(record);
    }
    let drawCalls = 0;
    for (const record of this.records) {
      drawCalls += record.nodes.length;
    }
    this.drawCalls = drawCalls;
  }

  private buildTripwire(record: HazardRecord, plan: HazardPlan): void {
    const a = plan.a!;
    const b = plan.b!;
    const direction = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const length = direction.length();
    if (length < 0.001) {
      return;
    }
    direction.scaleInPlace(1 / length);
    const beamParts: Mesh[] = [];
    const beam = CreateCylinder(`hazard-${plan.id}-beam`, {
      diameter: 0.06,
      height: length,
      tessellation: 8,
    }, this.scene);
    beam.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, direction, beam.rotationQuaternion = Quaternion.Identity());
    beamParts.push(beam);
    for (const endpoint of [a, b]) {
      const lens = CreateCylinder(`hazard-${plan.id}-lens`, {
        diameter: 0.22,
        height: 0.1,
        tessellation: 10,
      }, this.scene);
      lens.position.set(endpoint.x, endpoint.y, endpoint.z);
      Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, direction, lens.rotationQuaternion = Quaternion.Identity());
      beamParts.push(lens);
    }
    const dot = CreateCylinder(`hazard-${plan.id}-floor-dot`, {
      diameter: 0.24,
      height: 0.025,
      tessellation: 12,
    }, this.scene);
    dot.position.set((a.x + b.x) / 2, 0.025, (a.z + b.z) / 2);
    beamParts.push(dot);
    const active = mergeStatic(beamParts, `hazard-${plan.id}-beam-group`, this.materials.dangerDim);
    if (active) {
      record.active = active;
      record.nodes.push(active);
    }

    const posts: Mesh[] = [];
    for (const endpoint of [a, b]) {
      const post = CreateBox(`hazard-${plan.id}-post`, {
        width: 0.2,
        height: Math.max(0.8, endpoint.y),
        depth: 0.2,
      }, this.scene);
      post.position.set(endpoint.x, Math.max(0.4, endpoint.y / 2), endpoint.z);
      posts.push(post);
    }
    const postMesh = mergeStatic(posts, `hazard-${plan.id}-posts`, this.materials.dark);
    if (postMesh) {
      record.nodes.push(postMesh);
    }
  }

  private buildPulseGate(record: HazardRecord, plan: HazardPlan, low: boolean): void {
    const rect = gateRect(plan);
    const width = Math.max(0.2, rect.x1 - rect.x0);
    const height = Math.max(0.2, rect.y1 - rect.y0);
    const centerX = (rect.x0 + rect.x1) / 2;
    const centerY = (rect.y0 + rect.y1) / 2;
    const centerZ = (rect.z0 + rect.z1) / 2;
    const thickness = 0.12;
    const frameParts: Mesh[] = [];
    for (const x of [rect.x0, rect.x1]) {
      const bar = CreateBox(`hazard-${plan.id}-frame-side`, {
        width: thickness,
        height,
        depth: thickness,
      }, this.scene);
      bar.position.set(x, centerY, centerZ);
      frameParts.push(bar);
    }
    for (const y of [rect.y0, rect.y1]) {
      const bar = CreateBox(`hazard-${plan.id}-frame-cap`, {
        width,
        height: thickness,
        depth: thickness,
      }, this.scene);
      bar.position.set(centerX, y, centerZ);
      frameParts.push(bar);
    }
    const frame = mergeStatic(frameParts, `hazard-${plan.id}-frame`, this.materials.dangerDim);
    if (frame) {
      record.frame = frame;
      record.nodes.push(frame);
    }

    if (low) {
      const bars: Mesh[] = [];
      for (let i = 0; i < 5; i++) {
        const bar = CreateBox(`hazard-${plan.id}-curtain-bar`, {
          width: 0.035,
          height,
          depth: 0.035,
        }, this.scene);
        bar.position.set(rect.x0 + (width * (i + 0.5)) / 5, centerY, centerZ);
        bars.push(bar);
      }
      const curtain = mergeStatic(bars, `hazard-${plan.id}-curtain-grid`, this.materials.danger);
      if (curtain) {
        record.curtain = curtain;
        record.nodes.push(curtain);
      }
    } else {
      const curtain = CreatePlane(`hazard-${plan.id}-curtain`, {
        width,
        height,
      }, this.scene);
      curtain.position.set(centerX, centerY, centerZ);
      curtain.material = this.materials.dangerCurtain;
      curtain.isPickable = false;
      record.curtain = curtain;
      record.nodes.push(curtain);
    }
  }

  private buildSweeper(record: HazardRecord, plan: HazardPlan, low: boolean): void {
    const center = plan.center!;
    const root = new TransformNode(`hazard-${plan.id}-root`, this.scene);
    root.position.set(center.x, center.y, center.z);
    record.roots.push(root);

    const head = CreateBox(`hazard-${plan.id}-head`, {
      width: 0.55,
      height: 0.38,
      depth: 0.55,
    }, this.scene);
    head.parent = root;
    head.material = this.materials.dark;
    head.isPickable = false;
    record.head = head;
    record.nodes.push(head);

    const lens = CreateCylinder(`hazard-${plan.id}-lens`, {
      diameter: 0.24,
      height: 0.09,
      tessellation: 12,
    }, this.scene);
    lens.position.z = 0.3;
    lens.rotation.x = Math.PI / 2;
    lens.material = this.materials.danger;
    lens.isPickable = false;

    const floorOffset = -center.y + 0.025;
    if (low) {
      const radius = Math.max(0, plan.range ?? 0);
      const halfAngle = Math.max(0, plan.halfAngle ?? 0);
      const activeParts: Mesh[] = [lens];
      for (const angle of [-halfAngle, halfAngle]) {
        const edge = CreateBox(`hazard-${plan.id}-edge`, {
          width: 0.035,
          height: 0.02,
          depth: radius,
        }, this.scene);
        edge.position.set(Math.sin(angle) * radius / 2, floorOffset, Math.cos(angle) * radius / 2);
        edge.rotation.y = angle;
        edge.material = this.materials.danger;
        edge.isPickable = false;
        activeParts.push(edge);
      }
      const active = mergeStatic(activeParts, `hazard-${plan.id}-low-sweep`, this.materials.danger);
      if (active) {
        active.parent = root;
        active.position.set(0, 0, 0);
        active.unfreezeWorldMatrix();
        record.lens = active;
        record.nodes.push(active);
      }
    } else {
      lens.parent = root;
      record.lens = lens;
      record.nodes.push(lens);
      const wedge = makeWedge(this.scene, Math.max(0, plan.range ?? 0), Math.max(0, plan.halfAngle ?? 0));
      wedge.parent = root;
      wedge.position.y = floorOffset;
      wedge.material = this.materials.dangerCurtain;
      wedge.isPickable = false;
      record.wedge = wedge;
      record.nodes.push(wedge);
    }
  }

  private buildIce(record: HazardRecord, plan: HazardPlan): void {
    const rect = normalRect(plan.rect);
    const width = Math.max(0.2, rect.x1 - rect.x0);
    const depth = Math.max(0.2, rect.z1 - rect.z0);
    const centerX = (rect.x0 + rect.x1) / 2;
    const centerZ = (rect.z0 + rect.z1) / 2;
    const floor = CreatePlane(`hazard-${plan.id}-ice`, { width, height: depth }, this.scene);
    floor.position.set(centerX, rect.y0 + 0.02, centerZ);
    floor.rotation.x = Math.PI / 2;
    floor.material = this.materials.ice;
    floor.isPickable = false;
    record.nodes.push(floor);

    const stripes: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const stripe = CreatePlane(`hazard-${plan.id}-ice-stripe`, {
        width: width * 0.82,
        height: 0.045,
      }, this.scene);
      stripe.position.set(centerX, rect.y0 + 0.035, rect.z0 + depth * (0.25 + i * 0.25));
      stripe.rotation.x = Math.PI / 2;
      stripes.push(stripe);
    }
    const stripeMesh = mergeStatic(stripes, `hazard-${plan.id}-ice-stripes`, this.materials.iceLight);
    if (stripeMesh) {
      record.nodes.push(stripeMesh);
    }

    const sign = CreateCylinder(`hazard-${plan.id}-wet-floor-sign`, {
      diameterTop: 0.05,
      diameterBottom: 0.55,
      height: 0.72,
      tessellation: 8,
    }, this.scene);
    sign.position.set(rect.x0 + 0.42, rect.y0 + 0.36, rect.z0 + 0.42);
    sign.material = this.materials.cone;
    sign.isPickable = false;
    record.nodes.push(sign);
  }

  private buildGust(record: HazardRecord, plan: HazardPlan): void {
    const rect = normalRect(plan.rect);
    const centerX = (rect.x0 + rect.x1) / 2;
    const centerZ = (rect.z0 + rect.z1) / 2;
    const width = Math.max(0.2, rect.x1 - rect.x0);
    const depth = Math.max(0.2, rect.z1 - rect.z0);
    const grateParts: Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const bar = CreateBox(`hazard-${plan.id}-grate`, {
        width: width * 0.9,
        height: 0.08,
        depth: 0.08,
      }, this.scene);
      bar.position.set(centerX, rect.y0 + 0.05, rect.z0 + depth * (0.15 + i * 0.23));
      grateParts.push(bar);
    }
    const grate = mergeStatic(grateParts, `hazard-${plan.id}-grate`, this.materials.dark);
    if (grate) {
      record.nodes.push(grate);
    }

    const forceX = plan.force?.x ?? 1;
    const forceZ = plan.force?.z ?? 0;
    const forceLength = Math.hypot(forceX, forceZ) || 1;
    record.forceX = forceX / forceLength;
    record.forceZ = forceZ / forceLength;
    record.streakSpeed = Math.max(1.5, forceLength * 0.45);
    record.streakSpan = Math.max(width, depth) + 1.5;
    const streaks: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const streak = CreatePlane(`hazard-${plan.id}-gust-streak`, {
        width: 1.2,
        height: 0.08,
      }, this.scene);
      streak.position.set(
        rect.x0 + width * (0.25 + i * 0.25),
        rect.y0 + 0.09,
        centerZ,
      );
      streak.rotation.x = Math.PI / 2;
      streak.rotation.y = -Math.atan2(record.forceZ, record.forceX);
      streaks.push(streak);
    }
    const streak = mergeStatic(streaks, `hazard-${plan.id}-gust-streaks`, this.materials.gust);
    if (streak) {
      streak.unfreezeWorldMatrix();
      record.streak = streak;
      record.nodes.push(streak);
    }
  }

  update(t: number, phaseOf: (h: HazardPlan, t: number) => { on: boolean; warn: boolean; yaw?: number }): void {
    const dt = Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    for (const record of this.records) {
      const plan = record.plan;
      const phase = phaseOf(plan, t);
      record.flash = Math.max(0, record.flash - dt);
      const flashed = record.flash > 0;
      if (plan.kind === 'tripwire' && record.active) {
        record.active.material = flashed
          ? this.materials.white
          : phase.warn
            ? this.materials.warn
            : phase.on
              ? this.materials.danger
              : this.materials.dangerDim;
      } else if (plan.kind === 'pulse-gate') {
        if (record.frame) {
          record.frame.material = flashed
            ? this.materials.white
            : phase.warn
              ? this.materials.warn
              : phase.on
                ? this.materials.danger
                : this.materials.dangerDim;
        }
        if (record.curtain) {
          record.curtain.setEnabled(phase.on || flashed);
          record.curtain.material = flashed ? this.materials.white : this.materials.danger;
        }
      } else if (plan.kind === 'sweeper') {
        if (record.lens) {
          record.lens.material = flashed ? this.materials.white : this.materials.danger;
        }
        if (record.wedge) {
          record.wedge.setEnabled(flashed || phase.on);
          record.wedge.material = flashed ? this.materials.white : this.materials.dangerCurtain;
        }
        if (record.roots[0] && phase.yaw !== undefined) {
          record.roots[0].rotation.y = phase.yaw;
        }
      } else if (plan.kind === 'gust' && record.streak) {
        record.streakOffset += record.streakSpeed * dt;
        if (record.streakOffset > record.streakSpan) {
          record.streakOffset -= record.streakSpan;
        }
        record.streak.position.x = record.forceX * record.streakOffset;
        record.streak.position.z = record.forceZ * record.streakOffset;
      }
    }
  }

  flash(id: string): void {
    for (const record of this.records) {
      if (record.plan.id === id) {
        record.flash = 0.4;
        return;
      }
    }
  }

  dispose(): void {
    for (const record of this.records) {
      for (const node of record.nodes) {
        node.dispose(false, false);
      }
      for (const root of record.roots) {
        root.dispose(false, false);
      }
    }
  }
}
