import type { Engine, Scene, Vector3 } from '@babylonjs/core';
import { AssetLoader } from '../assets/AssetLoader.ts';
import { CinematicCamera } from '../camera/CinematicCamera.ts';
import { DevReadout } from '../dev/DevReadout.ts';
import { FlightInput } from '../input/FlightInput.ts';
import { Drone } from '../player/Drone.ts';
import { enableHavok } from '../physics/enableHavok.ts';
import { createEngine, createScene } from '../scene/createScene.ts';

export interface GameAppOptions {
  canvas: HTMLCanvasElement;
  createLevel: (scene: Scene) => Vector3;
  devParent?: HTMLElement;
}

export class GameApp {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly assets: AssetLoader;
  readonly input: FlightInput;
  readonly drone: Drone;
  readonly cameraRig: CinematicCamera;

  private readonly devReadout: DevReadout | null;
  private readonly onResize = () => {
    this.engine.resize();
  };

  private constructor(
    engine: Engine,
    scene: Scene,
    assets: AssetLoader,
    input: FlightInput,
    drone: Drone,
    cameraRig: CinematicCamera,
    devReadout: DevReadout | null,
  ) {
    this.engine = engine;
    this.scene = scene;
    this.assets = assets;
    this.input = input;
    this.drone = drone;
    this.cameraRig = cameraRig;
    this.devReadout = devReadout;
  }

  static async create(options: GameAppOptions): Promise<GameApp> {
    const engine = createEngine(options.canvas);
    const scene = createScene(engine);
    const plugin = await enableHavok(scene);
    const spawn = options.createLevel(scene);
    const input = new FlightInput();
    const assets = new AssetLoader(scene);
    const drone = new Drone(scene, plugin, { id: 'local-player', spawn });
    const cameraRig = new CinematicCamera(scene);
    cameraRig.snap([drone]);
    const devReadout = options.devParent ? new DevReadout(options.devParent) : null;
    devReadout?.update(drone.captureSnapshot());

    return new GameApp(engine, scene, assets, input, drone, cameraRig, devReadout);
  }

  start(): void {
    window.addEventListener('resize', this.onResize);
    this.engine.runRenderLoop(() => {
      this.frame();
    });
    this.engine.resize();
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.devReadout?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    this.drone.prePhysics(dt, this.input.sample(), this.cameraRig.getPlanarBasis());
    this.scene.render();
    this.drone.postPhysics();
    this.cameraRig.update(dt, [this.drone]);
    this.devReadout?.update(this.drone.captureSnapshot());
  }
}
