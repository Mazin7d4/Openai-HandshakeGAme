import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ObjectivePlan, ObjectiveState, Vec3 } from '../../../shared/nightshift/types.d.ts';
import { getQuality } from '../../scene/createScene.ts';
import { floorMaterials } from './materials.ts';

function point(value: Vec3): Vector3 {
  return new Vector3(value.x, value.y, value.z);
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

export class ObjectiveVisuals {
  readonly beacons: Vector3[] = [];
  readonly drawCalls: number;

  private readonly materials: ReturnType<typeof floorMaterials>;
  private readonly nodes: AbstractMesh[] = [];
  private readonly plates: AbstractMesh[] = [];
  private readonly handles: AbstractMesh[] = [];
  private readonly pads: AbstractMesh[] = [];
  private readonly cracks: AbstractMesh[] = [];
  private readonly safeBase = new Vector3();
  private readonly safeDirection = new Vector3();
  private readonly cageBase = new Vector3();
  private readonly shell?: AbstractMesh;
  private readonly safe?: AbstractMesh;
  private readonly door?: AbstractMesh;
  private readonly pillar?: AbstractMesh;
  private readonly pylonCore?: AbstractMesh;
  private readonly pylonBody?: AbstractMesh;
  private readonly stretch?: AbstractMesh;
  private readonly cage?: AbstractMesh;
  private lastSeq = -1;
  private lastEvent: ObjectiveState['lastEvent'] = null;
  private eventPulse = 0;
  private safeSlide = 0;
  private safeTarget = 0;
  private safeShake = 0;
  private doorAngle = 0;
  private cageDrop = 0;
  private crackShake = 0;
  private popTimer = 0;
  private relayFlash = 0;
  private pulseTime = 0;

  constructor(scene: Scene, plan: ObjectivePlan, loot: { mesh: AbstractMesh; cradle: Vector3 }) {
    this.materials = floorMaterials(scene);

    if (plan.levers && plan.levers.length === 2) {
      const leverPoints = [point(plan.levers[0]), point(plan.levers[1])];
      const posts: Mesh[] = [];
      const dashes: Mesh[] = [];
      for (const leverPoint of leverPoints) {
        const plate = CreateTorus('objective-lever-plate', {
          diameter: (plan.leverRadius ?? 0.8) * 2,
          thickness: 0.09,
          tessellation: 16,
        }, scene);
        plate.position.set(leverPoint.x, leverPoint.y + 0.03, leverPoint.z);
        plate.rotation.x = Math.PI / 2;
        plate.material = this.materials.goalDim;
        plate.isPickable = false;
        this.plates.push(plate);
        this.nodes.push(plate);
        this.beacons.push(leverPoint.clone());

        const post = CreateCylinder('objective-lever-post', {
          diameter: 0.18,
          height: 0.75,
          tessellation: 8,
        }, scene);
        post.position.set(leverPoint.x, leverPoint.y + 0.4, leverPoint.z);
        posts.push(post);

        const handle = CreateBox('objective-lever-handle', {
          width: 0.24,
          height: 0.82,
          depth: 0.24,
        }, scene);
        handle.position.set(leverPoint.x, leverPoint.y + 0.98, leverPoint.z);
        handle.material = this.materials.goal;
        handle.isPickable = false;
        this.handles.push(handle);
        this.nodes.push(handle);
      }
      const postMesh = mergeStatic(posts, 'objective-lever-posts', this.materials.metal);
      if (postMesh) {
        this.nodes.push(postMesh);
      }

      const delta = leverPoints[1].subtract(leverPoints[0]);
      const length = delta.length();
      if (length > 0.001) {
        const direction = delta.scale(1 / length);
        const dashLength = Math.min(0.65, length / 10);
        for (let i = 0; i < 10; i++) {
          const dash = CreateCylinder('objective-stretch', {
            diameter: 0.07,
            height: dashLength,
            tessellation: 6,
          }, scene);
          const at = leverPoints[0].add(delta.scale((i + 0.5) / 10));
          dash.position.copyFrom(at);
          Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, direction, dash.rotationQuaternion = Quaternion.Identity());
          dashes.push(dash);
        }
      }
      const stretch = mergeStatic(dashes, 'objective-stretch-line', this.materials.goalDim);
      if (stretch) {
        this.stretch = stretch;
        this.nodes.push(stretch);
      }
    }

    if (plan.safe) {
      const safePoint = point(plan.safe);
      this.safeBase.copyFrom(safePoint);
      this.beacons.push(safePoint.clone());
      this.safe = CreateBox('objective-safe', {
        width: 1.6,
        height: 1.35,
        depth: 1.35,
      }, scene);
      this.safe.position.set(safePoint.x, safePoint.y + 0.68, safePoint.z);
      this.safe.material = this.materials.dark;
      this.safe.isPickable = false;
      this.nodes.push(this.safe);

      const dial = CreateCylinder('objective-safe-dial', {
        diameter: 0.56,
        height: 0.06,
        tessellation: 16,
      }, scene);
      dial.parent = this.safe;
      dial.position.set(0, 0, -0.7);
      dial.rotation.x = Math.PI / 2;
      dial.material = this.materials.goal;
      dial.isPickable = false;
      this.nodes.push(dial);

      this.door = CreateBox('objective-safe-door', {
        width: 1.1,
        height: 0.9,
        depth: 0.06,
      }, scene);
      this.door.parent = this.safe;
      this.door.position.set(0, 0, -0.71);
      this.door.material = this.materials.metal;
      this.door.isPickable = false;
      this.nodes.push(this.door);

      const hook = CreateTorus('objective-safe-hook', {
        diameter: 0.52,
        thickness: 0.07,
        tessellation: 16,
      }, scene);
      hook.position.set(safePoint.x, safePoint.y + 1.55, safePoint.z);
      hook.rotation.x = Math.PI / 2;
      hook.material = this.materials.goal;
      hook.isPickable = false;
      this.nodes.push(hook);
    }

    if (plan.pylon) {
      const pylon = point(plan.pylon);
      const body = CreateCylinder('objective-pylon-body', { diameter: 0.72, height: 2.15, tessellation: 12 }, scene);
      body.position.set(pylon.x, pylon.y + 1.075, pylon.z);
      body.material = this.materials.pylon;
      body.isPickable = false;
      this.pylonBody = body;
      this.nodes.push(body);
      const core = CreateSphere('objective-pylon-core', { diameter: 0.38, segments: 12 }, scene);
      core.position.set(pylon.x, pylon.y + 1.7, pylon.z);
      core.material = this.materials.objectiveMint;
      core.isPickable = false;
      this.pylonCore = core;
      this.nodes.push(core);
      this.safeDirection.copyFrom(pylon).subtractInPlace(this.safeBase);
      this.safeDirection.y = 0;
      if (this.safeDirection.lengthSquared() > 0.001) {
        this.safeDirection.normalize();
      }
    }

    if (plan.anchor) {
      const anchor = point(plan.anchor);
      this.beacons.push(anchor.clone());
    }

    if (plan.pads) {
      for (const padPlan of plan.pads) {
        const padPoint = point(padPlan);
        this.beacons.push(padPoint.clone());
        const pad = CreateCylinder('objective-relay-pad', {
          diameter: (plan.padRadius ?? 1) * 2,
          height: 0.06,
          tessellation: 20,
        }, scene);
        pad.position.set(padPoint.x, padPoint.y + 0.03, padPoint.z);
        pad.material = padPlan.role === 'pix' ? this.materials.pix : this.materials.nee;
        pad.isPickable = false;
        this.pads.push(pad);
        this.nodes.push(pad);
      }
      if (plan.pads.length > 0) {
        this.pillar = CreateCylinder('objective-relay-pillar', {
          diameter: 0.12,
          height: 4,
          tessellation: 8,
        }, scene);
        this.pillar.material = this.materials.goalBright;
        this.pillar.isPickable = false;
        this.nodes.push(this.pillar);
      }
    }

    if (plan.kind === 'fragile') {
      this.shell = CreateSphere('objective-fragile-shell', {
        diameter: 1.55,
        segments: 16,
      }, scene);
      this.shell.parent = loot.mesh;
      this.shell.position.set(0, 0, 0);
      this.shell.material = getQuality(scene)?.status.tier === 'low'
        ? this.materials.glassOpaque
        : this.materials.glass;
      this.shell.isPickable = false;
      this.nodes.push(this.shell);
      for (let i = 0; i < 6; i++) {
        const crack = CreateBox('objective-fragile-crack', {
          width: 0.025,
          height: 0.72,
          depth: 0.025,
        }, scene);
        crack.parent = this.shell;
        crack.position.set((i - 2.5) * 0.16, 0.08 * (i % 2 ? 1 : -1), 0.72);
        crack.rotation.z = (i - 2.5) * 0.22;
        crack.material = this.materials.white;
        crack.isPickable = false;
        this.cracks.push(crack);
        this.nodes.push(crack);
      }
    }

    if (plan.kind !== 'fragile' && plan.kind !== 'grab') {
      this.cageBase.copyFrom(loot.cradle);
      const cageParts: Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const bar = CreateBox('objective-cage-bar', {
          width: 0.07,
          height: 1.8,
          depth: 0.07,
        }, scene);
        bar.position.set(
          this.cageBase.x + Math.cos(angle) * 0.9,
          this.cageBase.y + 0.9,
          this.cageBase.z + Math.sin(angle) * 0.9,
        );
        cageParts.push(bar);
      }
      const top = CreateTorus('objective-cage-top', {
        diameter: 1.8,
        thickness: 0.07,
        tessellation: 20,
      }, scene);
      top.position.set(this.cageBase.x, this.cageBase.y + 1.8, this.cageBase.z);
      top.rotation.x = Math.PI / 2;
      cageParts.push(top);
      const cage = mergeStatic(cageParts, 'objective-loot-cage', this.materials.metal);
      if (cage) {
        cage.unfreezeWorldMatrix();
        this.cage = cage;
        this.nodes.push(cage);
      }
    }

    this.drawCalls = this.nodes.length;
  }

  update(dt: number, state: ObjectiveState): void {
    const delta = Math.max(0, Math.min(0.25, dt));
    this.pulseTime += delta;
    this.eventPulse = Math.max(0, this.eventPulse - delta);
    this.safeShake = Math.max(0, this.safeShake - delta * 0.8);
    this.crackShake = Math.max(0, this.crackShake - delta * 2.5);
    this.popTimer = Math.max(0, this.popTimer - delta);
    this.relayFlash = Math.max(0, this.relayFlash - delta);

    if (state.seq !== this.lastSeq || state.lastEvent !== this.lastEvent) {
      this.lastSeq = state.seq;
      this.lastEvent = state.lastEvent;
      this.eventPulse = 0.28;
      if (state.lastEvent === 'pull') {
        this.safeTarget += 0.5;
        this.safeShake = 0.22;
      } else if (state.lastEvent === 'crack') {
        this.crackShake = 0.35;
      } else if (state.lastEvent === 'shatter') {
        this.popTimer = 0.32;
      } else if (state.lastEvent === 'reset') {
        this.relayFlash = 0.35;
      }
    }

    this.safeSlide += (this.safeTarget - this.safeSlide) * Math.min(1, delta * 8);
    if (this.safe) {
      const shake = Math.sin(this.pulseTime * 55) * this.safeShake;
      this.safe.position.set(
        this.safeBase.x + this.safeDirection.x * this.safeSlide + shake,
        this.safeBase.y + 0.68,
        this.safeBase.z + this.safeDirection.z * this.safeSlide,
      );
    }
    this.doorAngle += ((state.done ? Math.PI * 0.52 : 0) - this.doorAngle) * Math.min(1, delta * 6);
    if (this.door) {
      this.door.rotation.y = -this.doorAngle;
    }

    for (const plate of this.plates) {
      plate.material = state.done ? this.materials.done : state.progress > 0 ? this.materials.objectiveMint : this.materials.goalDim;
      plate.scaling.setAll(this.eventPulse > 0 ? 1.08 : 1);
    }
    for (const handle of this.handles) {
      handle.material = state.done ? this.materials.done : state.progress > 0 ? this.materials.objectiveMint : this.materials.goal;
      handle.rotation.z = state.done || state.progress > 0.99 ? -0.78 : 0;
    }
    if (this.stretch) {
      this.stretch.material = state.done ? this.materials.done : state.progress > 0 ? this.materials.objectiveMint : this.materials.goalDim;
      this.stretch.visibility = 0.55 + state.progress * 0.45;
    }
    if (this.pylonCore) {
      this.pylonCore.material = state.done ? this.materials.done : state.progress > 0 ? this.materials.objectiveMint : this.materials.goalDim;
      const pulse = state.done ? 1 : 1 + Math.sin(this.pulseTime * 4) * 0.08;
      this.pylonCore.scaling.setAll(pulse);
    }
    if (this.pylonBody) {
      this.pylonBody.material = state.done ? this.materials.done : this.materials.pylon;
    }


    for (let i = 0; i < this.pads.length; i++) {
      const pad = this.pads[i];
      const touched = state.done || i < state.step;
      pad.material = this.relayFlash > 0
        ? this.materials.nee
        : touched
        ? this.materials.done
        : i === state.step
          ? (this.relayFlash > 0 ? this.materials.nee : this.materials.goal)
          : i % 2 === 0
            ? this.materials.pix
            : this.materials.nee;
      const active = i === state.step && !state.done;
      const scale = active ? 1 + Math.sin(this.pulseTime * 5) * 0.15 : 1;
      pad.scaling.setAll(scale);
    }
    if (this.pillar) {
      const hasTarget = !state.done && state.step < this.pads.length;
      this.pillar.setEnabled(hasTarget);
      if (hasTarget) {
        const pad = this.pads[state.step];
        this.pillar.position.set(pad.position.x, pad.position.y + 2, pad.position.z);
        this.pillar.scaling.y = 1 + Math.sin(this.pulseTime * 5) * 0.08;
      }
    }

    this.cageDrop += ((state.done ? -1.8 : 0) - this.cageDrop) * Math.min(1, delta * 4);
    if (this.cage) {
      this.cage.position.y = this.cageDrop;
    }

    if (this.shell) {
      const popping = this.popTimer > 0;
      this.shell.setEnabled(!state.shatters || popping);
      const popScale = popping ? 1 + (0.32 - this.popTimer) * 2.5 : 1;
      const shake = Math.sin(this.pulseTime * 50) * this.crackShake * 0.06;
      this.shell.scaling.setAll(popScale);
      this.shell.rotation.z = shake;
      for (let i = 0; i < this.cracks.length; i++) {
        this.cracks[i].setEnabled(!state.shatters && i < state.cracks * 2);
      }
    }
  }

  dispose(): void {
    for (const node of this.nodes) {
      node.dispose(false, false);
    }
  }
}
