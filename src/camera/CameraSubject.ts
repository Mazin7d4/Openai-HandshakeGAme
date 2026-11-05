import type { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/** Anything the cinematic camera is allowed to frame. */
export interface CameraSubject {
  readonly id: string;
  getFocusPosition(target: Vector3): Vector3;
}
