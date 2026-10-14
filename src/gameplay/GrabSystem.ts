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
  private readonly onGrab?: (objectId: string, role: DroneRole) => void;
  private readonly onThrow?: (objectId: string, role: DroneRole) => void;
  private readonly canGrab?: (objectId: string, role: DroneRole) => boolean;

  constructor(
    objects: readonly Grabbable[],
    session: MultiplayerSession | null,
    localRole: DroneRole | null,
    callbacks?: {
      onGrab?: (objectId: string, role: DroneRole) => void;
      onThrow?: (objectId: string, role: DroneRole) => void;
      canGrab?: (objectId: string, role: DroneRole) => boolean;
    },
  ) {
    this.objects = objects;
    this.session = session;
    this.localRole = localRole;
    this.onGrab = callbacks?.onGrab;
    this.onThrow = callbacks?.onThrow;
    this.canGrab = callbacks?.canGrab;
  }

  sync(status: RoomStatus): void {
    this.localRole = status.localRole;
    if (!this.localRole) return;
    for (const object of this.objects) {
      const state = status.objects.get(object.id);
      if (state) object.applyNetworkState(state, this.localRole);
    }
  }

  /** TEST-ONLY: hand an object straight to a role (local modes only). */
  debugGrab(id: string, role: DroneRole): void {
    if (this.session) return;
    const object = this.objects.find((candidate) => candidate.id === id);
    if (!object || object.heldBy) return;
    object.grab(role);
    this.onGrab?.(object.id, role);
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
    if (this.canGrab && !this.canGrab(nearest.id, role)) return false;
    if (this.session) {
      if (role === this.localRole) this.session.requestGrab(nearest.id);
    } else {
      nearest.grab(role);
      this.onGrab?.(nearest.id, role);
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
    this.onThrow?.(held.id, role);
    return true;
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    for (const object of this.objects) {
      const holder = object.heldBy ? drones.get(object.heldBy) : undefined;
      if (holder) {
        if (object.heavy) this.applyHeavyDrag(object, holder, drones);
        this.holdTarget.copyFrom(holder.position).addInPlace(HOLD_OFFSET);
        object.update(dt, this.holdTarget, holder.velocity);
      } else {
        object.update(dt);
      }
    }
  }

  /** Partner helping = within cord range and flying the same way. Shared by drag + prompts. */
  private partnerHelps(holderRole: DroneRole, holder: Drone, drones: ReadonlyMap<DroneRole, Drone>): boolean {
    const partner = drones.get(holderRole === 'pix' ? 'nee' : 'pix');
    if (!partner) return false;
    if (Vector3.Distance(partner.position, holder.position) > 10.5) return false;
    const pv = partner.velocity;
    const hv = holder.velocity;
    const partnerSpeed = pv.length();
    if (partnerSpeed < 1.5) return false;
    const holderSpeed = hv.length();
    if (holderSpeed < 0.5) return true; // Partner is towing the carrier.
    return Vector3.Dot(pv, hv) / (partnerSpeed * holderSpeed) > 0.35;
  }

  private applyHeavyDrag(object: Grabbable, holder: Drone, drones: ReadonlyMap<DroneRole, Drone>): void {
    const role = object.heldBy;
    if (!role) return;
    const helped = this.partnerHelps(role, holder, drones);
    object.helped = helped;
    const cap = helped ? 8.5 : 2.4;
    const v = holder.velocity;
    const planar = Math.hypot(v.x, v.z);
    if (planar > cap) {
      v.x *= cap / planar;
      v.z *= cap / planar;
    }
    if (!helped && v.y > 1.2) v.y = 1.2; // Can barely lift it alone.
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

  objectPosition(id: string): Vector3 | null {
    return this.objects.find((object) => object.id === id)?.position ?? null;
  }

  objectHeldBy(id: string): DroneRole | null {
    return this.objects.find((object) => object.id === id)?.heldBy ?? null;
  }

  nearbyFastObject(point: Vector3, radius: number, minimumSpeed = 5): boolean {
    return this.objects.some((object) =>
      object.heldBy === null && object.distanceTo(point) <= radius && object.speed >= minimumSpeed);
  }

  promptsFor(role: DroneRole, drone: Drone): string[] {
    const held = this.objects.find((object) => object.heldBy === role);
    if (held?.heavy && !held.helped) {
      return [`HEAVY! ${role === 'pix' ? 'NEE' : 'PIX'} MUST FLY WITH YOU (OR TOW YOU)`, `[E] Drop ${held.label}`];
    }
    if (held) return [`[E] Drop ${held.label}`, `[Q] Throw ${held.label}`];
    let nearest: Grabbable | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const object of this.objects) {
      if (this.canGrab && !this.canGrab(object.id, role)) continue;
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
