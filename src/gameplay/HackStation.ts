import {
  Color3,
  CreateBox,
  CreateTorus,
  DynamicTexture,
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

const ROLE_RING_COLORS: Record<DroneRole | 'either', string> = {
  pix: '#3DDBFF',
  nee: '#FF6194',
  either: '#F4EFE6',
};

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
  private readonly floorRing: Mesh;
  private readonly ringMaterial: StandardMaterial;
  private readonly ringActiveColor: Color3;
  private readonly ringDimColor: Color3;
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

    this.indicator = CreateBox(`${spec.id}-indicator`, { width: 0.72, height: 1.15, depth: 0.08 }, scene);
    this.indicator.position.copyFrom(spec.position);
    this.indicator.position.z -= 0.42;

    this.material = new StandardMaterial(`${spec.id}-indicator-mat`, scene);
    this.material.diffuseTexture = this.screenTexture;
    this.material.emissiveTexture = this.screenTexture;
    this.material.diffuseColor = Color3.White();
    this.material.emissiveColor = new Color3(0.55, 0.55, 0.55);
    this.indicator.material = this.material;

    const roleHex = ROLE_RING_COLORS[spec.allowedRole] ?? '#F4EFE6';
    const baseRoleColor = Color3.FromHexString(roleHex);
    this.ringActiveColor = baseRoleColor.scale(0.9);
    this.ringDimColor = baseRoleColor.scale(0.35);

    this.ringMaterial = new StandardMaterial(`${spec.id}-floor-ring-mat`, scene);
    this.ringMaterial.disableLighting = true;
    this.ringMaterial.emissiveColor = this.ringActiveColor.clone();

    this.floorRing = CreateTorus(
      `${spec.id}-floor-ring`,
      { diameter: 2.2, thickness: 0.06, tessellation: 40 },
      scene,
    );
    this.floorRing.position.set(spec.position.x, spec.position.y - 1.25 + 0.03, spec.position.z);
    this.floorRing.isPickable = false;
    this.floorRing.material = this.ringMaterial;
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
    this.ringMaterial.emissiveColor.copyFrom(complete ? this.ringDimColor : this.ringActiveColor);
  }

  dispose(): void {
    this.aggregate.dispose();
    this.floorRing.dispose();
    this.ringMaterial.dispose();
    this.screenTexture.dispose();
    this.material.dispose();
    this.indicator.dispose();
    this.mesh.dispose();
  }
}
