import {
  Color4,
  DynamicTexture,
  ParticleSystem,
  Vector3,
  type Scene,
} from '@babylonjs/core';

export type SparkStyle = 'impact' | 'zap' | 'yank' | 'pix' | 'nee' | 'confetti';

const STYLES: Record<SparkStyle, { c1: Color4; c2: Color4; speed: number; size: number; life: number }> = {
  impact: { c1: new Color4(1, 0.93, 0.75, 1), c2: new Color4(1, 0.62, 0.3, 1), speed: 4.5, size: 0.14, life: 0.32 },
  zap: { c1: new Color4(0.55, 0.95, 1, 1), c2: new Color4(1, 1, 1, 1), speed: 7, size: 0.2, life: 0.45 },
  yank: { c1: new Color4(1, 1, 1, 0.9), c2: new Color4(1, 0.86, 0.45, 0.9), speed: 3.2, size: 0.12, life: 0.3 },
  pix: { c1: new Color4(0.3, 0.85, 1, 1), c2: new Color4(0.75, 0.97, 1, 1), speed: 5, size: 0.16, life: 0.55 },
  nee: { c1: new Color4(1, 0.42, 0.6, 1), c2: new Color4(1, 0.8, 0.6, 1), speed: 5, size: 0.16, life: 0.55 },
  confetti: { c1: new Color4(1, 0.85, 0.3, 1), c2: new Color4(1, 0.55, 0.6, 1), speed: 6, size: 0.18, life: 1.6 },
};

/**
 * Presentation-only juice: pooled spark bursts. No gameplay state lives here,
 * so it is safe to trigger from local or remote events alike.
 */
export class Juice {
  private readonly systems = new Map<SparkStyle, ParticleSystem>();
  private readonly texture: DynamicTexture;

  constructor(scene: Scene) {
    this.texture = new DynamicTexture('juice-dot', { width: 32, height: 32 }, scene, false);
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    this.texture.hasAlpha = true;
    this.texture.update();
    for (const [style, cfg] of Object.entries(STYLES) as [SparkStyle, (typeof STYLES)[SparkStyle]][]) {
      const capacity = style === 'confetti' ? 400 : 160;
      const ps = new ParticleSystem(`juice-${style}`, capacity, scene);
      ps.particleTexture = this.texture;
      ps.emitter = new Vector3();
      ps.minEmitBox = new Vector3(-0.08, -0.08, -0.08);
      ps.maxEmitBox = new Vector3(0.08, 0.08, 0.08);
      ps.color1 = cfg.c1;
      ps.color2 = cfg.c2;
      ps.colorDead = new Color4(cfg.c2.r, cfg.c2.g, cfg.c2.b, 0);
      ps.minSize = cfg.size * 0.5;
      ps.maxSize = cfg.size;
      ps.minLifeTime = cfg.life * 0.5;
      ps.maxLifeTime = cfg.life;
      ps.minEmitPower = cfg.speed * 0.4;
      ps.maxEmitPower = cfg.speed;
      if (style === 'confetti') {
        ps.direction1 = new Vector3(-1, 1, -1);
        ps.direction2 = new Vector3(1, 3, 1);
        ps.gravity = new Vector3(0, -3, 0);
      } else {
        ps.direction1 = new Vector3(-1, -0.4, -1);
        ps.direction2 = new Vector3(1, 1.2, 1);
        ps.gravity = new Vector3(0, -9, 0);
      }
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.emitRate = 0;
      ps.manualEmitCount = 0;
      ps.updateSpeed = 1 / 60;
      ps.start();
      this.systems.set(style, ps);
    }
  }

  burst(style: SparkStyle, at: Vector3, count = 18): void {
    const ps = this.systems.get(style);
    if (!ps) return;
    (ps.emitter as Vector3).copyFrom(at);
    ps.manualEmitCount = Math.max(ps.manualEmitCount, 0) + Math.round(count);
  }

  dispose(): void {
    for (const ps of this.systems.values()) ps.dispose();
    this.texture.dispose();
  }
}
