import { gameEvents } from './GameEvents.ts';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { GameAudio } from '../audio/GameAudio.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole, HackNetworkState, RoomStatus } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { Door } from './Door.ts';
import type { HackMinigameView } from './HackMinigame.ts';
import { HackStation, type HackStationId } from './HackStation.ts';
import { MemoryTraceView } from './MemoryTraceView.ts';
import { PacketRoutingView } from './PacketRoutingView.ts';
import { SignalMatchView } from './SignalMatchView.ts';
import layout from '../level/heist-layout.json';
import type { RunLayout } from '../seed/index.ts';
import { BOT_TUNING } from '../../shared/bot/brain.mjs';

interface ActiveHack {
  station: HackStation;
  role: DroneRole;
  view: HackMinigameView;
}

function terminalPos(
  run: RunLayout | null | undefined,
  id: HackStationId,
): Vector3 {
  const src = run?.terminals[id] ?? layout.terminals[id];
  return new Vector3(src.x, src.y, src.z);
}

/** Owns station proximity, minigame lifetime, completion state and the shared door target. */
/** Seconds the CPU partner needs on its own console. */
export class HackSession {
  readonly stations: readonly HackStation[];
  readonly door: Door;

  private readonly multiplayer: MultiplayerSession | null;
  private readonly uiParent: HTMLElement | null;
  private readonly audio?: GameAudio;
  private localRole: DroneRole | null;
  private readonly owners: Record<HackStationId, DroneRole | null> = {
    'terminal-a': null, 'terminal-b': null, 'terminal-c': null,
  };
  private readonly completed: Record<HackStationId, boolean> = {
    'terminal-a': false, 'terminal-b': false, 'terminal-c': false,
  };
  private doorOpen = false;
  private alarmed = false;
  private active: ActiveHack | null = null;
  private debugView = false;

  constructor(
    scene: Scene,
    plugin: HavokPlugin,
    multiplayer: MultiplayerSession | null,
    uiParent?: HTMLElement,
    audio?: GameAudio,
    runLayout?: RunLayout | null,
  ) {
    this.multiplayer = multiplayer;
    this.uiParent = uiParent ?? null;
    this.audio = audio;
    this.localRole = multiplayer?.currentStatus.localRole ?? null;
    this.stations = [
      new HackStation(scene, {
        id: 'terminal-a',
        label: 'PIX packet console',
        position: terminalPos(runLayout, 'terminal-a'),
        interactionRadius: 3.2,
        minigameType: 'packet-routing',
        allowedRole: 'pix',
        accent: new Color3(0.08, 0.55, 1),
      }),
      new HackStation(scene, {
        id: 'terminal-b',
        label: 'NEE signal console',
        position: terminalPos(runLayout, 'terminal-b'),
        interactionRadius: 3.2,
        minigameType: 'signal-match',
        allowedRole: 'nee',
        accent: new Color3(1, 0.25, 0.48),
      }),
      new HackStation(scene, {
        id: 'terminal-c',
        label: 'Memory authorizer',
        position: terminalPos(runLayout, 'terminal-c'),
        interactionRadius: 3.1,
        minigameType: 'memory-trace',
        allowedRole: 'either',
        accent: new Color3(0.42, 0.9, 0.62),
      }),
    ];
    this.door = new Door(scene, plugin, {
      name: 'lab-access-door', x: 0, y: 4, z: 2, width: 5.6, height: 8, depth: 0.7, travel: -8.2,
    });
  }

  /** Re-apply terminal positions from a RunLayout (solo next-floor stub). */
  applyRunLayout(run: RunLayout): void {
    for (const station of this.stations) {
      station.relocate(terminalPos(run, station.id));
    }
  }

  sync(status: RoomStatus): void {
    this.localRole = status.localRole;
    this.applyState(status.hack);
    if (this.active) {
      const owner = this.ownerFor(this.active.station.id);
      const complete = this.completeFor(this.active.station.id);
      if (complete || owner !== this.active.role) this.closeView();
    }
    if (!this.active && this.localRole) {
      const station = this.stations.find(
        (candidate) =>
          this.ownerFor(candidate.id) === this.localRole && !this.completeFor(candidate.id),
      );
      if (station) this.openPuzzle(station, this.localRole);
    }
  }

  tryStartNearest(role: DroneRole, position: Vector3): boolean {
    const station = this.stations
      .filter((candidate) => candidate.allowedRole === 'either' || candidate.allowedRole === role)
      .filter((candidate) => !this.completeFor(candidate.id))
      .sort((a, b) => a.distanceTo(position) - b.distanceTo(position))[0];
    if (!station || !station.canInteract(role, position, this.completeFor(station.id))) return false;
    if (this.multiplayer) {
      if (role === this.localRole) this.multiplayer.startHack(station.id);
    } else {
      this.setOwner(station.id, role);
      this.openPuzzle(station, role);
    }
    return true;
  }

  promptsFor(role: DroneRole, position: Vector3): string[] {
    const station = this.stations.find((candidate) =>
      candidate.canInteract(role, position, this.completeFor(candidate.id)),
    );
    return station ? [`[F] Hack ${station.label}`] : [];
  }

  /**
   * Solo only: the CPU partner works its own console (e.g. NEE's signal console)
   * while parked in range. Returns true while it is working.
   */
  botWork(role: DroneRole, position: Vector3, dt: number): boolean {
    if (this.multiplayer) return false;
    const station = this.botStation(role);
    if (!station || !station.canInteract(role, position, false)) {
      if (station && this.ownerFor(station.id) === role) this.setOwner(station.id, null);
      return false;
    }
    this.setOwner(station.id, role);
    this.botProgress += dt / BOT_TUNING.hackSeconds;
    if (this.botProgress >= 1) {
      this.botProgress = 0;
      this.setComplete(station.id, true);
      this.setOwner(station.id, null);
      this.doorOpen = this.allComplete();
      this.audio?.success();
      gameEvents.emit('toast', { text: role === 'nee' ? 'NEE cracked her console' : 'PIX cracked his console', tone: role });
    }
    return true;
  }

