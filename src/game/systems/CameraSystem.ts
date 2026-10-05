import { Vector3, FreeCamera, TransformNode, Scene, Ray } from '@babylonjs/core';

export class CameraSystem {
  private camera: FreeCamera;
  private scene: Scene;
  private target: TransformNode | null = null;

  private readonly distance = 3.7;
  private readonly lookHeight = 1.15;
  private readonly minPitch = -0.45;
  private readonly maxPitch = 1.05;
  private readonly mouseSensitivity = 0.0022;

  private currentYaw = 0;
  private currentPitch = 0.16;
  private targetYaw = 0;
  private targetPitch = 0.16;
  private snapped = false;

  private isPointerLocked = false;
  private readonly onMouseMove: (event: MouseEvent) => void;
  private readonly onPointerLock: () => void;
  private readonly onClick: () => void;
  private readonly canvas: HTMLCanvasElement;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.canvas = canvas;
    this.camera = new FreeCamera('camera', new Vector3(0, 2, -6), scene);
    this.camera.attachControl(canvas, true);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.fov = 0.85;

    this.onClick = () => canvas.requestPointerLock();
    this.onPointerLock = () => {
      this.isPointerLocked = document.pointerLockElement === canvas;
    };
    this.onMouseMove = (event: MouseEvent) => {
      if (!this.isPointerLocked) return;
      this.targetYaw -= event.movementX * this.mouseSensitivity;
      this.targetPitch -= event.movementY * this.mouseSensitivity;
      this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.targetPitch));
    };

    canvas.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  public setTarget(target: TransformNode): void {
    this.target = target;
    this.snapped = false;
    this.update(1 / 60);
  }

  public update(deltaTime: number): void {
    if (!this.target) return;

    const follow = this.snapped ? 1 - Math.exp(-10 * deltaTime) : 1;
    this.currentYaw = dampAngle(this.currentYaw, this.targetYaw, follow);
    this.currentPitch += (this.targetPitch - this.currentPitch) * follow;

    const lookAt = this.target.getAbsolutePosition().add(new Vector3(0, this.lookHeight, 0));
    const look = this.getForwardVector();
    const horizontal = this.distance * Math.cos(this.currentPitch);
    const vertical = this.distance * Math.sin(this.currentPitch);
    let desired = lookAt.subtract(look.scale(horizontal));
    desired.y += vertical;

    desired = this.resolveCollision(lookAt, desired);

    if (!this.snapped) {
      this.camera.position.copyFrom(desired);
      this.snapped = true;
    } else {
      const positionFollow = 1 - Math.exp(-8 * deltaTime);
      this.camera.position = Vector3.Lerp(this.camera.position, desired, positionFollow);
    }
    this.camera.setTarget(lookAt);
  }

  /** Flat direction the camera looks, which is where W moves the character. */
  public getForwardVector(): Vector3 {
    return new Vector3(Math.sin(this.currentYaw), 0, Math.cos(this.currentYaw));
  }

  public getRightVector(): Vector3 {
    return Vector3.Cross(Vector3.Up(), this.getForwardVector()).normalize();
  }

  public getYaw(): number {
    return this.currentYaw;
  }

  public getCamera(): FreeCamera {
    return this.camera;
  }

  private resolveCollision(lookAt: Vector3, desired: Vector3): Vector3 {
    const toCamera = desired.subtract(lookAt);
    const distance = toCamera.length();
    if (distance < 0.001) return desired;
    const direction = toCamera.scale(1 / distance);
    const ray = new Ray(lookAt, direction, distance);
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      if (!mesh.checkCollisions) return false;
      if (mesh.metadata?.player) return false;
      return mesh.isEnabled();
    });
    if (hit?.hit && hit.distance < distance - 0.2) {
      const pulled = Math.max(1.25, hit.distance - 0.3);
      return lookAt.add(direction.scale(Math.min(pulled, distance)));
    }
    return desired;
  }

  public dispose(): void {
    this.canvas.removeEventListener('click', this.onClick);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.camera.dispose();
  }
}

function dampAngle(current: number, target: number, t: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * t;
}
