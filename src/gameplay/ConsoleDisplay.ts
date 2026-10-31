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
  private readonly signText: string;
  private readonly completionText: string;
  private complete = false;

  constructor(scene: Scene, id: string, role: DroneRole | 'either', customSign?: string) {
    this.tint = Color3.FromHexString(role === 'pix' ? '#3DDBFF' : role === 'nee' ? '#FF8176' : '#FFF3DC');
    const defaultSigns: Record<string, string> = {
      'arrival-console': 'OPENS BAY DOOR',
      'terminal-a': 'KEY A · OFFICE',
      'terminal-b': 'KEY B · OFFICE',
      'terminal-c': 'OPENS VAULT DOOR',
    };
    const campaign = !!scene.metadata?.campaignLevel && id !== 'arrival-console';
    this.signText = customSign ?? (campaign ? 'POWER LINK' : defaultSigns[id]) ?? 'TERMINAL';
    this.completionText = campaign ? 'LINKED' : /^terminal-[ab]$/.test(id) ? 'KEY SENT' : 'UNLOCKED';
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
    c.fillStyle = '#10171B'; c.fillRect(0, 0, 192, 192);
    c.strokeStyle = '#FFFFFF'; c.lineWidth = 8; c.lineJoin = 'round';
    c.strokeRect(6, 6, 180, 180);
    c.fillStyle = '#FFFFFF';
    if (this.complete) {
      c.strokeStyle = '#4DFFA0';
      c.lineWidth = 14; c.beginPath(); c.moveTo(48, 86); c.lineTo(78, 116); c.lineTo(142, 52); c.stroke();
      c.fillStyle = '#4DFFA0';
      c.font = 'bold 20px sans-serif';
      c.textAlign = 'center';
      c.fillText(this.completionText, 96, 160);
    } else {
      // Large, conventional two-pin plug with clear diegetic target label below.
      c.fillRect(62, 48, 68, 50); c.fillRect(72, 24, 14, 28); c.fillRect(106, 24, 14, 28);
      c.fillRect(85, 96, 22, 20); c.fillRect(96, 110, 38, 10);
      c.font = 'bold 16px sans-serif';
      c.textAlign = 'center';
      c.fillText(this.signText, 96, 162);
    }
    this.texture.update();
  }
}
