import { FreeCamera, Vector3, type Scene } from '@babylonjs/core';
import type { CameraSubject } from './CameraSubject.ts';

const BASE_OFFSET = { x: -4.6, y: 6.6, z: -11 };
const LOOK_AHEAD = { x: 0.35, y: 0.25, z: 3.4 };
const POSITION_RESPONSE = 3.6;
const LOOK_RESPONSE = 7.2;
const PAIR_SPAN = 18;
const MAX_PULLBACK = 1.9;

function damp(current: number, target: number, response: number, dt: number): number {
  const weight = 1 - Math.exp(-response * dt);
  return current + (target - current) * weight;
}

/**
 * Fixed-angle follow camera. It has no pointer or keyboard input.
 * One subject stays in a 3/4 view. Two or more subjects pull the camera back
 * around their midpoint so both can share the frame later.
 */
export class CinematicCamera {
  readonly camera: FreeCamera;

  private readonly focus = new Vector3();
  private readonly subjectPosition = new Vector3();
  private readonly desiredPosition = new Vector3();
  private readonly desiredLook = new Vector3();
  private readonly smoothedPosition = new Vector3();
  private readonly smoothedLook = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly right = new Vector3(1, 0, 0);
  private placed = false;

  constructor(scene: Scene) {
    this.camera = new FreeCamera('cinematic-camera', new Vector3(0, 8, -24), scene);
    this.camera.fov = 0.86;
    this.camera.minZ = 0.15;
    this.camera.maxZ = 500;
    this.camera.inertia = 0;
    this.camera.inputs.clear();
  }

  getPlanarBasis(): { forward: Vector3; right: Vector3 } {
    return { forward: this.forward, right: this.right };
  }

  snap(subjects: readonly CameraSubject[]): void {
    this.placed = false;
    this.update(0, subjects);
  }

  update(dt: number, subjects: readonly CameraSubject[]): void {
    if (subjects.length === 0) {
      return;
    }

    this.focus.set(0, 0, 0);
    for (const subject of subjects) {
      subject.getFocusPosition(this.subjectPosition);
      this.focus.addInPlace(this.subjectPosition);
    }
    this.focus.scaleInPlace(1 / subjects.length);

    let span = 0;
    if (subjects.length > 1) {
      for (const subject of subjects) {
        subject.getFocusPosition(this.subjectPosition);
        const dx = this.subjectPosition.x - this.focus.x;
        const dz = this.subjectPosition.z - this.focus.z;
        span = Math.max(span, Math.hypot(dx, dz));
      }
    }

    const pull =
      subjects.length > 1 ? 1 + Math.min(span / PAIR_SPAN, 1) * (MAX_PULLBACK - 1) : 1;
    const ahead = subjects.length > 1 ? 0.2 : 1;

    this.desiredLook.set(
      this.focus.x + LOOK_AHEAD.x * ahead,
      this.focus.y + LOOK_AHEAD.y,
      this.focus.z + LOOK_AHEAD.z * ahead,
    );
    this.desiredPosition.set(
      this.focus.x + BASE_OFFSET.x * pull,
      this.focus.y + BASE_OFFSET.y * pull,
      this.focus.z + BASE_OFFSET.z * pull,
    );

    if (!this.placed) {
      this.smoothedPosition.copyFrom(this.desiredPosition);
      this.smoothedLook.copyFrom(this.desiredLook);
      this.placed = true;
    } else {
      this.smoothedPosition.set(
        damp(this.smoothedPosition.x, this.desiredPosition.x, POSITION_RESPONSE, dt),
        damp(this.smoothedPosition.y, this.desiredPosition.y, POSITION_RESPONSE, dt),
        damp(this.smoothedPosition.z, this.desiredPosition.z, POSITION_RESPONSE, dt),
      );
      this.smoothedLook.set(
        damp(this.smoothedLook.x, this.desiredLook.x, LOOK_RESPONSE, dt),
        damp(this.smoothedLook.y, this.desiredLook.y, LOOK_RESPONSE, dt),
        damp(this.smoothedLook.z, this.desiredLook.z, LOOK_RESPONSE, dt),
      );
    }

    this.camera.position.copyFrom(this.smoothedPosition);
    this.camera.setTarget(this.smoothedLook);
    this.updateBasis();
  }

  private updateBasis(): void {
    this.forward.set(
      this.smoothedLook.x - this.smoothedPosition.x,
      0,
      this.smoothedLook.z - this.smoothedPosition.z,
    );
    if (this.forward.lengthSquared() < 1e-6) {
      this.forward.set(0, 0, 1);
    } else {
      this.forward.normalize();
    }
    this.right.set(this.forward.z, 0, -this.forward.x);
  }
}
