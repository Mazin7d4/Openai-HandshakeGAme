import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import type { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import { PhysicsMotionType, PhysicsPrestepType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { addStaticBody } from '../physics/staticBody.ts';
import { applySolidColor } from '../scene/solidMaterial.ts';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';

const CLOSED_Y = 2.2;
const OPEN_Y = 7.1;

/** Reusable animated collision door driven by a replicated boolean. */
export class Door {
  readonly mesh: Mesh;

  private readonly plugin: HavokPlugin;
  private readonly aggregate;
  private open = false;
  private readonly closedY: number;
  private readonly openY: number;
  private readonly axis: 'x' | 'y';
  private readonly closedX: number;
  private readonly openX: number;
  private closeBlocked = false;
  private readonly lockMaterial: StandardMaterial;
  private readonly lock: Mesh;

  constructor(scene: Scene, plugin: HavokPlugin, spec?: {
    name: string; x: number; y: number; z: number;
    width: number; height: number; depth: number; travel: number; axis?: 'x' | 'y';
  }) {
    this.plugin = plugin;
    this.axis = spec?.axis ?? 'y';
    this.closedY = spec?.y ?? CLOSED_Y;
    this.openY = spec ? spec.y + spec.travel : OPEN_Y;
    this.closedX = spec?.x ?? 0;
    this.openX = this.axis === 'x' ? this.closedX + (spec?.travel ?? 0) : this.closedX;
    this.mesh = CreateBox(spec?.name ?? 'locked-door', spec ?? { width: 5.35, height: 4.4, depth: 0.6 }, scene);
    this.mesh.position.set(spec?.x ?? 0, this.closedY, spec?.z ?? 2);
    applySolidColor(this.mesh, new Color3(0.16, 0.21, 0.24), scene);
    // Ribbed panel and a large physical padlock, readable even with bloom disabled.
    const width = spec?.width ?? 5.35;
    const height = spec?.height ?? 4.4;
    const depth = spec?.depth ?? 0.6;
    const parts: Mesh[] = [];
    this.lockMaterial = new StandardMaterial(`${this.mesh.name}-lock-state`, scene);
    this.lockMaterial.disableLighting = true;
    this.lockMaterial.emissiveColor = Color3.FromHexString('#FF8F45');
    for (const [x, y, w, h] of [[0, -0.25, 1.55, 1.05], [-0.48, 0.49, 0.26, 0.65], [0.48, 0.49, 0.26, 0.65], [0, 0.82, 1.22, 0.26]]) {
      const part = CreateBox('lock-piece', { width: w, height: h, depth: 0.14 }, scene);
      part.position.set(x, y, -depth / 2 - 0.12); parts.push(part);
    }
    this.lock = Mesh.MergeMeshes(parts, true, true)!;
    this.lock.name = `${this.mesh.name}-physical-lock`;
    this.lock.parent = this.mesh; this.lock.material = this.lockMaterial;
    this.lock.metadata = { presentationDynamic: true }; this.lock.isPickable = false;
    // Panel ribs share the leaf's neutral material and are rigidly batched into one mesh.
    const ribs: Mesh[] = [];
    for (let y = -height / 2 + 0.4; y < height / 2; y += 0.8) {
      const rib = CreateBox('door-rib', { width: width - 0.25, height: 0.06, depth: 0.08 }, scene);
      rib.position.set(0, y, -depth / 2 - 0.025); ribs.push(rib);
    }
    const ribMesh = Mesh.MergeMeshes(ribs, true, true)!;
    ribMesh.name = `${this.mesh.name}-panel-ribs`; ribMesh.parent = this.mesh;
    ribMesh.material = scene.getMaterialByName('lab-brushed-aluminium') ?? this.mesh.material;
    ribMesh.metadata = { presentationDynamic: true }; ribMesh.isPickable = false;
    this.mesh.metadata = { presentationDynamic: true };
    this.aggregate = addStaticBody(this.mesh, scene);
    this.aggregate.body.setMotionType(PhysicsMotionType.ANIMATED);
    this.aggregate.body.setPrestepType(PhysicsPrestepType.TELEPORT);
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    if (this.open !== open) {
      this.lockMaterial.emissiveColor.copyFromFloats(open ? 0.25 : 1, open ? 1 : 0.32, open ? 0.45 : 0.07);
      this.mesh.metadata.open = open;
    }
    this.open = open;
  }

  setCloseBlocked(blocked: boolean): void {
    this.closeBlocked = blocked;
  }

  update(dt: number): void {
    const shouldOpen = this.open || this.closeBlocked;
    const target = shouldOpen ? this.openY : this.closedY;
    if (this.axis === 'x') {
      this.mesh.position.x = this.mesh.position.x * Math.exp(-5 * dt) + (shouldOpen ? this.openX : this.closedX) * (1 - Math.exp(-5 * dt));
    } else {
      this.mesh.position.y += (target - this.mesh.position.y) * (1 - Math.exp(-5 * dt));
    }
    // Sinking leaves stop colliding once their top is below the floor.
    const sunk = this.axis === 'y' && this.mesh.position.y + this.mesh.getBoundingInfo().boundingBox.extendSize.y <= 0;
    this.mesh.isVisible = !sunk;
    this.lock.setEnabled(!sunk);
    this.aggregate.shape.filterCollideMask = sunk ? 0 : 0xffffffff;
    this.plugin.setPhysicsBodyTransformation(this.aggregate.body, this.mesh);
  }

  dispose(): void {
    this.aggregate.dispose();
    this.mesh.dispose();
    this.lockMaterial.dispose();
  }
}
