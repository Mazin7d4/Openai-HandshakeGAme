import {
  Color3,
  CreateCylinder,
  CreateSphere,
  StandardMaterial,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import type { GameAudio } from '../audio/GameAudio.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { cordState } from './Tether.ts';
import { gameEvents } from './GameEvents.ts';

const CAMERA_RANGE = 10;
const CAMERA_HALF_ANGLE = Math.PI / 5;

interface SecurityCallbacks {
  onSpotted: (role: DroneRole) => void;
  hasFastObjectNear: (point: Vector3, radius: number) => boolean;
}

class SecurityCamera {
  private readonly body: Mesh;
  private readonly cone: Mesh;
  private readonly coneMaterial: StandardMaterial;
  private readonly origin = new Vector3(0, 3.7, 8.5);
  private readonly forward = new Vector3(0, -0.08, -1).normalize();
  private readonly meters = new Map<DroneRole, number>();
  private alertCooldown = 0;
  private disabled = false;

  constructor(scene: Scene) {
    this.body = CreateSphere('security-camera', { diameter: 0.75, segments: 12 }, scene);
    this.body.position.copyFrom(this.origin);
    const bodyMaterial = new StandardMaterial('security-camera-material', scene);
    bodyMaterial.diffuseColor = new Color3(0.12, 0.16, 0.18);
    bodyMaterial.emissiveColor = new Color3(0.3, 0.05, 0.04);
    this.body.material = bodyMaterial;
    this.cone = CreateCylinder('security-camera-cone', {
      height: CAMERA_RANGE,
      diameterTop: 0,
      diameterBottom: CAMERA_RANGE * Math.tan(CAMERA_HALF_ANGLE) * 2,
      tessellation: 28,
    }, scene);
    this.cone.position.copyFrom(this.origin).addInPlace(this.forward.scale(CAMERA_RANGE / 2));
    this.cone.rotation.x = Math.PI / 2;
    this.coneMaterial = new StandardMaterial('security-camera-cone-material', scene);
    this.coneMaterial.diffuseColor = new Color3(1, 0.26, 0.16);
    this.coneMaterial.emissiveColor = new Color3(0.55, 0.06, 0.03);
    this.coneMaterial.alpha = 0.16;
    this.coneMaterial.backFaceCulling = false;
    this.cone.material = this.coneMaterial;
    this.cone.isPickable = false;
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.cone.setEnabled(!disabled);
    const material = this.body.material as StandardMaterial;
    material.emissiveColor = disabled ? new Color3(0.04, 0.28, 0.14) : new Color3(0.3, 0.05, 0.04);
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>, onSpotted: (role: DroneRole) => void): number {
    this.alertCooldown = Math.max(0, this.alertCooldown - dt);
    let highest = 0;
    for (const [role, drone] of drones) {
      const relative = drone.position.subtract(this.origin);
      const distance = relative.length();
      const inside = !this.disabled && distance < CAMERA_RANGE && distance > 0.1 &&
        Vector3.Dot(relative.scale(1 / distance), this.forward) > Math.cos(CAMERA_HALF_ANGLE);
      const next = Math.max(0, Math.min(1, (this.meters.get(role) ?? 0) + dt * (inside ? 0.72 : -1.2)));
      this.meters.set(role, next);
      highest = Math.max(highest, next);
      if (next >= 1 && this.alertCooldown <= 0) {
        onSpotted(role);
        this.alertCooldown = 3;
        this.meters.set(role, 0.35);
      }
    }
    this.coneMaterial.alpha = 0.11 + highest * 0.24;
    return highest;
  }

  dispose(): void {
    this.body.material?.dispose();
    this.coneMaterial.dispose();
    this.body.dispose();
    this.cone.dispose();
  }
}

class PatrolDrone {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly velocity = new Vector3();
  private stunnedFor = 0;
  private shoveCooldown = 0;
  private phase: number;

  constructor(scene: Scene, index: number) {
    this.phase = index * Math.PI;
    this.mesh = CreateSphere(`security-drone-${index}`, { diameter: 1.35, segments: 14 }, scene);
    this.mesh.position.set(index === 0 ? -4 : 4, 2.2, 10 + index * 3);
    this.material = new StandardMaterial(`security-drone-${index}-material`, scene);
    this.material.diffuseColor = new Color3(0.16, 0.19, 0.21);
    this.material.emissiveColor = new Color3(0.5, 0.08, 0.04);
    this.mesh.material = this.material;
    this.mesh.setEnabled(false);
  }

  update(
    dt: number,
    elapsed: number,
    active: boolean,
    drones: ReadonlyMap<DroneRole, Drone>,
    callbacks: SecurityCallbacks,
    tetherStrain: number,
  ): void {
    this.mesh.setEnabled(active);
    if (!active) return;
    this.stunnedFor = Math.max(0, this.stunnedFor - dt);
    this.shoveCooldown = Math.max(0, this.shoveCooldown - dt);
    if (this.stunnedFor > 0) {
      this.material.emissiveColor.set(0.1, 0.35, 0.6);
      this.mesh.rotation.z += dt * 7;
      return;
    }
    this.material.emissiveColor.set(0.5, 0.08, 0.04);
    if (callbacks.hasFastObjectNear(this.mesh.position, 1.65)) {
      this.stunnedFor = 3.2;
      return;
    }
    const roles = [...drones.entries()];
    const nearest = roles.sort((a, b) =>
      Vector3.DistanceSquared(a[1].position, this.mesh.position) -
      Vector3.DistanceSquared(b[1].position, this.mesh.position))[0];
    let target = new Vector3(Math.sin(elapsed * 0.55 + this.phase) * 5, 2.2, 10 + Math.cos(elapsed * 0.55 + this.phase) * 4);
    if (nearest && Vector3.Distance(nearest[1].position, this.mesh.position) < 9) target = nearest[1].position;
    this.velocity.copyFrom(target).subtractInPlace(this.mesh.position);
    if (this.velocity.lengthSquared() > 0.05) this.velocity.normalize().scaleInPlace(3.1);
    this.mesh.position.addInPlace(this.velocity.scale(dt));
    const pix = drones.get('pix');
    const nee = drones.get('nee');
    // Clothesline: a taut or fast-swept cord crossing the patrol knocks it out.
    const cordLive = tetherStrain > 0.2 || cordState.sweep > 6;
    if (pix && nee && cordLive) {
      const path = cordState.path;
      let hit = false;
      if (path.length > 1) {
        for (let i = 1; i < path.length && !hit; i++) {
          hit = distanceToSegment(this.mesh.position, path[i - 1], path[i]) < 0.85;
        }
      } else {
        hit = distanceToSegment(this.mesh.position, pix.position, nee.position) < 0.85;
      }
      if (hit) {
        this.stunnedFor = 3.4;
        const away = this.mesh.position.subtract(pix.position.add(nee.position).scale(0.5));
        away.y = 0;
        if (away.lengthSquared() > 0.01) this.mesh.position.addInPlace(away.normalize().scale(1.2));
        this.mesh.position.y = Math.max(0.8, this.mesh.position.y - 0.6);
        gameEvents.emit('clothesline', { position: this.mesh.position.clone() });
        return;
      }
    }
    if (nearest && this.shoveCooldown <= 0 && Vector3.Distance(nearest[1].position, this.mesh.position) < 1.55) {
      const shove = nearest[1].position.subtract(this.mesh.position).normalize().scaleInPlace(4.2);
      shove.y = 1.2;
      nearest[1].knockback(shove);
      this.shoveCooldown = 1.2;
    }
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.dispose();
  }
}

/** Readable, non-lethal camera and patrol-drone hazards for the heist slice. */
export class SecuritySystem {
  private readonly camera: SecurityCamera;
  private readonly patrols: PatrolDrone[];
  private elapsed = 0;
  private warningCooldown = 0;
  private readonly callbacks: SecurityCallbacks;
  private readonly audio?: GameAudio;
  detection = 0;

  constructor(
    scene: Scene,
    callbacks: SecurityCallbacks,
    audio?: GameAudio,
  ) {
    this.callbacks = callbacks;
    this.audio = audio;
    this.camera = new SecurityCamera(scene);
    this.patrols = [new PatrolDrone(scene, 0), new PatrolDrone(scene, 1)];
  }

  update(
    dt: number,
    drones: ReadonlyMap<DroneRole, Drone>,
    securityActive: boolean,
    cameraDisabled: boolean,
    tetherStrain: number,
  ): void {
    this.elapsed += dt;
    this.warningCooldown = Math.max(0, this.warningCooldown - dt);
    this.camera.setDisabled(cameraDisabled);
    this.detection = this.camera.update(dt, drones, this.callbacks.onSpotted);
    if (this.detection > 0.55 && this.warningCooldown <= 0) {
      this.audio?.warning();
      this.warningCooldown = 0.75;
    }
    for (const patrol of this.patrols) {
      patrol.update(dt, this.elapsed, securityActive, drones, this.callbacks, tetherStrain);
    }
  }

  dispose(): void {
    this.camera.dispose();
    for (const patrol of this.patrols) patrol.dispose();
  }
}

function distanceToSegment(point: Vector3, a: Vector3, b: Vector3): number {
  const segment = b.subtract(a);
  const lengthSquared = segment.lengthSquared();
  if (lengthSquared < 0.0001) return Vector3.Distance(point, a);
  const t = Math.max(0, Math.min(1, Vector3.Dot(point.subtract(a), segment) / lengthSquared));
  return Vector3.Distance(point, a.add(segment.scale(t)));
}
