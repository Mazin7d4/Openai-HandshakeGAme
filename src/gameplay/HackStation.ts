import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { DroneRole } from '../network/NetworkTypes.ts';
import { addStaticBody } from '../physics/staticBody.ts';
import { createRoundedBox } from '../scene/roundedBox.ts';
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

const PLUG_GRID = [
  '..#...#..',
  '..#...#..',
  '..#...#..',
  '.#######.',
  '#########',
  '#########',
  '#########',
  '#########',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
  '....#....',
  '....#....',
  '....#....',
  '....#....',
  '....#....',
];

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
  private readonly screenTexture: DynamicTexture;
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

    this.screenTexture = new DynamicTexture(
      `${spec.id}-screen-tex`,
      { width: 128, height: 192 },
      scene,
      false,
    );
    const ctx = this.screenTexture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#F4EFE6';
    ctx.fillRect(0, 0, 128, 192);

    ctx.fillStyle = '#1E2528';
    const pitch = 8;
    const dotRadius = 2.8;
    const rows = PLUG_GRID.length;
    const cols = PLUG_GRID[0].length;
    const startX = 64 - ((cols - 1) * pitch) / 2;
    const startY = 96 - ((rows - 1) * pitch) / 2;

    for (let r = 0; r < rows; r++) {
      const rowStr = PLUG_GRID[r];
      const cy = startY + r * pitch;
      for (let c = 0; c < cols; c++) {
        if (rowStr[c] === '#') {
          const cx = startX + c * pitch;
          ctx.beginPath();
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    this.screenTexture.update();

    this.indicator = createRoundedBox(`${spec.id}-indicator`, { width: 0.72, height: 1.15, depth: 0.08, radius: 0.025, segments: 1 }, scene);
    this.indicator.position.copyFrom(spec.position);
    this.indicator.position.z -= 0.42;

    this.material = new StandardMaterial(`${spec.id}-indicator-mat`, scene);
    this.material.diffuseTexture = this.screenTexture;
    this.material.emissiveTexture = this.screenTexture;
    this.material.diffuseColor = Color3.White();
    this.material.emissiveColor = new Color3(0.55, 0.55, 0.55);
    this.indicator.material = this.material;
  }

  /** Move the console for a seeded RunLayout (mesh + indicator + interact point). */
  relocate(next: Vector3): void {
    this.position.copyFrom(next);
    this.mesh.position.copyFrom(next);
    this.indicator.position.copyFrom(next);
    this.indicator.position.z -= 0.42;
    this.mesh.computeWorldMatrix(true);
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
    const k = complete ? 1.0 : owner ? 0.875 + Math.sin(this.time * 8) * 0.125 : 0.55;
    this.material.emissiveColor.set(k, k, k);
    this.indicator.scaling.y = complete ? 1 : 0.93 + Math.sin(this.time * 5) * 0.035;
  }

  dispose(): void {
    this.aggregate.dispose();
    this.screenTexture.dispose();
    this.material.dispose();
    this.indicator.dispose();
    this.mesh.dispose();
  }
}
