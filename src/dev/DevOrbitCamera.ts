import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { CameraSubject } from '../camera/CameraSubject.ts';

/**
 * DEV ONLY. Orbit camera for inspecting the drone models from any angle.
 * Mouse drag rotates around the subjects' midpoint, wheel zooms.
 * Never the gameplay camera: GameApp toggles it with F2.
 */
export class DevOrbitCamera {
  readonly camera: ArcRotateCamera;

  private readonly canvas: HTMLCanvasElement;
  private readonly focus = new Vector3();
  private readonly subjectPosition = new Vector3();
  private active = false;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.camera = new ArcRotateCamera(
      'dev-orbit-camera',
      -Math.PI / 2,
      1.25,
      6,
      Vector3.Zero(),
      scene,
      false,
    );
    this.camera.minZ = 0.05;
    this.camera.maxZ = 500;
    this.camera.lowerRadiusLimit = 1.2;
    this.camera.upperRadiusLimit = 40;
    this.camera.wheelDeltaPercentage = 0.03;
    this.camera.angularSensibilityX = 600;
    this.camera.angularSensibilityY = 600;
    this.camera.panningSensibility = 0;
    this.camera.inertia = 0.75;
    // Arrow keys belong to player two.
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  }

  get isActive(): boolean {
    return this.active;
  }

  activate(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    const scene = this.camera.getScene();
    scene.activeCamera = this.camera;
    this.camera.attachControl(this.canvas, true);
  }

  deactivate(previous: Scene['activeCamera']): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.camera.detachControl();
    this.camera.getScene().activeCamera = previous;
  }

  /** Keep the orbit centre on the subjects while they fly. */
  update(subjects: readonly CameraSubject[]): void {
    if (!this.active || subjects.length === 0) {
      return;
    }
    this.focus.set(0, 0, 0);
    for (const subject of subjects) {
      subject.getFocusPosition(this.subjectPosition);
      this.focus.addInPlace(this.subjectPosition);
    }
    this.focus.scaleInPlace(1 / subjects.length);
    this.camera.target.copyFrom(this.focus);
  }

  dispose(): void {
    this.camera.detachControl();
    this.camera.dispose();
  }
}
