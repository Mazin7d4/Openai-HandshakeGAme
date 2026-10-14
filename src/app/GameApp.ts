import { Vector3, type Engine, type Scene } from '@babylonjs/core';
import { AssetLoader } from '../assets/AssetLoader.ts';
import { CinematicCamera } from '../camera/CinematicCamera.ts';
import { BotControlSource } from '../control/BotControlSource.ts';
import type { DroneControlSource } from '../control/DroneControlSource.ts';
import { HumanControlSource } from '../control/HumanControlSource.ts';
import { RemoteControlSource } from '../control/RemoteControlSource.ts';
import { Autopilot } from '../dev/Autopilot.ts';
import { DevOrbitCamera } from '../dev/DevOrbitCamera.ts';
import { DevReadout } from '../dev/DevReadout.ts';
import { reportStabilityIssue, StabilityDiagnostics } from '../dev/StabilityDiagnostics.ts';
import { TETHER_TUNING, Tether } from '../gameplay/Tether.ts';
import { GameplayWorld } from '../gameplay/GameplayWorld.ts';
import { gameEvents } from '../gameplay/GameEvents.ts';
import { Juice } from '../gameplay/Juice.ts';
import { TetherMoves, type YankKind } from '../gameplay/TetherMoves.ts';
import { zeroFlightAxes } from '../input/FlightAxes.ts';
import { PLAYER_ONE_KEYS } from '../input/KeyboardInput.ts';
import { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import { Drone, DRONE_PALETTES } from '../player/Drone.ts';
import { DRONE_MODEL_URL } from '../player/DroneVisual.ts';
import type { PlayerSnapshot } from '../player/PlayerState.ts';
import { enableHavok } from '../physics/enableHavok.ts';
import { createEngine, createScene } from '../scene/createScene.ts';
import { GameHud } from '../ui/GameHud.ts';
import type { GameMode } from './GameMode.ts';

export interface GameAppOptions {
  canvas: HTMLCanvasElement;
  createLevel: (scene: Scene) => Vector3 | Promise<Vector3>;
  uiParent?: HTMLElement;
  devParent?: HTMLElement;
  mode?: GameMode;
  multiplayer?: MultiplayerSession;
  onLeaveGame?: () => void;
}

interface LocalPlayer {
  role: DroneRole;
  drone: Drone;
  control: DroneControlSource;
}

/**
 * Shared two-drone session. Control sources decide whether each pawn is driven
 * by local human actions, a replicated remote pose, or the future bot seam.
 */
export class GameApp {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly assets: AssetLoader;
  readonly players: readonly LocalPlayer[];
  readonly drones: readonly Drone[];
  readonly tether: Tether;
  readonly cameraRig: CinematicCamera;
  readonly mode: GameMode;
  readonly gameplay: GameplayWorld;

  private readonly devReadout: DevReadout | null;
  private readonly devOrbit: DevOrbitCamera | null;
  private readonly multiplayer: MultiplayerSession | null;
  private readonly removeNetworkStatus: (() => void) | null;
  private readonly snapshots: PlayerSnapshot[] = [];
  private readonly hud: GameHud | null;
  private readonly diagnostics = new StabilityDiagnostics();
  private readonly idleAxes = zeroFlightAxes();
  /** TEST-ONLY (?autotest): position-targeted steering for deterministic verifiers. */
  private readonly autopilot = Autopilot.enabled ? new Autopilot() : null;
  private paused = false;
  private readonly juice: Juice;
  private readonly moves: TetherMoves;
  private readonly unsubscribers: (() => void)[] = [];
  private hintTimer = 0;
  private yankRequested = false;
  private disposed = false;
  private activeDevRole: DroneRole = 'pix';
  private readonly onResize = () => {
    this.engine.resize();
  };
  /** DEV ONLY: F2 toggles the orbit inspection camera. Gameplay keeps the cinematic rig. */
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'F2' || !this.devOrbit) {
      return;
    }
    event.preventDefault();
    if (this.devOrbit.isActive) {
      this.devOrbit.deactivate(this.cameraRig.camera);
    } else {
      this.devOrbit.activate();
    }
  };

  private constructor(
    engine: Engine,
    scene: Scene,
    assets: AssetLoader,
    players: LocalPlayer[],
    tether: Tether,
    cameraRig: CinematicCamera,
    devReadout: DevReadout | null,
    devOrbit: DevOrbitCamera | null,
    mode: GameMode,
    multiplayer: MultiplayerSession | null,
    gameplay: GameplayWorld,
    hudParent: HTMLElement | undefined,
    onLeaveGame: (() => void) | undefined,
  ) {
    this.engine = engine;
    this.scene = scene;
    this.assets = assets;
    this.players = players;
    this.drones = players.map((p) => p.drone);
    this.tether = tether;
    this.cameraRig = cameraRig;
    this.devReadout = devReadout;
    this.devOrbit = devOrbit;
    this.mode = mode;
    this.multiplayer = multiplayer;
    this.gameplay = gameplay;
    this.hud = hudParent
      ? new GameHud(hudParent, {
          onResume: () => this.setPaused(false),
          onLeave: () => onLeaveGame?.(),
          onGraphicsQuality: (quality) => {
            this.engine.setHardwareScalingLevel(
              quality === 'low' ? 1.5 : quality === 'medium' ? 1 : 0.75,
            );
          },
          onInteract: () => this.triggerHudAction('interact'),
          onGrabDrop: () => this.triggerHudAction('grabDrop'),
          onThrow: () => this.triggerHudAction('throwObject'),
          onYank: () => { this.yankRequested = true; },
        })
      : null;
    this.juice = new Juice(scene);
    const audio = gameplay.sfx;
    this.moves = new TetherMoves(
      audio,
      cameraRig,
      this.juice,
      multiplayer,
      (text, tone) => this.hud?.toast(text, tone),
      () => gameplay.recordTetherSave(),
    );
    const isLocalDrone = (id: string) => {
      const role = this.hudRole();
      return this.players.find((p) => p.role === role)?.drone.id === id;
    };
    this.unsubscribers.push(
      gameEvents.on('impact', (e) => {
        this.juice.burst('impact', e.position, 6 + Math.min(16, e.strength * 1.4));
        audio.impact(Math.min(1, e.strength / 12));
        if (isLocalDrone(e.droneId)) this.cameraRig.addShake(Math.min(0.4, e.strength * 0.03));
      }),
      gameEvents.on('boost', (e) => {
        if (!isLocalDrone(e.droneId)) return;
        audio.boostStart();
        this.cameraRig.kickFov(0.045);
      }),
      gameEvents.on('knockback', (e) => {
        this.juice.burst('impact', e.position, 12);
        if (isLocalDrone(e.droneId)) {
          this.cameraRig.addShake(0.35);
          this.hud?.toast('YANK [R] TO RESCUE!', 'good');
        }
      }),
      gameEvents.on('clothesline', (e) => {
        this.juice.burst('zap', e.position, 34);
        audio.clothesline();
        this.cameraRig.addShake(0.45);
        for (const drone of this.drones) drone.react('proud', 1.2);
        this.hud?.toast('CLOTHESLINED!', 'good');
      }),
      gameEvents.on('heist', (e) => {
        const pos = e.position;
        switch (e.beat) {
          case 'vault':
            this.juice.burst('zap', pos, 40);
            audio.success();
            this.cameraRig.beat(pos, 2.4);
            this.cameraRig.addShake(0.12);
            for (const drone of this.drones) drone.react('happy', 2);
            this.hud?.toast('VAULT OPEN · MEET P01', 'good');
            break;
          case 'pickup':
            this.juice.burst('zap', pos, 60);
            this.juice.burst('pix', pos, 25);
            this.juice.burst('nee', pos, 25);
            this.cameraRig.addShake(0.6);
            this.cameraRig.kickFov(0.08);
            this.cameraRig.beat(pos, 1.4);
            for (const p of this.players) {
              if (e.role != null && p.role === e.role) {
                p.drone.react('proud', 2.5);
              } else {
                p.drone.react('panic', 2);
              }
            }
            this.hud?.toast('WE GOT IT!', 'good');
            setTimeout(() => { if (!this.disposed) this.hud?.toast('ALARM! SECURITY DRONES ONLINE', 'good'); }, 900);
            break;
          case 'extract':
            this.juice.burst('confetti', pos, 120);
            setTimeout(() => { if (!this.disposed) this.juice.burst('confetti', pos.add(new Vector3(0, 2, 0)), 120); }, 250);
            setTimeout(() => { if (!this.disposed) this.juice.burst('confetti', pos.add(new Vector3(0, 4, 0)), 120); }, 500);
            this.juice.burst('pix', pos, 40);
            this.juice.burst('nee', pos, 40);
            for (const drone of this.drones) drone.react('proud', 6);
            this.cameraRig.addShake(0.3);
            break;
        }
      }),
    );
    if (multiplayer) {
      this.unsubscribers.push(multiplayer.onTetherYanked((message) => {
        const role = multiplayer.currentStatus.localRole;
        const local = this.players.find((p) => p.role === role)?.drone;
        if (local) this.moves.receive(message, local, true);
      }));
    }
    this.removeNetworkStatus = multiplayer
      ? multiplayer.onStatus((status) => {
          for (const player of this.players) {
            if (player.control instanceof RemoteControlSource) {
              const remote = status.players.get(player.role);
              if (remote) {
                player.control.push(remote);
              }
            }
          }
          this.gameplay.sync(status);
        })
      : null;
  }

  static async create(options: GameAppOptions): Promise<GameApp> {
    const engine = createEngine(options.canvas);
    const scene = createScene(engine);
    const plugin = await enableHavok(scene);
    const spawn = await options.createLevel(scene);
    const assets = new AssetLoader(scene);
    const mode = options.mode ?? 'dev-local';
    const multiplayer = options.multiplayer ?? null;
    const localRole = multiplayer?.currentStatus.localRole ?? null;
    if (mode === 'multiplayer' && (!multiplayer || !localRole)) {
      throw new Error('Multiplayer mode requires a joined room and assigned role.');
    }

    // One GLB instance per player so accent materials can differ.
    const [modelOne, modelTwo] = await Promise.all([
      assets.loadModel(DRONE_MODEL_URL),
      assets.loadModel(DRONE_MODEL_URL),
    ]);

    // Late-bound refs so the single-player companion can perceive drones/camera created below.
    const live: { drones?: Drone[]; camera?: CinematicCamera; gameplay?: GameplayWorld } = {};
    const controlFor = (role: DroneRole): DroneControlSource => {
      if (mode === 'multiplayer') {
        return role === localRole
          ? new HumanControlSource(PLAYER_ONE_KEYS)
          : new RemoteControlSource();
      }
      if (mode === 'singleplayer') {
        return role === 'pix'
          ? new HumanControlSource(PLAYER_ONE_KEYS)
          : new BotControlSource({
            self: () => live.drones?.[1]?.position ?? null,
            leader: () => live.drones?.[0]?.position ?? null,
            basis: () => live.camera!.getPlanarBasis(),
            busy: () => live.gameplay?.isRoleHacking('nee') ?? false,
          });
      }
      return role === 'pix'
        ? new HumanControlSource(PLAYER_ONE_KEYS)
        : new BotControlSource();
    };
    const players: LocalPlayer[] = [
      {
        role: 'pix',
        drone: new Drone(scene, plugin, {
          id: 'player-1',
          spawn: spawn.add(new Vector3(-1.6, 0, 0)),
          palette: DRONE_PALETTES.pix,
          model: modelOne,
        }),
        control: controlFor('pix'),
      },
      {
        role: 'nee',
        drone: new Drone(scene, plugin, {
          id: 'player-2',
          spawn: spawn.add(new Vector3(1.6, 0, 0)),
          palette: DRONE_PALETTES.nee,
          model: modelTwo,
        }),
        control: controlFor('nee'),
      },
    ];
    const drones = players.map((p) => p.drone);
    const tether = new Tether(scene, drones[0], drones[1], TETHER_TUNING, {
      collarA: DRONE_PALETTES.pix.accent,
      collarB: DRONE_PALETTES.nee.accent,
    });
    const uiParent = options.uiParent ?? options.devParent;
    const gameplay = new GameplayWorld(scene, plugin, mode, multiplayer, uiParent, options.onLeaveGame);

    const cameraRig = new CinematicCamera(scene);
    cameraRig.snap(drones);
    Object.assign(live, { drones, camera: cameraRig, gameplay });
    scene.activeCamera = cameraRig.camera;
    const devReadout = options.devParent ? new DevReadout(options.devParent, mode) : null;
    const devOrbit = options.devParent ? new DevOrbitCamera(scene, options.canvas) : null;

    return new GameApp(
      engine,
      scene,
      assets,
      players,
      tether,
      cameraRig,
      devReadout,
      devOrbit,
      mode,
      multiplayer,
      gameplay,
      uiParent,
      options.onLeaveGame,
    );
  }

  start(): void {
    this.autopilot?.install();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    this.engine.runRenderLoop(() => {
      this.frame();
    });
    this.engine.resize();
  }

  dispose(): void {
    this.disposed = true;
    this.engine.stopRenderLoop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    for (const player of this.players) {
      player.control.dispose();
    }
    this.removeNetworkStatus?.();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.juice.dispose();
    void this.multiplayer?.dispose();
    this.devReadout?.dispose();
    this.devOrbit?.dispose();
    this.cameraRig.dispose();
    this.gameplay.dispose();
    this.hud?.dispose();
    this.diagnostics.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private frame(): void {
    try {
      this.tick();
    } catch (error) {
      reportStabilityIssue('game-loop', 'Frame execution failed; pausing the simulation.', error);
      this.setPaused(true);
    }
  }

  private tick(): void {
    if (this.paused) return;
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    const basis = this.cameraRig.getPlanarBasis();
    const faceGameplayCamera = this.devOrbit?.isActive !== true;
    const droneByRole = new Map<DroneRole, Drone>();
    for (const player of this.players) droneByRole.set(player.role, player.drone);

    let switchDrone = false;
    for (const player of this.players) {
      const control = player.control.sample(dt);
      if (control.remoteState) {
        player.drone.applyRemoteState(control.remoteState);
      } else if (player.control.kind !== 'remote') {
        const piloted = this.autopilot?.steer(player.role, player.drone.position, basis) ?? null;
        const actions = this.gameplay.isRoleHacking(player.role)
          ? this.idleAxes
          : piloted ?? control.actions;
        player.drone.steer(dt, actions, basis, faceGameplayCamera);
      }
      if (player.control.kind !== 'remote') {
        const interactions = this.autopilot
          ? this.autopilot.interactions(player.role, control.interactions)
          : control.interactions;
        this.gameplay.handle(player.role, player.drone, interactions);
        const wantsYank = interactions.yank || (this.yankRequested && player.role === this.hudRole());
        if (wantsYank && !this.gameplay.isRoleHacking(player.role)) this.yank(player);
        if (interactions.pause) this.setPaused(true);
        switchDrone ||= control.interactions.switchDrone;
      }
    }
    this.yankRequested = false;
    this.moves.update(dt);
    this.gameplay.sfx.cordTension(this.tether.currentStrain);
    if (switchDrone && this.mode === 'dev-local') this.switchDevDrone();
    this.gameplay.update(dt, droneByRole, this.tether.currentStrain);
    this.tether.apply(dt, (drone) => {
      const player = this.players.find((candidate) => candidate.drone === drone);
      return player?.control.kind !== 'remote';
    });
    for (const drone of this.drones) {
      drone.commit();
    }

    this.scene.render();

    this.snapshots.length = 0;
    for (const drone of this.drones) {
      drone.postPhysics(dt);
      this.snapshots.push(drone.captureSnapshot());
    }
    if (this.multiplayer) {
      const localIndex = this.players.findIndex(
        (player) => player.role === this.multiplayer?.currentStatus.localRole,
      );
      const localSnapshot = this.snapshots[localIndex];
      if (localSnapshot) {
        this.multiplayer.publish(localSnapshot);
      }
      this.gameplay.publish();
    }
    this.tether.updateVisual();
    this.cameraRig.update(dt, this.drones, this.gameplay.cameraContext);
    this.devOrbit?.update(this.drones);
    this.devReadout?.update(
      this.snapshots,
      this.tether.currentStrain,
      this.gameplay.describe(),
      {
        fps: this.engine.getFps(),
        activeRole: this.mode === 'dev-local'
          ? this.activeDevRole
          : this.multiplayer?.currentStatus.localRole ?? 'pix',
        heldObject: this.gameplay.heldObjectId(
          this.mode === 'dev-local'
            ? this.activeDevRole
            : this.multiplayer?.currentStatus.localRole ?? 'pix',
        ),
        network: this.multiplayer?.connectionState ?? 'local',
        diagnostics: this.diagnostics.summary,
      },
    );
    const hudRole = this.mode === 'dev-local'
      ? this.activeDevRole
      : this.multiplayer?.currentStatus.localRole ?? 'pix';
    const hudPlayer = this.players.find((player) => player.role === hudRole);
    if (hudPlayer) {
      this.hud?.update(
        [...this.gameplay.promptsFor(hudRole, hudPlayer.drone), ...this.tetherPrompts(hudPlayer, dt)],
        this.mode,
        hudRole,
      );
    }
  }

  private hudRole(): DroneRole {
    return this.mode === 'dev-local'
      ? this.activeDevRole
      : this.multiplayer?.currentStatus.localRole ?? 'pix';
  }

  private partnerOf(player: LocalPlayer): LocalPlayer | undefined {
    return this.players.find((candidate) => candidate !== player);
  }

  private partnerAnchored(partner: LocalPlayer): boolean {
    return this.gameplay.isRoleHacking(partner.role);
  }

  private yank(player: LocalPlayer): void {
    const partner = this.partnerOf(player);
    if (!partner) return;
    this.moves.tryYank(
      player.role,
      player.drone,
      partner.drone,
      partner.control.kind !== 'remote',
      this.tether.currentStrain,
      this.partnerAnchored(partner),
    );
  }

  /** Contextual tether-move prompts. Only shown when the move is meaningful right now. */
  private tetherPrompts(player: LocalPlayer, dt: number): string[] {
    const partner = this.partnerOf(player);
    if (!partner || this.gameplay.isRoleHacking(player.role)) return [];
    const name = partner.role.toUpperCase();
    if (this.moves.cooldown(player.role) > 0) return [];
    if (partner.drone.inTrouble) return [`[R] YANK ${name} TO SAFETY`];
    const strain = this.tether.currentStrain;
    const kind: YankKind | null = this.moves.preview(player.drone, partner.drone, strain, this.partnerAnchored(partner));
    if (kind === 'sling') return [`[R] SLINGSHOT PAST ${name}`];
    if (kind === 'yank' && strain > 0.25) {
      this.hintTimer += dt;
      return this.hintTimer < 9 ? [`[R] YANK ${name}`] : [];
    }
    return [];
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.hud?.setPaused(paused);
  }

  private switchDevDrone(): void {
    this.activeDevRole = this.activeDevRole === 'pix' ? 'nee' : 'pix';
    for (const player of this.players) {
      player.control.dispose();
      player.control = player.role === this.activeDevRole
        ? new HumanControlSource(PLAYER_ONE_KEYS)
        : new BotControlSource();
    }
  }

  private triggerHudAction(action: 'interact' | 'grabDrop' | 'throwObject'): void {
    const role = this.mode === 'dev-local'
      ? this.activeDevRole
      : this.multiplayer?.currentStatus.localRole ?? 'pix';
    const player = this.players.find((candidate) => candidate.role === role);
    if (!player) return;
    this.gameplay.handle(role, player.drone, {
      grabDrop: action === 'grabDrop',
      throwObject: action === 'throwObject',
      interact: action === 'interact',
      pause: false,
      switchDrone: false,
      yank: false,
    });
  }
}
