import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { audio } from '../audio/AudioManager.ts';
import { initialTier } from '../scene/Quality.ts';
import { effectiveReducedMotion, getSettings } from '../ui/Settings.ts';

/**
 * Slow-mo escape replay: a ring buffer of the last ~6 s of drone / loot / tether transforms, replayed
 * as a letterboxed cinematic after a successful heist (or Night Shift floor clear) before the report.
 * Purely local: each co-op client replays its own buffer, so no netcode is involved.
 */

/** A drone as the replay sees it: physics root (position) plus the banked visual (euler rotation). */
export interface ReplayDrone { readonly root: TransformNode; readonly visualRoot: TransformNode }

export interface ReplayActors {
  scene: Scene;
  camera: FreeCamera;
  drones: readonly ReplayDrone[];
  /** Grabbables (loot, crates, desk toys): position + rotationQuaternion. */
  props: readonly TransformNode[];
  /** Redraws the cord between the (replayed) drone positions. */
  redrawTether: () => void;
  /** Called after transforms are restored so the gameplay camera can re-snap. */
  onRestored: () => void;
  /** HUD parent for the letterbox overlay. */
  uiParent: HTMLElement;
}

export interface ReplayPlayOptions {
  onDone: () => void;
  /** Night Shift floor clear: subline under the stamp. */
  subline?: string;
  /** Report "Watch replay": play even under reduced motion (a short, static-camera cut). */
  manual?: boolean;
}

const BUFFER_SECONDS = 6;
/** Real seconds of footage that end the replay (the final approach + extraction). */
const WINDOW_SECONDS = 2.4;
/** Playback length: ~1x at the start easing to ~0.35x on the extraction beat. */
const PLAY_SECONDS = 3.6;
const PLAY_SECONDS_LOW = 3.0;
const PLAY_SECONDS_REDUCED = 1.6;
const SKIP_ARM_MS = 250;
/** Floats per node per frame: position xyz + rotation (quat xyzw, or euler xyz + pad for drone visuals). */
const STRIDE = 7;

const isFiniteNum = (n: number) => Number.isFinite(n);

class EscapeReplayController {
  private actors: ReplayActors | null = null;
  private nodeCount = 0;
  private capacity = 0;
  private hz = 30;
  private data = new Float32Array(0);
  private times = new Float64Array(0);
  private head = 0;
  private count = 0;
  private lastSample = -Infinity;
  private freezeAt: number | null = null;
  private frozen = false;

  private playing = false;
  private elapsed = 0;
  private duration = PLAY_SECONDS;
  private staticCamera = false;
  private windowStart = 0;
  private windowEnd = 0;
  private onDone: (() => void) | null = null;
  private overlay: HTMLElement | null = null;
  private stampShown = false;
  private armedAt = 0;
  private restore: Float32Array | null = null;
  private cameraRestore: { pos: Vector3; target: Vector3; fov: number } | null = null;
  private orbitStart = 0;
  private orbitRadius = 10;
  private orbitHeight = 5;
  private gamepadHeld = new Set<string>();
  private readonly centroid = new Vector3();
  private readonly tmp = new Vector3();
  private readonly ray = new Ray(new Vector3(), new Vector3(0, 1, 0), 1);
  private readonly excluded = new Set<TransformNode>();
  private camDist = 0;
  private readonly onSkipKey = (e: KeyboardEvent) => this.inputSkip(e);
  private readonly onSkipPointer = (e: PointerEvent) => this.inputSkip(e);

  /** GameApp registers the live actors once the scene is built. */
  attach(actors: ReplayActors): void {
    this.detach();
    this.actors = actors;
    this.nodeCount = actors.drones.length + actors.props.length;
    this.hz = initialTier() === 'low' ? 15 : 30;
    this.capacity = Math.ceil(BUFFER_SECONDS * this.hz) + 2;
    this.data = new Float32Array(this.capacity * this.nodeCount * STRIDE);
    this.times = new Float64Array(this.capacity);
    this.reset();
  }

  detach(): void {
    if (this.playing) this.finish(false);
    this.actors = null;
    this.nodeCount = 0;
    this.count = 0;
  }

  /** New attempt (stage back to infiltrate / restart): drop old footage and resume recording. */
  reset(): void {
    this.head = 0;
    this.count = 0;
    this.lastSample = -Infinity;
    this.freezeAt = null;
    this.frozen = false;
  }

  get active(): boolean { return this.playing; }
  get hasFootage(): boolean { return this.actors !== null && this.count >= Math.max(6, this.hz * 0.6); }

  /** Stop recording `afterMs` from now (the extraction beat), so later replays end on it. */
  markEnd(afterMs = 400): void {
    if (this.frozen) return;
    this.freezeAt = performance.now() + afterMs;
  }

