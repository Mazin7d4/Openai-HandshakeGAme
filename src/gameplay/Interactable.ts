import type { Vector3 } from '@babylonjs/core';

/** Minimal contract shared by proximity-based gameplay objects. */
export interface Interactable {
  readonly id: string;
  readonly position: Vector3;
  distanceTo(point: Vector3): number;
}
