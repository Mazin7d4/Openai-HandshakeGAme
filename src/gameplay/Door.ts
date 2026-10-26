import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import type { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import { PhysicsMotionType, PhysicsPrestepType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
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
    this.aggregate = addStaticBody(this.mesh, scene);
    this.aggregate.body.setMotionType(PhysicsMotionType.ANIMATED);
    this.aggregate.body.setPrestepType(PhysicsPrestepType.TELEPORT);
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
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
    this.aggregate.shape.filterCollideMask = sunk ? 0 : 0xffffffff;
    this.plugin.setPhysicsBodyTransformation(this.aggregate.body, this.mesh);
  }

  dispose(): void {
    this.aggregate.dispose();
    this.mesh.dispose();
  }
}
