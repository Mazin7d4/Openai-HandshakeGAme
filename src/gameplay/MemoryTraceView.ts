import type { GameAudio } from '../audio/GameAudio.ts';
import type { HackMinigameView } from './HackMinigame.ts';
import { audio } from '../audio/AudioManager.ts';

const NODE_COUNT = 6;
/** Run-length trim (5-7 min target): two traces of 3 then 4 nodes. */
const ROUNDS = 2;

/** Simon-style trace with short, forgiving rounds. */
export class MemoryTraceView implements HackMinigameView {
  private readonly overlay: HTMLDivElement;
  private readonly nodes: HTMLButtonElement[] = [];
  private readonly status: HTMLParagraphElement;
  private readonly cancelButton: HTMLButtonElement;
  private sequence: number[] = [];
  private inputIndex = 0;
  private round = 0;
  private disposed = false;
  private accepting = false;
  private timers: number[] = [];
  private readonly complete: () => void;
  private readonly cancel: () => void;
  private readonly audio?: GameAudio;

  constructor(
    parent: HTMLElement,
    stationLabel: string,
    complete: () => void,
    cancel: () => void,
    gameAudio?: GameAudio,
  ) {
    this.complete = complete;
    this.cancel = cancel;
    this.audio = gameAudio;
    this.overlay = document.createElement('div');
    this.overlay.className = 'hack-overlay';
    this.overlay.dataset.testid = 'memory-trace';
    const panel = document.createElement('section');
    panel.className = 'hack-panel';
    panel.innerHTML = `<p class="menu-kicker"></p><h2>MEMORY TRACE</h2><p class="hack-help">Watch the pulse route, then repeat it. Mistakes replay the same round.</p>`;
    panel.querySelector('.menu-kicker')!.textContent = stationLabel;
    const board = document.createElement('div');
    board.className = 'memory-board';
    for (let index = 0; index < NODE_COUNT; index++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'memory-node';
      button.dataset.index = String(index);
      button.setAttribute('aria-label', `Trace node ${index + 1}`);
      button.textContent = String(index + 1);
      button.addEventListener('click', () => this.press(index));
      this.nodes.push(button);
      board.append(button);
    }
    this.status = document.createElement('p');
    this.status.className = 'hack-status';
    this.cancelButton = document.createElement('button');
    this.cancelButton.type = 'button';
    this.cancelButton.className = 'hack-cancel';
    this.cancelButton.textContent = 'CANCEL';
    this.cancelButton.addEventListener('click', this.cancel);
    panel.append(board, this.status, this.cancelButton);
    this.overlay.append(panel);
    parent.append(this.overlay);
    audio.play('hackStart');
    this.startRound();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers = [];
    this.cancelButton.removeEventListener('click', this.cancel);
    this.overlay.remove();
  }

  private startRound(): void {
    this.accepting = false;
    this.inputIndex = 0;
    const length = 3 + this.round;
    if (this.sequence.length !== length) {
      const previous = this.sequence[this.sequence.length - 1] ?? Math.floor(Math.random() * NODE_COUNT);
      this.sequence.push((previous + 1 + Math.floor(Math.random() * (NODE_COUNT - 1))) % NODE_COUNT);
      while (this.sequence.length < length) this.sequence.push(Math.floor(Math.random() * NODE_COUNT));
    }
    this.overlay.dataset.sequence = this.sequence.join(',');
    this.overlay.dataset.rounds = String(ROUNDS);
    this.status.textContent = `TRACE ${this.round + 1} / ${ROUNDS} — WATCH`;
    this.sequence.forEach((node, index) => {
      this.schedule(() => this.flash(node), 500 + index * 430);
    });
    this.schedule(() => {
      this.accepting = true;
      this.status.textContent = `TRACE ${this.round + 1} / ${ROUNDS} — REPEAT`;
    }, 650 + this.sequence.length * 430);
  }

  private press(index: number): void {
    if (!this.accepting || this.disposed) return;
    this.flash(index);
    if (index !== this.sequence[this.inputIndex]) {
      this.accepting = false;
      this.overlay.classList.add('failure');
      this.status.textContent = 'TRACE LOST — REPLAYING';
      this.audio?.fail();
      this.schedule(() => {
        this.overlay.classList.remove('failure');
        this.startRound();
      }, 700);
      return;
    }
    this.inputIndex += 1;
    if (this.inputIndex < this.sequence.length) return;
    this.accepting = false;
    this.round += 1;
    this.audio?.success();
    if (this.round >= ROUNDS) {
      this.overlay.classList.add('success');
      this.status.textContent = 'MEMORY TRACE VERIFIED';
      this.schedule(this.complete, 650);
    } else {
      this.schedule(() => this.startRound(), 650);
    }
  }

  private flash(index: number): void {
    const node = this.nodes[index];
    if (!node) return;
    node.classList.add('active');
    this.audio?.click(index / NODE_COUNT);
    this.schedule(() => node.classList.remove('active'), 230);
  }

  private schedule(action: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      this.timers = this.timers.filter((candidate) => candidate !== timer);
      if (!this.disposed) action();
    }, delay);
    this.timers.push(timer);
  }
}
