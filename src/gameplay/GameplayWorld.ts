import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { CordPlayground } from '../level/CordPlayground.ts';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { GameAudio } from '../audio/GameAudio.ts';
import type { GameMode } from '../app/GameMode.ts';
import type { InteractionActions } from '../input/InteractionActions.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole, RoomStatus } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import type { RunLayout } from '../seed/index.ts';
import { BOT_TUNING } from '../../shared/bot/brain.mjs';
import { applyRunLayout } from '../seed/index.ts';
import { generateNightShiftRun } from '../seed/nightShiftRun.ts';
import { getRunState, onFloorStart, setLayoutSinkProvider } from '../run/ClientRun.ts';
import { GrabSystem } from './GrabSystem.ts';
import { Grabbable } from './Grabbable.ts';
import { HackSession } from './HackSession.ts';
import { MissionDirector } from './MissionDirector.ts';
import layout from '../level/heist-layout.json';
import { dressRunLayout } from '../level/kit/KitDressing.ts';
import { dressPrototype } from '../level/PrototypeVisual.ts';
import { dressLabCrate } from '../level/LabCrateVisual.ts';
import { dressCargoCore, dressCoolantCell } from '../level/GrabbableVisuals.ts';
import { addContactShadows } from '../level/ContactShadows.ts';
import { gameEvents } from './GameEvents.ts';
import { FloorPlanRuntime } from '../run/floorplan/FloorPlanRuntime.ts';

