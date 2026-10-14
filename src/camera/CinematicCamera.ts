import { FreeCamera, Ray, Vector3, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { CameraSubject } from './CameraSubject.ts';

export interface CameraContext { alarm: boolean; vaultOpen: boolean; complete: boolean }
const QUIET: CameraContext = { alarm: false, vaultOpen: false, complete: false };
const smooth = (a: number, b: number, speed: number, dt: number) => a + (b - a) * (1 - Math.exp(-speed * dt));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Authored dolly with a fixed compass heading. No camera input or axis reversals. */
export class CinematicCamera {
  readonly camera: FreeCamera;
  private readonly scene: Scene;
  private readonly focus = new Vector3();
  private readonly previousFocus = new Vector3();
  private readonly motion = new Vector3();
  private readonly look = new Vector3();
  private readonly position = new Vector3();
  private readonly sample = new Vector3();
  private readonly forward = new Vector3(0.325, 0, 0.946).normalize();
  private readonly right = new Vector3(0.946, 0, -0.325).normalize();
  private placed = false;
  private distance = 13;
  private pitch = 0.53;
  private reveal = 0;
  private occluders: AbstractMesh[] | null = null;
  private readonly canvas: HTMLCanvasElement | null;
  private looking = false;
  private lookYaw = 0;
  private lookPitch = 0;
  private zoom = 1;
  private releaseTimer = 0;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.scene.activeCamera !== this.camera) return;
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size < 2) return;
    } else if (event.button !== 2) return;
    this.looking = true; this.releaseTimer = 1.8;
    this.canvas?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.looking) return;
    let dx = event.movementX, dy = event.movementY;
    if (event.pointerType === 'touch') {
      const before = this.touches.get(event.pointerId);
      if (!before || this.touches.size < 2) return;
      const other = [...this.touches].find(([id]) => id !== event.pointerId)?.[1];
      if (!other) return;
      const oldDistance = Math.hypot(before.x - other.x, before.y - other.y);
      dx = (event.clientX - before.x) * 0.5;
      dy = (event.clientY - before.y) * 0.5;
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const newDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      this.zoom = clamp(this.zoom + (oldDistance - newDistance) * 0.003, 0.85, 1.16);
    }
    this.lookYaw = clamp(this.lookYaw + dx * 0.0015, -0.16, 0.16);
    this.lookPitch = clamp(this.lookPitch - dy * 0.0012, -0.085, 0.085);
  };
  private readonly onPointerUp = (event: PointerEvent) => {
    this.touches.delete(event.pointerId);
    if (event.pointerType !== 'touch' || this.touches.size < 2) this.looking = false;
  };
  private readonly onWheel = (event: WheelEvent) => {
    if (this.scene.activeCamera !== this.camera) return;
    this.zoom = clamp(this.zoom + Math.sign(event.deltaY) * 0.05, 0.85, 1.16);
    event.preventDefault();
  };
  private readonly onContextMenu = (event: MouseEvent) => event.preventDefault();

  constructor(scene: Scene) {
    this.scene = scene;
    this.canvas = scene.getEngine().getRenderingCanvas();
    this.camera = new FreeCamera('cinematic-camera', new Vector3(0, 8, -24), scene);
    this.camera.fov = 0.86; this.camera.minZ = 0.12; this.camera.maxZ = 180;
    this.camera.inertia = 0; this.camera.inputs.clear();
    this.canvas?.addEventListener('pointerdown', this.onPointerDown);
    this.canvas?.addEventListener('pointermove', this.onPointerMove);
    this.canvas?.addEventListener('pointerup', this.onPointerUp);
    this.canvas?.addEventListener('pointercancel', this.onPointerUp);
    this.canvas?.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas?.addEventListener('contextmenu', this.onContextMenu);
  }

  getPlanarBasis(): { forward: Vector3; right: Vector3 } { return { forward: this.forward, right: this.right }; }
  dispose(): void {
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas?.removeEventListener('pointermove', this.onPointerMove);
    this.canvas?.removeEventListener('pointerup', this.onPointerUp);
    this.canvas?.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas?.removeEventListener('wheel', this.onWheel);
    this.canvas?.removeEventListener('contextmenu', this.onContextMenu);
    this.touches.clear();
    this.camera.dispose();
  }
  private shakeAmount = 0;
  private shakeTime = 0;
  private fovKick = 0;
  private baseFov: number | undefined;
  private beatTarget: Vector3 | null = null;
  private beatRemaining = 0;
  /** Trauma-style shake (0..1). Summed, decays quickly. Presentation only. */
  addShake(amount: number): void { this.shakeAmount = Math.min(1, this.shakeAmount + amount); }
  /** Brief FOV punch for boosts/slingshots (radians). */
  kickFov(amount: number): void { this.fovKick = Math.max(this.fovKick, amount); }
  /** Blend the look target toward a point for a duration. Presentation only. */
  beat(point: Vector3, seconds: number): void {
    this.beatTarget = point.clone();
    this.beatRemaining = seconds;
  }
  snap(subjects: readonly CameraSubject[]): void { this.placed = false; this.update(0, subjects); }

  update(dt: number, subjects: readonly CameraSubject[], context: CameraContext = QUIET): void {
    if (!subjects.length) return;
    this.focus.setAll(0);
    const positions = subjects.map(subject => { const v = new Vector3(); subject.getFocusPosition(v); this.focus.addInPlace(v); return v; });
    this.focus.scaleInPlace(1 / subjects.length);
    const safeDt = Math.min(dt, 0.05);
    if (this.placed && safeDt > 0) {
      this.sample.copyFrom(this.focus).subtractInPlace(this.previousFocus).scaleInPlace(1 / safeDt);
      if (this.sample.length() > 24) this.sample.setAll(0);
      Vector3.LerpToRef(this.motion, this.sample, 1 - Math.exp(-2.4 * safeDt), this.motion);
    } else this.motion.setAll(0);
    this.previousFocus.copyFrom(this.focus);
    if (!this.looking && this.releaseTimer > 0) this.releaseTimer = Math.max(0, this.releaseTimer - safeDt);
    if (!this.looking && this.releaseTimer === 0) {
      this.lookYaw = smooth(this.lookYaw, 0, 0.65, safeDt);
      this.lookPitch = smooth(this.lookPitch, 0, 0.65, safeDt);
    }
    const inLab = this.focus.z > 3 && this.focus.x > -11;
    const revealTarget = inLab && context.vaultOpen && !context.alarm ? clamp((this.focus.z - 3) / 5, 0, 1) : 0;
    this.reveal = smooth(this.reveal, revealTarget, 1.3, safeDt);
    const extracting = this.focus.x < -10 && this.focus.z < -55;
    const vent = this.focus.z > -47 && this.focus.z < -39;
    const targetPitch = extracting ? 0.66 : vent ? 0.39 : inLab ? 0.46 : 0.53;
    this.pitch = this.placed ? smooth(this.pitch, targetPitch, 1.6, safeDt) : targetPitch;
    const angle = Math.atan2(this.forward.x, this.forward.z) + this.lookYaw;
    const pitch = this.pitch + this.lookPitch;
    const view = new Vector3(Math.sin(angle) * Math.cos(pitch), -Math.sin(pitch), Math.cos(angle) * Math.cos(pitch));
    const viewRight = new Vector3(view.z, 0, -view.x).normalize();
    const up = Vector3.Cross(view, viewRight).normalize();
    const ahead = this.motion.scale(context.alarm ? 0.20 : 0.12);
    ahead.x = clamp(ahead.x, -1.4, 1.4); ahead.y = clamp(ahead.y, -0.65, 0.65); ahead.z = clamp(ahead.z, -1.4, 1.4);
    const targetLook = this.focus.add(ahead);
    targetLook.y += 0.45 + this.reveal * 0.5;
    targetLook.z += this.reveal * 1.25;
    const aspect = Math.max(0.4, this.scene.getEngine().getAspectRatio(this.camera));
    const fovTarget = context.alarm && !context.complete ? 0.94 : 0.86;
    this.baseFov = smooth(this.baseFov ?? this.camera.fov, fovTarget, 1.6, safeDt);
    this.camera.fov = this.baseFov;
    const tanY = Math.tan(this.camera.fov / 2) * 0.72;
    const tanX = tanY * aspect;
    let required = extracting ? 15.5 : vent ? 12 : inLab ? 15 + this.reveal * 2 : 13;
    for (const point of positions) {
      const delta = point.subtract(targetLook);
      const depth = Vector3.Dot(delta, view);
      required = Math.max(required,
        (Math.abs(Vector3.Dot(delta, viewRight)) + 1.6) / tanX - depth,
        (Math.abs(Vector3.Dot(delta, up)) + 1.4) / tanY - depth);
    }
    if (this.beatTarget && this.beatRemaining > 0 && safeDt > 0) {
      this.beatRemaining = Math.max(0, this.beatRemaining - safeDt);
      const easeOut = this.beatRemaining < 0.6 ? this.beatRemaining / 0.6 : 1;
      const weight = 0.55 * easeOut;
      Vector3.LerpToRef(targetLook, this.beatTarget, weight, targetLook);
      required += 3 * easeOut;
      if (this.beatRemaining <= 0) this.beatTarget = null;
    }
    this.distance = this.placed ? smooth(this.distance, required, required > this.distance ? 5 : 1.5, safeDt) : required;
    const targetPosition = targetLook.subtract(view.scale(this.distance * this.zoom));
    if (!this.placed) {
      this.look.copyFrom(targetLook); this.position.copyFrom(targetPosition); this.placed = true;
    } else {
      const response = context.alarm ? 5.2 : 4;
      Vector3.LerpToRef(this.look, targetLook, 1 - Math.exp(-response * safeDt), this.look);
      Vector3.LerpToRef(this.position, targetPosition, 1 - Math.exp(-response * safeDt), this.position);
    }
    this.camera.position.copyFrom(this.position);
    if (this.shakeAmount > 0.001 && safeDt > 0) {
      this.shakeTime += safeDt;
      const trauma = this.shakeAmount * this.shakeAmount * 0.32;
      const t = this.shakeTime * 38;
      this.camera.position.addInPlaceFromFloats(
        (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * trauma,
        (Math.cos(t * 1.7) + Math.sin(t * 2.9) * 0.4) * trauma,
        Math.sin(t * 1.3 + 1.7) * trauma * 0.6);
      this.shakeAmount = Math.max(0, this.shakeAmount - safeDt * 2.2);
    }
    if (safeDt > 0) {
      this.camera.fov += this.fovKick;
      this.fovKick = Math.max(0, this.fovKick - safeDt * 0.35);
    }
    this.camera.setTarget(this.look);
    this.updateOcclusion(positions, safeDt);
  }

  private updateOcclusion(subjects: Vector3[], dt: number): void {
    this.occluders ??= this.scene.meshes.filter(mesh => mesh.metadata?.cameraOccluder);
    const inspection = this.scene.activeCamera !== this.camera;
    for (const mesh of this.occluders) {
      let obscures = false;
      if (!inspection) {
        for (const point of subjects) {
          const delta = point.subtract(this.camera.position);
          const length = delta.length();
          const ray = new Ray(this.camera.position, delta.normalize(), Math.max(0, length - 0.5));
          if (ray.intersectsMesh(mesh, false).hit) { obscures = true; break; }
        }
      }
      mesh.visibility = smooth(mesh.visibility, obscures ? 0.10 : 1, obscures ? 12 : 5, dt);
    }
  }
}
