import {
  Color3,
  CreateCylinder,
  CreateSphere,
  CreateTorus,
  StandardMaterial,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import type { GameAudio } from '../audio/GameAudio.ts';
import type { DroneRole, SecurityNetworkState } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import type { RunLayout } from '../seed/index.ts';
import { cordState } from './Tether.ts';
import { gameEvents } from './GameEvents.ts';
import { audio } from '../audio/AudioManager.ts';
import { SecurityEmote, type SecurityMood } from './SecurityEmote.ts';

const CAMERA_RANGE = 10;
const CAMERA_HALF_ANGLE = Math.PI / 5;
/** Patrol readability: '?' inside SUSPECT_RANGE, '!' (with a short alert beat) inside CHASE_RANGE. */
const SUSPECT_RANGE = 13;
const CHASE_RANGE = 9;
const ALERT_BEAT = 0.45;
/** Capture-and-carry: never a game over; the partner yanks you free (or struggle / throw). */
const CARRY_POINT = new Vector3(0, 3.5, 10);
const CARRY_MAX = 4.5;
/** Route checks (?autotest) skip captures unless they opt in with &capture. */
const CAPTURE_ENABLED = typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('autotest')
  || new URLSearchParams(window.location.search).has('capture');
const CAMERA_BLIND = 8;

const SECURITY_AMBER = Color3.FromHexString('#FFB84D');
const CAMERA_BODY_EMISSIVE_ACTIVE = SECURITY_AMBER.scale(0.3);
const CAMERA_BODY_EMISSIVE_DISABLED = new Color3(0.05, 0.05, 0.05);
const CAMERA_CONE_EMISSIVE = SECURITY_AMBER.scale(0.35);
const DRONE_BODY_EMISSIVE = new Color3(0.04, 0.04, 0.04);
const DRONE_EYE_STUNNED = new Color3(0.18, 0.18, 0.18);

interface SecurityCallbacks {
  onSpotted: (role: DroneRole) => void;
  /** Multiplayer: route a clothesline through the server instead of stunning locally. */
  requestStun?: (index: number, position: Vector3) => void;
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
  private range = CAMERA_RANGE;
  private halfAngle = CAMERA_HALF_ANGLE;
  private detectionRateScale = 1;
  private blindFor = 0;
  private readonly emote: SecurityEmote;

  constructor(scene: Scene) {
    this.body = CreateSphere('security-camera', { diameter: 0.75, segments: 12 }, scene);
    this.body.position.copyFrom(this.origin);
    const bodyMaterial = new StandardMaterial('security-camera-material', scene);
    bodyMaterial.diffuseColor = new Color3(0.12, 0.16, 0.18);
    bodyMaterial.emissiveColor.copyFrom(CAMERA_BODY_EMISSIVE_ACTIVE);
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
    this.coneMaterial.diffuseColor.copyFrom(SECURITY_AMBER);
    this.coneMaterial.emissiveColor.copyFrom(CAMERA_CONE_EMISSIVE);
    this.coneMaterial.alpha = 0.16;
    this.coneMaterial.backFaceCulling = false;
    this.cone.material = this.coneMaterial;
    this.cone.isPickable = false;
    this.emote = new SecurityEmote(scene, this.body, 'security-camera');
  }

  /** Apply primary camera placement from a RunLayout. */
  applyPlacement(origin: Vector3, forward: Vector3, range: number, halfAngle: number, detectionRateScale = 1): void {
    this.origin.copyFrom(origin);
    this.forward.copyFrom(forward).normalize();
    this.range = range;
    this.halfAngle = halfAngle;
    this.detectionRateScale = detectionRateScale;
    this.body.position.copyFrom(this.origin);
    this.cone.scaling.y = range / CAMERA_RANGE;
    this.cone.scaling.x = (range * Math.tan(halfAngle)) / (CAMERA_RANGE * Math.tan(CAMERA_HALF_ANGLE));
    this.cone.scaling.z = this.cone.scaling.x;
    this.cone.position.copyFrom(this.origin).addInPlace(this.forward.scale(range / 2));
  }

  setDisabled(disabled: boolean): void {
    if (disabled && !this.disabled) audio.play('cameraBlind');
    this.disabled = disabled;
    this.cone.setEnabled(!disabled && this.blindFor <= 0);
    const material = this.body.material as StandardMaterial;
    material.emissiveColor.copyFrom(disabled ? CAMERA_BODY_EMISSIVE_DISABLED : CAMERA_BODY_EMISSIVE_ACTIVE);
  }

  update(
    dt: number,
    drones: ReadonlyMap<DroneRole, Drone>,
    onSpotted: (role: DroneRole) => void,
    hasFastObjectNear: (point: Vector3, radius: number) => boolean,
  ): number {
    this.alertCooldown = Math.max(0, this.alertCooldown - dt);
    // A thrown prop smacking the lens blinds the camera for a while.
    if (!this.disabled && this.blindFor <= 0 && hasFastObjectNear(this.origin, 1.7)) {
      this.blindFor = CAMERA_BLIND;
      gameEvents.emit('camera-blind', { position: this.origin.clone() });
    }
    const wasBlind = this.blindFor > 0;
    this.blindFor = Math.max(0, this.blindFor - dt);
    if (wasBlind) this.cone.setEnabled(!this.disabled && this.blindFor <= 0);
    this.body.rotation.y = this.blindFor > 0 ? Math.sin(performance.now() / 90) * 0.25 : 0;
    const blind = this.disabled || this.blindFor > 0;
    let highest = 0;
    for (const [role, drone] of drones) {
      const relative = drone.position.subtract(this.origin);
      const distance = relative.length();
      const inside = !blind && distance < this.range && distance > 0.1 &&
        Vector3.Dot(relative.scale(1 / distance), this.forward) > Math.cos(this.halfAngle);
      const next = Math.max(0, Math.min(1, (this.meters.get(role) ?? 0) + dt * (inside ? 0.72 * this.detectionRateScale : -1.2)));
      this.meters.set(role, next);
      highest = Math.max(highest, next);
      if (next >= 1 && this.alertCooldown <= 0) {
        onSpotted(role);
        this.alertCooldown = 3;
        this.meters.set(role, 0.35);
      }
    }
    this.coneMaterial.alpha = 0.11 + highest * 0.24;
    const mood: SecurityMood = this.disabled ? 'off' : this.blindFor > 0 ? 'stunned'
      : highest > 0.6 ? 'chase' : highest > 0.08 ? 'suspicious' : 'patrol';
    this.emote.set(mood);
    this.emote.update(dt);
    return highest;
  }

  get aimPoint(): Vector3 | null {
    return this.disabled || this.blindFor > 0 ? null : this.origin;
  }

  get blinded(): boolean {
    return this.blindFor > 0;
  }

  /** Multiplayer: the server owns the meters; only present them. */
  present(highest: number): number {
    this.coneMaterial.alpha = 0.11 + highest * 0.24;
    this.emote.set(this.disabled ? 'off' : highest > 0.6 ? 'chase' : highest > 0.08 ? 'suspicious' : 'patrol');
    this.emote.update(1 / 60);
    return highest;
  }

  dispose(): void {
    this.emote.dispose();
    this.body.material?.dispose();
    this.coneMaterial.dispose();
    this.body.dispose();
    this.cone.dispose();
  }
}

class PatrolDrone {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly eyeMaterial: StandardMaterial;
  private readonly velocity = new Vector3();
  private stunnedFor = 0;
  private shoveCooldown = 0;
  private phase: number;
  private readonly index: number;
  private requested = 0;
  private waypoints: Vector3[] = [];
  private waypointIndex = 0;
  private patrolSpeed = 3.1;
  private readonly emote: SecurityEmote;
  private mood: SecurityMood = 'off';
  private alertBeat = 0;
  private carrying: Drone | null = null;
  private carryFor = 0;
  private strainFor = 0;
  private captureCooldown = 0;
  private dazedFor = 0;

  constructor(scene: Scene, index: number) {
    this.phase = index * Math.PI;
    this.index = index;
    // Morrow building-security unit: squat aluminium pod, rotor guard ring, red sensor bar.
    this.mesh = CreateSphere(`security-drone-${index}`, { diameter: 1.35, segments: 14 }, scene);
    this.mesh.scaling.y = 0.62;
    const shell = new StandardMaterial(`security-drone-${index}-shell`, scene);
    shell.diffuseColor = new Color3(0.72, 0.74, 0.76); shell.specularColor = new Color3(0.5, 0.5, 0.5);
    const guard = CreateTorus(`security-drone-${index}-guard`, { diameter: 1.9, thickness: 0.12, tessellation: 32 }, scene);
    guard.parent = this.mesh; guard.material = shell; guard.isPickable = false;
    const cap = CreateCylinder(`security-drone-${index}-cap`, { height: 0.3, diameterTop: 0.7, diameterBottom: 1.05, tessellation: 24 }, scene);
    cap.parent = this.mesh; cap.position.y = 0.62; cap.material = shell; cap.isPickable = false;
    this.mesh.position.set(index === 0 ? -4 : 4, 2.2, 10 + index * 3);
    this.material = new StandardMaterial(`security-drone-${index}-material`, scene);
    this.material.diffuseColor = new Color3(0.16, 0.19, 0.21);
    this.material.emissiveColor.copyFrom(DRONE_BODY_EMISSIVE);
    this.mesh.material = this.material;
    this.eyeMaterial = new StandardMaterial(`security-drone-${index}-eye-material`, scene);
    this.eyeMaterial.disableLighting = true;
    this.eyeMaterial.emissiveColor.copyFrom(SECURITY_AMBER);
    const eye = CreateCylinder(`security-drone-${index}-eye`, { height: 0.5, diameter: 0.16, tessellation: 12 }, scene);
    eye.parent = this.mesh; eye.rotation.z = Math.PI / 2; eye.position.set(0, 0, 0.66); eye.material = this.eyeMaterial;
    eye.isPickable = false;
    this.emote = new SecurityEmote(scene, this.mesh, `security-drone-${index}`);
    this.mesh.setEnabled(false);
  }

  /** Let go of a carried drone. `freedBy` explains why (for the toast + juice). */
  private release(freedBy: 'yank' | 'struggle' | 'strain' | 'stun' | 'timeout'): void {
    const drone = this.carrying;
    if (!drone) return;
    drone.setCaptured(null);
    this.carrying = null;
    this.captureCooldown = 3;
    this.dazedFor = freedBy === 'stun' ? 0 : 1.1;
    if (freedBy !== 'timeout') {
      const kick = drone.position.subtract(this.mesh.position); kick.y = 0;
      if (kick.lengthSquared() > 0.01) this.mesh.position.subtractInPlace(kick.normalize().scale(0.8));
    }
    gameEvents.emit('capture', { droneId: drone.id, position: drone.position.clone(), freed: true });
  }

  private setMood(mood: SecurityMood, dt: number): void {
    this.mood = mood;
    this.emote.set(mood);
    this.emote.update(dt);
  }

  /** Authoritative stun (server broadcast in multiplayer, or local in solo). */
  stun(at?: Vector3): void {
    this.release('stun');
    this.stunnedFor = 3.4;
    if (at) this.mesh.position.copyFrom(at);
    audio.play('stun', { position: this.mesh.position });
    gameEvents.emit('clothesline', { position: this.mesh.position.clone() });
  }

  get position(): Vector3 { return this.mesh.position; }

  applyRoute(waypoints: { x: number; y: number; z: number }[], speed: number): void {
    this.waypoints = waypoints.map((w) => new Vector3(w.x, w.y, w.z));
    this.waypointIndex = 0;
    this.patrolSpeed = speed;
    if (this.waypoints[0]) this.mesh.position.copyFrom(this.waypoints[0]);
  }

  /**
   * Multiplayer: the server owns position and stun. Ease toward the latest server sample
   * (patches arrive at ~20 Hz; patrols move 3.1 u/s, so the visual lag stays under ~0.3 u).
   * The local clothesline check still runs, but only to *propose* a stun to the server.
   */
  updateNetworked(
    dt: number,
    elapsed: number,
    active: boolean,
    server: { x: number; y: number; z: number; stunned: boolean } | undefined,
    drones: ReadonlyMap<DroneRole, Drone>,
    callbacks: SecurityCallbacks,
    tetherStrain: number,
  ): void {
    this.mesh.setEnabled(active);
    if (!server) return;
    const dx = server.x - this.mesh.position.x;
    const dy = server.y - this.mesh.position.y;
    const dz = server.z - this.mesh.position.z;
    if (!active || dx * dx + dy * dy + dz * dz > 36) {
      this.mesh.position.set(server.x, server.y, server.z);
    } else {
      const k = 1 - Math.exp(-dt * 14);
      this.mesh.position.set(this.mesh.position.x + dx * k, this.mesh.position.y + dy * k, this.mesh.position.z + dz * k);
    }
    if (!active) return;
    // Presentation-only mood: the server decides stuns and hits, the face just reads the room.
    let nearest = Number.POSITIVE_INFINITY;
    for (const drone of drones.values()) nearest = Math.min(nearest, Vector3.Distance(drone.position, this.mesh.position));
    this.emote.set(server.stunned ? 'stunned' : nearest < CHASE_RANGE ? 'chase' : nearest < SUSPECT_RANGE ? 'suspicious' : 'patrol');
    this.emote.update(dt);
    if (server.stunned) {
      this.eyeMaterial.emissiveColor.copyFrom(DRONE_EYE_STUNNED);
      this.mesh.rotation.z += dt * 7;
      return;
    }
    this.mesh.rotation.z = 0;
    this.eyeMaterial.emissiveColor.copyFrom(SECURITY_AMBER);
    if (callbacks.requestStun && this.cordCrosses(drones, tetherStrain) && Math.abs(elapsed - this.requested) > 0.6) {
      this.requested = elapsed;
      callbacks.requestStun(this.index, this.mesh.position.clone());
    }
  }

  private cordCrosses(drones: ReadonlyMap<DroneRole, Drone>, tetherStrain: number): boolean {
    const pix = drones.get('pix');
    const nee = drones.get('nee');
    if (!pix || !nee || !(tetherStrain > 0.2 || cordState.sweep > 6)) return false;
    const path = cordState.path;
    if (path.length > 1) {
      for (let i = 1; i < path.length; i++) {
        if (distanceToSegment(this.mesh.position, path[i - 1], path[i]) < 0.85) return true;
      }
      return false;
    }
    return distanceToSegment(this.mesh.position, pix.position, nee.position) < 0.85;
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
    if (!active) {
      this.release('timeout');
      this.mood = 'off';
      return;
    }
    this.stunnedFor = Math.max(0, this.stunnedFor - dt);
    this.shoveCooldown = Math.max(0, this.shoveCooldown - dt);
    this.captureCooldown = Math.max(0, this.captureCooldown - dt);
    this.dazedFor = Math.max(0, this.dazedFor - dt);
    if (this.stunnedFor > 0) {
      this.eyeMaterial.emissiveColor.copyFrom(DRONE_EYE_STUNNED);
      this.mesh.rotation.z += dt * 7;
      this.setMood('stunned', dt);
      return;
    }
    this.eyeMaterial.emissiveColor.copyFrom(SECURITY_AMBER);
    this.mesh.rotation.z *= Math.max(0, 1 - dt * 8);
    if (callbacks.hasFastObjectNear(this.mesh.position, 1.65)) {
      this.release('stun');
      this.stunnedFor = 3.2;
      audio.play('stun', { position: this.mesh.position });
      gameEvents.emit('toast', { text: 'BONK!', tone: 'good' });
      return;
    }
    if (this.carrying) {
      this.updateCarry(dt, tetherStrain);
      if (this.carrying) { this.setMood('carrying', dt); return; }
    }
    const roles = [...drones.entries()];
    const nearest = roles.sort((a, b) =>
      Vector3.DistanceSquared(a[1].position, this.mesh.position) -
      Vector3.DistanceSquared(b[1].position, this.mesh.position))[0];
    let target: Vector3;
    if (this.waypoints.length > 0) {
      const wp = this.waypoints[this.waypointIndex % this.waypoints.length]!;
      if (Vector3.Distance(this.mesh.position, wp) < 0.85) {
        this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
      }
      target = this.waypoints[this.waypointIndex % this.waypoints.length]!.clone();
    } else {
      target = new Vector3(Math.sin(elapsed * 0.55 + this.phase) * 5, 2.2, 10 + Math.cos(elapsed * 0.55 + this.phase) * 4);
    }
    const range = nearest ? Vector3.Distance(nearest[1].position, this.mesh.position) : Infinity;
    let speed = this.patrolSpeed;
    let mood: SecurityMood = 'patrol';
    if (this.dazedFor > 0) {
      mood = 'stunned'; speed = 0.6;
    } else if (nearest && range < CHASE_RANGE) {
      // '!' beat: freeze for a moment when we first notice, then give chase.
      if (this.mood !== 'chase') this.alertBeat = ALERT_BEAT;
      mood = 'chase';
      target = nearest[1].position;
    } else if (nearest && range < SUSPECT_RANGE) {
      // '?': drift toward the noise, slowly.
      mood = 'suspicious';
      target = Vector3.Lerp(target, nearest[1].position, 0.5);
      speed = Math.min(1.6, this.patrolSpeed);
    }
    this.setMood(mood, dt);
    this.alertBeat = Math.max(0, this.alertBeat - dt);
    if (this.alertBeat > 0) {
      this.mesh.position.y += Math.sin(this.alertBeat * 40) * 0.02; // little startle hop
      speed = 0;
    }
    this.velocity.copyFrom(target).subtractInPlace(this.mesh.position);
    if (this.velocity.lengthSquared() > 0.05) this.velocity.normalize().scaleInPlace(speed);
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
        const away = this.mesh.position.subtract(pix.position.add(nee.position).scale(0.5));
        away.y = 0;
        if (away.lengthSquared() > 0.01) this.mesh.position.addInPlace(away.normalize().scale(1.2));
        this.mesh.position.y = Math.max(0.8, this.mesh.position.y - 0.6);
        if (callbacks.requestStun) {
          // Wait for the server's verdict; avoid spamming while the cord stays across us.
          if (Math.abs(elapsed - this.requested) > 0.6) { this.requested = elapsed; callbacks.requestStun(this.index, this.mesh.position.clone()); }
        } else this.stun();
        return;
      }
    }
    if (nearest && this.alertBeat <= 0 && this.dazedFor <= 0 && range < 1.55) {
      const victim = nearest[1];
      if (CAPTURE_ENABLED && this.captureCooldown <= 0 && !victim.isCaptured) {
        // GOTCHA: grab and start hauling toward the lab holding pen.
        this.carrying = victim;
        this.carryFor = 0;
        this.strainFor = 0;
        victim.struggles = 0;
        victim.setCaptured(Vector3.Zero());
        gameEvents.emit('capture', { droneId: victim.id, position: victim.position.clone(), freed: false });
      } else if (this.shoveCooldown <= 0) {
        const shove = victim.position.subtract(this.mesh.position).normalize().scaleInPlace(4.2);
        shove.y = 1.2;
        victim.knockback(shove);
        this.shoveCooldown = 1.2;
      }
    }
  }

  private updateCarry(dt: number, tetherStrain: number): void {
    const drone = this.carrying!;
    this.carryFor += dt;
    this.strainFor = tetherStrain > 0.85 ? this.strainFor + dt : 0;
    if (drone.yankedRecently > 0) return this.release('yank');
    if (drone.struggles >= 3) return this.release('struggle');
    if (this.strainFor > 0.6) return this.release('strain');
    if (this.carryFor > CARRY_MAX) return this.release('timeout');
    const to = CARRY_POINT.subtract(this.mesh.position);
    if (to.lengthSquared() > 0.2) this.mesh.position.addInPlace(to.normalize().scale(2.2 * dt));
    // Hang the captive just under the pod; the drone's own steer follows this pull.
    const hold = this.mesh.position.add(new Vector3(0, -0.95, 0));
    const pull = hold.subtract(drone.position).scaleInPlace(6);
    if (pull.length() > 9) pull.normalize().scaleInPlace(9);
    drone.setCaptured(pull);
    this.mesh.rotation.z = Math.sin(this.carryFor * 9) * 0.12; // straining wobble
  }

  get isCarrying(): boolean { return this.carrying !== null; }

  get captiveId(): string | null { return this.carrying?.id ?? null; }

  /** Throw-assist target while this pod is active and not already knocked out. */
  get aimPoint(): Vector3 | null {
    return this.mesh.isEnabled() && this.stunnedFor <= 0 ? this.mesh.position : null;
  }

  get currentMood(): SecurityMood { return this.mood; }

  dispose(): void {
    this.release('timeout');
    this.emote.dispose();
    this.material.dispose();
    this.eyeMaterial.dispose();
    this.mesh.dispose();
  }
}