function vec(src: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(src.x, src.y, src.z);
}

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
  private readonly objects: Grabbable[];
  private readonly scene: Scene;
  private kitDressing: { dispose(): void } | null = null;
  private runLayout: RunLayout | null;
  private readonly removeFloorStart: (() => void) | null;
  private readonly removeObjectEvent: (() => void) | null;
  private readonly playground: CordPlayground;
  private readonly floorPlanRuntime: FloorPlanRuntime;
  private readonly removeYank: () => void;

  constructor(
    scene: Scene,
    plugin: HavokPlugin,
    mode: GameMode,
    session: MultiplayerSession | null,
    uiParent?: HTMLElement,
    onLeave?: () => void,
    runLayout?: RunLayout | null,
  ) {
    this.scene = scene;
    this.runLayout = runLayout ?? null;
    const loot = runLayout?.loot ?? layout.objects.prototype;
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
        position: vec(loot),
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
    this.objects = objects;
    dressLabCrate(objects.find((object) => object.id === 'crate-blue')!.mesh, 3.6, scene);
    dressPrototype(objects.find((object) => object.id === 'prototype')!.mesh, scene);
    dressCargoCore(objects.find((object) => object.id === 'cargo-core')!.mesh, scene);
    dressCoolantCell(objects.find((object) => object.id === 'crate-pink')!.mesh, scene);
    addContactShadows(scene, [
      { mesh: objects.find((object) => object.id === 'cargo-core')!.mesh, radius: 0.75 },
      { mesh: objects.find((object) => object.id === 'crate-blue')!.mesh, radius: 2.4 },
      { mesh: objects.find((object) => object.id === 'crate-pink')!.mesh, radius: 0.7 },
      { mesh: objects.find((object) => object.id === 'prototype')!.mesh, radius: 0.8 },
    ]);
    this.grab = new GrabSystem(
      objects,
      session,
      mode === 'multiplayer' ? session?.currentStatus.localRole ?? null : null,
      scene,
      {
        onGrab: (objectId, role) => {
          this.audio.pickup();
          this.mission.notifyGrab(objectId, role);
        },
        onThrow: () => this.mission.notifyThrow(),
        canGrab: (objectId) => objectId !== 'prototype' || (
          this.hack.allComplete() && (this.floorPlanRuntime?.canGrabPrototype() ?? true)
        ),
      },
    );
    this.hack = new HackSession(scene, plugin, session, uiParent, this.audio, runLayout);
    this.mission = new MissionDirector(scene, mode, session, this.grab, this.audio, uiParent, onLeave, runLayout);
    this.floorPlanRuntime = new FloorPlanRuntime(
      scene,
      session,
      this.grab,
      this.mission,
      this.objects.find((object) => object.id === 'prototype')!,
    );
    this.removeYank = gameEvents.on('yank', (event) => this.notifyYank(event.from));
    this.removeObjectEvent = session
      ? session.onObjectEvent((message) => this.grab.handleObjectEvent(message))
      : null;
    this.playground = new CordPlayground(scene);
    const partner = mode === 'multiplayer' && session?.currentStatus.localRole === 'nee' ? 'PIX' : 'NEE';
    this.mission.setWarmup(() => (this.playground.done ? null : this.playground.checklist(partner)));
    // Register sinks so ClientRun.applyFloorStart can call applyRunLayout(generateRun(...), sinks).
    setLayoutSinkProvider(() => this.layoutSinks());
    // applyFloorStart already ran applyRunLayout with our sinks; keep the local ref in sync.
    this.removeFloorStart = onFloorStart((_payload, layoutFromHook) => {
      if (layoutFromHook) this.runLayout = layoutFromHook;
    });
    if (session) {
      this.sync(session.currentStatus);
      // Lobby may have received floor-start before sinks existed; apply from synced run state.
      const run = session.currentStatus.run ?? getRunState();
      if (run?.mode === 'nightshift' && !runLayout) {
        this.applySoloLayout(generateNightShiftRun(run.seed, run.floor));
      }
    } else if (runLayout) {
      this.applySoloLayout(runLayout);
    }
  }

  /** Sinks for applyRunLayout — used by solo Night Shift and co-op floor-start/reconnect. */
  private layoutSinks() {
    return {
      objects: {
        prototype: { position: this.objects.find((o) => o.id === 'prototype')!.position },
      },
      onApplied: (run: RunLayout) => {
        this.objects.find((o) => o.id === 'prototype')?.relocateCradle(vec(run.loot));
        this.hack.applyRunLayout(run);
        this.mission.applyRunLayout(run);
        this.floorPlanRuntime.applyLayout(run);
        this.kitDressing?.dispose();
        if (!run.plan) {
          void dressRunLayout(this.scene, run).then((h) => { this.kitDressing = h; }).catch((e) => console.warn('[kit] dressing failed', e));
        } else {
          this.kitDressing = null;
        }
      },
    };
  }

  /** Solo / network Night Shift: push a RunLayout into terminals, loot, mission, and security. */
  applySoloLayout(run: RunLayout): void {
    this.runLayout = run;
    applyRunLayout(run, this.layoutSinks());
  }

  get activeRunLayout(): RunLayout | null {
    return this.runLayout;
  }

  sync(status: RoomStatus): void {
    this.grab.sync(status);
    this.hack.sync(status);
    this.mission.sync(status);
    this.floorPlanRuntime.sync(status);
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
    this.floorPlanRuntime.update(dt, drones);
    this.mission.update(dt, drones, this.hack, this.grab, tetherStrain);
  }

  applyHazardPhysics(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    this.floorPlanRuntime.applyPhysics(dt, drones);
  }

  notifyYank(role: DroneRole): void {
    this.floorPlanRuntime.notifyYank(role);
  }

  /** TEST-ONLY (?autotest&stage=escape): vault hacked, NEE carrying the prototype, alarm on. */
  debugStartEscape(): void {
    this.hack.debugCompleteAll();
    this.grab.debugGrab('prototype', 'nee');
  }

  debugStage(stage: 'hack-security' | 'steal-prototype' | 'escape'): void {
    this.hack.debugCompleteAll();
    this.mission.debugSetStage(stage);
  }

  /** TEST-ONLY (?autotest): security snapshot for multiplayer agreement checks. */
  debugSecurity() { return this.mission.debugSecurity(); }

  publish(): void {
    this.grab.publish();
  }

  promptsFor(role: DroneRole, drone: Drone): string[] {
    return [...this.grab.promptsFor(role, drone), ...this.hack.promptsFor(role, drone.position)];
  }

  /** Solo companion: where its own console is, once the leader is working nearby. */
  botObjective(role: DroneRole, leader: Vector3): Vector3 | null {
    const objective = this.floorPlanRuntime.botObjective(role, leader);
    if (objective) return objective;
    if (this.mission.stage !== 'hack-security') return null;
    const station = this.hack.botStation(role);
    if (!station || Vector3.Distance(station.position, leader) > BOT_TUNING.objectiveRange) return null;
    return station.position.add(new Vector3(0, 0.4, 0));
  }

  botAvoidYank(): boolean {
    return this.floorPlanRuntime.botAvoidYank();
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

  extractionPoint(): Vector3 {
    return vec(this.runLayout?.extraction ?? layout.extraction);
  }

  patrolPositions(): Vector3[] {
    return this.mission.activePatrolPositions().map((point) => vec(point));
  }

  releaseHeldFor(role: DroneRole): void {
    this.grab.releaseHeld(role);
  }

  describe(): string {
    return `${this.grab.describe()}\n${this.hack.describe()}\n${this.mission.describe()}`;
  }

  get cameraContext() { return this.mission.cameraContext; }

  /** Shared synthesized SFX bank (one AudioContext). */
  get sfx(): GameAudio { return this.audio; }
  /** Grabbable meshes (loot, crates, desk toys) for the escape replay recorder. */
  get replayProps(): readonly Mesh[] { return this.objects.map((object) => object.mesh); }

  recordTetherSave(): void { this.mission.recordTetherSave(); }

  dispose(): void {
    this.removeFloorStart?.();
    this.removeObjectEvent?.();
    this.removeYank();
    setLayoutSinkProvider(null);
    this.playground.dispose();
    this.grab.dispose();
    this.hack.dispose();
    this.mission.dispose();
    this.floorPlanRuntime.dispose();
    this.audio.dispose();
  }
}
