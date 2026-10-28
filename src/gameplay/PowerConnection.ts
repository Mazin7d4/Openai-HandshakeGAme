import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** A wired connection between a physical control and its lock. */
export class PowerConnection {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly color: Color3;
  private powered = false;

  constructor(scene: Scene, name: string, points: readonly Vector3[], color: Color3) {
    this.color = color;
    const parts: Mesh[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const part = CreateBox(`${name}-wire`, { width: .09, height: .09, depth: Vector3.Distance(a, b) }, scene);
      part.position.copyFrom(a.add(b).scale(.5)); part.lookAt(b); parts.push(part);
    }
    this.mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    this.mesh.name = name; this.mesh.isPickable = false;
    this.material = new StandardMaterial(`${name}-insulation`, scene);
    this.material.diffuseColor = Color3.FromHexString('#596366');
    this.material.specularColor = Color3.Black(); this.mesh.material = this.material;
  }

  setPowered(powered: boolean): void {
    if (powered === this.powered) return;
    this.powered = powered;
    this.material.emissiveColor = powered ? this.color : Color3.Black();
    this.material.diffuseColor = powered ? this.color : Color3.FromHexString('#596366');
  }

  dispose(): void { this.mesh.dispose(); this.material.dispose(); }
}
