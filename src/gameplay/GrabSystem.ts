import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Drone } from '../player/Drone.ts';
import type { DroneRole, ObjectEventMessage, RoomStatus } from '../network/NetworkTypes.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import { effectiveReducedMotion, getSettings } from '../ui/Settings.ts';
import { Grabbable } from './Grabbable.ts';
import { cordState } from './Tether.ts';
import { gameEvents } from './GameEvents.ts';
import { canPass, facingYaw } from './passRules.ts';

const HOLD_OFFSET = new Vector3(0, -1.15, 0.35);
const THROW_SPEED = 10;
const THROW_LIFT = 1.8;
const DRONE_CLEARANCE = 0.82;
const STEAL_RANGE = 2.0;

/** Owns proximity selection, carry springs, stealing, release and throw semantics. */
export class GrabSystem {
  private readonly objects: readonly Grabbable[];
  private readonly session: MultiplayerSession | null;
  private readonly scene: Scene | null;
  private readonly holdTarget = new Vector3();
  private readonly throwVelocity = new Vector3();
  private readonly aimDirection = new Vector3();
  private readonly releasePosition = new Vector3();
  private localRole: DroneRole | null;
  private readonly onGrab?: (objectId: string, role: DroneRole) => void;
  private readonly onThrow?: (objectId: string, role: DroneRole) => void;
  private readonly localHandoffs: boolean;
  private readonly canGrab?: (objectId: string, role: DroneRole) => boolean;
  private readonly sweepCooldown = new Map<string, number>();
  private readonly sweepPush = new Vector3();
  private readonly closest = new Vector3();
  private drones: ReadonlyMap<DroneRole, Drone> = new Map();
  private readonly pendingRequests = new Map<string, { revision: number; sentAt: number }>();
  private readonly pendingHandoffs: ObjectEventMessage[] = [];

  constructor(
    objects: readonly Grabbable[],
    session: MultiplayerSession | null,
    localRole: DroneRole | null,
    scene: Scene | null = null,
    callbacks?: {
      onGrab?: (objectId: string, role: DroneRole) => void;
      onThrow?: (objectId: string, role: DroneRole) => void;
      canGrab?: (objectId: string, role: DroneRole) => boolean;
      localHandoffs?: boolean;
    },
  ) {
    this.objects = objects;
    this.session = session;
    this.scene = scene;
    this.localRole = localRole;
    this.onGrab = callbacks?.onGrab;
    this.onThrow = callbacks?.onThrow;
    this.canGrab = callbacks?.canGrab;
    this.localHandoffs = callbacks?.localHandoffs === true;
  }

