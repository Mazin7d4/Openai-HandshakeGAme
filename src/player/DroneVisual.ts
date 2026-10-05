import {
  Color3,
  CreateBox,
  CreateCylinder,
  CreateSphere,
  CreateTorus,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { FLIGHT_TUNING } from './FlightTuning.ts';

export interface DronePalette {
  /** Main shell colour. */
  body: Color3;
  /** Thruster rings, antenna tip. */
  glow: Color3;
}

export interface DroneVisualState {
  velocity: Vector3;
  boosting: boolean;
  dt: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function blend(current: number, target: number, response: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-response * dt));
}

function shell(scene: Scene, name: string, color: Color3, gloss = 48): StandardMaterial {
  const material = new StandardMaterial(`${name}-mat`, scene);
  material.diffuseColor = color.clone();
  material.specularColor = new Color3(0.35, 0.35, 0.35);
  material.specularPower = gloss;
  return material;
}

function emissive(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(`${name}-mat`, scene);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = color.clone();
  material.disableLighting = true;
  return material;
}

/**
 * Procedural mascot drone built from primitives. Everything hangs off `root`,
 * so a real GLB can later replace this class without touching Drone or the controller.
 * Handles the idle hover bob, squash/stretch, eye blinks and thruster glow.
 */
export class DroneVisual {
  readonly root: TransformNode;

  private readonly bob: TransformNode;
  private readonly squash: TransformNode;
  private readonly eyes: Mesh[] = [];
  private readonly rings: StandardMaterial[] = [];
  private readonly antennaTip: StandardMaterial;
  private readonly glow: Color3;
  private time = Math.random() * 10;
  private blinkTimer = 2 + Math.random() * 3;
  private blinkPhase = 0;
  private stretch = 1;
  private thrust = 0;

