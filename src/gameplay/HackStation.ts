import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { DroneRole } from '../network/NetworkTypes.ts';
import { addStaticBody } from '../physics/staticBody.ts';
import { createRoundedBox } from '../scene/roundedBox.ts';
import { applySolidColor } from '../scene/solidMaterial.ts';
import type { Interactable } from './Interactable.ts';
import { ConsoleDisplay } from './ConsoleDisplay.ts';

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
  private readonly display: ConsoleDisplay;
  private readonly aggregate;
  private time = 0;

  constructor(scene: Scene, spec: HackStationSpec) {
    this.id = spec.id;
    this.label = spec.label;
    this.position = spec.position.clone();
    this.interactionRadius = spec.interactionRadius;
    this.minigameType = spec.minigameType;
    this.allowedRole = spec.allowedRole;

    this.mesh = createRoundedBox(spec.id, { width: 1.15, height: 2.5, depth: 0.75, radius: 0.08 }, scene);
    this.mesh.position.copyFrom(spec.position);
    applySolidColor(this.mesh, new Color3(0.16, 0.18, 0.19), scene);
    this.aggregate = addStaticBody(this.mesh, scene);

    this.display = new ConsoleDisplay(scene, spec.id, spec.allowedRole);
    this.indicator = createRoundedBox(`${spec.id}-indicator`, { width: 1.55, height: 1.55, depth: 0.12, radius: 0.08 }, scene);
    this.placeScreen();
    this.indicator.rotation.x = 0.55;
    this.indicator.material = this.display.material;
  }

  /** Move the console for a seeded RunLayout (mesh + indicator + interact point). */
  relocate(next: Vector3): void {
    this.position.copyFrom(next);
    this.mesh.position.copyFrom(next);
    this.placeScreen();
    this.mesh.computeWorldMatrix(true);
  }

  distanceTo(point: Vector3): number {
    return Vector3.Distance(this.position, point);
  }

  /** Hide unused campaign consoles and remove their collision shapes. */
  setEnabled(enabled: boolean): void {
    this.mesh.setEnabled(enabled);
    this.indicator.setEnabled(enabled);
    this.aggregate.shape.filterCollideMask = enabled ? 0xffffffff : 0;
  }

  canInteract(role: DroneRole, point: Vector3, complete: boolean): boolean {
    return this.mesh.isEnabled() && !complete && (this.allowedRole === 'either' || role === this.allowedRole) &&
      this.distanceTo(point) <= this.interactionRadius;
  }

  update(dt: number, owner: DroneRole | null, complete: boolean, nearby = false): void {
    this.time += dt;
    this.display.update(this.time, nearby, owner !== null, complete);
    this.indicator.scaling.setAll(nearby && !complete ? 1.08 + Math.sin(this.time * 5) * 0.025 : 1);
  }

  private placeScreen(): void {
    this.indicator.position.copyFrom(this.position);
    this.indicator.position.y += 0.32;
    this.indicator.position.z -= 0.51;
  }

  dispose(): void {
    this.aggregate.dispose();
    this.display.dispose();
    this.indicator.dispose();
    this.mesh.dispose();
  }
}
