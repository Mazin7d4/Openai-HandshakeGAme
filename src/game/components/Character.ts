import {
  Scene,
  TransformNode,
  AnimationGroup,
  SceneLoader,
  AbstractMesh,
  Skeleton,
  AnimationPropertiesOverride,
  Animation,
} from '@babylonjs/core';
import '@babylonjs/loaders';
import {
  CHARACTER_ASSET_PATH,
  CLIP_AUTHORED_SPEED,
  LOCOMOTION_CLIPS,
  type LocomotionClipName,
  type LocomotionIntent,
} from '../types';

const GAIT_CLIPS: LocomotionClipName[] = [
  'walk',
  'run',
  'strafeLeftWalk',
  'strafeRightWalk',
  'strafeLeft',
  'strafeRight',
];

export class Character {
  public readonly root: TransformNode;
  private meshes: AbstractMesh[] = [];
  private skeleton: Skeleton | null = null;
  private readonly clips = new Map<LocomotionClipName, AnimationGroup>();
  private readonly weights = new Map<LocomotionClipName, number>();
  private readonly targets = new Map<LocomotionClipName, number>();

  private scene: Scene;
  private loaded = false;
  private loadError = false;
  private gaitPlayback = 1;
  private gaitDirection = 1;
  private gaitMaster: LocomotionClipName = 'walk';
  private gaitSynced = false;
  private jumpPlaying = false;
  private wasAirborne = false;

  private readonly blendSharpness = 12;
  private readonly jumpBlendSharpness = 16;

  constructor(scene: Scene) {
    this.scene = scene;
    this.root = new TransformNode('characterRoot', scene);
    for (const name of LOCOMOTION_CLIPS) {
      this.weights.set(name, name === 'idle' ? 1 : 0);
      this.targets.set(name, name === 'idle' ? 1 : 0);
    }
  }

  public get mesh(): AbstractMesh | null {
    return this.meshes[0] ?? null;
  }

  public getMeshes(): readonly AbstractMesh[] {
    return this.meshes;
  }

  public async load(): Promise<void> {
    const result = await SceneLoader.ImportMeshAsync('', '', CHARACTER_ASSET_PATH, this.scene);
    const roots = result.meshes.filter((mesh) => !mesh.parent);
    for (const mesh of roots) {
      mesh.parent = this.root;
      mesh.position.set(0, 0, 0);
    }
    this.meshes = result.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    for (const mesh of this.meshes) {
      mesh.isPickable = false;
      mesh.metadata = { ...(mesh.metadata ?? {}), player: true };
    }

    this.skeleton = result.skeletons[0] ?? this.meshes.find((mesh) => mesh.skeleton)?.skeleton ?? null;
    if (this.skeleton) {
      this.skeleton.returnToRest();
    }

    const override = new AnimationPropertiesOverride();
    override.enableBlending = true;
    override.blendingSpeed = 0.12;
    override.loopMode = Animation.ANIMATIONLOOPMODE_CYCLE;
    this.scene.animationPropertiesOverride = override;

    this.bindClips(result.animationGroups);
    this.loaded = true;
    this.applyWeights(1);
  }

  private bindClips(groups: AnimationGroup[]): void {
    const wanted = new Set<string>(LOCOMOTION_CLIPS);
    for (const group of groups) {
      const key = group.name as LocomotionClipName;
      if (!wanted.has(group.name)) {
        group.stop();
        continue;
      }
      for (const targeted of group.targetedAnimations) {
        targeted.animation.enableBlending = true;
      }
      group.stop();
      group.start(key !== 'jump', 1, group.from, group.to, false);
      group.speedRatio = key === 'jump' ? 0 : 1;
      group.weight = key === 'idle' ? 1 : 0;
      this.clips.set(key, group);
    }

    const missing = LOCOMOTION_CLIPS.filter((name) => !this.clips.has(name));
    if (missing.length > 0) {
      throw new Error(`player.glb is missing animations: ${missing.join(', ')}`);
    }
  }

  public setIntent(intent: LocomotionIntent): void {
    const speedRef = this.speedReference(intent.run);
    const localX = speedRef > 0.001 ? intent.localVelocity.x / speedRef : 0;
    const localZ = speedRef > 0.001 ? intent.localVelocity.z / speedRef : 0;
    const mag = Math.min(1, Math.hypot(localX, localZ));
    const forward = mag > 0.001 ? Math.max(localZ, 0) / Math.max(mag, 0.001) * mag : 0;
    const back = mag > 0.001 ? Math.max(-localZ, 0) / Math.max(mag, 0.001) * mag : 0;
    const right = mag > 0.001 ? Math.max(localX, 0) / Math.max(mag, 0.001) * mag : 0;
    const left = mag > 0.001 ? Math.max(-localX, 0) / Math.max(mag, 0.001) * mag : 0;
    const run = intent.run;
    const walk = 1 - run;

    const next = new Map<LocomotionClipName, number>();
    for (const name of LOCOMOTION_CLIPS) next.set(name, 0);
    next.set('idle', 1 - mag);
    next.set('walk', forward * walk);
    next.set('run', forward * run);
    next.set('strafeLeftWalk', left * walk);
    next.set('strafeRightWalk', right * walk);
    next.set('strafeLeft', left * run);
    next.set('strafeRight', right * run);

    // Backpedal uses the forward cycle in reverse. There is no backward clip in the pack.
    if (back > forward) {
      next.set('walk', (next.get('walk') ?? 0) + back * walk);
      next.set('run', (next.get('run') ?? 0) + back * run);
    }

    const turnAmount = Math.min(1, Math.abs(intent.yawRate) / 3.0);
    const turnMix = turnAmount * (0.45 + 0.55 * (1 - mag));
    if (turnMix > 0.001) {
      for (const name of ['idle', 'walk', 'run', 'strafeLeftWalk', 'strafeRightWalk', 'strafeLeft', 'strafeRight'] as const) {
        next.set(name, (next.get(name) ?? 0) * (1 - turnMix));
      }
      next.set(intent.yawRate >= 0 ? 'turnRight' : 'turnLeft', turnMix);
    }

    if (!intent.grounded) {
      for (const name of LOCOMOTION_CLIPS) {
        if (name !== 'jump') next.set(name, 0);
      }
      next.set('jump', 1);
    }

    for (const name of LOCOMOTION_CLIPS) this.targets.set(name, next.get(name) ?? 0);

    const gaitSpeed = this.blendedAuthoredSpeed();
    const moving = intent.horizontalSpeed > 0.15;
    this.gaitPlayback = moving ? clamp(intent.horizontalSpeed / Math.max(gaitSpeed, 0.5), 0.7, 1.35) : 1;
    this.gaitDirection = back > forward && back > 0.05 ? -1 : 1;

    if ((intent.jump || !intent.grounded) && !this.wasAirborne) {
      this.restartJump();
    }
    this.wasAirborne = intent.jump || !intent.grounded;
  }