  constructor(scene: Scene, parent: TransformNode, palette: DronePalette) {
    this.glow = palette.glow.clone();
    this.root = new TransformNode(`${parent.name}-visual`, scene);
    this.root.parent = parent;
    this.bob = new TransformNode(`${parent.name}-bob`, scene);
    this.bob.parent = this.root;
    this.squash = new TransformNode(`${parent.name}-squash`, scene);
    this.squash.parent = this.bob;

    const n = parent.name;
    const dark = new Color3(0.13, 0.14, 0.18);
    const bodyMat = shell(scene, `${n}-body`, palette.body, 64);
    const darkMat = shell(scene, `${n}-dark`, dark, 24);
    const visorMat = shell(scene, `${n}-visor`, new Color3(0.06, 0.07, 0.1), 128);
    const eyeMat = emissive(scene, `${n}-eye`, new Color3(0.72, 0.96, 1));
    this.antennaTip = emissive(scene, `${n}-tip`, palette.glow);

    const body = CreateSphere(`${n}-shell`, { diameter: 0.9, segments: 24 }, scene);
    body.scaling.set(1, 0.8, 0.98);
    body.material = bodyMat;
    body.parent = this.squash;

    const belly = CreateSphere(`${n}-belly`, { diameter: 0.7, segments: 16 }, scene);
    belly.scaling.set(1, 0.5, 0.9);
    belly.position.y = -0.2;
    belly.material = darkMat;
    belly.parent = this.squash;

    const visor = CreateSphere(`${n}-face`, { diameter: 0.72, segments: 20 }, scene);
    visor.scaling.set(1, 0.6, 0.5);
    visor.position.set(0, 0.03, 0.3);
    visor.material = visorMat;
    visor.parent = this.squash;

    for (const side of [-1, 1]) {
      const eye = CreateSphere(`${n}-eye-${side}`, { diameter: 0.15, segments: 12 }, scene);
      eye.scaling.set(1, 1.35, 0.35);
      eye.position.set(side * 0.14, 0.08, 0.6);
      eye.material = eyeMat;
      eye.parent = this.squash;
      this.eyes.push(eye);
    }

    const antenna = CreateCylinder(`${n}-antenna`, { height: 0.3, diameter: 0.035, tessellation: 8 }, scene);
    antenna.position.set(0, 0.48, -0.1);
    antenna.rotation.x = -0.25;
    antenna.material = darkMat;
    antenna.parent = this.squash;

    const tip = CreateSphere(`${n}-antenna-tip`, { diameter: 0.1, segments: 10 }, scene);
    tip.position.set(0, 0.63, -0.14);
    tip.material = this.antennaTip;
    tip.parent = this.squash;

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const arm = CreateBox(`${n}-arm`, { width: 0.34, height: 0.06, depth: 0.1 }, scene);
        arm.position.set(sx * 0.42, -0.06, sz * 0.3);
        arm.rotation.y = -sx * sz * 0.5;
        arm.material = darkMat;
        arm.parent = this.squash;

        const pod = CreateCylinder(`${n}-pod`, { height: 0.12, diameter: 0.3, tessellation: 20 }, scene);
        pod.position.set(sx * 0.58, -0.08, sz * 0.4);
        pod.material = darkMat;
        pod.parent = this.squash;

        const ringMat = emissive(scene, `${n}-ring`, palette.glow);
        const ring = CreateTorus(`${n}-ring`, { diameter: 0.24, thickness: 0.045, tessellation: 20 }, scene);
        ring.position.set(sx * 0.58, -0.14, sz * 0.4);
        ring.material = ringMat;
        ring.parent = this.squash;
        this.rings.push(ringMat);
      }
    }

    for (const mesh of this.root.getChildMeshes()) {
      mesh.isPickable = false;
    }
  }

  update(state: DroneVisualState): void {
    const dt = state.dt;
    this.time += dt;

    const speed = state.velocity.length();
    const planar = Math.hypot(state.velocity.x, state.velocity.z);
    const moveBlend = clamp(speed / FLIGHT_TUNING.cruiseSpeed, 0, 1);

    const bobAmount = 0.045 * (1 - moveBlend * 0.7);
    this.bob.position.y = Math.sin(this.time * 2.3) * bobAmount;
    this.bob.rotation.z = Math.sin(this.time * 1.7) * 0.02 * (1 - moveBlend);

    const lift = clamp(state.velocity.y / FLIGHT_TUNING.verticalSpeed, -1, 1);
    const targetStretch = 1 + lift * 0.14 + (state.boosting ? 0.05 : 0);
    this.stretch = blend(this.stretch, targetStretch, 10, dt);
    const dash = 1 + clamp(planar / (FLIGHT_TUNING.cruiseSpeed * FLIGHT_TUNING.boostMultiplier), 0, 1) * 0.08;
    const side = 1 / Math.sqrt(this.stretch * dash);
    this.squash.scaling.set(side, this.stretch, dash);

    const thrustTarget = 0.45 + moveBlend * 0.45 + (state.boosting ? 0.6 : 0);
    this.thrust = blend(this.thrust, thrustTarget, 8, dt);
    const flicker = 1 + Math.sin(this.time * 31) * 0.05;
    const glow = this.thrust * flicker;
    for (const ring of this.rings) {
      ring.emissiveColor.set(this.glow.r * glow, this.glow.g * glow, this.glow.b * glow);
    }
    const pulse = 0.65 + Math.sin(this.time * 3.1) * 0.35;
    this.antennaTip.emissiveColor.set(this.glow.r * pulse, this.glow.g * pulse, this.glow.b * pulse);

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkPhase = 0.18;
      this.blinkTimer = 2.4 + Math.random() * 3.2;
    }
    let eyeOpen = 1;
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
      const t = this.blinkPhase / 0.18;
      eyeOpen = Math.max(0.08, Math.abs(t * 2 - 1));
    }
    const squint = state.boosting ? 0.7 : 1;
    for (const eye of this.eyes) {
      eye.scaling.y = 1.35 * eyeOpen * squint;
    }
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}
