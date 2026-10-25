import type { Scene } from '@babylonjs/core/scene.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

export type SecurityMood = 'off' | 'patrol' | 'suspicious' | 'chase' | 'stunned' | 'carrying';

const W = 256, H = 144, R = 30;
type MoodCfg = { glyph: string; color: string; bubbleAlpha: number; bubbleTint?: string; fontSize: number };
const CFG: Record<Exclude<SecurityMood, 'off'>, MoodCfg> = {
  patrol:     { glyph: '• • •',  color: '#8a949a', bubbleAlpha: 0.7,  fontSize: 44 },
  suspicious: { glyph: '?',      color: '#f2a516', bubbleAlpha: 1,    fontSize: 64 },
  chase:      { glyph: '!',      color: '#ff3b2f', bubbleAlpha: 1, bubbleTint: '#fff1ee', fontSize: 64 },
  stunned:    { glyph: '@ @',    color: '#3aa0ff', bubbleAlpha: 1,    fontSize: 48 },
  carrying:   { glyph: 'GOTCHA', color: '#ff3b2f', bubbleAlpha: 1,    fontSize: 30 },
};

function drawBubble(ctx: CanvasRenderingContext2D, cfg: MoodCfg) {
  ctx.clearRect(0, 0, W, H);
  const pad = 10, bw = W - pad * 2, bh = H - 30, tail = 10;
  ctx.beginPath();
  ctx.moveTo(pad + R, pad);
  ctx.lineTo(pad + bw - R, pad);
  ctx.arcTo(pad + bw, pad, pad + bw, pad + R, R);
  ctx.lineTo(pad + bw, pad + bh - R);
  ctx.arcTo(pad + bw, pad + bh, pad + bw - R, pad + bh, R);
  ctx.lineTo(W / 2 + tail, pad + bh);
  ctx.lineTo(W / 2, pad + bh + tail);
  ctx.lineTo(W / 2 - tail, pad + bh);
  ctx.lineTo(pad + R, pad + bh);
  ctx.arcTo(pad, pad + bh, pad, pad + bh - R, R);
  ctx.lineTo(pad, pad + R);
  ctx.arcTo(pad, pad, pad + R, pad, R);
  ctx.closePath();
  ctx.globalAlpha = cfg.bubbleAlpha;
  ctx.fillStyle = cfg.bubbleTint ?? '#ffffff';
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1d2226';
  ctx.stroke();
  ctx.font = `bold ${cfg.fontSize}px 'Trebuchet MS', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = cfg.color;
  ctx.fillText(cfg.glyph, W / 2, pad + bh / 2);
}

export class SecurityEmote {
  private plane: Mesh;
  private tex: DynamicTexture;
  private mood: SecurityMood = 'off';
  private popTime = -1;
  private parent: TransformNode;
  private time = 0;

  constructor(scene: Scene, parent: TransformNode, name: string) {
    this.parent = parent;
    this.plane = MeshBuilder.CreatePlane(name + '_emote', { width: 1.1, height: 0.62 }, scene);
    this.plane.parent = parent;
    this.plane.position.y = 1.25;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.setEnabled(false);
    this.tex = new DynamicTexture(name + '_emoteTex', { width: W, height: H }, scene, false);
    this.tex.hasAlpha = true;
    const mat = new StandardMaterial(name + '_emoteMat', scene);
    mat.disableLighting = true;
    mat.diffuseTexture = this.tex;
    mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveTexture = this.tex;
    this.plane.material = mat;
  }

  set(mood: SecurityMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood === 'off') { this.plane.setEnabled(false); return; }
    this.plane.setEnabled(true);
    const ctx = this.tex.getContext() as CanvasRenderingContext2D;
    drawBubble(ctx, CFG[mood]);
    this.tex.update();
    this.popTime = 0;
  }

  update(dt: number): void {
    if (this.mood === 'off') return;
    this.time += dt;
    let popScale = 1;
    if (this.popTime >= 0) {
      this.popTime += dt;
      if (this.popTime < 0.25) {
        const t = this.popTime / 0.25;
        popScale = 1 + 0.35 * Math.sin(t * Math.PI) * (1 - t);
      } else { this.popTime = -1; }
    }
    const ps = this.parent.scaling;
    // Bob in world units even though the pod is squashed (y scale 0.62).
    this.plane.position.y = (1.05 + Math.sin(this.time * 3) * 0.06) / ps.y;
    this.plane.scaling.x = popScale / ps.x;
    this.plane.scaling.y = popScale / ps.y;
    this.plane.scaling.z = 1;
    if (this.mood === 'stunned') {
      this.plane.rotation.z = this.time * 1.2;
    } else {
      this.plane.rotation.z = 0;
    }
  }

  dispose(): void {
    this.plane.material?.dispose();
    this.tex.dispose();
    this.plane.dispose();
  }
}