  /** Solo: the console only this role can hack and that is still locked. */
  botStation(role: DroneRole): HackStation | null {
    return this.stations.find((s) => s.allowedRole === role && !this.completeFor(s.id)) ?? null;
  }

  isRoleHacking(role: DroneRole): boolean {
    return this.active?.role === role;
  }

  setAlarmed(alarmed: boolean): void {
    this.alarmed = alarmed;
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    if (this.active) {
      const drone = drones.get(this.active.role);
      if (!this.debugView && (!drone || this.active.station.distanceTo(drone.position) > this.active.station.interactionRadius + 0.8)) {
        this.cancelCurrent();
      }
    }
    for (const station of this.stations) {
      const nearby = [...drones.entries()].some(([role, drone]) => station.canInteract(role, drone.position, this.completeFor(station.id)));
      station.update(dt, this.ownerFor(station.id), this.completeFor(station.id), nearby);
    }
    const inLabThreshold = [...drones.values()].some((drone) =>
      Math.abs(drone.position.x) < 3.1 && Math.abs(drone.position.z - 2) < 1.25 && drone.position.y < 8.2,
    );
    this.door.setCloseBlocked(this.alarmed && inLabThreshold);
    this.door.setOpen(this.doorOpen && !this.alarmed);
    this.door.update(dt);
    for (const [role, drone] of drones) {
      drone.setFocused(this.ownerForRole(role) !== null);
    }
  }

  describe(): string {
    return `hack A:${this.completed['terminal-a'] ? 'complete' : this.owners['terminal-a'] ?? '-'} ` +
      `B:${this.completed['terminal-b'] ? 'complete' : this.owners['terminal-b'] ?? '-'} ` +
      `C:${this.completed['terminal-c'] ? 'complete' : this.owners['terminal-c'] ?? '-'} ` +
      `door:${this.doorOpen ? 'open' : 'locked'}`;
  }

  completionCount(): number {
    return Object.values(this.completed).filter(Boolean).length;
  }

  /** TEST-ONLY (?autotest&stage=escape, local modes): mark every station hacked. */
  debugCompleteAll(): void {
    if (this.multiplayer) return;
    for (const station of this.stations) this.setComplete(station.id, true);
    this.doorOpen = true;
  }

  debugOpenStation(id: HackStationId, role: DroneRole): void {
    const station = this.stations.find((candidate) => candidate.id === id);
    if (!station) return;
    if (this.active) this.closeView();
    this.setOwner(id, role);
    this.debugView = true;
    this.openPuzzle(station, role);
  }

  allComplete(): boolean {
    return this.completionCount() === this.stations.length;
  }

  private botProgress = 0;

  isComplete(id: HackStationId): boolean { return this.completed[id]; }

  dispose(): void {
    this.closeView();
    for (const station of this.stations) station.dispose();
    this.door.dispose();
  }

  private applyState(state: HackNetworkState): void {
    this.owners['terminal-a'] = state.stationAOwner;
    this.owners['terminal-b'] = state.stationBOwner;
    this.owners['terminal-c'] = state.stationCOwner;
    this.completed['terminal-a'] = state.stationAComplete;
    this.completed['terminal-b'] = state.stationBComplete;
    this.completed['terminal-c'] = state.stationCComplete;
    this.doorOpen = state.doorOpen;
  }

  private openPuzzle(station: HackStation, role: DroneRole): void {
    if (!this.uiParent || this.active) return;
    document.body.classList.add('hack-session-open');
    const done = () => this.completeCurrent();
    const cancel = () => this.cancelCurrent();
    const view = station.minigameType === 'packet-routing'
      ? new PacketRoutingView(this.uiParent, station.label, done, cancel, this.audio)
      : station.minigameType === 'signal-match'
        ? new SignalMatchView(this.uiParent, station.label, done, cancel, this.audio)
        : new MemoryTraceView(this.uiParent, station.label, done, cancel, this.audio);
    this.active = { station, role, view };
  }

  private completeCurrent(): void {
    const active = this.active;
    if (!active) return;
    if (this.multiplayer) {
      this.multiplayer.completeHack(active.station.id);
    } else {
      this.setComplete(active.station.id, true);
      this.setOwner(active.station.id, null);
      this.doorOpen = this.allComplete();
    }
    this.closeView();
  }

  private cancelCurrent(): void {
    const active = this.active;
    if (!active) return;
    if (this.multiplayer) this.multiplayer.cancelHack(active.station.id);
    else this.setOwner(active.station.id, null);
    this.closeView();
  }

  private closeView(): void {
    this.active?.view.dispose();
    this.active = null;
    this.debugView = false;
    document.body.classList.remove('hack-session-open');
  }

  private ownerFor(id: HackStationId): DroneRole | null {
    return this.owners[id];
  }

  private completeFor(id: HackStationId): boolean {
    return this.completed[id];
  }

  private setOwner(id: HackStationId, role: DroneRole | null): void {
    this.owners[id] = role;
  }

  private setComplete(id: HackStationId, complete: boolean): void {
    this.completed[id] = complete;
  }

  private ownerForRole(role: DroneRole): HackStation | null {
    return this.stations.find((station) => this.ownerFor(station.id) === role) ?? null;
  }
}
