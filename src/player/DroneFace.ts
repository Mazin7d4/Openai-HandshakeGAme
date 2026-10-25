import { DynamicTexture, Texture, type Color3, type Scene } from '@babylonjs/core';

export type Expression =
  | 'neutral' | 'happy' | 'focused' | 'strained' | 'shocked' | 'stunned'
  | 'yanked' | 'panic' | 'dizzy' | 'proud' | 'sheepish'
  | 'star-eyes' | 'heart' | 'sunglasses' | 'sleepy' | 'wink' | 'determined';

export type EmoteFace = 'here' | 'wait' | 'go' | 'yay';

/** Expressions that animate on their own and never blink. */
const ANIMATED: ReadonlySet<Expression> = new Set(['panic', 'dizzy']);

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
  private cosmetic: Expression | null = null;
  private override: Expression | null = null;
  private overrideTimer = 0;
  private blinkTimer = 2 + Math.random() * 3;
  private blinkPhase = 0;
  private lastKey = '';
  private time = 0;

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

  /** Optional unlockable face treatment; gameplay reactions still take priority. */
  setCosmetic(expression: Expression | null): void {
    this.cosmetic = expression;
    this.lastKey = '';
  }

  /** Temporary expression, e.g. stunned after a hit. */
  flash(expression: Expression, seconds: number): void {
    this.override = expression;
    this.overrideTimer = seconds;
  }

  update(dt: number): void {
    this.time += dt;
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
    const active = this.override ?? this.cosmetic ?? this.expression;
    if (active === 'stunned' || ANIMATED.has(active)) {
      open = 1;
    }
    this.draw(open);
  }

  dispose(): void {
    this.texture.dispose();
  }

  private draw(open: number): void {
    const active = this.override ?? this.cosmetic ?? this.expression;
    const quantised = Math.round(open * 12);
    const frame = ANIMATED.has(active) ? Math.floor(this.time * 12) : 0;
    const key = `${active}:${quantised}:${frame}`;
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
        case 'strained':
          this.drawStrained(ctx, side);
          break;
        case 'shocked':
          this.drawShocked(ctx);
          break;
        case 'yanked':
          this.drawYanked(ctx, side);
          break;
        case 'panic':
          this.drawPanic(ctx, side, frame);
          break;
        case 'dizzy':
          this.drawDizzy(ctx, side, frame);
          break;
        case 'proud':
          this.drawProud(ctx, side);
          break;
        case 'sheepish':
          this.drawSheepish(ctx, side);
          break;
        case 'star-eyes':
          this.drawStarEyes(ctx);
          break;
        case 'heart':
          this.drawHeart(ctx);
          break;
        case 'sunglasses':
          this.drawSunglasses(ctx);
          break;
        case 'sleepy':
          this.drawSleepy(ctx);
          break;
        case 'wink':
          side === 1 ? this.drawWink(ctx) : this.drawHappy(ctx);
          break;
        case 'determined':
          this.drawDetermined(ctx, side);
          break;
        default:
          this.drawNeutral(ctx);
      }
      ctx.restore();
    }

    this.texture.update(false);
  }

  /** Embarrassed: small smiling arcs glancing down-left, a sweat drop on the right. */
  private drawSheepish(ctx: CanvasRenderingContext2D, side: number): void {
    ctx.translate(-10, 12);
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(0, 8, 15, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    if (side === 1) {
      ctx.beginPath();
      ctx.moveTo(40, -40);
      ctx.quadraticCurveTo(50, -20, 40, -16);
      ctx.quadraticCurveTo(30, -20, 40, -40);
      ctx.fill();
    }
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

  private drawStrained(ctx: CanvasRenderingContext2D, side: number): void {
    ctx.rotate(side * -0.3);
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(-14, 8);
    ctx.lineTo(0, -8);
    ctx.lineTo(14, 8);
    ctx.stroke();
  }

  private drawShocked(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 27, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Squeezed > < chevrons pointing inward. */
  private drawYanked(ctx: CanvasRenderingContext2D, side: number): void {
    ctx.lineWidth = 13;
    ctx.beginPath();
    const d = -side;
    ctx.moveTo(-d * 13, -18);
    ctx.lineTo(d * 13, 0);
    ctx.lineTo(-d * 13, 18);
    ctx.stroke();
  }

  /** Tall thin jittery ovals. */
  private drawPanic(ctx: CanvasRenderingContext2D, side: number, frame: number): void {
    const jitter = Math.sin(frame * 2.7 + side * 1.3) * 3;
    ctx.translate(jitter, Math.cos(frame * 3.1) * 2);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 30, side * 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Two-turn spiral, rotating. */
  private drawDizzy(ctx: CanvasRenderingContext2D, side: number, frame: number): void {
    ctx.rotate(frame * 0.5 * side);
    ctx.lineWidth = 6;
    ctx.beginPath();
    const turns = 2;
    const steps = 36;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * turns * Math.PI * 2;
      const r = 2 + (i / steps) * 22;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** Closed happy arcs + a sparkle above the right eye. */
  private drawProud(ctx: CanvasRenderingContext2D, side: number): void {
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(0, 14, 20, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    if (side > 0) {
      ctx.save();
      ctx.translate(26, -30);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? 11 : 3.5;
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawStarEyes(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 25 : 9;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  }

  private drawHeart(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.moveTo(0, 24); ctx.bezierCurveTo(-36, 2, -25, -27, 0, -9); ctx.bezierCurveTo(25, -27, 36, 2, 0, 24);
    ctx.fill();
  }

  private drawSunglasses(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.roundRect(-25, -17, 50, 30, 8); ctx.fill();
    ctx.fillRect(-44, -5, 17, 8); ctx.fillRect(27, -5, 17, 8);
  }

  private drawSleepy(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(0, 4, 22, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  }

  private drawWink(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(-20, 4); ctx.lineTo(20, -7); ctx.stroke();
  }

  private drawDetermined(ctx: CanvasRenderingContext2D, side: number): void {
    ctx.rotate(side * -0.2); ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(-16, 5); ctx.lineTo(16, -5); ctx.stroke();
  }
}
