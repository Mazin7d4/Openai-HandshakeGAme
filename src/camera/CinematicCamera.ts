import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import {
  getCameraTouchSettings,
  subscribeCameraTouchSettings,
} from '../ui/CameraTouchSettings.ts';
import { effectiveReducedMotion, getSettings, subscribeSettings } from '../ui/Settings.ts';
import type { CameraSubject } from './CameraSubject.ts';

export interface CameraContext { alarm: boolean; vaultOpen: boolean; complete: boolean }
const QUIET: CameraContext = { alarm: false, vaultOpen: false, complete: false };
const smooth = (a: number, b: number, speed: number, dt: number) => a + (b - a) * (1 - Math.exp(-speed * dt));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const FRAME_LIFT = 1.7;
const TOUCH_RELEASE_S = 2;
const ZOOM_MIN = 0.85;
const ZOOM_MAX = 1.16;

/** Authored dolly with a fixed compass heading. Mouse right-drag + touch look pad. */
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
  private occluderMeshCount = -1;
  private readonly occlusionDelta = new Vector3();
  private readonly occlusionDirection = new Vector3();
  private readonly occlusionRay = new Ray(Vector3.Zero(), Vector3.Forward(), 0);
  private readonly occlusionAxes = ['x', 'y', 'z'] as const;
  private readonly canvas: HTMLCanvasElement | null;
  private looking = false;
  private lookYaw = 0;
  private lookPitch = 0;
  private zoom = 1;
  private releaseTimer = 0;
  private lookSensitivity = 1;
  private touchSensitivity = 1;
  private touchTargetYaw = 0;
  private touchTargetPitch = 0;
  private touchZoomTarget = 1;
  /** Touch invert (CameraTouchSettings). */
  private touchInvertY = false;
  /** Mouse invert (GameSettings.invertY). */
  private mouseInvertY = false;
  private screenShake = true;
  private reducedMotion = false;
  private showcaseMode = false;
  private fovScale = 1;
  private distanceScale = 1;
  private readonly unsubscribeSettings: (() => void) | null = null;
  private readonly unsubscribeTouch: (() => void) | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.scene.activeCamera !== this.camera) return;
    if (event.pointerType === 'touch') {
      // Single-finger look is owned by TouchControls; canvas keeps two-finger pinch/look.
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size < 2) return;
    } else if (event.button !== 2) return;
    this.looking = true; this.releaseTimer = TOUCH_RELEASE_S;
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
      this.zoom = clamp(this.zoom + (oldDistance - newDistance) * 0.003, ZOOM_MIN, ZOOM_MAX);
      this.touchZoomTarget = this.zoom;
    }
    this.applyLookDelta(dx, dy, this.lookSensitivity, this.mouseInvertY);
  };
  private readonly onPointerUp = (event: PointerEvent) => {
    this.touches.delete(event.pointerId);
    if (event.pointerType !== 'touch' || this.touches.size < 2) this.looking = false;
  };
  private readonly onWheel = (event: WheelEvent) => {
    if (this.scene.activeCamera !== this.camera) return;
    this.zoom = clamp(this.zoom + Math.sign(event.deltaY) * 0.05, ZOOM_MIN, ZOOM_MAX);
    this.touchZoomTarget = this.zoom;
    event.preventDefault();
  };
  private readonly onContextMenu = (event: MouseEvent) => event.preventDefault();

  constructor(scene: Scene) {
    this.scene = scene;
    this.canvas = scene.getEngine().getRenderingCanvas();
    this.camera = new FreeCamera('cinematic-camera', new Vector3(0, 8, -24), scene);
    this.camera.fov = 0.86; this.camera.minZ = 0.12; this.camera.maxZ = 180;
    this.camera.inertia = 0; this.camera.inputs.clear();
    const initialSettings = getSettings();
    this.lookSensitivity = initialSettings.lookSensitivity;
    this.reducedMotion = effectiveReducedMotion(initialSettings);
    this.screenShake = initialSettings.screenShake && !this.reducedMotion;
    this.mouseInvertY = initialSettings.invertY;
    this.fovScale = initialSettings.fovScale;
    this.distanceScale = initialSettings.cameraDistance;
    const touch = getCameraTouchSettings();
    this.touchSensitivity = touch.camSensitivity;
    this.touchInvertY = touch.invertY;
    this.unsubscribeSettings = subscribeSettings((settings) => {
      this.lookSensitivity = settings.lookSensitivity;
      this.reducedMotion = effectiveReducedMotion(settings);
      this.screenShake = settings.screenShake && !this.reducedMotion;
      this.mouseInvertY = settings.invertY;
      this.fovScale = settings.fovScale;
      this.distanceScale = settings.cameraDistance;
      if (!this.screenShake) {
        this.shakeAmount = 0;
      }
    });
    this.unsubscribeTouch = subscribeCameraTouchSettings((settings) => {
      this.touchSensitivity = settings.camSensitivity;
      this.touchInvertY = settings.invertY;
    });
    this.canvas?.addEventListener('pointerdown', this.onPointerDown);
    this.canvas?.addEventListener('pointermove', this.onPointerMove);
    this.canvas?.addEventListener('pointerup', this.onPointerUp);
    this.canvas?.addEventListener('pointercancel', this.onPointerUp);
    this.canvas?.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas?.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Current touch/mouse yaw offset (radians). Used by QA as "camera alpha". */
  get touchLookYaw(): number {
    return this.lookYaw;
  }

  get touchLookZoom(): number { return this.zoom; }

  getPlanarBasis(): { forward: Vector3; right: Vector3 } { return { forward: this.forward, right: this.right }; }

  /** One-finger look from the on-screen look pad (separate pointerId from the stick). */
  touchLook(dx: number, dy: number): void {
    this.looking = true;
    this.releaseTimer = TOUCH_RELEASE_S;
    this.applyLookDelta(dx, dy, this.touchSensitivity, this.touchInvertY, true);
  }

  /** Pinch zoom from the look pad; clamped to the authored dolly range. */
  touchZoom(deltaDistance: number): void {
    this.looking = true;
    this.releaseTimer = TOUCH_RELEASE_S;
    this.touchZoomTarget = clamp(this.touchZoomTarget + deltaDistance * 0.003, ZOOM_MIN, ZOOM_MAX);
  }

  /** Standard gamepad right-stick look at approximately 2.6 radians per second. */
  gamepadLook(x: number, y: number, dt: number): void {
    this.releaseTimer = TOUCH_RELEASE_S;
    this.applyLookDelta(x * dt * 2.6 / 0.008055, y * dt * 1.6 / 0.005, 1, this.mouseInvertY, true);
  }

  /** Double-tap: snap the look back behind the active drone. */
  touchRecenter(): void {
    this.looking = false;
    this.releaseTimer = 0;
    if (this.reducedMotion) {
      this.lookYaw = 0;
      this.lookPitch = 0;
      this.touchTargetYaw = 0;
      this.touchTargetPitch = 0;
    } else {
      // Mark for a fast ease on the next frames by clearing the hold timer.
      this.lookYaw *= 0.15;
      this.lookPitch *= 0.15;
      this.touchTargetYaw = this.lookYaw;
      this.touchTargetPitch = this.lookPitch;
      if (Math.abs(this.lookYaw) < 0.002) this.lookYaw = 0;
      if (Math.abs(this.lookPitch) < 0.002) this.lookPitch = 0;
    }
  }

  /** Keep the auto-recenter timer fresh while a look finger is down. */
  touchLookHold(): void {
    this.looking = true;
    this.releaseTimer = TOUCH_RELEASE_S;
  }

  touchLookRelease(): void {
    this.looking = false;
  }

  dispose(): void {
    this.unsubscribeSettings?.();
    this.unsubscribeTouch?.();
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
  addShake(amount: number): void {
    if (!this.screenShake || this.reducedMotion) return;
    this.shakeAmount = Math.min(1, this.shakeAmount + amount);
  }
  /** Brief FOV punch for boosts/slingshots (radians). */
  kickFov(amount: number): void {
    if (this.reducedMotion) return;
    this.fovKick = Math.max(this.fovKick, amount);
  }
  /** Blend the look target toward a point for a duration. Presentation only. */
  beat(point: Vector3, seconds: number): void {
    this.beatTarget = point.clone();
    this.beatRemaining = seconds;
  }
  snap(subjects: readonly CameraSubject[]): void { this.placed = false; this.update(0, subjects); }

  /** Test/photo hook only (installed via the dev autopilot): pins the camera to a fixed pose. */
  debugPose: { eye: Vector3; target: Vector3 } | null = null;

  setShowcaseMode(enabled: boolean): void { this.showcaseMode = enabled; }

  update(dt: number, subjects: readonly CameraSubject[], context: CameraContext = QUIET): void {
    if (this.debugPose) {
      this.camera.position.copyFrom(this.debugPose.eye);
      this.camera.setTarget(this.debugPose.target);
      this.updateOcclusion([], Math.min(dt, 0.05));
      return;
    }
    if (!subjects.length) return;
    this.focus.setAll(0);
    const positions = subjects.map(subject => { const v = new Vector3(); subject.getFocusPosition(v); this.focus.addInPlace(v); return v; });
    this.focus.scaleInPlace(1 / subjects.length);
    const safeDt = Math.min(dt, 0.05);
    if (safeDt > 0) {
      this.lookYaw = smooth(this.lookYaw, this.touchTargetYaw, 1 / 0.06, safeDt);
      this.lookPitch = smooth(this.lookPitch, this.touchTargetPitch, 1 / 0.06, safeDt);
      this.zoom = smooth(this.zoom, this.touchZoomTarget, 1 / 0.06, safeDt);
    }
    if (this.placed && safeDt > 0) {
      this.sample.copyFrom(this.focus).subtractInPlace(this.previousFocus).scaleInPlace(1 / safeDt);
      if (this.sample.length() > 24) this.sample.setAll(0);
      Vector3.LerpToRef(this.motion, this.sample, 1 - Math.exp(-2.4 * safeDt), this.motion);
    } else this.motion.setAll(0);
    this.previousFocus.copyFrom(this.focus);
    if (!this.looking && this.releaseTimer > 0) this.releaseTimer = Math.max(0, this.releaseTimer - safeDt);
    if (!this.looking && this.releaseTimer === 0) {
      if (this.reducedMotion) {
        this.lookYaw = 0;
        this.lookPitch = 0;
      } else {
        this.lookYaw = smooth(this.lookYaw, 0, 0.65, safeDt);
        this.lookPitch = smooth(this.lookPitch, 0, 0.65, safeDt);
      }
      this.touchTargetYaw = this.lookYaw;
      this.touchTargetPitch = this.lookPitch;
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
    // Look a little above the crew so they sit in the lower-middle third (clear of the objective card).
    targetLook.y += FRAME_LIFT + this.reveal * 0.5;
    targetLook.z += this.reveal * 1.25;
    const aspect = Math.max(0.4, this.scene.getEngine().getAspectRatio(this.camera));
    const fovTarget = (context.alarm && !context.complete ? 0.94 : 0.86) * this.fovScale;
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
    const scaledRequired = required * this.distanceScale;
    this.distance = this.placed ? smooth(this.distance, scaledRequired, scaledRequired > this.distance ? 5 : 1.5, safeDt) : scaledRequired;
    const targetPosition = targetLook.subtract(view.scale(this.distance * this.zoom));
    if (!this.placed) {
      this.look.copyFrom(targetLook); this.position.copyFrom(targetPosition); this.placed = true;
    } else {
      const response = context.alarm ? 5.2 : 4;
      Vector3.LerpToRef(this.look, targetLook, 1 - Math.exp(-response * safeDt), this.look);
      Vector3.LerpToRef(this.position, targetPosition, 1 - Math.exp(-response * safeDt), this.position);
    }
    this.camera.position.copyFrom(this.position);
    if (this.screenShake && this.shakeAmount > 0.001 && safeDt > 0) {
      this.shakeTime += safeDt;
      const trauma = this.shakeAmount * this.shakeAmount * 0.32;
      const t = this.shakeTime * 38;
      this.camera.position.addInPlaceFromFloats(
        (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * trauma,
        (Math.cos(t * 1.7) + Math.sin(t * 2.9) * 0.4) * trauma,
        Math.sin(t * 1.3 + 1.7) * trauma * 0.6);
      this.shakeAmount = Math.max(0, this.shakeAmount - safeDt * 2.2);
    } else if (!this.screenShake) {
      this.shakeAmount = 0;
    }
    if (safeDt > 0) {
      this.camera.fov += this.fovKick;
      this.fovKick = Math.max(0, this.fovKick - safeDt * 0.35);
    }
    this.camera.setTarget(this.look);
    this.updateOcclusion(positions, safeDt);
  }

  private applyLookDelta(dx: number, dy: number, sensitivity: number, invertY: boolean, touch = false): void {
    const pitchSign = invertY ? 1 : -1;
    const yawScale = (touch ? 0.008055 : 0.0015) * sensitivity;
    const pitchScale = (touch ? 0.005 : 0.0012) * sensitivity;
    if (touch) {
      this.touchTargetYaw = clamp(this.touchTargetYaw + dx * yawScale, -Math.PI, Math.PI);
      this.touchTargetPitch = clamp(this.touchTargetPitch + pitchSign * dy * pitchScale, -0.8, 0.8);
    } else {
      this.lookYaw = clamp(this.lookYaw + dx * yawScale, -0.16, 0.16);
      this.lookPitch = clamp(this.lookPitch + pitchSign * dy * pitchScale, -0.085, 0.085);
      this.touchTargetYaw = this.lookYaw;
      this.touchTargetPitch = this.lookPitch;
    }
  }

  private updateOcclusion(subjects: Vector3[], dt: number): void {
    // Room dressing is built asynchronously after the first camera frame. Refresh when
    // the scene mesh set changes so newly merged racks/props participate in occlusion.
    if (this.occluderMeshCount !== this.scene.meshes.length) {
      this.occluders = this.scene.meshes.filter(mesh => mesh.metadata?.cameraOccluder);
      this.occluderMeshCount = this.scene.meshes.length;
    }
    const inspection = this.scene.activeCamera !== this.camera;
    for (const mesh of this.occluders ?? []) {
      if (this.showcaseMode) {
        mesh.visibility = smooth(mesh.visibility, 0.04, 9, dt);
        continue;
      }
      let obscures = false;
      if (!inspection) {
        for (const point of subjects) {
          this.occlusionDelta.copyFrom(point).subtractInPlace(this.camera.position);
          const length = this.occlusionDelta.length();
          if (length <= 0.5) continue;
          this.occlusionDirection.copyFrom(this.occlusionDelta).scaleInPlace(1 / length);
          this.occlusionRay.origin.copyFrom(this.camera.position);
          this.occlusionRay.direction.copyFrom(this.occlusionDirection);
          this.occlusionRay.length = length - 0.5;
          // Bounding-box testing is stable for imported instances and cheaper than triangle
          // picking; room props are static and already have frozen world bounds.
          if (this.segmentIntersectsBounds(mesh, this.occlusionRay.length)) { obscures = true; break; }
        }
      }
      mesh.visibility = smooth(mesh.visibility, obscures ? 0.10 : 1, obscures ? 12 : 5, dt);
    }
  }

  private segmentIntersectsBounds(mesh: AbstractMesh, length: number): boolean {
    const box = mesh.getBoundingInfo().boundingBox;
    const min = box.minimumWorld;
    const max = box.maximumWorld;
    let near = 0;
    let far = length;
    const origin = this.occlusionRay.origin;
    const direction = this.occlusionRay.direction;
    for (const axis of this.occlusionAxes) {
      const component = direction[axis];
      if (Math.abs(component) < 1e-5) {
        if (origin[axis] < min[axis] || origin[axis] > max[axis]) return false;
        continue;
      }
      let a = (min[axis] - origin[axis]) / component;
      let b = (max[axis] - origin[axis]) / component;
      if (a > b) { const swap = a; a = b; b = swap; }
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near > far) return false;
    }
    return far >= 0 && near <= length;
  }
}
