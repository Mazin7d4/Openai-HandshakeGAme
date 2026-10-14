import { Vector3 } from '@babylonjs/core';
import type { GameAudio } from '../audio/GameAudio.ts';
import type { CinematicCamera } from '../camera/CinematicCamera.ts';
import type { MultiplayerSession, TetherYankMessage } from '../network/MultiplayerSession.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { gameEvents } from './GameEvents.ts';
import type { Juice } from './Juice.ts';
import { TETHER_TUNING } from './Tether.ts';

export type YankKind = 'yank' | 'sling' | 'bump';

const COOLDOWN = 1.1;
const BUMP_RANGE = 2.6;
const MAX_PARTNER_IMPULSE = 16;

export interface YankResult {
  kind: YankKind;
  rescue: boolean;
  strength: number;
}

/**
 * The tether's signature active moves, built on top of the passive spring:
 *  - YANK: burst-pull the partner toward you (rescues a partner in trouble).
 *  - SLINGSHOT: when the cord is taut and your partner is holding still,
 *    yank launches *you* toward and past them.
 *  - BUMP: up close, a harmless "boop" that nudges the partner away.
 *
 * Each client only ever writes its own drone's velocity. The partner's
 * impulse is relayed through the server (validated there), so it works the
 * same for two remote players as for dev-local / single player.
 */
export class TetherMoves {
  private readonly cooldowns = new Map<DroneRole, number>([['pix', 0], ['nee', 0]]);
  private readonly dir = new Vector3();
  private readonly impulse = new Vector3();

  private readonly audio: GameAudio;
  private readonly camera: CinematicCamera;
  private readonly juice: Juice;
  private readonly session: MultiplayerSession | null;
  private readonly onToast: (text: string, tone: 'pix' | 'nee' | 'good') => void;
  private readonly onRescue: () => void;

  constructor(
    audio: GameAudio,
    camera: CinematicCamera,
    juice: Juice,
    session: MultiplayerSession | null,
    onToast: (text: string, tone: 'pix' | 'nee' | 'good') => void,
    onRescue: () => void,
  ) {
    this.audio = audio;
    this.camera = camera;
    this.juice = juice;
    this.session = session;
    this.onToast = onToast;
    this.onRescue = onRescue;
  }

  update(dt: number): void {
    for (const [role, value] of this.cooldowns) this.cooldowns.set(role, Math.max(0, value - dt));
  }

  cooldown(role: DroneRole): number {
    return this.cooldowns.get(role) ?? 0;
  }

  /** Predicts which move a yank would perform right now (for prompts). */
  preview(self: Drone, partner: Drone, strain: number, partnerAnchored: boolean): YankKind | null {
    const d = Vector3.Distance(self.position, partner.position);
    if (d > TETHER_TUNING.maxLength + 1.5) return null;
    if (d < BUMP_RANGE) return 'bump';
    if (strain > 0.45 && partnerAnchored) return 'sling';
    return 'yank';
  }

  tryYank(
    role: DroneRole,
    self: Drone,
    partner: Drone,
    partnerIsLocal: boolean,
    strain: number,
    partnerAnchored: boolean,
  ): YankResult | null {
    if (this.cooldown(role) > 0) return null;
    const kind = this.preview(self, partner, strain, partnerAnchored);
    if (!kind) return null;
    this.cooldowns.set(role, kind === 'bump' ? 0.45 : COOLDOWN);

    // dir: from partner toward self.
    this.dir.copyFrom(self.position).subtractInPlace(partner.position);
    const distance = Math.max(0.001, this.dir.length());
    this.dir.scaleInPlace(1 / distance);
    const rescue = kind === 'yank' && partner.inTrouble;
    const strength = kind === 'bump' ? 0.3 : Math.min(1, 0.45 + strain * 0.55);
    const mid = self.position.add(partner.position).scaleInPlace(0.5);

    if (kind === 'bump') {
      this.impulse.copyFrom(this.dir).scaleInPlace(-3.6);
      this.impulse.y += 0.8;
      self.react('proud', 0.7);
      this.audio.bump();
      this.juice.burst(role, partner.position, 8);
    } else if (kind === 'sling') {
      // Launch self toward (and past) the anchored partner.
      const launch = this.dir.scale(-(17 + strain * 6));
      launch.y += 2.2;
      self.yankedBy(launch, 1);
      self.react('proud', 1.1);
      this.impulse.copyFrom(this.dir).scaleInPlace(2.2);
      this.audio.slingshot();
      this.camera.kickFov(0.14);
      this.camera.addShake(0.35);
      this.juice.burst(role, self.position, 26);
      this.onToast('SLINGSHOT!', role);
    } else {
      this.impulse.copyFrom(this.dir).scaleInPlace(7 + strain * 7 + (rescue ? 3 : 0));
      this.impulse.y += 1.6;
      self.applyVelocityDelta(this.dir.scale(-2.6));
      self.recoil(strength);
      this.audio.yank(strength);
      this.camera.addShake(0.22 + strength * 0.2);
      this.juice.burst('yank', mid, 14);
      if (rescue) {
        this.audio.rescue();
        this.onToast('RESCUE!', 'good');
        this.onRescue();
      }
    }
    clamp(this.impulse, MAX_PARTNER_IMPULSE);

    if (partnerIsLocal) {
      this.receive({ kind, rescue, strength, impulse: { x: this.impulse.x, y: this.impulse.y, z: this.impulse.z } }, partner, false);
    } else {
      partner.showYanked(kind === 'bump' ? 0.3 : strength);
      this.session?.sendTetherYank({
        kind,
        rescue,
        strength,
        impulse: { x: this.impulse.x, y: this.impulse.y, z: this.impulse.z },
      });
    }
    gameEvents.emit('yank', { kind, from: role, strength, rescue, position: mid });
    return { kind, rescue, strength };
  }

  /** Apply a partner's yank to the drone this client owns. */
  receive(message: TetherYankMessage, local: Drone, remote: boolean): void {
    this.impulse.set(message.impulse.x, message.impulse.y, message.impulse.z);
    clamp(this.impulse, MAX_PARTNER_IMPULSE);
    if (message.kind === 'bump') {
      local.applyVelocityDelta(this.impulse);
      local.react('shocked', 0.4);
      return;
    }
    local.yankedBy(this.impulse, message.strength);
    if (remote) {
      this.audio.yanked();
      this.camera.addShake(0.3 + message.strength * 0.25);
      if (message.rescue) this.onToast('RESCUED!', 'good');
    } else {
      this.audio.yanked();
    }
  }
}

function clamp(value: Vector3, max: number): void {
  const length = value.length();
  if (length > max) value.scaleInPlace(max / length);
}
