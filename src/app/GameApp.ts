import { Vector3, type Engine, type Scene } from '@babylonjs/core';
import { AssetLoader } from '../assets/AssetLoader.ts';
import { CinematicCamera } from '../camera/CinematicCamera.ts';
import { BotControlSource } from '../control/BotControlSource.ts';
import type { DroneControlSource } from '../control/DroneControlSource.ts';
import { HumanControlSource } from '../control/HumanControlSource.ts';
import { RemoteControlSource } from '../control/RemoteControlSource.ts';
import { DevOrbitCamera } from '../dev/DevOrbitCamera.ts';
import { DevReadout } from '../dev/DevReadout.ts';
import { TETHER_TUNING, Tether } from '../gameplay/Tether.ts';
import { PLAYER_ONE_KEYS, PLAYER_TWO_KEYS } from '../input/KeyboardInput.ts';
import { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import { Drone, DRONE_PALETTES } from '../player/Drone.ts';
import { DRONE_MODEL_URL } from '../player/DroneVisual.ts';
import type { PlayerSnapshot } from '../player/PlayerState.ts';
import { enableHavok } from '../physics/enableHavok.ts';
import { createEngine, createScene } from '../scene/createScene.ts';
import type { GameMode } from './GameMode.ts';

export interface GameAppOptions {
  canvas: HTMLCanvasElement;
  createLevel: (scene: Scene) => Vector3;
  devParent?: HTMLElement;
  mode?: GameMode;
  multiplayer?: MultiplayerSession;
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

  private readonly devReadout: DevReadout | null;
  private readonly devOrbit: DevOrbitCamera | null;
  private readonly multiplayer: MultiplayerSession | null;
  private readonly removeNetworkStatus: (() => void) | null;
  private readonly snapshots: PlayerSnapshot[] = [];
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
        })
      : null;
  }

  static async create(options: GameAppOptions): Promise<GameApp> {
    const engine = createEngine(options.canvas);
    const scene = createScene(engine);
    const plugin = await enableHavok(scene);
    const spawn = options.createLevel(scene);
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

    const controlFor = (role: DroneRole): DroneControlSource => {
      if (mode === 'multiplayer') {
        return role === localRole
          ? new HumanControlSource(PLAYER_ONE_KEYS)
          : new RemoteControlSource();
      }
      if (mode === 'singleplayer') {
        return role === 'pix'
          ? new HumanControlSource(PLAYER_ONE_KEYS)
          : new BotControlSource();
      }
      return new HumanControlSource(role === 'pix' ? PLAYER_ONE_KEYS : PLAYER_TWO_KEYS);
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

    const cameraRig = new CinematicCamera(scene);
    cameraRig.snap(drones);
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
    );
  }

  start(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    this.engine.runRenderLoop(() => {
      this.frame();
    });
    this.engine.resize();
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    for (const player of this.players) {
      player.control.dispose();
    }
    this.removeNetworkStatus?.();
    void this.multiplayer?.dispose();
    this.devReadout?.dispose();
    this.devOrbit?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    const basis = this.cameraRig.getPlanarBasis();
    const faceGameplayCamera = this.devOrbit?.isActive !== true;

    for (const player of this.players) {
      const control = player.control.sample(dt);
      if (control.remoteState) {
        player.drone.applyRemoteState(control.remoteState);
      } else if (player.control.kind !== 'remote') {
        player.drone.steer(dt, control.actions, basis, faceGameplayCamera);
      }
    }
    this.tether.apply(dt);
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
    }
    this.tether.updateVisual();
    this.cameraRig.update(dt, this.drones);
    this.devOrbit?.update(this.drones);
    this.devReadout?.update(this.snapshots, this.tether.currentStrain);
  }
}
