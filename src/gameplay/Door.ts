import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import type { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import { PhysicsMotionType, PhysicsPrestepType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { addStaticBody } from '../physics/staticBody.ts';
import { applySolidColor } from '../scene/solidMaterial.ts';

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
  private readonly frame: Mesh;
  private readonly lock: Mesh;
  private readonly stateMaterial: StandardMaterial;

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
    const width = spec?.width ?? 5.35, height = spec?.height ?? 4.4, depth = spec?.depth ?? .6;
    const frameParts: Mesh[] = [];
    for (const [x, y, w, h] of [[-width / 2 - .15, 0, .3, height + .6], [width / 2 + .15, 0, .3, height + .6], [0, height / 2 + .15, width + .6, .3]]) {
      const part = CreateBox(`${this.mesh.name}-frame-part`, { width: w, height: h, depth: depth + .2 }, scene);
      part.position.set(this.closedX + x, this.closedY + y, this.mesh.position.z); frameParts.push(part);
    }
    this.frame = Mesh.MergeMeshes(frameParts, true, true, undefined, false, false)!;
    this.frame.name = `${this.mesh.name}-frame`;
    applySolidColor(this.frame, Color3.FromHexString('#293337'), scene);
    const lockParts: Mesh[] = [];
    for (const [x, y, w, h] of [[0, -.25, 1.05, .8], [-.35, .35, .14, .65], [.35, .35, .14, .65], [0, .65, .84, .14]]) {
      const part = CreateBox(`${this.mesh.name}-lock-part`, { width: w, height: h, depth: .16 }, scene);
      part.position.set(x, y, -depth / 2 - .12); lockParts.push(part);
    }
    this.lock = Mesh.MergeMeshes(lockParts, true, true, undefined, false, false)!;
    this.lock.name = `${this.mesh.name}-physical-lock`; this.lock.parent = this.mesh;
    this.stateMaterial = new StandardMaterial(`${this.mesh.name}-state-light`, scene);
    this.stateMaterial.disableLighting = true;
    this.stateMaterial.emissiveColor = Color3.FromHexString('#FFB84D');
    this.lock.material = this.stateMaterial;
    this.lock.isPickable = false; this.frame.isPickable = false;
    this.aggregate = addStaticBody(this.mesh, scene);
    this.aggregate.body.setMotionType(PhysicsMotionType.ANIMATED);
    this.aggregate.body.setPrestepType(PhysicsPrestepType.TELEPORT);
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    if (open !== this.open) this.stateMaterial.emissiveColor = Color3.FromHexString(open ? '#71B38C' : '#FFB84D');
    this.open = open;
  }

  setCloseBlocked(blocked: boolean): void {
    this.closeBlocked = blocked;
  }

  update(dt: number): void {
    const shouldOpen = this.open || this.closeBlocked;
    const target = shouldOpen ? this.openY : this.closedY;
    if (this.axis === 'x') {
      this.mesh.position.x = this.mesh.position.x * Math.exp(-5 * dt) + (this.open ? this.openX : this.closedX) * (1 - Math.exp(-5 * dt));
    } else {
      this.mesh.position.y += (target - this.mesh.position.y) * (1 - Math.exp(-5 * dt));
    }
    // Sinking leaves stop colliding once their top is below the floor.
    const sunk = this.axis === 'y' && this.mesh.position.y + this.mesh.getBoundingInfo().boundingBox.extendSize.y <= 0;
    this.mesh.isVisible = !sunk;
    this.lock.isVisible = !sunk;
    this.aggregate.shape.filterCollideMask = sunk ? 0 : 0xffffffff;
    this.plugin.setPhysicsBodyTransformation(this.aggregate.body, this.mesh);
  }

  dispose(): void {
    this.aggregate.dispose();
    this.mesh.dispose();
    this.frame.dispose();
    this.lock.dispose();
    this.stateMaterial.dispose();
  }
}