  /** Called every gameplay tick after physics. Cheap: one fixed-rate sample into a preallocated ring. */
  record(now = performance.now()): void {
    const a = this.actors;
    if (!a || this.playing || this.frozen) return;
    if (this.freezeAt !== null && now >= this.freezeAt) { this.frozen = true; return; }
    if (now - this.lastSample < 1000 / this.hz - 1) return;
    this.lastSample = now;
    this.writeNodes(this.data, this.head * this.nodeCount * STRIDE);
    this.times[this.head] = now / 1000;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /**
   * Play the replay; returns false (and never calls onDone) when there is nothing to show
   * or reduced motion skips the automatic replay. If already playing, the new onDone replaces the old.
   */
  play(options: ReplayPlayOptions): boolean {
    const a = this.actors;
    if (this.playing) { this.onDone = options.onDone; return true; }
    if (!a || !this.hasFootage) return false;
    const reduced = effectiveReducedMotion(getSettings());
    if (reduced && !options.manual) return false;
    this.frozen = true;

    const newest = this.times[(this.head - 1 + this.capacity) % this.capacity];
    const oldest = this.times[(this.head - this.count + this.capacity) % this.capacity];
    this.windowEnd = newest;
    this.windowStart = Math.max(oldest, newest - WINDOW_SECONDS);
    this.staticCamera = reduced;
    this.duration = reduced ? PLAY_SECONDS_REDUCED : initialTier() === 'low' ? PLAY_SECONDS_LOW : PLAY_SECONDS;
    this.elapsed = 0;
    this.onDone = options.onDone;
    this.stampShown = false;

    this.restore = new Float32Array(this.nodeCount * STRIDE);
    this.writeNodes(this.restore, 0);
    const cam = a.camera;
    this.cameraRestore = { pos: cam.position.clone(), target: cam.getTarget().clone(), fov: cam.fov };
    this.sampleCentroidAt(this.windowEnd);
    this.orbitStart = Math.atan2(cam.position.x - this.centroid.x, cam.position.z - this.centroid.z);
    this.orbitRadius = Math.max(4, Math.hypot(cam.position.x - this.centroid.x, cam.position.z - this.centroid.z));
    this.orbitHeight = Math.max(1.5, cam.position.y - this.centroid.y);
    this.camDist = 0;
    this.excluded.clear();
    for (const d of this.actors!.drones) for (const m of d.root.getChildMeshes(false)) this.excluded.add(m);
    for (const m of this.actors!.props) this.excluded.add(m);
    a.scene.physicsEnabled = false;

    this.overlay = this.buildOverlay(a.uiParent, options.subline, reduced);
    this.playing = true;
    this.armedAt = performance.now() + SKIP_ARM_MS;
    this.gamepadHeld = this.pressedPads();
    window.addEventListener('keydown', this.onSkipKey, true);
    window.addEventListener('pointerdown', this.onSkipPointer, true);
    audio.play('replayDrop');
    this.update(0);
    return true;
  }

  /** Any input ends the replay. */
  skip(): void { if (this.playing) this.finish(true); }

  /** Per-frame while active (GameApp skips the simulation). realDt in seconds. */
  update(realDt: number): void {
    const a = this.actors;
    if (!this.playing || !a) return;
    this.elapsed += realDt;
    if (this.pollPads()) { this.skip(); return; }
    const p = Math.min(1, this.elapsed / this.duration);
    // Speed ramps linearly from vStart to vEnd (in source seconds per real second); integrate for position.
    const span = this.windowEnd - this.windowStart;
    const vStart = 1;
    const vEnd = Math.max(0.05, (2 * span) / this.duration - vStart);
    const t = this.elapsed > this.duration ? this.duration : this.elapsed;
    const covered = vStart * t + 0.5 * ((vEnd - vStart) / this.duration) * t * t;
    const source = Math.min(this.windowEnd, this.windowStart + covered);
    this.applyAt(source);
    a.redrawTether();
    this.driveCamera(p);
    if (!this.stampShown && p > 0.42) {
      this.stampShown = true;
      this.overlay?.classList.add('escape-replay--stamp');
    }
    if (this.elapsed >= this.duration + 0.35) this.finish(true);
  }

  // ------------------------------------------------------------------ internals

