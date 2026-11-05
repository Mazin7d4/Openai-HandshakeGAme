import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

/** Small, unlit marker for a drone currently controlled by the AI. */
export class BotTag {
  private readonly plane: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;

  constructor(scene: Scene, parent: TransformNode) {
    this.plane = MeshBuilder.CreatePlane('ai-tag', { width: 0.30, height: 0.14 }, scene);
    this.plane.parent = parent;
    this.plane.position.y = 0.42;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.receiveShadows = false;

    this.texture = new DynamicTexture('ai-tag-texture', { width: 256, height: 120 }, scene, true);
    this.texture.hasAlpha = true;
    const context = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    context.clearRect(0, 0, 256, 120);
    context.fillStyle = 'rgba(20,24,32,0.85)';
    context.beginPath();
    context.roundRect(8, 8, 240, 104, 52);
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = 'bold 84px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('AI', 128, 61);
    this.texture.update();

    this.material = new StandardMaterial('ai-tag-material', scene);
    this.material.disableLighting = true;
    this.material.diffuseTexture = this.texture;
    this.material.emissiveTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.diffuseColor.set(1, 1, 1);
    this.material.emissiveColor.set(1, 1, 1);
    this.material.backFaceCulling = false;
    this.plane.material = this.material;
    this.setVisible(false);
  }

  get visible(): boolean {
    return this.plane.isVisible;
  }

  setVisible(on: boolean): void {
    this.plane.isVisible = on;
  }

  dispose(): void {
    this.plane.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
