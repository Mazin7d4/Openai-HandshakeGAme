import {
  Color3,
  PBRMaterial,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type Node,
  type Scene,
} from '@babylonjs/core';
import type { LoadedModel } from '../assets/AssetLoader.ts';
import { DroneFace } from './DroneFace.ts';
import { FLIGHT_TUNING } from './FlightTuning.ts';

export const DRONE_MODEL_URL = `${import.meta.env.BASE_URL}assets/drone/drone.glb`;

/** Uniform scale applied to the GLB so it sits inside the existing collider. */
const MODEL_SCALE = 0.9;
/** Lifts the model so the hover pods sit at the collider's underside. */
const MODEL_LIFT = 0.14;

export interface DronePalette {
  /** Side discs, socket collar, top strip. */
  accent: Color3;
  /** Hover pod rings, antenna tip. */
  glow: Color3;
  /** LED eyes on the face screen. */
  eye: Color3;
}

export interface DroneVisualState {
  velocity: Vector3;
  boosting: boolean;
  dt: number;
  focused?: boolean;
  selfPowered?: boolean;
  tetherPull?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function blend(current: number, target: number, response: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-response * dt));
}

function findNode(root: Node, name: string): TransformNode | null {
  for (const node of root.getDescendants(false)) {
    if (node.name === name && node instanceof TransformNode) {
      return node;
    }
  }
  return null;
}

/**
 * Visual-only mascot built from drone.glb. Everything hangs off `root`, which
 * Drone rotates for yaw and banking. Handles hover bob, acceleration lean, pod
 * tilt, antenna wobble, subtle squash/stretch, thruster glow and the LED face.
 *
 * Node layout: root -> bob -> lean -> squash -> glTF root.
 */
export class DroneVisual {
  readonly root: TransformNode;

  private readonly bob: TransformNode;
  private readonly lean: TransformNode;
  private readonly squash: TransformNode;
  private readonly model: LoadedModel;
  private readonly face: DroneFace;
  private readonly antenna: TransformNode | null;
  private readonly socket: TransformNode | null;
  private readonly pods: { node: TransformNode; sx: number; sz: number }[] = [];
  private readonly glowMaterials: PBRMaterial[] = [];
  private readonly antennaGlow: PBRMaterial[] = [];
  private readonly glow: Color3;

  private time = Math.random() * 10;
  private stretch = 1;
  private dash = 1;
  private thrust = 0;
  private readonly prevVelocity = new Vector3();
  private readonly accel = new Vector3();
  private hasPrev = false;
  private leanPitch = 0;
  private leanRoll = 0;
  private antennaX = 0;
  private antennaZ = 0;
  private antennaVX = 0;
  private antennaVZ = 0;
  private podPitch = 0;
  private podRoll = 0;
  private stunTimer = 0;

  constructor(scene: Scene, parent: TransformNode, palette: DronePalette, model: LoadedModel) {
    this.glow = palette.glow.clone();
    this.model = model;
    const n = parent.name;

    this.root = new TransformNode(`${n}-visual`, scene);
    this.root.parent = parent;
    this.bob = new TransformNode(`${n}-bob`, scene);
    this.bob.parent = this.root;
    this.lean = new TransformNode(`${n}-lean`, scene);
    this.lean.parent = this.bob;
    this.squash = new TransformNode(`${n}-squash`, scene);
    this.squash.parent = this.lean;

    model.root.name = `${n}-model`;
    model.root.parent = this.squash;
    model.root.scaling.setAll(MODEL_SCALE);
    model.root.position.y = MODEL_LIFT;

    this.face = new DroneFace(scene, n, palette.eye);
    this.applyMaterials(model.meshes, palette);

    this.antenna = findNode(model.root, 'Antenna');
    this.socket = findNode(model.root, 'TetherSocket');
    for (const [name, sx, sz] of [
      ['HoverPod_FL', -1, 1],
      ['HoverPod_FR', 1, 1],
      ['HoverPod_BL', -1, -1],
      ['HoverPod_BR', 1, -1],
    ] as const) {
      const node = findNode(model.root, name);
      if (node) {
        node.rotationQuaternion = null;
        this.pods.push({ node, sx, sz });
      }
    }
    if (this.antenna) {
      this.antenna.rotationQuaternion = null;
    }

    for (const mesh of model.meshes) {
      mesh.isPickable = false;
    }
  }

  /** World position of the tether socket on the back shell. */
  getSocketPosition(target: Vector3): Vector3 {
    if (!this.socket) {
      return target.copyFrom(this.root.getAbsolutePosition());
    }
    this.socket.computeWorldMatrix(true);
    return target.copyFrom(this.socket.getAbsolutePosition());
  }

