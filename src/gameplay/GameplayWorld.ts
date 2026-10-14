import { Color3, Vector3, type HavokPlugin, type Scene } from '@babylonjs/core';
import { GameAudio } from '../audio/GameAudio.ts';
import type { GameMode } from '../app/GameMode.ts';
import type { InteractionActions } from '../input/InteractionActions.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole, RoomStatus } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { GrabSystem } from './GrabSystem.ts';
import { Grabbable } from './Grabbable.ts';
import { HackSession } from './HackSession.ts';
import { MissionDirector } from './MissionDirector.ts';
import layout from '../level/heist-layout.json';
import { dressPrototype } from '../level/PrototypeVisual.ts';

/** Small reusable interaction layer for the dev gameplay room. */
export class GameplayWorld {
  private readonly grab: GrabSystem;
  private readonly hack: HackSession;
  private readonly mission: MissionDirector;
  private readonly audio = new GameAudio();

  constructor(
    scene: Scene,
    plugin: HavokPlugin,
    mode: GameMode,
    session: MultiplayerSession | null,
    uiParent?: HTMLElement,
    onLeave?: () => void,
  ) {
    const objects = [
      new Grabbable(scene, plugin, {
        id: 'cargo-core',
        label: 'Power Core',
        position: Vector3.FromArray(Object.values(layout.objects['cargo-core'])),
        color: new Color3(0.16, 0.64, 0.9),
        shape: 'sphere',
        size: 1,
        grabRadius: 3.3,
      }),
      new Grabbable(scene, plugin, {
        id: 'crate-blue',
        label: 'Lab Crate',
        position: Vector3.FromArray(Object.values(layout.objects['crate-blue'])),
        color: new Color3(0.32, 0.42, 0.48),
        shape: 'box',
        size: 1.2,
        grabRadius: 3.1,
      }),
      new Grabbable(scene, plugin, {
        id: 'crate-pink',
        label: 'Coolant Cell',
        position: Vector3.FromArray(Object.values(layout.objects['crate-pink'])),
        color: new Color3(0.72, 0.28, 0.38),
        shape: 'cylinder',
        size: 0.9,
        grabRadius: 3,
      }),
      new Grabbable(scene, plugin, {
        id: 'prototype',
        label: 'Quantum Prototype',
        position: Vector3.FromArray(Object.values(layout.objects.prototype)),
        color: new Color3(0.32, 0.95, 0.72),
        shape: 'sphere',
        size: 1.15,
        grabRadius: 3.2,
      }),
    ];
    dressPrototype(objects.find((object) => object.id === 'prototype')!.mesh, scene);
    this.grab = new GrabSystem(
      objects,
      session,
      mode === 'multiplayer' ? session?.currentStatus.localRole ?? null : null,
      {
        onGrab: (objectId, role) => {
          this.audio.pickup();
          this.mission.notifyGrab(objectId, role);
        },
        onThrow: () => this.mission.notifyThrow(),
        canGrab: (objectId) => objectId !== 'prototype' || this.hack.allComplete(),
      },
    );
    this.hack = new HackSession(scene, plugin, session, uiParent, this.audio);
    this.mission = new MissionDirector(scene, mode, session, this.grab, this.audio, uiParent, onLeave);
    if (session) this.sync(session.currentStatus);
  }

  sync(status: RoomStatus): void {
    this.grab.sync(status);
    this.hack.sync(status);
    this.mission.sync(status);
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

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>, tetherStrain = 0): void {
    this.grab.update(dt, drones);
    this.hack.update(dt, drones);
    this.mission.update(dt, drones, this.hack, this.grab, tetherStrain);
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
    return `${this.grab.describe()}\n${this.hack.describe()}\n${this.mission.describe()}`;
  }

  get cameraContext() { return this.mission.cameraContext; }

  dispose(): void {
    this.grab.dispose();
    this.hack.dispose();
    this.mission.dispose();
    this.audio.dispose();
  }
}
