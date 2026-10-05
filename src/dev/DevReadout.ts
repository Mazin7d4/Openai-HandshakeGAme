import type { PlayerSnapshot } from '../player/PlayerState.ts';
import type { GameMode } from '../app/GameMode.ts';

/** Temporary flight readout for the dev room. Not a game HUD. */
export class DevReadout {
  private readonly readout: HTMLDivElement;
  private readonly controls: HTMLDivElement;

  constructor(parent: HTMLElement, mode: GameMode = 'dev-local') {
    this.readout = document.createElement('div');
    this.readout.id = 'dev-readout';
    this.controls = document.createElement('div');
    this.controls.id = 'dev-controls';
    this.controls.textContent = mode === 'dev-local'
      ? 'ACTIVE  WASD move   Space rise   Ctrl/C fall   Shift boost      ' +
        'E grab/drop   Q throw   F hack   Tab switch drone   Esc pause      ' +
        'F2 inspect camera'
      : 'LOCAL  WASD move   Space rise   Ctrl/C fall   LShift boost      ' +
        'E grab/drop   Q throw   F hack   Esc pause      ' +
        'F2  inspect camera (drag orbit, wheel zoom)';
    parent.append(this.readout, this.controls);
  }

  update(snapshots: readonly PlayerSnapshot[], tetherStrain = 0, gameplay = ''): void {
    const lines = snapshots.map((snapshot) => {
      const { position, velocity, movement, boost } = snapshot;
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      return (
        `${snapshot.id}   ` +
        `x ${position.x.toFixed(1)}   y ${position.y.toFixed(1)}   z ${position.z.toFixed(1)}   ` +
        `speed ${speed.toFixed(1)}   ${movement}   boost ${boost}   ` +
        `${snapshot.selfPowered ? 'self-powered' : 'passive'}   tether-pull ${snapshot.tetherPull.toFixed(2)}`
      );
    });
    lines.push(`tether strain ${(tetherStrain * 100).toFixed(0)}%`);
    if (gameplay) lines.push(gameplay);
    this.readout.textContent = lines.join('\n');
  }

  dispose(): void {
    this.readout.remove();
    this.controls.remove();
  }
}
