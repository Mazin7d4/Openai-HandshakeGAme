import {
  Color3,
  CreateGround,
  FreeCamera,
  PBRMaterial,
  TransformNode,
  Vector3,
  type Engine,
  type Scene,
} from '@babylonjs/core';
import { AssetLoader } from '../assets/AssetLoader.ts';
import { createEngine, createScene } from '../scene/createScene.ts';
import { effectiveReducedMotion, getSettings } from './Settings.ts';
import { DRONE_MODEL_URL, DroneVisual } from '../player/DroneVisual.ts';
import { DRONE_PALETTES } from '../player/Drone.ts';

/** Lightweight, presentation-only title scene. It never creates physics bodies. */
export class TitleAttract {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly roots: TransformNode[] = [];
  private readonly visuals: DroneVisual[] = [];
  private camera: FreeCamera | null = null;
  private frame = 0;
  private disposed = false;
  private playHovered = false;
  private readonly onPlayEnter = () => { this.playHovered = true; };
  private readonly onPlayLeave = () => { this.playHovered = false; };

  private constructor(canvas: HTMLCanvasElement, engine: Engine, scene: Scene) {
    this.canvas = canvas;
    this.engine = engine;
    this.scene = scene;
  }

  static async mount(canvas: HTMLCanvasElement, play: HTMLElement): Promise<TitleAttract | null> {
    let attract: TitleAttract | null = null;
    try {
      const engine = createEngine(canvas);
      const scene = createScene(engine);
      attract = new TitleAttract(canvas, engine, scene);
      const camera = new FreeCamera('title-attract-camera', new Vector3(0, 4.4, -14), scene);
      camera.setTarget(new Vector3(0, 2.2, 0));
      camera.fov = 0.72;
      camera.minZ = 0.1;
      scene.activeCamera = camera;
      attract.camera = camera;

      const floor = CreateGround('title-attract-floor', { width: 32, height: 26 }, scene);
      const floorMat = new PBRMaterial('title-attract-floor-mat', scene);
      floorMat.albedoColor = Color3.FromHexString('#27383A');
      floorMat.roughness = 0.82;
      floor.material = floorMat;

      const assets = new AssetLoader(scene);
      const [pixModel, neeModel] = await Promise.all([
        assets.loadModel(DRONE_MODEL_URL),
        assets.loadModel(DRONE_MODEL_URL),
      ]);
      if (attract.disposed) return null;
      attract.addDrone('title-pix', pixModel, DRONE_PALETTES.pix, -1.7);
      attract.addDrone('title-nee', neeModel, DRONE_PALETTES.nee, 1.7);
      play.addEventListener('pointerenter', attract.onPlayEnter);
      play.addEventListener('pointerleave', attract.onPlayLeave);
      engine.runRenderLoop(() => attract?.tick());
      engine.resize();
      return attract;
    } catch {
      attract?.dispose();
      return null;
    }
  }

  private addDrone(name: string, model: Awaited<ReturnType<AssetLoader['loadModel']>>, palette: typeof DRONE_PALETTES.pix, x: number): void {
    const root = new TransformNode(name, this.scene);
    root.position.set(x, 2.2, 0.2);
    root.rotation.y = x < 0 ? 0.12 : -0.12;
    this.roots.push(root);
    this.visuals.push(new DroneVisual(this.scene, root, palette, model));
  }

  private tick(): void {
    if (this.disposed) return;
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    this.frame += dt;
    const reduced = effectiveReducedMotion(getSettings());
    const drift = reduced ? 0 : this.frame;
    if (this.camera) {
      this.camera.position.x = Math.sin(drift * 0.18) * 1.25;
      this.camera.position.y = 4.1 + Math.sin(drift * 0.23) * 0.22;
      this.camera.position.z = -14 + Math.cos(drift * 0.15) * 0.45;
      this.camera.setTarget(new Vector3(0, 2.2, 0));
    }
    for (let i = 0; i < this.visuals.length; i++) {
      const root = this.roots[i]!;
      root.position.y = 2.2 + Math.sin(this.frame * 1.4 + i * Math.PI) * (reduced ? 0.03 : 0.18);
      root.rotation.y += (Math.sin(this.frame * 0.28 + i) * 0.08 - root.rotation.y) * Math.min(1, dt * 1.5);
      const visual = this.visuals[i]!;
      if (this.playHovered) visual.react('happy', 0.22);
      else if (Math.floor(this.frame / 3.8 + i) % 2 === 0) visual.react('focused', 0.18);
      visual.update({ velocity: Vector3.Zero(), boosting: false, dt, focused: false, selfPowered: false });
    }
    this.scene.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.parentElement?.querySelector('[data-title-play]')?.removeEventListener('pointerenter', this.onPlayEnter);
    this.canvas.parentElement?.querySelector('[data-title-play]')?.removeEventListener('pointerleave', this.onPlayLeave);
    this.engine.stopRenderLoop();
    for (const visual of this.visuals) visual.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
