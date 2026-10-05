import {
  Color3,
  CreateTube,
  StandardMaterial,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import type { Drone } from '../player/Drone.ts';

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
  radius: 0.045,
  segments: 16,
};

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
  private readonly material: StandardMaterial;
  private readonly slackColor = new Color3(0.9, 0.9, 0.95);
  private readonly tautColor = new Color3(1, 0.45, 0.35);
  private strain = 0;
  private readonly a: Drone;
  private readonly b: Drone;

  constructor(scene: Scene, a: Drone, b: Drone, tuning: TetherTuning = TETHER_TUNING) {
    this.a = a;
    this.b = b;
    this.tuning = tuning;
    for (let i = 0; i <= tuning.segments; i++) {
      this.path.push(new Vector3());
    }
    this.writePath();
    this.mesh = CreateTube(
      'tether',
      { path: this.path, radius: tuning.radius, tessellation: 8, updatable: true, cap: 2 },
      scene,
    );
    this.material = new StandardMaterial('tether-mat', scene);
    this.material.diffuseColor = this.slackColor.clone();
    this.material.emissiveColor = new Color3(0.2, 0.2, 0.22);
    this.material.specularColor = new Color3(0.2, 0.2, 0.2);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
  }

  get currentStrain(): number {
    return this.strain;
  }

  /** Call after both drones have steered and before they commit. */
  apply(dt: number): void {
    const t = this.tuning;
    const pa = this.a.position;
    const pb = this.b.position;
    this.dir.copyFrom(pb).subtractInPlace(pa);
    const distance = this.dir.length();
    if (distance < 1e-4) {
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
    const separating = Vector3.Dot(vb, this.dir) - Vector3.Dot(va, this.dir);
    let pull = t.stiffness * stretch;
    if (separating > 0) {
      pull += t.damping * separating;
    }
    const impulse = pull * dt;
    this.delta.copyFrom(this.dir).scaleInPlace(impulse);
    this.a.applyVelocityDelta(this.delta);
    this.delta.scaleInPlace(-1);
    this.b.applyVelocityDelta(this.delta);

    if (distance >= t.maxLength) {
      const stillSeparating = Vector3.Dot(vb, this.dir) - Vector3.Dot(va, this.dir);
      if (stillSeparating > 0) {
        const half = stillSeparating * 0.5;
        this.delta.copyFrom(this.dir).scaleInPlace(half);
        va.addInPlace(this.delta);
        vb.subtractInPlace(this.delta);
      }
    }
  }

  /** Call after physics so the rope matches the resolved positions. */
  updateVisual(): void {
    this.writePath();
    CreateTube('tether', { path: this.path, radius: this.tuning.radius, instance: this.mesh });
    Color3.LerpToRef(this.slackColor, this.tautColor, this.strain, this.material.diffuseColor);
    const glow = 0.2 + this.strain * 0.5;
    this.material.emissiveColor.set(glow, glow * (1 - this.strain * 0.6), glow * (1 - this.strain * 0.7));
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }

  private writePath(): void {
    const pa = this.a.position;
    const pb = this.b.position;
    const distance = Vector3.Distance(pa, pb);
    const slack = Math.max(0, this.tuning.restLength - distance);
    const sag = slack * 0.32 + 0.08;
    const count = this.path.length - 1;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const point = this.path[i];
      point.x = pa.x + (pb.x - pa.x) * t;
      point.y = pa.y + (pb.y - pa.y) * t - Math.sin(t * Math.PI) * sag;
      point.z = pa.z + (pb.z - pa.z) * t;
    }
  }
}