  public update(deltaTime: number): void {
    if (!this.loaded) return;

    const sharpness = this.targets.get('jump')! > 0.5 ? this.jumpBlendSharpness : this.blendSharpness;
    const t = 1 - Math.exp(-sharpness * deltaTime);
    for (const name of LOCOMOTION_CLIPS) {
      const current = this.weights.get(name) ?? 0;
      const target = this.targets.get(name) ?? 0;
      this.weights.set(name, current + (target - current) * t);
    }
    this.normalizeWeights();
    this.applyWeights(deltaTime);
    this.syncGaitPhase();
    this.updateJumpPlayback();
  }

  private speedReference(run: number): number {
    return CLIP_AUTHORED_SPEED.walk * (1 - run) + CLIP_AUTHORED_SPEED.run * run;
  }

  private blendedAuthoredSpeed(): number {
    let weighted = 0;
    let total = 0;
    for (const name of GAIT_CLIPS) {
      const weight = this.targets.get(name) ?? 0;
      const authored = CLIP_AUTHORED_SPEED[name];
      if (weight <= 0 || authored <= 0) continue;
      weighted += weight * authored;
      total += weight;
    }
    return total > 0.001 ? weighted / total : CLIP_AUTHORED_SPEED.walk;
  }

  private normalizeWeights(): void {
    let sum = 0;
    for (const name of LOCOMOTION_CLIPS) sum += this.weights.get(name) ?? 0;
    if (sum <= 0.0001) {
      this.weights.set('idle', 1);
      return;
    }
    for (const name of LOCOMOTION_CLIPS) {
      this.weights.set(name, (this.weights.get(name) ?? 0) / sum);
    }
  }

  private applyWeights(_deltaTime: number): void {
    for (const name of LOCOMOTION_CLIPS) {
      const group = this.clips.get(name);
      if (!group) continue;
      const weight = this.weights.get(name) ?? 0;
      group.weight = weight;
      if (name !== 'jump' && !group.isPlaying) {
        group.start(true, 0, group.from, group.to, false);
        group.speedRatio = 0;
      }
    }
  }

  private syncGaitPhase(): void {
    let masterName: LocomotionClipName = this.gaitMaster;
    let best = -1;
    for (const name of GAIT_CLIPS) {
      const weight = this.weights.get(name) ?? 0;
      if (weight > best) {
        best = weight;
        masterName = name;
      }
    }
    const master = this.clips.get(masterName);
    const masterAnimatable = master?.animatables[0];
    if (master && masterAnimatable && (!this.gaitSynced || masterName !== this.gaitMaster)) {
      this.gaitSynced = true;
      this.gaitMaster = masterName;
      master.syncAllAnimationsWith(null);
      for (const name of GAIT_CLIPS) {
        if (name === masterName) continue;
        this.clips.get(name)?.syncAllAnimationsWith(masterAnimatable);
      }
    }
    if (master) {
      master.speedRatio = best > 0.02 ? this.gaitDirection * this.gaitPlayback : 1;
    }
    const idle = this.clips.get('idle');
    if (idle) idle.speedRatio = 1;
    for (const name of ['turnLeft', 'turnRight'] as const) {
      const group = this.clips.get(name);
      if (!group) continue;
      group.speedRatio = (this.weights.get(name) ?? 0) > 0.04 ? 1 : 0;
    }
  }

  private restartJump(): void {
    const jump = this.clips.get('jump');
    if (!jump) return;
    jump.stop();
    jump.start(false, 1.15, jump.from, jump.to, false);
    this.jumpPlaying = true;
  }

  private updateJumpPlayback(): void {
    const jump = this.clips.get('jump');
    if (!jump) return;
    const weight = this.weights.get('jump') ?? 0;
    if (weight < 0.02) {
      if (this.jumpPlaying) {
        jump.pause();
        this.jumpPlaying = false;
      }
      return;
    }
    if (!jump.isPlaying && this.jumpPlaying) {
      jump.goToFrame(jump.to);
      jump.pause();
    }
  }

  public isLoadedSuccessfully(): boolean {
    return this.loaded;
  }

  public hasLoadError(): boolean {
    return this.loadError;
  }

  public dispose(): void {
    for (const group of this.clips.values()) group.dispose();
    this.root.dispose();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
