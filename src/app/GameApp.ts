import { Vector3, type Engine, type Scene } from '@babylonjs/core';
import { AssetLoader } from '../assets/AssetLoader.ts';
import { CinematicCamera } from '../camera/CinematicCamera.ts';
import { DevOrbitCamera } from '../dev/DevOrbitCamera.ts';
import { DevReadout } from '../dev/DevReadout.ts';
import { TETHER_TUNING, Tether } from '../gameplay/Tether.ts';
import { FlightInput } from '../input/FlightInput.ts';
import { PLAYER_ONE_KEYS, PLAYER_TWO_KEYS } from '../input/KeyboardInput.ts';
import { Drone, DRONE_PALETTES } from '../player/Drone.ts';
import { DRONE_MODEL_URL } from '../player/DroneVisual.ts';
import type { PlayerSnapshot } from '../player/PlayerState.ts';
import { enableHavok } from '../physics/enableHavok.ts';
import { createEngine, createScene } from '../scene/createScene.ts';

export interface GameAppOptions {
  canvas: HTMLCanvasElement;
  createLevel: (scene: Scene) => Vector3;
  devParent?: HTMLElement;
}

interface LocalPlayer {
  drone: Drone;
  input: FlightInput;
}

/**
 * Local two-player session: both drones steered from one keyboard, linked by a tether.
 * Multiplayer later swaps the second FlightInput for a network-driven source.
 */
export class GameApp {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly assets: AssetLoader;
  readonly players: readonly LocalPlayer[];
  readonly drones: readonly Drone[];
  readonly tether: Tether;
  readonly cameraRig: CinematicCamera;

  private readonly devReadout: DevReadout | null;
  private readonly devOrbit: DevOrbitCamera | null;
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
  }

  static async create(options: GameAppOptions): Promise<GameApp> {
    const engine = createEngine(options.canvas);
    const scene = createScene(engine);
    const plugin = await enableHavok(scene);
    const spawn = options.createLevel(scene);
    const assets = new AssetLoader(scene);

    // One GLB instance per player so accent materials can differ.
    const [modelOne, modelTwo] = await Promise.all([
      assets.loadModel(DRONE_MODEL_URL),
      assets.loadModel(DRONE_MODEL_URL),
    ]);

    const players: LocalPlayer[] = [
      {
        drone: new Drone(scene, plugin, {
          id: 'player-1',
          spawn: spawn.add(new Vector3(-1.6, 0, 0)),
          palette: DRONE_PALETTES.pix,
          model: modelOne,
        }),
        input: new FlightInput(PLAYER_ONE_KEYS),
      },
      {
        drone: new Drone(scene, plugin, {
          id: 'player-2',
          spawn: spawn.add(new Vector3(1.6, 0, 0)),
          palette: DRONE_PALETTES.nee,
          model: modelTwo,
        }),
        input: new FlightInput(PLAYER_TWO_KEYS),
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
    const devReadout = options.devParent ? new DevReadout(options.devParent) : null;
    const devOrbit = options.devParent ? new DevOrbitCamera(scene, options.canvas) : null;

    return new GameApp(engine, scene, assets, players, tether, cameraRig, devReadout, devOrbit);
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
      player.input.dispose();
    }
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
      player.drone.steer(dt, player.input.sample(), basis, faceGameplayCamera);
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
    this.tether.updateVisual();
    this.cameraRig.update(dt, this.drones);
    this.devOrbit?.update(this.drones);
    this.devReadout?.update(this.snapshots, this.tether.currentStrain);
  }
}
