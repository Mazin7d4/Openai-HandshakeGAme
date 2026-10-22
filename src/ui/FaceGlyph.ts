/** 9×9 rounded-dot face glyphs matching the drones' LED face-screens. */

export type FaceMood = 'happy' | 'proud' | 'shocked' | 'sneaky' | 'sleepy' | 'neutral';

/** Dot patterns: 1 = lit. Eyes/mouth sit on a 9×9 grid like the mascot screens. */
const PATTERNS: Record<FaceMood, readonly string[]> = {
  // Happy: ^ ^ arcs
  happy: [
    '000000000',
    '011000110',
    '100101001',
    '000000000',
    '000000000',
    '000000000',
    '100000001',
    '011111110',
    '000000000',
  ],
  // Proud: closed smile + sparkle
  proud: [
    '000000010',
    '011000111',
    '100101000',
    '000000000',
    '000000000',
    '001000100',
    '010111010',
    '000000000',
    '000000000',
  ],
  // Shocked: O O
  shocked: [
    '000000000',
    '011000110',
    '100101001',
    '011000110',
    '000000000',
    '001111100',
    '010000010',
    '001111100',
    '000000000',
  ],
  // Sneaky: > <
  sneaky: [
    '000000000',
    '010000010',
    '001000100',
    '010000010',
    '000000000',
    '000000000',
    '001111100',
    '000000000',
    '000000000',
  ],
  // Sleepy: - -
  sleepy: [
    '000000000',
    '000000000',
    '011000110',
    '000000000',
    '000000000',
    '000000000',
    '001111100',
    '000000000',
    '000000000',
  ],
  // Neutral: ||
  neutral: [
    '000000000',
    '011000110',
    '011000110',
    '011000110',
    '000000000',
    '000000000',
    '001111100',
    '000000000',
    '000000000',
  ],
};

export interface FaceGlyphOptions {
  mood: FaceMood;
  /** LED colour (CSS). */
  color: string;
  size?: number;
  className?: string;
  label?: string;
}

/** Build an inline SVG face-screen glyph (no emoji / Unicode stars). */
export function createFaceGlyph(options: FaceGlyphOptions): SVGSVGElement {
  const size = options.size ?? 36;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 9 9');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  if (options.label) svg.setAttribute('aria-label', options.label);
  else svg.setAttribute('aria-hidden', 'true');
  if (options.className) svg.setAttribute('class', options.className);

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '9');
  bg.setAttribute('height', '9');
  bg.setAttribute('rx', '1.1');
  bg.setAttribute('fill', '#142022');
  svg.append(bg);

  const pattern = PATTERNS[options.mood];
  for (let y = 0; y < 9; y++) {
    const row = pattern[y] ?? '000000000';
    for (let x = 0; x < 9; x++) {
      if (row[x] !== '1') continue;
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(x + 0.5));
      dot.setAttribute('cy', String(y + 0.5));
      dot.setAttribute('r', '0.38');
      dot.setAttribute('fill', options.color);
      svg.append(dot);
    }
  }
  return svg;
}

/** Draw the same glyph into a 2D canvas context (share card). */
export function drawFaceGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  mood: FaceMood,
  color: string,
): void {
  const cell = size / 9;
  ctx.fillStyle = '#142022';
  roundRect(ctx, x, y, size, size, size * 0.12);
  ctx.fill();
  const pattern = PATTERNS[mood];
  ctx.fillStyle = color;
  for (let row = 0; row < 9; row++) {
    const line = pattern[row] ?? '000000000';
    for (let col = 0; col < 9; col++) {
      if (line[col] !== '1') continue;
      ctx.beginPath();
      ctx.arc(x + (col + 0.5) * cell, y + (row + 0.5) * cell, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
