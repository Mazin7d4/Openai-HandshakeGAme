import { Color3, Vector3, type HavokPlugin, type Scene } from '@babylonjs/core';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole, HackNetworkState, RoomStatus } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { Door } from './Door.ts';
import { HackStation, type HackStationId } from './HackStation.ts';
import { PacketRoutingView } from './PacketRoutingView.ts';

interface ActiveHack {
  station: HackStation;
  role: DroneRole;
  view: PacketRoutingView;
}

/** Owns station proximity, minigame lifetime, completion state and the shared door target. */
export class HackSession {
  readonly stations: readonly HackStation[];
  readonly door: Door;

  private readonly multiplayer: MultiplayerSession | null;
  private readonly uiParent: HTMLElement | null;
  private localRole: DroneRole | null;
  private stationAOwner: DroneRole | null = null;
  private stationBOwner: DroneRole | null = null;
  private stationAComplete = false;
  private stationBComplete = false;
  private doorOpen = false;
  private active: ActiveHack | null = null;

  constructor(
    scene: Scene,
    plugin: HavokPlugin,
    multiplayer: MultiplayerSession | null,
    uiParent?: HTMLElement,
  ) {
    this.multiplayer = multiplayer;
    this.uiParent = uiParent ?? null;
    this.localRole = multiplayer?.currentStatus.localRole ?? null;
    this.stations = [
      new HackStation(scene, {
        id: 'terminal-a',
        label: 'PIX ROUTER',
        position: new Vector3(-2.5, 1.25, -8.5),
        interactionRadius: 3.2,
        minigameType: 'packet-routing',
        allowedRole: 'pix',
        accent: new Color3(0.08, 0.55, 1),
      }),
      new HackStation(scene, {
        id: 'terminal-b',
        label: 'NEE ROUTER',
        position: new Vector3(2.5, 1.25, -8.5),
        interactionRadius: 3.2,
        minigameType: 'packet-routing',
        allowedRole: 'nee',
        accent: new Color3(1, 0.25, 0.48),
      }),
    ];
    this.door = new Door(scene, plugin);
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
      .filter((candidate) => candidate.allowedRole === role)
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

  isRoleHacking(role: DroneRole): boolean {
    return this.active?.role === role;
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    if (this.active) {
      const drone = drones.get(this.active.role);
      if (!drone || this.active.station.distanceTo(drone.position) > this.active.station.interactionRadius + 0.8) {
        this.cancelCurrent();
      }
    }
    for (const station of this.stations) {
      station.update(dt, this.ownerFor(station.id), this.completeFor(station.id));
    }
    this.door.setOpen(this.doorOpen);
    this.door.update(dt);
    for (const [role, drone] of drones) {
      drone.setFocused(this.ownerForRole(role) !== null);
    }
  }

  describe(): string {
    return `hack A:${this.stationAComplete ? 'complete' : this.stationAOwner ?? '-'} B:${this.stationBComplete ? 'complete' : this.stationBOwner ?? '-'} door:${this.doorOpen ? 'open' : 'locked'}`;
  }

  dispose(): void {
    this.closeView();
    for (const station of this.stations) station.dispose();
    this.door.dispose();
  }

  private applyState(state: HackNetworkState): void {
    this.stationAOwner = state.stationAOwner;
    this.stationBOwner = state.stationBOwner;
    this.stationAComplete = state.stationAComplete;
    this.stationBComplete = state.stationBComplete;
    this.doorOpen = state.doorOpen;
  }

  private openPuzzle(station: HackStation, role: DroneRole): void {
    if (!this.uiParent || this.active) return;
    const view = new PacketRoutingView(
      this.uiParent,
      station.label,
      () => this.completeCurrent(),
      () => this.cancelCurrent(),
    );
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
      this.doorOpen = this.stationAComplete && this.stationBComplete;
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
  }

  private ownerFor(id: HackStationId): DroneRole | null {
    return id === 'terminal-a' ? this.stationAOwner : this.stationBOwner;
  }

  private completeFor(id: HackStationId): boolean {
    return id === 'terminal-a' ? this.stationAComplete : this.stationBComplete;
  }

  private setOwner(id: HackStationId, role: DroneRole | null): void {
    if (id === 'terminal-a') this.stationAOwner = role;
    else this.stationBOwner = role;
  }

  private setComplete(id: HackStationId, complete: boolean): void {
    if (id === 'terminal-a') this.stationAComplete = complete;
    else this.stationBComplete = complete;
  }

  private ownerForRole(role: DroneRole): HackStation | null {
    return this.stations.find((station) => this.ownerFor(station.id) === role) ?? null;
  }
}
