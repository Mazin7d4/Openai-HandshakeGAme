import {
  Color3,
  CreateCylinder,
  CreateTube,
  PBRMaterial,
  Quaternion,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import type { Drone } from '../player/Drone.ts';
import { reportStabilityIssue } from '../dev/StabilityDiagnostics.ts';

/** Cord appearance: a plain charcoal rubber/fabric elastic. No glow. */
const CORD_COLOR = new Color3(0.09, 0.09, 0.1);
const COLLAR_LENGTH = 0.14;
const COLLAR_DIAMETER = 0.15;
const MAX_VELOCITY_DELTA_PER_FRAME = 4;

export interface TetherTuning {
  /** Rope hangs slack below this distance. */
  restLength: number;
  /** Hard stop. Separating velocity is removed past this. */
  maxLength: number;
  /** Spring pull per metre of stretch (m/s^2). */
  stiffness: number;
  /** Damping on separating velocity while stretched. */
  damping: number;
  /** Rope radius in metres. */
  radius: number;
  segments: number;
}

export const TETHER_TUNING: TetherTuning = {
  restLength: 7,
  maxLength: 10,
  stiffness: 22,
  damping: 5,
  radius: 0.055,
  segments: 20,
};

export interface TetherVisualOptions {
  /** Collar colour at drone A's socket. */
  collarA: Color3;
  /** Collar colour at drone B's socket. */
  collarB: Color3;
}

/**
 * Elastic link between two drones. Pulls them together once they drift past
 * the rest length and hard-clamps separation at the max length. Works on the
 * steered velocities between Drone.steer() and Drone.commit(), so Havok still
 * owns collisions. The rope mesh sags when slack and goes taut when stretched.
 */
export class Tether {
  readonly mesh: Mesh;

  private readonly tuning: TetherTuning;
  private readonly path: Vector3[] = [];
  private readonly dir = new Vector3();
  private readonly delta = new Vector3();
  private readonly anchorA = new Vector3();
  private readonly anchorB = new Vector3();
  private readonly tangent = new Vector3();
  private readonly zero = new Vector3();
  private readonly material: PBRMaterial;
  private readonly collars: Mesh[] = [];
  private strain = 0;
  private readonly a: Drone;
  private readonly b: Drone;

  constructor(
    scene: Scene,
    a: Drone,
    b: Drone,
    tuning: TetherTuning = TETHER_TUNING,
    visual?: TetherVisualOptions,
  ) {
    this.a = a;
    this.b = b;
    this.tuning = tuning;
    for (let i = 0; i <= tuning.segments; i++) {
      this.path.push(new Vector3());
    }
    this.writePath();
    this.mesh = CreateTube(
      'tether',
      { path: this.path, radius: tuning.radius, tessellation: 10, updatable: true, cap: 0 },
      scene,
    );
    this.material = new PBRMaterial('tether-mat', scene);
    this.material.albedoColor = CORD_COLOR.clone();
    this.material.metallic = 0;
    this.material.roughness = 0.82;
    this.material.specularIntensity = 0.5;
    this.mesh.material = this.material;
    this.mesh.isPickable = false;

    const collarColors = [visual?.collarA ?? CORD_COLOR, visual?.collarB ?? CORD_COLOR];
    collarColors.forEach((color, index) => {
      const collar = CreateCylinder(
        `tether-collar-${index}`,
        { height: COLLAR_LENGTH, diameter: COLLAR_DIAMETER, tessellation: 20 },
        scene,
      );
      const material = new PBRMaterial(`tether-collar-${index}-mat`, scene);
      material.albedoColor = color.clone();
      material.metallic = 0;
      material.roughness = 0.35;
      collar.material = material;
      collar.isPickable = false;
      collar.rotationQuaternion = Quaternion.Identity();
      this.collars.push(collar);
    });
  }

  get currentStrain(): number {
    return this.strain;
  }

  /** Call after both drones have steered and before they commit. */
  apply(dt: number, canMove: (drone: Drone) => boolean = () => true): void {
    const t = this.tuning;
    const pa = this.a.position;
    const pb = this.b.position;
    if (!isFiniteVector(pa) || !isFiniteVector(pb)) {
      reportStabilityIssue('tether', 'A drone supplied a non-finite tether anchor position.');
      this.strain = 0;
      return;
    }
    this.dir.copyFrom(pb).subtractInPlace(pa);
    const distance = this.dir.length();
    if (!Number.isFinite(distance) || distance < 1e-4) {
      this.strain = 0;
      return;
    }
    this.dir.scaleInPlace(1 / distance);

    const stretch = distance - t.restLength;
    this.strain = Math.max(0, Math.min(1, stretch / (t.maxLength - t.restLength)));
    if (stretch <= 0) {
      return;
    }

    const va = this.a.velocity;
    const vb = this.b.velocity;
    if (!isFiniteVector(va) || !isFiniteVector(vb)) {
      reportStabilityIssue('tether', 'A drone supplied a non-finite tether velocity.');
      return;
    }
    const separating = Vector3.Dot(vb, this.dir) - Vector3.Dot(va, this.dir);
    let pull = t.stiffness * stretch;
    if (separating > 0) {
      pull += t.damping * separating;
    }
    const impulse = Math.min(MAX_VELOCITY_DELTA_PER_FRAME, Math.max(0, pull * dt));
    this.delta.copyFrom(this.dir).scaleInPlace(impulse);
    const pullStrength = Math.min(1, pull / (t.stiffness * (t.maxLength - t.restLength)));
    if (canMove(this.a)) this.a.applyTetherVelocityDelta(this.delta, pullStrength);
    this.delta.scaleInPlace(-1);
    if (canMove(this.b)) this.b.applyTetherVelocityDelta(this.delta, pullStrength);

    if (distance >= t.maxLength) {
      const stillSeparating = Vector3.Dot(vb, this.dir) - Vector3.Dot(va, this.dir);
      if (stillSeparating > 0) {
        const half = Math.min(MAX_VELOCITY_DELTA_PER_FRAME, stillSeparating * 0.5);
        this.delta.copyFrom(this.dir).scaleInPlace(half);
        if (canMove(this.a)) {
          va.addInPlace(this.delta);
          this.a.applyTetherVelocityDelta(this.zero, 1);
        }
        if (canMove(this.b)) {
          vb.subtractInPlace(this.delta);
          this.b.applyTetherVelocityDelta(this.zero, 1);
        }
      }
    }
  }

  /** Call after physics so the rope matches the resolved positions. */
  updateVisual(): void {
    this.writePath();
    // An elastic cord thins as it stretches.
    const radius = this.tuning.radius * (1 - this.strain * 0.35);
    CreateTube('tether', { path: this.path, radius, instance: this.mesh });
    this.placeCollar(0, this.anchorA, this.path[1]);
    this.placeCollar(1, this.anchorB, this.path[this.path.length - 2]);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    for (const collar of this.collars) {
      collar.material?.dispose();
      collar.dispose();
    }
  }

  private placeCollar(index: number, anchor: Vector3, next: Vector3): void {
    const collar = this.collars[index];
    if (!collar) {
      return;
    }
    this.tangent.copyFrom(next).subtractInPlace(anchor);
    if (this.tangent.lengthSquared() < 1e-8) {
      this.tangent.set(0, -1, 0);
    } else {
      this.tangent.normalize();
    }
    Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, this.tangent, collar.rotationQuaternion!);
    collar.position.copyFrom(anchor).addInPlace(this.tangent.scaleInPlace(COLLAR_LENGTH * 0.35));
  }

  private writePath(): void {
    const pa = this.a.getTetherAnchor(this.anchorA);
    const pb = this.b.getTetherAnchor(this.anchorB);
    const distance = Vector3.Distance(pa, pb);
    const slack = Math.max(0, this.tuning.restLength - distance);
    const sag = slack * 0.3 + 0.12 * (1 - this.strain);
    const count = this.path.length - 1;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const point = this.path[i];
      // Parabolic droop: the classic hanging-cable approximation.
      const u = t * 2 - 1;
      const droop = 1 - u * u;
      point.x = pa.x + (pb.x - pa.x) * t;
      point.y = pa.y + (pb.y - pa.y) * t - droop * sag;
      point.z = pa.z + (pb.z - pa.z) * t;
    }
  }
}

function isFiniteVector(value: Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}
