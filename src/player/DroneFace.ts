import { DynamicTexture, Texture, type Color3, type Scene } from '@babylonjs/core';

export type Expression = 'neutral' | 'happy' | 'focused' | 'stunned';

const WIDTH = 256;
const HEIGHT = 160;
const EYE_SPACING = 38;
const EYE_CENTER_Y = 80;

function toCss(color: Color3, alpha = 1): string {
  const r = Math.round(Math.min(1, color.r) * 255);
  const g = Math.round(Math.min(1, color.g) * 255);
  const b = Math.round(Math.min(1, color.b) * 255);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Simple LED-display eyes drawn into an emissive texture on the glossy face
 * screen. No eyeballs: just flat graphic shapes, like the character sheet.
 * Redraws only when the expression or blink changes.
 */
export class DroneFace {
  readonly texture: DynamicTexture;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly color: Color3;
  private expression: Expression = 'neutral';
  private override: Expression | null = null;
  private overrideTimer = 0;
  private blinkTimer = 2 + Math.random() * 3;
  private blinkPhase = 0;
  private lastKey = '';

  constructor(scene: Scene, name: string, eyeColor: Color3) {
    this.color = eyeColor.clone();
    this.texture = new DynamicTexture(
      `${name}-face`,
      { width: WIDTH, height: HEIGHT },
      scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    this.ctx = this.texture.getContext() as CanvasRenderingContext2D;
    this.draw(1);
  }

  /** Base expression derived from movement; overrides (stun) win while active. */
  setExpression(expression: Expression): void {
    this.expression = expression;
  }

  /** Temporary expression, e.g. stunned after a hit. */
  flash(expression: Expression, seconds: number): void {
    this.override = expression;
    this.overrideTimer = seconds;
  }

  update(dt: number): void {
    if (this.override) {
      this.overrideTimer -= dt;
      if (this.overrideTimer <= 0) {
        this.override = null;
      }
    }

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase <= 0) {
      this.blinkPhase = 0.16;
      this.blinkTimer = 2.4 + Math.random() * 3.4;
    }
    let open = 1;
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
      const t = Math.max(0, this.blinkPhase) / 0.16;
      open = Math.max(0.1, Math.abs(t * 2 - 1));
    }
    const active = this.override ?? this.expression;
    if (active === 'stunned') {
      open = 1;
    }
    this.draw(open);
  }

  dispose(): void {
    this.texture.dispose();
  }

  private draw(open: number): void {
    const active = this.override ?? this.expression;
    const quantised = Math.round(open * 12);
    const key = `${active}:${quantised}`;
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.shadowColor = toCss(this.color, 0.9);
    ctx.shadowBlur = 14;
    ctx.fillStyle = toCss(this.color);
    ctx.strokeStyle = toCss(this.color);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const side of [-1, 1]) {
      const cx = WIDTH / 2 + side * EYE_SPACING;
      ctx.save();
      ctx.translate(cx, EYE_CENTER_Y);
      ctx.scale(1, quantised / 12);
      switch (active) {
        case 'happy':
          this.drawHappy(ctx);
          break;
        case 'focused':
          this.drawFocused(ctx, side);
          break;
        case 'stunned':
          this.drawStunned(ctx);
          break;
        default:
          this.drawNeutral(ctx);
      }
      ctx.restore();
    }

    this.texture.update(false);
  }

  /** Two vertical rounded bars. */
  private drawNeutral(ctx: CanvasRenderingContext2D): void {
    const w = 24;
    const h = 56;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, w / 2);
    ctx.fill();
  }

  /** Upward arcs. */
  private drawHappy(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(0, 10, 22, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
  }

  /** Narrowed, slanted geometric bars that lean toward the centre. */
  private drawFocused(ctx: CanvasRenderingContext2D, side: number): void {
    ctx.rotate(side * 0.42);
    const w = 20;
    const h = 36;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2 + 4, w, h, 6);
    ctx.fill();
  }

  /** Simple rings. */
  private drawStunned(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.stroke();
  }
}
