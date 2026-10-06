import { Color3, Vector3, type HavokPlugin, type Scene } from '@babylonjs/core';
import type { GameMode } from '../app/GameMode.ts';
import type { InteractionActions } from '../input/InteractionActions.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole, RoomStatus } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { GrabSystem } from './GrabSystem.ts';
import { Grabbable } from './Grabbable.ts';
import { HackSession } from './HackSession.ts';

/** Small reusable interaction layer for the dev gameplay room. */
export class GameplayWorld {
  private readonly grab: GrabSystem;
  private readonly hack: HackSession;

  constructor(
    scene: Scene,
    plugin: HavokPlugin,
    mode: GameMode,
    session: MultiplayerSession | null,
    uiParent?: HTMLElement,
  ) {
    const objects = [
      new Grabbable(scene, plugin, {
        id: 'cargo-core',
        label: 'Power Core',
        position: new Vector3(-1.6, 0.65, -11.7),
        color: new Color3(0.16, 0.64, 0.9),
        shape: 'sphere',
        size: 1,
        grabRadius: 3.3,
      }),
      new Grabbable(scene, plugin, {
        id: 'crate-blue',
        label: 'Lab Crate',
        position: new Vector3(1.1, 0.65, -10.7),
        color: new Color3(0.32, 0.42, 0.48),
        shape: 'box',
        size: 1.2,
        grabRadius: 3.1,
      }),
      new Grabbable(scene, plugin, {
        id: 'crate-pink',
        label: 'Coolant Cell',
        position: new Vector3(3.2, 0.65, -12),
        color: new Color3(0.72, 0.28, 0.38),
        shape: 'cylinder',
        size: 0.9,
        grabRadius: 3,
      }),
    ];
    this.grab = new GrabSystem(
      objects,
      session,
      mode === 'multiplayer' ? session?.currentStatus.localRole ?? null : null,
    );
    this.hack = new HackSession(scene, plugin, session, uiParent);
    if (session) this.sync(session.currentStatus);
  }

  sync(status: RoomStatus): void {
    this.grab.sync(status);
    this.hack.sync(status);
  }

  handle(
    role: DroneRole,
    drone: Drone,
    actions: InteractionActions,
  ): void {
    if (actions.throwObject) {
      this.grab.handleThrow(role, drone);
    }
    if (actions.grabDrop) {
      this.grab.grabOrDrop(role, drone);
    }
    if (actions.interact) {
      this.hack.tryStartNearest(role, drone.position);
    }
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    this.grab.update(dt, drones);
    this.hack.update(dt, drones);
  }

  publish(): void {
    this.grab.publish();
  }

  promptsFor(role: DroneRole, drone: Drone): string[] {
    return [...this.grab.promptsFor(role, drone), ...this.hack.promptsFor(role, drone.position)];
  }

  isRoleHacking(role: DroneRole): boolean {
    return this.hack.isRoleHacking(role);
  }

  heldObjectId(role: DroneRole): string | null {
    return this.grab.heldObjectId(role);
  }

  describe(): string {
    return `${this.grab.describe()}\n${this.hack.describe()}`;
  }

  dispose(): void {
    this.grab.dispose();
    this.hack.dispose();
  }
}
