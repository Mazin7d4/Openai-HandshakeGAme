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
  private readonly closedY: number;
  private readonly openY: number;

  constructor(scene: Scene, plugin: HavokPlugin, spec?: {
    name: string; x: number; y: number; z: number;
    width: number; height: number; depth: number; travel: number;
  }) {
    this.plugin = plugin;
    this.closedY = spec?.y ?? CLOSED_Y;
    this.openY = spec ? spec.y + spec.travel : OPEN_Y;
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

  update(dt: number): void {
    const target = this.open ? this.openY : this.closedY;
    this.mesh.position.y += (target - this.mesh.position.y) * (1 - Math.exp(-5 * dt));
    this.plugin.setPhysicsBodyTransformation(this.aggregate.body, this.mesh);
  }

  dispose(): void {
    this.aggregate.dispose();
    this.mesh.dispose();
  }
}