/** Readable, non-lethal camera and patrol-drone hazards for the heist slice. */
export class SecuritySystem {
  private readonly camera: SecurityCamera;
  private readonly patrols: PatrolDrone[];
  private readonly scene: Scene;
  private elapsed = 0;
  private warningCooldown = 0;
  private lastNetworkedAt = 0;
  private readonly callbacks: SecurityCallbacks;
  private readonly audio?: GameAudio;
  detection = 0;

  constructor(
    scene: Scene,
    callbacks: SecurityCallbacks,
    audio?: GameAudio,
  ) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.audio = audio;
    this.camera = new SecurityCamera(scene);
    this.patrols = [new PatrolDrone(scene, 0), new PatrolDrone(scene, 1)];
    (globalThis as { __security?: SecuritySystem }).__security = this; // test/debug probe
  }

  /** Solo: apply patrol routes + primary camera from generateRun. */
  applyRunLayout(layout: RunLayout): void {
    const routes = layout.patrolRoutes;
    while (this.patrols.length < routes.length) {
      this.patrols.push(new PatrolDrone(this.scene, this.patrols.length));
    }
    while (this.patrols.length > Math.max(2, routes.length)) {
      this.patrols.pop()?.dispose();
    }
    for (let i = 0; i < this.patrols.length; i++) {
      const route = routes[i] ?? routes[i % Math.max(1, routes.length)];
      if (route) this.patrols[i]!.applyRoute(route.waypoints, route.speed);
    }
    const cam = layout.cameras[0];
    if (cam) {
      this.camera.applyPlacement(
        new Vector3(cam.origin.x, cam.origin.y, cam.origin.z),
        new Vector3(cam.forward.x, cam.forward.y, cam.forward.z),
        cam.range,
        cam.sweepAngle,
        layout.escalation.detectionRateScale,
      );
    }
  }

  remoteStun(index: number, at: Vector3): void { this.patrols[index]?.stun(at); }

  /** TEST/DEBUG: rendered patrol positions. */
  patrolPositions(): { x: number; y: number; z: number }[] {
    return this.patrols.map((patrol) => ({ x: patrol.position.x, y: patrol.position.y, z: patrol.position.z }));
  }

  /**
   * Multiplayer: present server-owned security. No local detection, stuns or shoves happen here;
   * spotted/shove outcomes arrive as server messages.
   */
  updateNetworked(
    dt: number,
    drones: ReadonlyMap<DroneRole, Drone>,
    securityActive: boolean,
    server: SecurityNetworkState,
    tetherStrain: number,
    sharedClock: number,
  ): void {
    this.elapsed = sharedClock;
    this.warningCooldown = Math.max(0, this.warningCooldown - dt);
    this.camera.setDisabled(server.cameraDisabled);
    this.detection = this.camera.present(Math.max(server.detection.pix, server.detection.nee));
    if (this.detection > 0.55 && this.warningCooldown <= 0) {
      this.audio?.warning();
      this.warningCooldown = 0.75;
    }
    // Ease with wall-clock time: the game loop clamps dt to 50 ms, which would make the
    // patrols trail the server badly whenever the frame rate drops.
    const now = performance.now();
    const wallDt = this.lastNetworkedAt ? Math.min(0.5, (now - this.lastNetworkedAt) / 1000) : dt;
    this.lastNetworkedAt = now;
    this.patrols.forEach((patrol, index) => {
      patrol.updateNetworked(wallDt, this.elapsed, securityActive, server.patrols[index], drones, this.callbacks, tetherStrain);
    });
  }

  update(
    dt: number,
    drones: ReadonlyMap<DroneRole, Drone>,
    securityActive: boolean,
    cameraDisabled: boolean,
    tetherStrain: number,
    sharedClock?: number,
  ): void {
    // Multiplayer: patrol routes follow the server's mission clock so both clients agree.
    this.elapsed = sharedClock ?? this.elapsed + dt;
    this.warningCooldown = Math.max(0, this.warningCooldown - dt);
    this.camera.setDisabled(cameraDisabled);
    this.detection = this.camera.update(dt, drones, this.callbacks.onSpotted, this.callbacks.hasFastObjectNear);
    if (this.detection > 0.55 && this.warningCooldown <= 0) {
      this.audio?.warning();
      this.warningCooldown = 0.75;
    }
    for (const patrol of this.patrols) {
      patrol.update(dt, this.elapsed, securityActive, drones, this.callbacks, tetherStrain);
    }
  }

  /** Where assisted throws should home in (active patrols, a watching camera). */
  aimTargets(): Vector3[] {
    return [this.camera.aimPoint, ...this.patrols.map((p) => p.aimPoint)].filter((p): p is Vector3 => p !== null);
  }

  /** Readable state for tests and the HUD. */
  get debug(): { camera: boolean; patrols: SecurityMood[]; carrying: boolean; captive: string | null; aimTargets: number } {
    return {
      camera: this.camera.blinded,
      patrols: this.patrols.map((p) => p.currentMood),
      carrying: this.patrols.some((p) => p.isCarrying),
      captive: this.patrols.find((p) => p.captiveId)?.captiveId ?? null,
      aimTargets: this.aimTargets().length,
    };
  }

  dispose(): void {
    const probe = globalThis as { __security?: SecuritySystem };
    if (probe.__security === this) delete probe.__security;
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
