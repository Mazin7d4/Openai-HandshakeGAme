import {
  Color3,
  CreateBox,
  StandardMaterial,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import type { DroneRole } from '../network/NetworkTypes.ts';
import { addStaticBody } from '../physics/staticBody.ts';
import { applySolidColor } from '../scene/solidMaterial.ts';
import type { Interactable } from './Interactable.ts';

export type HackStationId = 'terminal-a' | 'terminal-b' | 'terminal-c';
export type HackMinigameType = 'packet-routing' | 'signal-match' | 'memory-trace';

export interface HackStationSpec {
  id: HackStationId;
  label: string;
  position: Vector3;
  interactionRadius: number;
  minigameType: HackMinigameType;
  allowedRole: DroneRole | 'either';
  accent: Color3;
}

/** Physical endpoint that advertises a minigame and a connected security target. */
export class HackStation implements Interactable {
  readonly id: HackStationId;
  readonly label: string;
  readonly position: Vector3;
  readonly interactionRadius: number;
  readonly minigameType: HackMinigameType;
  readonly allowedRole: DroneRole | 'either';
  readonly mesh: Mesh;

  private readonly indicator: Mesh;
  private readonly material: StandardMaterial;
  private readonly aggregate;
  private time = 0;

  constructor(scene: Scene, spec: HackStationSpec) {
    this.id = spec.id;
    this.label = spec.label;
    this.position = spec.position.clone();
    this.interactionRadius = spec.interactionRadius;
    this.minigameType = spec.minigameType;
    this.allowedRole = spec.allowedRole;
    this.mesh = CreateBox(spec.id, { width: 1.15, height: 2.5, depth: 0.75 }, scene);
    this.mesh.position.copyFrom(spec.position);
    applySolidColor(this.mesh, new Color3(0.08, 0.12, 0.16), scene);
    this.aggregate = addStaticBody(this.mesh, scene);
    this.indicator = CreateBox(`${spec.id}-indicator`, { width: 0.72, height: 1.15, depth: 0.08 }, scene);
    this.indicator.position.copyFrom(spec.position);
    this.indicator.position.z -= 0.42;
    this.material = new StandardMaterial(`${spec.id}-indicator-mat`, scene);
    this.material.diffuseColor = spec.accent.clone();
    this.material.emissiveColor = spec.accent.scale(0.15);
    this.indicator.material = this.material;
  }

  distanceTo(point: Vector3): number {
    return Vector3.Distance(this.position, point);
  }

  canInteract(role: DroneRole, point: Vector3, complete: boolean): boolean {
    return !complete && (this.allowedRole === 'either' || role === this.allowedRole) &&
      this.distanceTo(point) <= this.interactionRadius;
  }

  update(dt: number, owner: DroneRole | null, complete: boolean): void {
    this.time += dt;
    const pulse = complete ? 1.25 : owner ? 0.75 + Math.sin(this.time * 8) * 0.25 : 0.16;
    this.material.emissiveColor.copyFrom(this.material.diffuseColor).scaleInPlace(pulse);
    this.indicator.scaling.y = complete ? 1 : 0.93 + Math.sin(this.time * 5) * 0.035;
  }

  dispose(): void {
    this.aggregate.dispose();
    this.material.dispose();
    this.indicator.dispose();
    this.mesh.dispose();
  }
}
