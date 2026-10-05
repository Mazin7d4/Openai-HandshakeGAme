import type { HackMinigameSnapshot } from './HackMinigame.ts';
import { PacketRoutingMinigame } from './PacketRoutingMinigame.ts';

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
  private completed = false;

  constructor(
    parent: HTMLElement,
    stationLabel: string,
    complete: () => void,
    cancel: () => void,
  ) {
    this.model = new PacketRoutingMinigame();
    this.complete = complete;
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
    const cancelButton = document.createElement('button');
    cancelButton.className = 'hack-cancel';
    cancelButton.type = 'button';
    cancelButton.textContent = 'CANCEL';
    cancelButton.addEventListener('click', cancel);
    panel.append(kicker, title, help, board, this.status, cancelButton);
    this.overlay.append(panel);
    parent.append(this.overlay);
    this.render(this.model.snapshot());
  }

  dispose(): void {
    this.overlay.remove();
  }

  private render(snapshot: HackMinigameSnapshot): void {
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
      button.addEventListener('click', () => this.render(this.model.rotate(index)));
      this.grid.append(button);
    });
    this.overlay.classList.toggle('success', snapshot.completed);
    this.status.textContent = snapshot.completed
      ? 'ACCESS ROUTE STABLE — PACKET DELIVERED'
      : 'ROUTE INCOMPLETE';
    if (snapshot.completed && !this.completed) {
      this.completed = true;
      window.setTimeout(this.complete, 650);
    }
  }
}
