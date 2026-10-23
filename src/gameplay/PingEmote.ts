import { Vector3, type Camera, type Scene } from '@babylonjs/core';
import { audio } from '../audio/AudioManager.ts';
import type { Drone } from '../player/Drone.ts';
import type { DroneRole, EmoteId, EmotePlayedMessage, PingPlacedMessage } from '../network/NetworkTypes.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import { getSettings, effectiveReducedMotion } from '../ui/Settings.ts';
import { PingEmoteOverlay } from '../ui/PingEmoteOverlay.ts';

export const PING_LIFETIME_MS = 4000;
export const EMOTE_LIFETIME_MS = 2000;
export const PING_COOLDOWN_MS = 750;
export const EMOTE_COOLDOWN_MS = 500;
const PAD_BUTTONS = [11, 12, 13, 14, 15] as const;
const EMOTES: readonly EmoteId[] = ['here', 'wait', 'go', 'yay'];

export class PingEmote {
  readonly overlay: PingEmoteOverlay;
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly multiplayer: MultiplayerSession | null;
  private readonly drones: readonly Drone[];
  private readonly localRole: () => DroneRole;
  private readonly localDrone: () => Drone;
  private lastPing = -Infinity;
  private lastEmote = -Infinity;
  private padState = new Map<number, boolean>();
  private readonly unsubs: (() => void)[] = [];
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const el = event.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (event.code === 'KeyG') { event.preventDefault(); this.ping(); return; }
    const index = /^Digit([1-4])$/.exec(event.code)?.[1] ?? /^Numpad([1-4])$/.exec(event.code)?.[1];
    if (index) { event.preventDefault(); this.emote(EMOTES[Number(index) - 1]); }
  };
  private readonly onMouse = (event: MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault(); this.ping();
  };

  constructor(scene: Scene, canvas: HTMLCanvasElement, parent: HTMLElement, camera: Camera, drones: readonly Drone[], multiplayer: MultiplayerSession | null, localRole: () => DroneRole) {
    this.scene = scene; this.canvas = canvas; this.camera = camera; this.drones = drones; this.multiplayer = multiplayer; this.localRole = localRole;
    this.localDrone = () => this.drones.find((d) => d.role === this.localRole()) ?? this.drones[0];
    this.overlay = new PingEmoteOverlay(parent, canvas, camera);
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('mousedown', this.onMouse);
    canvas.addEventListener('auxclick', this.onMouse);
    if (multiplayer) {
      this.unsubs.push(multiplayer.onPing((message) => this.receivePing(message)));
      this.unsubs.push(multiplayer.onEmote((message) => this.receiveEmote(message)));
    }
  }

  ping(): void {
    const now = performance.now();
    if (now - this.lastPing < PING_COOLDOWN_MS) return;
    this.lastPing = now;
    const position = this.target();
    if (this.multiplayer) this.multiplayer.sendPing(position);
    else this.receivePing({ role: this.localRole(), ...position, id: Math.floor(now), at: Date.now() });
  }
  emote(id: EmoteId): void {
    if (!EMOTES.includes(id) || performance.now() - this.lastEmote < EMOTE_COOLDOWN_MS) return;
    this.lastEmote = performance.now();
    if (this.multiplayer) this.multiplayer.sendEmote(id);
    else this.receiveEmote({ role: this.localRole(), id, at: Date.now() });
  }
  /** Gamepad: R3 (standard button 11) pings, d-pad 12-15 emotes. GamepadInput reserves exactly these; no stick axes are read here. */
  update(): void {
    const pad = this.activePad();
    if (pad) {
      const pressed = (index: number) => pad.buttons[index]?.pressed === true;
      if (pressed(11) && !this.padState.get(11)) this.ping();
      const mapping: [number, EmoteId][] = [[12, 'here'], [15, 'go'], [13, 'wait'], [14, 'yay']];
      for (const [button, id] of mapping) if (pressed(button) && !this.padState.get(button)) this.emote(id);
      for (const button of PAD_BUTTONS) this.padState.set(button, pressed(button));
    }
    const positions = new Map<DroneRole, Vector3>(this.drones.map((drone) => [drone.role, drone.position]));
    this.overlay.update(this.localDrone().position, positions);
  }
  /** Call on unpause: buttons still held from menu navigation must not fire an emote/ping on resume. */
  resetPadEdges(): void {
    const pad = this.activePad();
    for (const button of PAD_BUTTONS) this.padState.set(button, pad?.buttons[button]?.pressed === true);
  }
  /** Same pad selection as GamepadInput: first connected standard-mapped pad. */
  private activePad(): Gamepad | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const candidate of pads) if (candidate?.connected && candidate.mapping === 'standard') return candidate;
    return null;
  }
  dispose(): void {
    window.removeEventListener('keydown', this.onKey); this.canvas.removeEventListener('mousedown', this.onMouse); this.canvas.removeEventListener('auxclick', this.onMouse);
    for (const unsub of this.unsubs) unsub(); this.overlay.dispose();
  }
  private receivePing(message: PingPlacedMessage): void {
    this.overlay.placePing(message); audio.play('ping', { position: { x: message.x, y: message.y, z: message.z }, role: message.role });
  }
  private receiveEmote(message: EmotePlayedMessage): void {
    this.overlay.playEmote(message);
    const drone = this.drones.find((candidate) => candidate.role === message.role);
    const expression = ({ here: 'focused', wait: 'sheepish', go: 'proud', yay: 'happy' } as const)[message.id];
    drone?.react(expression, EMOTE_LIFETIME_MS / 1000);
    audio.play('emote', { role: message.role, mood: expression === 'sheepish' ? 'neutral' : expression, position: drone?.position ?? null });
    this.overlay.root.classList.toggle('ping-emote-overlay--motion', !effectiveReducedMotion(getSettings()));
  }
  private target(): { x: number; y: number; z: number } {
    const ray = this.camera.getForwardRay(60);
    const picked = this.scene.pickWithRay(ray, (mesh) => mesh.isVisible && mesh.isPickable && !/drone|tether|ping/i.test(mesh.name));
    if (picked?.hit && picked.pickedPoint) return { x: picked.pickedPoint.x, y: picked.pickedPoint.y, z: picked.pickedPoint.z };
    const drone = this.localDrone();
    const yaw = drone.root.rotation.y;
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const point = drone.position.add(forward.scale(12));
    return { x: point.x, y: point.y, z: point.z };
  }
}
