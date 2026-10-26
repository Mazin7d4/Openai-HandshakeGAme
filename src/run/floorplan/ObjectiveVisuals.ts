import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ObjectivePlan, ObjectiveState, Vec3 } from '../../../shared/nightshift/types.d.ts';
import { getQuality } from '../../scene/createScene.ts';
import { floorMaterials } from './materials.ts';
import { HackStation } from '../../gameplay/HackStation.ts';
import type { DroneRole } from '../../network/NetworkTypes.ts';

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
  private readonly stations: HackStation[] = [];
  private readonly cables: AbstractMesh[] = [];
  private readonly plan: ObjectivePlan;
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
  private readonly pylonBody?: AbstractMesh;
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

  constructor(scene: Scene, plan: ObjectivePlan, loot: { mesh: AbstractMesh; cradle: Vector3 }, campaign = false) {
    this.plan = plan;
    this.materials = floorMaterials(scene);

    if (campaign && (plan.levers || plan.pads)) {
      const points = plan.levers ?? plan.pads ?? [];
      points.forEach((position, i) => {
        const role = ('role' in position ? position.role : i === 0 ? 'pix' : 'nee') as DroneRole;
        const station = new HackStation(scene, {
          id: i % 2 === 0 ? 'terminal-a' : 'terminal-b', label: '',
          position: point(position), interactionRadius: plan.leverRadius ?? plan.padRadius ?? 2,
          minigameType: 'memory-trace', allowedRole: role,
          accent: this.materials[role].diffuseColor,
        });
        this.stations.push(station);
        // A physical electrical run terminates at the lock, never at a waypoint.
        const x = position.x + (role === 'pix' ? -1 : 1);
        const parts: Mesh[] = [];
        const cable = (a: Vector3, b: Vector3) => {
          const d = b.subtract(a);
          const m = CreateBox('objective-power-cable', { width: 0.06, height: 0.06, depth: d.length() }, scene);
          m.position.copyFrom(a.add(b).scale(0.5)); m.lookAt(b); parts.push(m);
        };
        cable(new Vector3(position.x, 0.08, position.z), new Vector3(x, 0.08, position.z));
        cable(new Vector3(x, 0.08, position.z), new Vector3(x, 0.08, loot.cradle.z - 1.5));
        cable(new Vector3(x, 0.08, loot.cradle.z - 1.5), new Vector3(loot.cradle.x, 0.08, loot.cradle.z - 1.5));
        const wire = mergeStatic(parts, `objective-lock-cable-${i}`, this.materials.metal);
        if (wire) { this.nodes.push(wire); this.cables.push(wire); }
      });
    }

    if (!campaign && plan.levers && plan.levers.length === 2) {
      const leverPoints = [point(plan.levers[0]), point(plan.levers[1])];
      const posts: Mesh[] = [];
      for (const leverPoint of leverPoints) {
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
      this.safeDirection.copyFrom(pylon).subtractInPlace(this.safeBase);
      this.safeDirection.y = 0;
      if (this.safeDirection.lengthSquared() > 0.001) {
        this.safeDirection.normalize();
      }
    }

    if (!campaign && plan.pads) {
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
      const lock = CreateBox('objective-lock-body', { width: 0.85, height: 0.65, depth: 0.16 }, scene);
      lock.position.set(this.cageBase.x, this.cageBase.y + 0.6, this.cageBase.z - 0.98);
      cageParts.push(lock);
      for (const [dx, dy, w, h] of [[-0.28, 1.05, 0.12, 0.5], [0.28, 1.05, 0.12, 0.5], [0, 1.3, 0.68, 0.12]]) {
        const shackle = CreateBox('objective-lock-shackle', { width: w, height: h, depth: 0.14 }, scene);
        shackle.position.set(this.cageBase.x + dx, this.cageBase.y + dy, this.cageBase.z - 0.98);
        cageParts.push(shackle);
      }
      const cage = mergeStatic(cageParts, 'objective-loot-cage', this.materials.warn);
      if (cage) {
        cage.unfreezeWorldMatrix();
        this.cage = cage;
        this.nodes.push(cage);
      }
    }

    this.drawCalls = this.nodes.length + this.stations.length * 3;
  }

  update(dt: number, state: ObjectiveState, players: readonly { role: DroneRole; x: number; y: number; z: number }[] = []): void {
    const delta = Math.max(0, Math.min(0.25, dt));
    this.pulseTime += delta;
    this.stations.forEach((station, i) => {
      const nearby = players.find((p) => p.role === station.allowedRole && station.distanceTo(point(p)) <= station.interactionRadius);
      const complete = state.done || (this.plan.kind === 'relay' && i < state.step);
      station.update(delta, nearby?.role ?? null, complete);
      const powered = complete || (this.plan.kind === 'twin-levers' && Boolean(nearby));
      if (this.cables[i]) this.cables[i].material = powered ? this.materials[station.allowedRole] : this.materials.metal;
    });
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
    if (this.pylonBody) {
      this.pylonBody.material = this.materials.metal;
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
    for (const station of this.stations) station.dispose();
    for (const node of this.nodes) {
      node.dispose(false, false);
    }
  }
}
