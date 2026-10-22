import type { HackMinigameSnapshot } from './HackMinigame.ts';
import { PacketRoutingMinigame } from './PacketRoutingMinigame.ts';
import type { GameAudio } from '../audio/GameAudio.ts';
import { audio } from '../audio/AudioManager.ts';

const GLYPHS: Record<number, string> = {
  1: '╵', 2: '╴', 3: '└', 4: '╷', 5: '│', 6: '┌', 7: '├',
  8: '╶', 9: '┘', 10: '─', 11: '┴', 12: '┐', 13: '┤', 14: '┬', 15: '┼',
};

/** DOM presentation for Packet Routing; pointer buttons work for mouse and touch. */
export class PacketRoutingView {
  private readonly overlay: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly model: PacketRoutingMinigame;
  private readonly complete: () => void;
  private readonly cancelButton: HTMLButtonElement;
  private readonly cancel: () => void;
  private completed = false;
  private disposed = false;
  private completionTimer: number | null = null;
  private readonly audio?: GameAudio;

  constructor(
    parent: HTMLElement,
    stationLabel: string,
    complete: () => void,
    cancel: () => void,
    gameAudio?: GameAudio,
  ) {
    this.audio = gameAudio;
    this.model = new PacketRoutingMinigame();
    this.complete = complete;
    this.cancel = cancel;
    this.overlay = document.createElement('div');
    this.overlay.className = 'hack-overlay';
    this.overlay.dataset.testid = 'packet-routing';
    const panel = document.createElement('section');
    panel.className = 'hack-panel';
    const kicker = document.createElement('p');
    kicker.className = 'menu-kicker';
    kicker.textContent = stationLabel;
    const title = document.createElement('h2');
    title.textContent = 'PACKET ROUTING';
    const help = document.createElement('p');
    help.className = 'hack-help';
    help.textContent = 'Rotate nodes to carry the packet from SOURCE to TARGET.';
    const board = document.createElement('div');
    board.className = 'hack-board-shell';
    const source = document.createElement('span');
    source.className = 'hack-endpoint source';
    source.textContent = 'SOURCE';
    this.grid = document.createElement('div');
    this.grid.className = 'hack-grid';
    const target = document.createElement('span');
    target.className = 'hack-endpoint target';
    target.textContent = 'TARGET';
    board.append(source, this.grid, target);
    this.status = document.createElement('p');
    this.status.className = 'hack-status';
    this.cancelButton = document.createElement('button');
    this.cancelButton.className = 'hack-cancel';
    this.cancelButton.type = 'button';
    this.cancelButton.textContent = 'CANCEL';
    this.cancelButton.addEventListener('click', this.cancel);
    panel.append(kicker, title, help, board, this.status, this.cancelButton);
    this.overlay.append(panel);
    parent.append(this.overlay);
    audio.play('hackStart');
    this.render(this.model.snapshot());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.completionTimer !== null) {
      window.clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
    this.cancelButton.removeEventListener('click', this.cancel);
    this.overlay.remove();
  }

  private render(snapshot: HackMinigameSnapshot): void {
    if (this.disposed) return;
    this.grid.style.setProperty('--grid-width', String(snapshot.width));
    this.grid.replaceChildren();
    snapshot.masks.forEach((mask, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'packet-node';
      button.dataset.index = String(index);
      button.dataset.mask = String(mask);
      button.dataset.solutionMask = String(snapshot.solutionMasks[index] ?? 0);
      button.textContent = GLYPHS[mask] ?? '·';
      button.classList.toggle('connected', snapshot.connected.has(index));
      button.addEventListener('click', () => {
        audio.play('hackTick', { progress: snapshot.connected.size / snapshot.masks.length });
        this.render(this.model.rotate(index));
      });
      this.grid.append(button);
    });
    this.overlay.classList.toggle('success', snapshot.completed);
    this.status.textContent = snapshot.completed
      ? 'ACCESS ROUTE STABLE — PACKET DELIVERED'
      : 'ROUTE INCOMPLETE';
    if (snapshot.completed && !this.completed) {
      this.completed = true;
      this.audio?.success();
      this.completionTimer = window.setTimeout(() => {
        this.completionTimer = null;
        if (!this.disposed) this.complete();
      }, 650);
    }
  }
}