  private finish(callDone: boolean): void {
    const a = this.actors;
    this.playing = false;
    window.removeEventListener('keydown', this.onSkipKey, true);
    window.removeEventListener('pointerdown', this.onSkipPointer, true);
    this.overlay?.remove();
    this.overlay = null;
    document.body.classList.remove('escape-replay-on');
    if (a && this.restore) {
      this.readNodes(this.restore, 0, null, 0, 0);
      a.redrawTether();
      if (this.cameraRestore) {
        a.camera.position.copyFrom(this.cameraRestore.pos);
        a.camera.setTarget(this.cameraRestore.target);
        a.camera.fov = this.cameraRestore.fov;
      }
      a.scene.physicsEnabled = true;
      a.onRestored();
    }
    this.restore = null;
    const done = this.onDone;
    this.onDone = null;
    if (callDone) done?.();
  }

  private inputSkip(e: Event): void {
    if (!this.playing || performance.now() < this.armedAt) return;
    if (e instanceof KeyboardEvent && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key))) return;
    e.preventDefault();
    e.stopPropagation();
    this.skip();
  }

  private pressedPads(): Set<string> {
    const held = new Set<string>();
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      pad.buttons.forEach((b, i) => { if (b.pressed) held.add(`${pad.index}:${i}`); });
    }
    return held;
  }

  /** True when a gamepad button goes down that was not already held when the replay started. */
  private pollPads(): boolean {
    if (performance.now() < this.armedAt) { this.gamepadHeld = this.pressedPads(); return false; }
    const now = this.pressedPads();
    for (const key of now) if (!this.gamepadHeld.has(key)) return true;
    this.gamepadHeld = now;
    return false;
  }

  private writeNodes(out: Float32Array, base: number): void {
    const a = this.actors!;
    let o = base;
    for (const d of a.drones) {
      const p = d.root.position; const r = d.visualRoot.rotation;
      out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.z;
      out[o + 3] = r.x; out[o + 4] = r.y; out[o + 5] = r.z; out[o + 6] = 0;
      o += STRIDE;
    }
    for (const n of a.props) {
      const p = n.position; const q = n.rotationQuaternion;
      out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.z;
      out[o + 3] = q?.x ?? 0; out[o + 4] = q?.y ?? 0; out[o + 5] = q?.z ?? 0; out[o + 6] = q?.w ?? 1;
      o += STRIDE;
    }
  }

  /** Apply frame `baseA` (optionally blended toward `baseB` by `k`) to the live nodes. */
  private readNodes(src: Float32Array, baseA: number, srcB: Float32Array | null, baseB: number, k: number): void {
    const a = this.actors!;
    const lerp = (i: number) => {
      const va = src[baseA + i];
      return srcB ? va + (srcB[baseB + i] - va) * k : va;
    };
    let o = 0;
    for (const d of a.drones) {
      const x = lerp(o), y = lerp(o + 1), z = lerp(o + 2);
      if (isFiniteNum(x) && isFiniteNum(y) && isFiniteNum(z)) d.root.position.set(x, y, z);
      // Yaw wraps at ±PI: blend along the short way round.
      const ya = src[baseA + o + 4];
      let yaw = ya;
      if (srcB) { let dy = srcB[baseB + o + 4] - ya; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yaw = ya + dy * k; }
      d.visualRoot.rotation.set(lerp(o + 3), yaw, lerp(o + 5));
      o += STRIDE;
    }
    for (const n of a.props) {
      const x = lerp(o), y = lerp(o + 1), z = lerp(o + 2);
      if (isFiniteNum(x) && isFiniteNum(y) && isFiniteNum(z)) n.position.set(x, y, z);
      const q = n.rotationQuaternion;
      if (q) {
        let bx = srcB ? srcB[baseB + o + 3] : 0, by = srcB ? srcB[baseB + o + 4] : 0, bz = srcB ? srcB[baseB + o + 5] : 0, bw = srcB ? srcB[baseB + o + 6] : 1;
        const ax = src[baseA + o + 3], ay = src[baseA + o + 4], az = src[baseA + o + 5], aw = src[baseA + o + 6];
        if (srcB && ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
        const kk = srcB ? k : 0;
        const qx = ax + (bx - ax) * kk, qy = ay + (by - ay) * kk, qz = az + (bz - az) * kk, qw = aw + (bw - aw) * kk;
        const len = Math.hypot(qx, qy, qz, qw) || 1;
        q.set(qx / len, qy / len, qz / len, qw / len);
      }
      o += STRIDE;
    }
  }

  /** Ring index pair + blend for a source time (seconds). */
  private locate(time: number): { i0: number; i1: number; k: number } {
    const cap = this.capacity;
    const first = (this.head - this.count + cap) % cap;
    let i0 = first;
    for (let n = 0; n < this.count - 1; n++) {
      const idx = (first + n) % cap;
      const next = (idx + 1) % cap;
      if (this.times[next] >= time) {
        const span = this.times[next] - this.times[idx];
        return { i0: idx, i1: next, k: span > 0 ? Math.min(1, Math.max(0, (time - this.times[idx]) / span)) : 0 };
      }
      i0 = next;
    }
    return { i0, i1: i0, k: 0 };
  }

  private applyAt(time: number): void {
    const { i0, i1, k } = this.locate(time);
    const stride = this.nodeCount * STRIDE;
    this.readNodes(this.data, i0 * stride, this.data, i1 * stride, k);
  }

  private sampleCentroidAt(time: number): void {
    const a = this.actors!;
    const { i0, i1, k } = this.locate(time);
    const stride = this.nodeCount * STRIDE;
    this.centroid.setAll(0);
    for (let d = 0; d < a.drones.length; d++) {
      for (let c = 0; c < 3; c++) {
        const va = this.data[i0 * stride + d * STRIDE + c];
        const vb = this.data[i1 * stride + d * STRIDE + c];
        const v = va + (vb - va) * k;
        if (c === 0) this.centroid.x += v; else if (c === 1) this.centroid.y += v; else this.centroid.z += v;
      }
    }
    this.centroid.scaleInPlace(1 / Math.max(1, a.drones.length));
  }

  /**
   * Orbit + dolly onto the drones, starting from the gameplay camera's own (unoccluded) offset:
   * swing ~0.6 rad round the crew while closing to ~55% distance and dropping toward eye level.
   * Reduced motion holds the starting framing.
   */
  private driveCamera(p: number): void {
    const a = this.actors!;
    this.centroid.setAll(0);
    for (const d of a.drones) this.centroid.addInPlace(d.root.position);
    this.centroid.scaleInPlace(1 / Math.max(1, a.drones.length));
    const cam = a.camera;
    const ease = this.staticCamera ? 0 : p * p * (3 - 2 * p);
    const angle = this.orbitStart + ease * 0.6;
    const radius = this.orbitRadius * (1 - ease * 0.45);
    const height = this.orbitHeight * (1 - ease * 0.5) + ease * 0.8;
    // Keep a clear line to the crew: pull the camera in front of any opaque scenery between them.
    this.tmp.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
    const want = this.tmp.length();
    const dist = Math.min(want, this.clearDistance(this.tmp, want));
    this.camDist = this.camDist === 0 || dist < this.camDist ? dist : this.camDist + (dist - this.camDist) * 0.08;
    this.tmp.scaleInPlace(this.camDist / Math.max(0.001, want)).addInPlace(this.centroid);
    cam.position.copyFrom(this.tmp);
    this.tmp.copyFrom(this.centroid);
    this.tmp.y += 0.3;
    cam.setTarget(this.tmp);
    cam.fov = this.cameraRestore ? this.cameraRestore.fov * (1 - ease * 0.15) : cam.fov;
  }

  /** Distance from the crew toward `offset` before opaque scenery gets in the way (minus a margin). */
  private clearDistance(offset: Vector3, length: number): number {
    const scene = this.actors!.scene;
    this.ray.origin.copyFrom(this.centroid);
    this.ray.origin.y += 0.3;
    offset.normalizeToRef(this.ray.direction);
    this.ray.length = length;
    const hit = scene.pickWithRay(this.ray, (m) => m.isEnabled() && m.isVisible && m.visibility > 0.5
      && !this.excluded.has(m) && !!m.material && m.material.alpha >= 0.99 && !m.material.needAlphaBlending(), true);
    return hit?.hit ? Math.max(2.2, hit.distance - 0.45) : length;
  }

  private buildOverlay(parent: HTMLElement, subline: string | undefined, reduced: boolean): HTMLElement {
    const root = document.createElement('div');
    root.className = `escape-replay${reduced ? ' escape-replay--reduced' : ''}`;
    root.dataset.testid = 'escape-replay';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-label', 'Escape replay. Press any key to skip.');
    root.innerHTML = [
      '<div class="escape-replay__bar escape-replay__bar--top"></div>',
      '<div class="escape-replay__bar escape-replay__bar--bottom"></div>',
      '<p class="escape-replay__tag"><span class="escape-replay__rec" aria-hidden="true"></span>REPLAY · 0.35x</p>',
      '<div class="escape-replay__stamp"><strong>HEIST COMPLETE</strong></div>',
      '<p class="escape-replay__skip">Press any key to skip</p>',
    ].join('');
    if (subline) {
      const sub = document.createElement('span');
      sub.textContent = subline;
      root.querySelector('.escape-replay__stamp')!.append(sub);
    }
    if (matchMedia('(pointer: coarse)').matches) root.querySelector('.escape-replay__skip')!.textContent = 'Tap to skip';
    parent.append(root);
    document.body.classList.add('escape-replay-on');
    return root;
  }
}

/** One replay per page; GameApp attaches the actors, MissionDirector decides when to play. */
export const escapeReplay = new EscapeReplayController();
