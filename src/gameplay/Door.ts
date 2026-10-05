import {
  Color3,
  CreateBox,
  HavokPlugin,
  PhysicsMotionType,
  PhysicsPrestepType,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
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

  constructor(scene: Scene, plugin: HavokPlugin) {
    this.plugin = plugin;
    this.mesh = CreateBox('locked-door', { width: 5.35, height: 4.4, depth: 0.6 }, scene);
    this.mesh.position.set(0, CLOSED_Y, 2);
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

  update(dt: number): void {
    const target = this.open ? OPEN_Y : CLOSED_Y;
    this.mesh.position.y += (target - this.mesh.position.y) * (1 - Math.exp(-5 * dt));
    this.plugin.setPhysicsBodyTransformation(this.aggregate.body, this.mesh);
  }

  dispose(): void {
    this.aggregate.dispose();
    this.mesh.dispose();
  }
}
