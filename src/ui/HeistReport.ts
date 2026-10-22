import type { GameAudio } from '../audio/GameAudio.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import {
  awardAccent,
  formatRunTime,
  gradeFaces,
  pickAwards,
  quipFor,
  type RunStats,
} from './heistAwards.ts';
import { createFaceGlyph, drawFaceGlyph, type FaceMood } from './FaceGlyph.ts';

export interface HeistReportHandlers {
  onPlayAgain: () => void;
  onLeave?: () => void;
  audio?: GameAudio | null;
}

/**
 * End-of-run Heist Report: oak case-file panel, face-glyph grade, funny awards,
 * Play again / Challenge a friend / Save card. Keeps the `mission-complete` test id
 * so existing verifiers still find the overlay.
 */
export class HeistReport {
  readonly root: HTMLDivElement;
  private readonly panel: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly gradeEl: HTMLElement;
  private readonly awardsEl: HTMLElement;
  private readonly quipEl: HTMLElement;
  private readonly stampEl: HTMLElement;
  private readonly challengeHint: HTMLElement;
  private readonly playAgainBtn: HTMLButtonElement;
  private stats: RunStats | null = null;
  private gradeTimers: number[] = [];
  private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);
  private readonly handlers: HeistReportHandlers;

  constructor(parent: HTMLElement, handlers: HeistReportHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.className = 'mission-complete-overlay heist-report-overlay';
    this.root.dataset.testid = 'mission-complete';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'heist-report-title');

    this.panel = document.createElement('section');
    this.panel.className = 'mission-complete-panel heist-report';
    this.panel.innerHTML = [
      '<p class="heist-report__brand" aria-label="PIX and NEE">',
      '<span class="heist-report__brand-pix">PIX</span>',
      '<span class="heist-report__brand-cord" aria-hidden="true"></span>',
      '<span class="heist-report__brand-nee">NEE</span>',
      '</p>',
      '<p class="panel__kicker heist-report__kicker">Case closed</p>',
      '<h1 id="heist-report-title" class="heist-report__title">Heist Report</h1>',
      '<div class="heist-report__meta">',
      '<div class="heist-report__faces" data-heist="crew"></div>',
      '<p class="heist-report__time" data-heist="time">0:00</p>',
      '<div class="heist-report__grade" data-heist="grade" aria-label="Heist grade"></div>',
      '</div>',
      '<ul class="heist-report__awards" data-heist="awards"></ul>',
      '<p class="heist-report__quip" data-heist="quip"></p>',
      '<p class="heist-report__challenge-hint" data-heist="challenge-hint" hidden></p>',
      '<div class="mission-complete-actions heist-report__actions"></div>',
    ].join('');

    this.stampEl = document.createElement('span');
    this.stampEl.className = 'heist-report__stamp';
    this.stampEl.textContent = 'EXTRACTED';
    this.panel.append(this.stampEl);

    const crew = this.panel.querySelector('[data-heist="crew"]')!;
    crew.append(
      wrapFace('pix', 'happy', '#3DDBFF', 'PIX'),
      cordDivider(),
      wrapFace('nee', 'proud', '#FF6194', 'NEE'),
    );

    this.timeEl = this.panel.querySelector('[data-heist="time"]') as HTMLElement;
    this.gradeEl = this.panel.querySelector('[data-heist="grade"]') as HTMLElement;
    this.awardsEl = this.panel.querySelector('[data-heist="awards"]') as HTMLElement;
    this.quipEl = this.panel.querySelector('[data-heist="quip"]') as HTMLElement;
    this.challengeHint = this.panel.querySelector('[data-heist="challenge-hint"]') as HTMLElement;

    const actions = this.panel.querySelector('.heist-report__actions')!;
    this.playAgainBtn = button('Play again', 'btn btn--primary heist-report__play', 'retry-mission');
    this.playAgainBtn.title = 'Play again (R)';
    this.playAgainBtn.addEventListener('click', () => this.handlers.onPlayAgain());

    const challenge = button('Challenge a friend', 'btn', 'challenge-friend');
    challenge.addEventListener('click', () => void this.challengeFriend());

    const save = button('Save card', 'btn', 'save-card');
    save.addEventListener('click', () => void this.saveCard());

    actions.append(this.playAgainBtn, challenge, save);
    if (handlers.onLeave) {
      const leave = button('Leave game', 'btn btn--quiet', 'leave-heist');
      leave.addEventListener('click', () => handlers.onLeave?.());
      actions.append(leave);
    }

    this.root.append(this.panel);
    parent.append(this.root);
  }

  show(stats: RunStats): void {
    this.stats = stats;
    this.clearGradeTimers();
    this.timeEl.textContent = formatRunTime(stats.elapsedSeconds);
    this.quipEl.textContent = quipFor(stats);
    this.stampEl.textContent = stats.outcome === 'win' ? 'EXTRACTED' : 'BUSTED';
    this.stampEl.classList.toggle('heist-report__stamp--fail', stats.outcome !== 'win');
    this.challengeHint.hidden = true;
    this.challengeHint.textContent = '';

    this.awardsEl.replaceChildren();
    for (const award of pickAwards(stats)) {
      const li = document.createElement('li');
      li.className = `heist-report__award heist-report__award--${award.owner}`;
      li.style.setProperty('--award-accent', awardAccent(award.owner));
      const title = document.createElement('strong');
      title.textContent = award.title;
      const detail = document.createElement('span');
      detail.textContent = award.detail;
      li.append(title, detail);
      this.awardsEl.append(li);
    }

    this.gradeEl.replaceChildren();
    const faces = gradeFaces(stats);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    faces.forEach((face, index) => {
      const slot = document.createElement('span');
      slot.className = `heist-report__grade-slot${face.earned ? '' : ' is-missed'}`;
      slot.append(createFaceGlyph({
        mood: face.mood,
        color: face.color,
        size: 40,
        label: face.label,
      }));
      const caption = document.createElement('span');
      caption.className = 'heist-report__grade-caption';
      caption.textContent = face.caption;
      slot.append(caption);
      this.gradeEl.append(slot);
      if (reduced) {
        slot.classList.add('is-in');
      } else {
        const timer = window.setTimeout(() => {
          slot.classList.add('is-in');
          this.handlers.audio?.click(0.35 + index * 0.2);
        }, 180 + index * 220);
        this.gradeTimers.push(timer);
      }
    });

    this.root.classList.add('visible');
    window.addEventListener('keydown', this.onKey);
    window.setTimeout(() => this.playAgainBtn.focus(), 40);
  }

  hide(): void {
    this.clearGradeTimers();
    this.root.classList.remove('visible');
    window.removeEventListener('keydown', this.onKey);
  }

  get visible(): boolean {
    return this.root.classList.contains('visible');
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }

  /** TEST / demo: expose current stats for screenshot scripts. */
  currentStats(): RunStats | null {
    return this.stats;
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.visible) return;
    if (event.key === 'r' || event.key === 'R' || event.key === 'Enter') {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      this.handlers.onPlayAgain();
    }
  }

  private challengeUrl(): string {
    const time = formatRunTime(this.stats?.elapsedSeconds ?? 0);
    const url = new URL(window.location.href);
    url.searchParams.delete('report');
    url.searchParams.delete('autotest');
    url.searchParams.delete('debug');
    url.searchParams.set('beat', time);
    return url.toString();
  }

  private async challengeFriend(): Promise<void> {
    const link = this.challengeUrl();
    this.challengeHint.hidden = false;
    try {
      await navigator.clipboard.writeText(link);
      this.challengeHint.textContent = 'Invite copied. Beat this time.';
      this.handlers.audio?.success();
    } catch {
      this.challengeHint.textContent = link;
      this.handlers.audio?.warning();
    }
  }

  private async saveCard(): Promise<void> {
    if (!this.stats) return;
    const blob = await renderShareCard(this.stats);
    const filename = `pix-nee-heist-${formatRunTime(this.stats.elapsedSeconds).replace(':', 'm')}s.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    const canShare = typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });
    if (canShare) {
      try {
        await navigator.share({
          files: [file],
          title: 'PIX & NEE Heist Report',
          text: `Case closed in ${formatRunTime(this.stats.elapsedSeconds)}. Can you beat it?`,
        });
        this.handlers.audio?.success();
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
    this.handlers.audio?.click(0.8);
  }

  private clearGradeTimers(): void {
    for (const id of this.gradeTimers) window.clearTimeout(id);
    this.gradeTimers = [];
  }
}

function button(label: string, className: string, testId: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.dataset.testid = testId;
  return btn;
}

function wrapFace(role: DroneRole, mood: FaceMood, color: string, label: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `heist-report__crew-face heist-report__crew-face--${role}`;
  wrap.append(createFaceGlyph({ mood, color, size: 52, label }));
  const caption = document.createElement('span');
  caption.className = 'heist-report__crew-name';
  caption.textContent = label;
  wrap.append(caption);
  return wrap;
}

function cordDivider(): HTMLElement {
  const cord = document.createElement('span');
  cord.className = 'heist-report__crew-cord';
  cord.setAttribute('aria-hidden', 'true');
  return cord;
}

/** 1200×630 share PNG: wordmark, time, grade faces, awards. */
export async function renderShareCard(stats: RunStats): Promise<Blob> {
  const width = 1200;
  const height = 630;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // Oak case-file paper (flat fill — no decorative gradient).
  ctx.fillStyle = '#F4EFE6';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#BE9162';
  ctx.fillRect(0, 0, width, 18);
  ctx.strokeStyle = '#A7B6B5';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 36, width - 48, height - 60);

  ctx.fillStyle = '#0A5BC2';
  ctx.font = '800 42px Archivo, sans-serif';
  ctx.fillText('PIX', 64, 110);
  ctx.strokeStyle = '#1E2A2B';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(158, 96);
  ctx.lineTo(232, 96);
  ctx.stroke();
  ctx.fillStyle = '#C42A55';
  ctx.fillText('NEE', 248, 110);

  ctx.fillStyle = '#5C6B6A';
  ctx.font = '700 22px "Atkinson Hyperlegible Next", sans-serif';
  ctx.fillText('Case closed', 64, 158);

  ctx.fillStyle = '#1E2A2B';
  ctx.font = '800 64px Archivo, sans-serif';
  ctx.fillText('Heist Report', 64, 230);

  const time = formatRunTime(stats.elapsedSeconds);
  ctx.fillStyle = '#142022';
  roundRectPath(ctx, 64, 260, 220, 88, 12);
  ctx.fill();
  ctx.fillStyle = '#3DDBFF';
  ctx.font = '800 56px Doto, monospace';
  ctx.fillText(time, 88, 322);

  const faces = gradeFaces(stats);
  faces.forEach((face, i) => {
    const x = 320 + i * 100;
    drawFaceGlyph(ctx, x, 260, 64, face.mood, face.color);
    ctx.fillStyle = '#5C6B6A';
    ctx.font = '700 16px "Atkinson Hyperlegible Next", sans-serif';
    ctx.fillText(face.caption, x + 4, 344);
  });

  let y = 380;
  for (const award of pickAwards(stats).slice(0, 3)) {
    ctx.fillStyle = awardAccent(award.owner);
    ctx.fillRect(64, y - 18, 4, 44);
    ctx.fillStyle = '#1E2A2B';
    ctx.font = '800 22px Archivo, sans-serif';
    ctx.fillText(award.title, 80, y);
    ctx.fillStyle = '#455352';
    ctx.font = '600 20px "Atkinson Hyperlegible Next", sans-serif';
    ctx.fillText(award.detail, 80, y + 28);
    y += 64;
  }

  ctx.fillStyle = '#7A5631';
  ctx.font = '800 28px Archivo, sans-serif';
  ctx.save();
  ctx.translate(980, 520);
  ctx.rotate(-0.18);
  ctx.strokeStyle = '#7A5631';
  ctx.lineWidth = 3;
  roundRectPath(ctx, -90, -36, 180, 56, 8);
  ctx.stroke();
  ctx.fillText(stats.outcome === 'win' ? 'EXTRACTED' : 'BUSTED', -78, 8);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}

function roundRectPath(
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

/** Demo / screenshot stats when `?report` is set. */
export function demoRunStats(): RunStats {
  return {
    elapsedSeconds: 5 * 60 + 42,
    timesSpotted: 1,
    objectsThrown: 4,
    tetherSaves: 2,
    clotheslines: 1,
    cordTwangs: 11,
    nearMisses: 3,
    crateHaulMeters: 14.5,
    spottedBy: ['nee'],
    yankBy: ['pix', 'pix', 'nee', 'pix'],
    outcome: 'win',
  };
}
