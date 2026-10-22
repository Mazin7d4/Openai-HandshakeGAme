import { CordPlayground } from '../level/CordPlayground.ts';
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
import { dressLabCrate } from '../level/LabCrateVisual.ts';

const DESK_PROPS = [
  { id: 'mug-a', label: 'Coffee Mug', color: new Color3(0.93, 0.9, 0.84), shape: 'cylinder', size: 0.55 },
  { id: 'mug-b', label: 'Coffee Mug', color: new Color3(0.95, 0.46, 0.4), shape: 'cylinder', size: 0.55 },
  { id: 'paper-stack', label: 'Paper Stack', color: new Color3(0.96, 0.95, 0.9), shape: 'box', size: 0.7 },
  { id: 'cable-spool', label: 'Cable Spool', color: new Color3(0.55, 0.66, 0.58), shape: 'cylinder', size: 0.7 },
  { id: 'snack-tin', label: 'Snack Tin', color: new Color3(0.98, 0.78, 0.3), shape: 'box', size: 0.6 },
] as const satisfies readonly { id: keyof typeof layout.objects; label: string; color: Color3; shape: 'box' | 'cylinder' | 'sphere'; size: number }[];

/** Small reusable interaction layer for the dev gameplay room. */
export class GameplayWorld {
  private readonly grab: GrabSystem;
  private readonly hack: HackSession;
  private readonly mission: MissionDirector;
  private readonly audio = new GameAudio();
  private readonly playground: CordPlayground;

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
        label: 'Heavy Lab Crate',
        heavy: true,
        position: Vector3.FromArray(Object.values(layout.objects['crate-blue'])),
        color: new Color3(0.32, 0.42, 0.48),
        shape: 'box',
        size: 3.6,
        grabRadius: 4.8,
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
        cradled: true,
        label: 'Quantum Prototype',
        position: Vector3.FromArray(Object.values(layout.objects.prototype)),
        color: new Color3(0.32, 0.95, 0.72),
        shape: 'sphere',
        size: 1.15,
        grabRadius: 3.2,
      }),
      // Knockable desk/shelf props: cord-sweepable, grabbable, throwable at security.
      ...DESK_PROPS.map((prop) => new Grabbable(scene, plugin, {
        id: prop.id,
        label: prop.label,
        position: Vector3.FromArray(Object.values(layout.objects[prop.id])),
        color: prop.color,
        shape: prop.shape,
        size: prop.size,
        grabRadius: 2.2,
      })),
    ];
    dressLabCrate(objects.find((object) => object.id === 'crate-blue')!.mesh, 3.6, scene);
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
    this.playground = new CordPlayground(scene);
    const partner = mode === 'multiplayer' && session?.currentStatus.localRole === 'nee' ? 'PIX' : 'NEE';
    this.mission.setWarmup(() => (this.playground.done ? null : this.playground.checklist(partner)));
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
    this.playground.update(dt, drones);
    this.hack.update(dt, drones);
    this.mission.update(dt, drones, this.hack, this.grab, tetherStrain);
  }

  /** TEST-ONLY (?autotest&stage=escape): vault hacked, NEE carrying the prototype, alarm on. */
  debugStartEscape(): void {
    this.hack.debugCompleteAll();
    this.grab.debugGrab('prototype', 'nee');
  }

  publish(): void {
    this.grab.publish();
  }

  promptsFor(role: DroneRole, drone: Drone): string[] {
    return [...this.grab.promptsFor(role, drone), ...this.hack.promptsFor(role, drone.position)];
  }

  /** Solo companion: where its own console is, once the leader is working nearby. */
  botObjective(role: DroneRole, leader: Vector3): Vector3 | null {
    if (this.mission.stage !== 'hack-security') return null;
    const station = this.hack.botStation(role);
    if (!station || Vector3.Distance(station.position, leader) > 15) return null;
    return station.position.add(new Vector3(0, 0.4, 0));
  }

  botWork(role: DroneRole, position: Vector3, dt: number): boolean {
    return dt > 0 ? this.hack.botWork(role, position, dt) : (this.hack.botWork(role, position, 0), false);
  }

  isRoleHacking(role: DroneRole): boolean {
    return this.hack.isRoleHacking(role);
  }

  isRoleHaulingHeavy(role: DroneRole): boolean {
    return this.grab.isHaulingHeavy(role);
  }

  heldObjectId(role: DroneRole): string | null {
    return this.grab.heldObjectId(role);
  }

  describe(): string {
    return `${this.grab.describe()}\n${this.hack.describe()}\n${this.mission.describe()}`;
  }

  get cameraContext() { return this.mission.cameraContext; }

  /** Shared synthesized SFX bank (one AudioContext). */
  get sfx(): GameAudio { return this.audio; }

  recordTetherSave(): void { this.mission.recordTetherSave(); }

  dispose(): void {
    this.playground.dispose();
    this.grab.dispose();
    this.hack.dispose();
    this.mission.dispose();
    this.audio.dispose();
  }
}
