import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import { ConsoleDisplay } from '../gameplay/ConsoleDisplay.ts';
import { Door } from '../gameplay/Door.ts';
import { createRoundedBox } from '../scene/roundedBox.ts';
import { PowerCircuit } from './PowerCircuit.ts';

/** Safe automatic plug-in lesson: approach the console, watch its conduit power the delivery door. */
export class ArrivalLesson {
  private readonly door: Door;
  private readonly display: ConsoleDisplay;
  private readonly circuit: PowerCircuit;
  private readonly position = new Vector3(-2.7, 2.5, -57.6);
  private opened = false;
  private time = 0;

  constructor(scene: Scene, plugin: HavokPlugin) {
    const body = createRoundedBox('arrival-console', { width: 1.15, height: 2.5, depth: 0.75, radius: 0.08 }, scene);
    body.position.copyFrom(this.position); body.material = scene.getMaterialByName('lab-graphite-rubber');
    const screen = createRoundedBox('arrival-console-screen', { width: 1.55, height: 1.55, depth: 0.12, radius: 0.08 }, scene);
    screen.position.copyFrom(this.position); screen.position.addInPlaceFromFloats(0, 0.32, -0.51); screen.rotation.x = 0.55;
    this.display = new ConsoleDisplay(scene, 'arrival-console', 'either'); screen.material = this.display.material;
    for (const mesh of [body, screen]) { mesh.isPickable = false; mesh.metadata = { presentationDynamic: true }; }
    this.door = new Door(scene, plugin, { name: 'arrival-delivery-door', x: -1.5, y: 4, z: -55, width: 9, height: 8, depth: 0.5, travel: -8.2 });
    this.circuit = new PowerCircuit(scene, 'arrival', '#FFF3DC', [
      new Vector3(-2.7, 1.25, -57.6), new Vector3(-2.7, 0.13, -57.6),
      new Vector3(-5.5, 0.13, -57.6), new Vector3(-5.5, 0.13, -55.4), new Vector3(-5.5, 3.6, -55.4),
    ], new Vector3(-5.5, 3.6, -55.45));
    scene.onDisposeObservable.addOnce(() => { this.display.dispose(); this.door.dispose(); });
  }

  /** Replicated drone positions drive the same harmless lesson in solo and co-op, including late joins. */
  update(dt: number, positions: readonly Vector3[], progressed: boolean): boolean {
    this.time += dt;
    const nearby = positions.some(p => Vector3.DistanceSquared(p, this.position) < 3.4 ** 2);
    if (!this.opened && (nearby || progressed || positions.some(p => p.z > -54))) {
      this.opened = true;
    }
    this.display.update(this.time, nearby, false, this.opened);
    this.circuit.setPowered(this.opened);
    this.door.setOpen(this.opened); this.door.update(dt);
    return this.opened;
  }
}
