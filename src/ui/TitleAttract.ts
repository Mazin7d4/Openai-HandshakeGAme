import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Engine } from '@babylonjs/core/Engines/engine.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { AssetLoader } from '../assets/AssetLoader.ts';
import { createEngine, createScene } from '../scene/createScene.ts';
import { effectiveReducedMotion, getSettings } from './Settings.ts';
import { DRONE_MODEL_URL, DroneVisual } from '../player/DroneVisual.ts';
import { DRONE_PALETTES } from '../player/Drone.ts';
import { initialTier } from '../scene/Quality.ts';
import { loadPropKit } from '../level/PropKit.ts';

/** Lightweight, presentation-only title scene. It never creates physics bodies. */
export class TitleAttract {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly roots: TransformNode[] = [];
  private readonly visuals: DroneVisual[] = [];
  private tether: ReturnType<typeof MeshBuilder.CreateTube> | null = null;
  private readonly tetherMat: PBRMaterial;
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
    this.tetherMat = new PBRMaterial('title-attract-tether-mat', scene);
    this.tetherMat.albedoColor = Color3.FromHexString('#20292B');
    this.tetherMat.metallic = 0.55;
    this.tetherMat.roughness = 0.42;
  }

  static async mount(canvas: HTMLCanvasElement, play: HTMLElement): Promise<TitleAttract | null> {
    let attract: TitleAttract | null = null;
    try {
      const engine = createEngine(canvas);
      const scene = createScene(engine);
      attract = new TitleAttract(canvas, engine, scene);
      if (initialTier() === 'low') {
        attract.dispose();
        return null;
      }
      // The authored drone face is on +Z. Keep the camera on that side so the screen is the hero.
      const camera = new FreeCamera('title-attract-camera', new Vector3(3.1, 4.1, 13.5), scene);
      camera.setTarget(new Vector3(3.1, 2.25, 0));
      camera.fov = 0.72;
      camera.minZ = 0.1;
      scene.activeCamera = camera;
      attract.camera = camera;

      const floor = CreateGround('title-attract-floor', { width: 32, height: 26 }, scene);
      const floorMat = new PBRMaterial('title-attract-floor-mat', scene);
      floorMat.albedoColor = Color3.FromHexString('#616C70');
      floorMat.roughness = 0.82;
      floor.material = floorMat;

      const wall = CreateBox('title-attract-wall', { width: 22, height: 11, depth: 0.35 }, scene);
      wall.position.set(3.1, 5.3, -2.6);
      const wallMat = new PBRMaterial('title-attract-wall-mat', scene);
      wallMat.albedoColor = Color3.FromHexString('#989D96');
      wallMat.roughness = 0.88;
      wall.material = wallMat;
      const key = new PointLight('title-warm-key', new Vector3(1.5, 8, 7), scene);
      key.diffuse = Color3.FromHexString('#F5EEE2'); key.intensity = 22; key.range = 18;
      const cool = new PointLight('title-cool-fill', new Vector3(9, 4, 3), scene);
      cool.diffuse = Color3.FromHexString('#EDF1F4'); cool.intensity = 12; cool.range = 16;

      const props = await loadPropKit(scene);
      props.place({ prop: 'Plant', x: 0.3, y: 0, z: -1.8, scale: 1.25, ry: -0.2 });
      props.place({ prop: 'Monitor', x: 7.4, y: 0, z: -1.9, scale: 1.1, ry: Math.PI });
      props.place({ prop: 'Sofa', x: 9.3, y: 0, z: -0.7, scale: 1.05, ry: Math.PI });
      props.commit();

      const assets = new AssetLoader(scene);
      const [pixModel, neeModel] = await Promise.all([
        assets.loadModel(DRONE_MODEL_URL),
        assets.loadModel(DRONE_MODEL_URL),
      ]);
      if (attract.disposed) return null;
      attract.addDrone('title-pix', pixModel, DRONE_PALETTES.pix, -1.7);
      attract.addDrone('title-nee', neeModel, DRONE_PALETTES.nee, 1.7);
      attract.tether = MeshBuilder.CreateTube('title-attract-tether', {
        path: [new Vector3(1.6, 2.2, 0.4), new Vector3(3.1, 1.85, 0.7), new Vector3(4.6, 2.2, 0.4)],
        radius: 0.045, tessellation: 8, cap: Mesh.CAP_ALL,
      }, scene);
      attract.tether.material = attract.tetherMat;
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
      const portrait = this.engine.getAspectRatio(this.camera) < 0.75;
      const targetX = portrait ? 0 : 3.1;
      const targetY = portrait ? 5.45 : 2.2;
      this.camera.position.x = targetX + Math.sin(drift * 0.18) * (portrait ? 0.35 : 1.0);
      this.camera.position.y = (portrait ? 7.0 : 4.1) + Math.sin(drift * 0.23) * 0.22;
      this.camera.position.z = (portrait ? 11.8 : 13.5) + Math.cos(drift * 0.15) * 0.35;
      this.camera.fov = portrait ? 0.92 : 0.72;
      this.camera.setTarget(new Vector3(targetX, targetY, 0));
    }
    const portrait = this.camera ? this.engine.getAspectRatio(this.camera) < 0.75 : false;
    const baseY = portrait ? 5.8 : 2.2;
    for (let i = 0; i < this.visuals.length; i++) {
      const root = this.roots[i]!;
      root.position.x = portrait ? (i === 0 ? -0.72 : 0.72) : (i === 0 ? -1.7 : 1.7);
      root.position.z = portrait ? 2.8 : 0.2;
      root.position.y = baseY + Math.sin(this.frame * 1.4 + i * Math.PI) * (reduced ? 0.03 : 0.18);
      root.rotation.y += (Math.sin(this.frame * 0.28 + i) * 0.08 - root.rotation.y) * Math.min(1, dt * 1.5);
      const visual = this.visuals[i]!;
      if (this.playHovered) visual.react('happy', 0.22);
      else if (Math.floor(this.frame / 3.8 + i) % 2 === 0) visual.react('focused', 0.18);
      visual.update({ velocity: Vector3.Zero(), boosting: false, dt, focused: false, selfPowered: false });
    }
    if (this.tether) {
      const a = this.roots[0]!.getAbsolutePosition();
      const b = this.roots[1]!.getAbsolutePosition();
      const path = [a.add(new Vector3(0, 0, 0.25)), new Vector3(portrait ? 0 : 3.1, portrait ? baseY - 0.3 : 1.9, 0.8), b.add(new Vector3(0, 0, 0.25))];
      MeshBuilder.CreateTube('title-attract-tether', { path, radius: 0.045, tessellation: 8, cap: Mesh.CAP_ALL, instance: this.tether });
    }
    this.scene.render();
    if (this.frame > 0 && !this.canvas.classList.contains('title-attract-canvas--ready')) {
      this.canvas.classList.add('title-attract-canvas--ready');
      this.canvas.parentElement?.classList.add('title-scene-ready');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.parentElement?.querySelector('[data-title-play]')?.removeEventListener('pointerenter', this.onPlayEnter);
    this.canvas.parentElement?.querySelector('[data-title-play]')?.removeEventListener('pointerleave', this.onPlayLeave);
    this.engine.stopRenderLoop();
    for (const visual of this.visuals) visual.dispose();
    this.tether?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