  /** Hard contact: stunned eyes and a brief shake. Visual only. */
  impact(strength: number): void {
    const t = clamp(strength / 8, 0.4, 1);
    this.stunTimer = Math.max(this.stunTimer, 0.35 + t * 0.55);
    this.face.flash('stunned', 0.35 + t * 0.55);
    this.antennaVX += (Math.random() - 0.5) * 24 * t;
    this.antennaVZ += (Math.random() - 0.5) * 24 * t;
  }

  tetherYank(strength: number): void {
    const duration = 0.25 + clamp(strength, 0, 1) * 0.35;
    this.face.flash('shocked', duration);
  }

  update(state: DroneVisualState): void {
    const dt = state.dt;
    if (dt <= 0) {
      return;
    }
    this.time += dt;
    const v = state.velocity;

    // Local frame from the yaw the controller gave root (Babylon left-handed: forward = (sin, 0, cos)).
    const yaw = this.root.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const localForward = v.x * fx + v.z * fz;
    const localRight = v.x * fz - v.z * fx;

    if (this.hasPrev) {
      this.accel.set(
        blend(this.accel.x, (v.x - this.prevVelocity.x) / dt, 6, dt),
        blend(this.accel.y, (v.y - this.prevVelocity.y) / dt, 6, dt),
        blend(this.accel.z, (v.z - this.prevVelocity.z) / dt, 6, dt),
      );
    }
    this.prevVelocity.copyFrom(v);
    this.hasPrev = true;
    const accelForward = this.accel.x * fx + this.accel.z * fz;
    const accelRight = this.accel.x * fz - this.accel.z * fx;

    const speed = v.length();
    const moveBlend = clamp(speed / FLIGHT_TUNING.cruiseSpeed, 0, 1);

    // Hover bob: gentle while idle, nearly still at speed.
    const bobAmount = 0.035 * (1 - moveBlend * 0.75);
    this.bob.position.y = Math.sin(this.time * 2.1) * bobAmount;
    this.bob.rotation.z = Math.sin(this.time * 1.6) * 0.015 * (1 - moveBlend);
    this.bob.rotation.x = Math.sin(this.time * 1.3 + 1.2) * 0.01 * (1 - moveBlend);

    // Acceleration lean: nose dips on throttle, lifts on braking, shoulders into lateral pushes.
    const maxAccel = FLIGHT_TUNING.acceleration;
    const targetPitch = clamp(accelForward / maxAccel, -1, 1) * 0.11;
    const targetRoll = clamp(-accelRight / maxAccel, -1, 1) * 0.09;
    this.leanPitch = blend(this.leanPitch, targetPitch, 7, dt);
    this.leanRoll = blend(this.leanRoll, targetRoll, 7, dt);
    let shakeX = 0;
    let shakeZ = 0;
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      const s = clamp(this.stunTimer, 0, 1) * 0.04;
      shakeX = Math.sin(this.time * 46) * s;
      shakeZ = Math.cos(this.time * 39) * s;
    }
    this.lean.rotation.x = this.leanPitch + shakeX;
    this.lean.rotation.z = this.leanRoll + shakeZ;

    // Subtle squash/stretch.
    const lift = clamp(v.y / FLIGHT_TUNING.verticalSpeed, -1, 1);
    const targetStretch = 1 + lift * 0.05 + (state.boosting ? 0.025 : 0);
    this.stretch = blend(this.stretch, targetStretch, 9, dt);
    const planar = Math.hypot(v.x, v.z);
    const dashTarget =
      1 + clamp(planar / (FLIGHT_TUNING.cruiseSpeed * FLIGHT_TUNING.boostMultiplier), 0, 1) * 0.04;
    this.dash = blend(this.dash, dashTarget, 9, dt);
    const side = 1 / Math.sqrt(this.stretch * this.dash);
    this.squash.scaling.set(side, this.stretch, this.dash);

    // Hover pods vector into the direction of travel with a little idle flutter.
    const podTargetPitch = clamp(localForward / FLIGHT_TUNING.cruiseSpeed, -1.2, 1.2) * 0.3;
    const podTargetRoll = clamp(-localRight / FLIGHT_TUNING.cruiseSpeed, -1.2, 1.2) * 0.3;
    this.podPitch = blend(this.podPitch, podTargetPitch, 8, dt);
    this.podRoll = blend(this.podRoll, podTargetRoll, 8, dt);
    for (const pod of this.pods) {
      const flutter = 0.02 * (1 - moveBlend * 0.5);
      pod.node.rotation.x =
        this.podPitch + Math.sin(this.time * 3.3 + pod.sx * 1.1 + pod.sz * 2.3) * flutter;
      pod.node.rotation.z =
        this.podRoll + Math.cos(this.time * 2.9 + pod.sx * 2.1 + pod.sz * 0.7) * flutter;
    }

