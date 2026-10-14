import type { PlayerSnapshot } from '../player/PlayerState.ts';
import type { GameMode } from '../app/GameMode.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';

interface DevRuntimeStatus {
  fps: number;
  activeRole: DroneRole;
  heldObject: string | null;
  network: string;
  diagnostics: string;
}

/** Temporary flight readout for the dev room. Not a game HUD. */
export class DevReadout {
  private readonly readout: HTMLDivElement;
  private readonly controls: HTMLDivElement;

  constructor(parent: HTMLElement, mode: GameMode = 'dev-local') {
    this.readout = document.createElement('div');
    this.readout.id = 'dev-readout';
    this.controls = document.createElement('div');
    this.controls.id = 'dev-controls';
    // Player controls live in the HUD quick-controls card ([H]) and pause menu; this line
    // only lists the dev-only extras so the two never repeat each other.
    this.controls.textContent = (mode === 'dev-local' ? 'DEV  Tab switch drone   ' : 'DEV  ') +
      'right-drag look   wheel frame   F2 inspect camera   ·   [H] controls   Esc pause';
    parent.append(this.readout, this.controls);
  }

  update(
    snapshots: readonly PlayerSnapshot[],
    tetherStrain = 0,
    gameplay = '',
    runtime?: DevRuntimeStatus,
  ): void {
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
    if (runtime) {
      lines.unshift(
        `DEV ${runtime.fps.toFixed(0)} FPS   active ${runtime.activeRole.toUpperCase()}   ` +
        `held ${runtime.heldObject ?? '-'}   network ${runtime.network}   ${runtime.diagnostics}`,
      );
    }
    lines.push(`tether strain ${(tetherStrain * 100).toFixed(0)}%`);
    if (gameplay) lines.push(gameplay);
    this.readout.textContent = lines.join('\n');
  }

  dispose(): void {
    this.readout.remove();
    this.controls.remove();
  }
}
