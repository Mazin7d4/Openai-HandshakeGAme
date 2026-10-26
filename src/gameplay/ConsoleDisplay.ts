import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { DroneRole } from '../network/NetworkTypes.ts';

/** One physical screen vocabulary: an illuminated plug socket, then a completed check. */
export class ConsoleDisplay {
  readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;
  private readonly tint: Color3;
  private complete = false;

  constructor(scene: Scene, id: string, role: DroneRole | 'either') {
    this.tint = Color3.FromHexString(role === 'pix' ? '#3DDBFF' : role === 'nee' ? '#FF8176' : '#FFF3DC');
    this.texture = new DynamicTexture(`${id}-screen-tex`, { width: 192, height: 192 }, scene, false);
    this.material = new StandardMaterial(`${id}-screen-glow`, scene);
    this.material.disableLighting = true;
    this.material.emissiveTexture = this.texture;
    this.material.emissiveColor = this.tint.clone();
    this.material.diffuseColor = Color3.Black();
    this.draw();
  }

  /** Brightness and a small physical pulse replace floating interaction labels. */
  update(time: number, nearby: boolean, working: boolean, complete: boolean): void {
    if (this.complete !== complete) { this.complete = complete; this.draw(); }
    const level = complete ? 0.72 : working ? 1.2 + Math.sin(time * 8) * 0.15 : nearby ? 1.35 : 0.85;
    this.material.emissiveColor.copyFrom(this.tint).scaleInPlace(level);
  }

  dispose(): void { this.texture.dispose(); this.material.dispose(); }

  private draw(): void {
    const c = this.texture.getContext() as CanvasRenderingContext2D;
    c.fillStyle = '#131B20'; c.fillRect(0, 0, 192, 192);
    c.strokeStyle = '#FFFFFF'; c.lineWidth = 9; c.lineJoin = 'round';
    c.strokeRect(7, 7, 178, 178);
    c.fillStyle = '#FFFFFF';
    if (this.complete) {
      c.lineWidth = 16; c.beginPath(); c.moveTo(49, 97); c.lineTo(81, 127); c.lineTo(145, 62); c.stroke();
    } else {
      // Large, conventional two-pin plug. At phone size this is a single readable silhouette.
      c.fillRect(62, 66, 68, 58); c.fillRect(72, 38, 14, 38); c.fillRect(106, 38, 14, 38);
      c.fillRect(85, 122, 22, 26); c.fillRect(96, 140, 40, 13);
    }
    this.texture.update();
  }
}