    // Antenna: damped spring that lags behind acceleration, plus idle sway.
    if (this.antenna) {
      const stiffness = 60;
      const dampingK = 7;
      const driveX = -accelForward * 0.045;
      const driveZ = accelRight * 0.045;
      this.antennaVX += (-stiffness * this.antennaX - dampingK * this.antennaVX + driveX * stiffness) * dt;
      this.antennaVZ += (-stiffness * this.antennaZ - dampingK * this.antennaVZ + driveZ * stiffness) * dt;
      this.antennaX += this.antennaVX * dt;
      this.antennaZ += this.antennaVZ * dt;
      this.antennaX = clamp(this.antennaX, -0.6, 0.6);
      this.antennaZ = clamp(this.antennaZ, -0.6, 0.6);
      const sway = 0.03 * (1 - moveBlend * 0.6);
      this.antenna.rotation.x = this.antennaX + Math.sin(this.time * 1.9) * sway;
      this.antenna.rotation.z = this.antennaZ + Math.cos(this.time * 1.5 + 0.8) * sway;
    }

    // Thruster glow.
    const thrustTarget = 0.6 + moveBlend * 0.5 + (state.boosting ? 0.8 : 0);
    this.thrust = blend(this.thrust, thrustTarget, 8, dt);
    const flicker = 1 + Math.sin(this.time * 31) * 0.04;
    const glow = this.thrust * flicker;
    for (const material of this.glowMaterials) {
      material.emissiveColor.set(this.glow.r * glow, this.glow.g * glow, this.glow.b * glow);
    }
    const pulse = 0.7 + Math.sin(this.time * 3.1) * 0.3;
    for (const material of this.antennaGlow) {
      material.emissiveColor.set(this.glow.r * pulse, this.glow.g * pulse, this.glow.b * pulse);
    }

    // Face.
    if ((state.tetherPull ?? 0) > 0.18) {
      this.face.setExpression('strained');
    } else if (state.focused) {
      this.face.setExpression('focused');
    } else if (state.boosting && state.selfPowered) {
      this.face.setExpression('focused');
    } else if (state.selfPowered && moveBlend > 0.45) {
      this.face.setExpression('happy');
    } else {
      this.face.setExpression('neutral');
    }
    this.face.update(dt);
  }

  dispose(): void {
    this.face.dispose();
    this.model.dispose();
    this.root.dispose(false, true);
  }

  private applyMaterials(meshes: readonly AbstractMesh[], palette: DronePalette): void {
    for (const mesh of meshes) {
      const material = mesh.material;
      if (!(material instanceof PBRMaterial)) {
        continue;
      }
      const isAntenna = mesh.name.startsWith('Antenna');
      switch (material.name) {
        case 'Accent':
          material.albedoColor = palette.accent.clone();
          material.metallic = 0.08;
          material.roughness = 0.25;
          break;
        case 'Glow': {
          const glow = isAntenna ? material.clone(`${material.name}-antenna`) : material;
          glow.albedoColor = palette.glow.clone();
          glow.emissiveColor = palette.glow.clone();
          glow.emissiveIntensity = isAntenna ? 1 : 1.75;
          mesh.material = glow;
          const list = isAntenna ? this.antennaGlow : this.glowMaterials;
          if (!list.includes(glow)) {
            list.push(glow);
          }
          break;
        }
        case 'Screen':
          material.emissiveTexture = this.face.texture;
          material.emissiveColor = Color3.White();
          material.emissiveIntensity = 1.4;
          material.clearCoat.isEnabled = true;
          material.clearCoat.intensity = 0.7;
          material.clearCoat.roughness = 0.12;
          break;
        case 'FaceRim':
          material.albedoColor = Color3.Lerp(new Color3(0.62, 0.68, 0.74), palette.accent, 0.12);
          material.metallic = 0.62;
          material.roughness = 0.24;
          break;
        case 'DarkMetal':
          material.albedoColor = new Color3(0.045, 0.05, 0.065);
          material.metallic = 0.68;
          material.roughness = 0.4;
          break;
        default:
          break;
      }
    }
  }
}