  sync(status: RoomStatus): void {
    this.localRole = status.localRole;
    if (!this.localRole) return;
    for (const object of this.objects) {
      const state = status.objects.get(object.id);
      if (state) {
        const pending = this.pendingRequests.get(object.id);
        if (pending && (pending.revision !== state.revision || performance.now() - pending.sentAt >= 400)) {
          this.pendingRequests.delete(object.id);
        }
        object.applyNetworkState(state, this.localRole);
      }
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
      const partnerRole = role === 'pix' ? 'nee' : 'pix';
      const partner = this.drones.get(partnerRole);
      const partnerEmpty = partner && !this.objects.some((object) => object.heldBy === partnerRole);
      if ((this.session || this.localHandoffs) && partner && partnerEmpty && this.canHandoff(drone, partner)) {
        if (!this.session) {
          const from = held.position.clone();
          held.grab(partnerRole);
          held.startHandoffArc(from, partner.position.add(HOLD_OFFSET), effectiveReducedMotion(getSettings()));
          return true;
        }
        if (this.canRequest(held.id)) {
          this.session.requestHandoff(held.id);
          this.pendingRequests.set(held.id, { revision: this.revisionOf(held.id), sentAt: performance.now() });
        }
        return true;
      }
      this.drop(role, drone);
      return true;
    }
    let nearest: Grabbable | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const object of this.objects) {
      // Never snatch what the partner is carrying (it made [E] near the carrier steal the prototype).
      if (object.heldBy) continue;
      const distance = object.distanceTo(drone.position);
      if (distance <= object.grabRadius && distance < nearestDistance) {
        nearest = object;
        nearestDistance = distance;
      }
    }
    if (!nearest) {
      if (!this.session) return false;
      let steal: Grabbable | null = null;
      let stealDistance = Number.POSITIVE_INFINITY;
      for (const object of this.objects) {
        if (!object.heldBy || object.heldBy === role) continue;
        const distance = object.distanceTo(drone.position);
        if (distance <= STEAL_RANGE && distance <= object.grabRadius && distance < stealDistance) {
          steal = object;
          stealDistance = distance;
        }
      }
      if (!steal || !this.canRequest(steal.id)) return false;
      if (role === this.localRole) {
        this.session.requestGrab(steal.id);
        this.pendingRequests.set(steal.id, { revision: this.revisionOf(steal.id), sentAt: performance.now() });
      }
      return true;
    }
    if (this.canGrab && !this.canGrab(nearest.id, role)) return false;
    if (this.session) {
      if (role === this.localRole && this.canRequest(nearest.id)) {
        this.session.requestGrab(nearest.id);
        this.pendingRequests.set(nearest.id, { revision: this.revisionOf(nearest.id), sentAt: performance.now() });
      }
    } else {
      nearest.grab(role);
      this.onGrab?.(nearest.id, role);
    }
    return true;
  }

  private aimTargets: () => readonly Vector3[] = () => [];

  handleThrow(role: DroneRole, drone: Drone): boolean {
    const held = this.objects.find((object) => object.heldBy === role);
    if (!held) return false;
    this.throwVelocity.copyFrom(drone.velocity);
    drone.getThrowDirection(this.aimDirection);
    this.assistAim(held.position);
    this.throwVelocity.addInPlace(this.aimDirection.scale(THROW_SPEED));
    this.throwVelocity.y += THROW_LIFT;
    this.placeForRelease(held, drone, this.aimDirection, true);
    this.release(role, held, this.releasePosition, this.throwVelocity, true);
    this.onThrow?.(held.id, role);
    return true;
  }

  /** Security targets (patrol pods, the camera lens) that throws gently home in on. */
  setAimTargets(provider: () => readonly Vector3[]): void {
    this.aimTargets = provider;
  }

  /** Bend the throw toward a security target roughly in front (generous cone, 22 m). */
  private assistAim(from: Vector3): void {
    let best: Vector3 | null = null;
    let bestDot = Math.cos(0.5);
    for (const target of this.aimTargets()) {
      const to = target.subtract(from);
      const distance = to.length();
      if (distance < 1 || distance > 22) continue;
      to.scaleInPlace(1 / distance);
      const dot = Vector3.Dot(to, this.aimDirection);
      if (dot > bestDot) { bestDot = dot; best = to; }
    }
    if (!best) return;
    // Aim a touch low: THROW_LIFT arcs it back up into the target.
    best.y -= 0.08;
    Vector3.LerpToRef(this.aimDirection, best, 0.8, this.aimDirection);
    this.aimDirection.normalize();
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    this.drones = drones;
    this.applyPendingHandoffs();
    this.cordSweep(dt, drones);
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

  /**
   * The cord is a tool: a fast-swept or taut cord knocks free props off desks and
   * shelves and drags them along. Only bodies this client simulates are pushed, so
   * the owner's physics replicates the result to the partner.
   */
  private cordSweep(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    const path = cordState.path;
    const pix = drones.get('pix');
    const nee = drones.get('nee');
    if (path.length < 2 || !pix || !nee) return;
    const live = cordState.sweep > 3 || cordState.strain > 0.35;
    for (const object of this.objects) {
      const cooldown = Math.max(0, (this.sweepCooldown.get(object.id) ?? 0) - dt);
      this.sweepCooldown.set(object.id, cooldown);
      if (!live || cooldown > 0 || !object.pushable) continue;
      const p = object.position;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 1; i < path.length; i++) {
        const d = closestOnSegment(p, path[i - 1], path[i], this.closest);
        if (d < best) best = d;
        if (d === best) this.sweepPush.copyFrom(this.closest);
      }
      if (best > object.collisionRadius + 0.3) continue;
      // Push: the cord's average travel, plus a shove out of the cord line and a little hop.
      const away = p.subtract(this.sweepPush);
      away.y = 0;
      if (away.lengthSquared() < 1e-4) away.set(0, 0, 1);
      away.normalize();
      this.sweepPush.copyFrom(pix.velocity).addInPlace(nee.velocity).scaleInPlace(0.5 * (object.heavy ? 0.12 : 0.85));
      this.sweepPush.addInPlace(away.scaleInPlace(object.heavy ? 0.6 : 2.6 + cordState.strain * 3));
      this.sweepPush.y = Math.max(this.sweepPush.y, object.heavy ? 0 : 1.6);
      if (object.nudge(this.sweepPush)) {
        this.sweepCooldown.set(object.id, 0.35);
        if (!object.heavy) gameEvents.emit('cord-knock', { id: object.id, position: p.clone() });
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

  releaseHeld(role: DroneRole): void {
    this.drop(role, this.drones.get(role) ?? null);
  }

  resetToCradle(id: string, position: Vector3): void {
    const object = this.objects.find((candidate) => candidate.id === id);
    object?.resetToCradle(position);
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

  isHaulingHeavy(role: DroneRole): boolean {
    return this.objects.some((object) => object.heldBy === role && object.heavy);
  }

  /** Queue the direct server event; the next gameplay update has the live drone poses. */
  handleObjectEvent(message: ObjectEventMessage): void {
    if (message.event === 'handoff') this.pendingHandoffs.push(message);
  }

  promptsFor(role: DroneRole, drone: Drone): string[] {
    const held = this.objects.find((object) => object.heldBy === role);
    const partnerRole = role === 'pix' ? 'nee' : 'pix';
    const partner = this.drones.get(partnerRole);
    const partnerEmpty = partner && !this.objects.some((object) => object.heldBy === partnerRole);
    if (held && (this.session || this.localHandoffs) && partner && partnerEmpty && this.canHandoff(drone, partner)) {
      return [`[E] Pass ${held.label}`, `[Q] Throw ${held.label}`];
    }
    if (held?.heavy && !held.helped) {
      return [`Too heavy. Fly it with ${role === 'pix' ? 'NEE' : 'PIX'}`, `[E] Drop ${held.label}`];
    }
    if (held) {
      const action = (this.session || this.localHandoffs) && partner && partnerEmpty && this.canHandoff(drone, partner)
        ? `[E] Pass ${held.label}` : `[E] Drop ${held.label}`;
      return [action, `[Q] Throw ${held.label}`];
    }
    let nearest: Grabbable | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const object of this.objects) {
      if (object.heldBy || (this.canGrab && !this.canGrab(object.id, role))) continue;
      const distance = object.distanceTo(drone.position);
      if (distance <= object.grabRadius && distance < nearestDistance) {
        nearest = object;
        nearestDistance = distance;
      }
    }
    if (nearest) return [`[E] Grab ${nearest.label}`];
    if (this.session) {
      const steal = this.objects.find((object) => object.heldBy && object.heldBy !== role && object.distanceTo(drone.position) <= Math.min(STEAL_RANGE, object.grabRadius));
      if (steal) return [`[E] Snatch ${steal.label}`];
    }
    return [];
  }

  private canHandoff(holder: Drone, partner: Drone): boolean {
    const result = canPass({
      holder: holder.position,
      holderYaw: facingYaw(holder.yaw),
      partner: partner.position,
    });
    return result.ok && this.hasLineOfSight(holder.position, partner.position);
  }

  /** Static physics meshes are the only blockers; drones and grabbables are deliberately ignored. */
  private hasLineOfSight(from: Vector3, to: Vector3): boolean {
    if (!this.scene?.pickWithRay) {
      // No cheap raycast is available in this scene, so passRules remains the gate.
      return true;
    }
    const direction = to.subtract(from);
    const length = direction.length();
    if (length <= Number.EPSILON) return true;
    direction.scaleInPlace(1 / length);
    const ray = new Ray(from, direction, length);
    const picked = this.scene.pickWithRay(ray, (mesh) => {
      if (!mesh.isEnabled() || !mesh.physicsBody || mesh.physicsBody.motionType !== PhysicsMotionType.STATIC) return false;
      if (this.objects.some((object) => mesh === object.mesh || mesh.isDescendantOf(object.mesh))) return false;
      return !/player-|drone|HoverPod_|Antenna|Face|TetherSocket|node9|DarkMetal|Glow|Accent|Shell|FaceRim|tether|ping/i.test(mesh.name);
    });
    return !picked?.hit;
  }

  private applyPendingHandoffs(): void {
    while (this.pendingHandoffs.length > 0) {
      const event = this.pendingHandoffs.shift()!;
      const object = this.objects.find((candidate) => candidate.id === event.objectId);
      const from = this.drones.get(event.from as DroneRole);
      const to = this.drones.get(event.to as DroneRole);
      if (!object || !from || !to) continue;
      object.startHandoffArc(
        from.position.add(HOLD_OFFSET),
        to.position.add(HOLD_OFFSET),
        effectiveReducedMotion(getSettings()),
      );
    }
  }

  private revisionOf(id: string): number {
    return this.objects.find((object) => object.id === id)?.networkRevision ?? -1;
  }

  private canRequest(id: string): boolean {
    const pending = this.pendingRequests.get(id);
    return !pending || performance.now() - pending.sentAt >= 400;
  }

  dispose(): void {
    for (const object of this.objects) object.dispose();
  }

  private drop(role: DroneRole, drone: Drone | null): void {
    const held = this.objects.find((object) => object.heldBy === role);
    if (!held) return;
    if (!drone) {
      this.release(role, held, held.position.clone(), Vector3.Zero(), false);
      return;
    }
    this.throwVelocity.copyFrom(drone.velocity);
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

function closestOnSegment(point: Vector3, a: Vector3, b: Vector3, out: Vector3): number {
  const sx = b.x - a.x, sy = b.y - a.y, sz = b.z - a.z;
  const len2 = sx * sx + sy * sy + sz * sz;
  let t = len2 < 1e-6 ? 0 : ((point.x - a.x) * sx + (point.y - a.y) * sy + (point.z - a.z) * sz) / len2;
  t = Math.max(0, Math.min(1, t));
  out.set(a.x + sx * t, a.y + sy * t, a.z + sz * t);
  return Vector3.Distance(point, out);
}
