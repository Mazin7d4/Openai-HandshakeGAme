import type { PlayerSnapshot } from '../player/PlayerState.ts';

/** Temporary flight readout for the dev room. Not a game HUD. */
export class DevReadout {
  private readonly readout: HTMLDivElement;
  private readonly controls: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.readout = document.createElement('div');
    this.readout.id = 'dev-readout';
    this.controls = document.createElement('div');
    this.controls.id = 'dev-controls';
    this.controls.textContent =
      'WASD move    Space rise    Ctrl fall    Shift boost    Arrows also move';
    parent.append(this.readout, this.controls);
  }

  update(snapshot: PlayerSnapshot): void {
    const { position, velocity, movement, boost } = snapshot;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    this.readout.textContent =
      `${snapshot.id}   ` +
      `x ${position.x.toFixed(1)}   y ${position.y.toFixed(1)}   z ${position.z.toFixed(1)}   ` +
      `speed ${speed.toFixed(1)}   ${movement}   boost ${boost}`;
  }

  dispose(): void {
    this.readout.remove();
    this.controls.remove();
  }
}
