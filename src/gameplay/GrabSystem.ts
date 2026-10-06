import { Vector3 } from '@babylonjs/core';
import type { Drone } from '../player/Drone.ts';
import type { DroneRole, RoomStatus } from '../network/NetworkTypes.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import { Grabbable } from './Grabbable.ts';

const HOLD_OFFSET = new Vector3(0, -1.15, 0.35);
const THROW_SPEED = 10;
const THROW_LIFT = 1.8;
const DRONE_CLEARANCE = 0.82;

/** Owns proximity selection, carry springs, stealing, release and throw semantics. */
export class GrabSystem {
  private readonly objects: readonly Grabbable[];
  private readonly session: MultiplayerSession | null;
  private readonly holdTarget = new Vector3();
  private readonly throwVelocity = new Vector3();
  private readonly aimDirection = new Vector3();
  private readonly releasePosition = new Vector3();
  private localRole: DroneRole | null;

  constructor(
    objects: readonly Grabbable[],
    session: MultiplayerSession | null,
    localRole: DroneRole | null,
  ) {
    this.objects = objects;
    this.session = session;
    this.localRole = localRole;
  }

  sync(status: RoomStatus): void {
    this.localRole = status.localRole;
    if (!this.localRole) return;
    for (const object of this.objects) {
      const state = status.objects.get(object.id);
      if (state) object.applyNetworkState(state, this.localRole);
    }
  }

  hasHeld(role: DroneRole): boolean {
    return this.objects.some((object) => object.heldBy === role);
  }

  grabOrDrop(role: DroneRole, drone: Drone): boolean {
    const held = this.objects.find((object) => object.heldBy === role);
    if (held) {
      this.drop(role, drone);
      return true;
    }
    let nearest: Grabbable | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const object of this.objects) {
      const distance = object.distanceTo(drone.position);
      if (distance <= object.grabRadius && distance < nearestDistance) {
        nearest = object;
        nearestDistance = distance;
      }
    }
    if (!nearest) return false;
    if (this.session) {
      if (role === this.localRole) this.session.requestGrab(nearest.id);
    } else {
      nearest.grab(role);
    }
    return true;
  }

  handleThrow(role: DroneRole, drone: Drone): boolean {
    const held = this.objects.find((object) => object.heldBy === role);
    if (!held) return false;
    this.throwVelocity.copyFrom(drone.velocity);
    drone.getThrowDirection(this.aimDirection);
    this.throwVelocity.addInPlace(this.aimDirection.scale(THROW_SPEED));
    this.throwVelocity.y += THROW_LIFT;
    this.placeForRelease(held, drone, this.aimDirection, true);
    this.release(role, held, this.releasePosition, this.throwVelocity, true);
    return true;
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    for (const object of this.objects) {
      const holder = object.heldBy ? drones.get(object.heldBy) : undefined;
      if (holder) {
        this.holdTarget.copyFrom(holder.position).addInPlace(HOLD_OFFSET);
        object.update(dt, this.holdTarget, holder.velocity);
      } else {
        object.update(dt);
      }
    }
  }

  publish(): void {
    if (!this.session || !this.localRole) return;
    for (const object of this.objects) {
      if (object.authorityRole === this.localRole) {
        this.session.publishObject(object.captureState());
      }
    }
  }

  describe(): string {
    return this.objects
      .map((object) => {
        const p = object.position;
        return `${object.id}:${object.heldBy ?? 'free'}@${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
      })
      .join('  ');
  }

  heldObjectId(role: DroneRole): string | null {
    return this.objects.find((object) => object.heldBy === role)?.id ?? null;
  }

  promptsFor(role: DroneRole, drone: Drone): string[] {
    const held = this.objects.find((object) => object.heldBy === role);
    if (held) return [`[E] Drop ${held.label}`, `[Q] Throw ${held.label}`];
    let nearest: Grabbable | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const object of this.objects) {
      const distance = object.distanceTo(drone.position);
      if (distance <= object.grabRadius && distance < nearestDistance) {
        nearest = object;
        nearestDistance = distance;
      }
    }
    return nearest ? [`[E] Grab ${nearest.label}`] : [];
  }

  dispose(): void {
    for (const object of this.objects) object.dispose();
  }

  private drop(role: DroneRole, drone: Drone): void {
    this.throwVelocity.copyFrom(drone.velocity);
    const held = this.objects.find((object) => object.heldBy === role);
    if (!held) return;
    drone.getThrowDirection(this.aimDirection);
    this.placeForRelease(held, drone, this.aimDirection, false);
    this.release(role, held, this.releasePosition, this.throwVelocity, false);
  }

  private release(
    role: DroneRole,
    object: Grabbable,
    position: Vector3,
    velocity: Vector3,
    thrown: boolean,
  ): void {
    if (this.session) {
      if (role === this.localRole) {
        this.session.releaseObject(
          object.id,
          { x: position.x, y: position.y, z: position.z },
          { x: velocity.x, y: velocity.y, z: velocity.z },
          thrown,
        );
      }
    } else {
      object.release(position, velocity);
    }
  }

  private placeForRelease(
    object: Grabbable,
    drone: Drone,
    direction: Vector3,
    thrown: boolean,
  ): void {
    const distance = DRONE_CLEARANCE + object.collisionRadius + (thrown ? 0.35 : 0.08);
    this.releasePosition.copyFrom(drone.position).addInPlace(direction.scale(distance));
    this.releasePosition.y = Math.max(
      object.collisionRadius + 0.06,
      drone.position.y - (thrown ? 0.12 : 0.62),
    );
  }
}
