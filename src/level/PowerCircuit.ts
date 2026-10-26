import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** Real conduit between a control and its lock. Never draws a navigation path or floating marker. */
export class PowerCircuit {
  private readonly material: StandardMaterial;
  private readonly tint: Color3;
  private readonly meshes: Mesh[] = [];
  private readonly lamp: Mesh;

  constructor(scene: Scene, id: string, color: string, points: Vector3[], socket: Vector3) {
    this.tint = Color3.FromHexString(color);
    this.material = new StandardMaterial(`circuit-${id}-power`, scene);
    this.material.disableLighting = true;
    const wire = CreateTube(`circuit-${id}-conduit`, { path: points, radius: 0.11, tessellation: 6 }, scene);
    const housing = CreateBox(`circuit-${id}-socket`, { width: 1.45, height: 1.45, depth: 0.2 }, scene);
    housing.position.copyFrom(socket); housing.position.z += 0.05;
    housing.material = scene.getMaterialByName('lab-graphite-rubber');
    housing.isPickable = false;
    this.lamp = CreateBox(`circuit-${id}-lamp`, { width: 1.05, height: 1.05, depth: 0.12 }, scene);
    this.lamp.position.copyFrom(socket); this.lamp.position.z -= 0.1;
    for (const mesh of [wire, this.lamp]) {
      mesh.material = this.material; mesh.isPickable = false;
      mesh.metadata = { presentationDynamic: true, circuit: id, powered: false };
      this.meshes.push(mesh);
    }
    this.setPowered(false);
  }

  /** A completed console powers its own cable and fills exactly one key socket. */
  setPowered(powered: boolean): void {
    this.material.emissiveColor.copyFrom(this.tint).scaleInPlace(powered ? 1.2 : 0.18);
    this.lamp.scaling.set(powered ? 1 : 0.32, powered ? 1 : 0.32, 1);
    for (const mesh of this.meshes) mesh.metadata.powered = powered;
  }
}
