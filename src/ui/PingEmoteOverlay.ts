import { Matrix, Vector3, type Camera } from '@babylonjs/core';
import type { DroneRole, EmoteId } from '../network/NetworkTypes.ts';

export interface OverlayPing { role: DroneRole; x: number; y: number; z: number; id: number; at: number; receivedAt: number }
export interface OverlayEmote { role: DroneRole; id: EmoteId; at: number; receivedAt: number }

const LABELS: Record<EmoteId, string> = { here: 'Here!', wait: 'Wait', go: 'Go!', yay: 'Yay' };
const ICONS: Record<EmoteId, string> = { here: '⌖', wait: '◌', go: '➜', yay: '★' };

export class PingEmoteOverlay {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly pings = new Map<DroneRole, OverlayPing>();
  private readonly emotes = new Map<DroneRole, OverlayEmote>();
  private readonly pingEls = new Map<DroneRole, HTMLDivElement>();
  private readonly emoteEls = new Map<DroneRole, HTMLDivElement>();

  constructor(parent: HTMLElement, canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas; this.camera = camera;
    this.root = document.createElement('div');
    this.root.className = 'ping-emote-overlay';
    this.root.dataset.testid = 'ping-emote-overlay';
    parent.append(this.root);
  }

  placePing(ping: Omit<OverlayPing, 'receivedAt'>): void {
    this.pings.set(ping.role, { ...ping, receivedAt: performance.now() });
  }
  playEmote(emote: Omit<OverlayEmote, 'receivedAt'>): void {
    this.emotes.set(emote.role, { ...emote, receivedAt: performance.now() });
  }
  pingsSnapshot(): { role: DroneRole; x: number; y: number; z: number; ageMs: number }[] {
    const now = performance.now();
    return [...this.pings.values()].filter((p) => now - p.receivedAt < 4000).map((p) => ({ role: p.role, x: p.x, y: p.y, z: p.z, ageMs: now - p.receivedAt }));
  }
  emotesSnapshot(): { role: DroneRole; id: EmoteId; ageMs: number }[] {
    const now = performance.now();
    return [...this.emotes.values()].filter((e) => now - e.receivedAt < 2000).map((e) => ({ role: e.role, id: e.id, ageMs: now - e.receivedAt }));
  }

  update(localPosition: Vector3, rolePositions: ReadonlyMap<DroneRole, Vector3>): void {
    const now = performance.now();
    for (const [role, ping] of [...this.pings]) {
      const age = now - ping.receivedAt;
      if (age >= 4000) { this.pings.delete(role); this.remove(this.pingEls, role); continue; }
      const distance = Math.round(Vector3.Distance(localPosition, new Vector3(ping.x, ping.y, ping.z)));
      const el = this.ensure(this.pingEls, role, 'ping-marker');
      el.textContent = `${role === 'pix' ? 'PIX' : 'NEE'} · ${distance} m`;
      this.project(el, new Vector3(ping.x, ping.y, ping.z), age >= 3400 ? (4000 - age) / 600 : 1);
    }
    for (const [role, emote] of [...this.emotes]) {
      const age = now - emote.receivedAt;
      if (age >= 2000) { this.emotes.delete(role); this.remove(this.emoteEls, role); continue; }
      const position = rolePositions.get(role);
      if (!position) continue;
      const el = this.ensure(this.emoteEls, role, 'emote-bubble');
      el.textContent = `${ICONS[emote.id]} ${LABELS[emote.id]}`;
      this.project(el, position.add(new Vector3(0, 1.4, 0)), age >= 1600 ? (2000 - age) / 400 : 1);
    }
  }

  dispose(): void { this.root.remove(); this.pings.clear(); this.emotes.clear(); }

  private ensure(map: Map<DroneRole, HTMLDivElement>, role: DroneRole, cls: string): HTMLDivElement {
    let el = map.get(role);
    if (!el) { el = document.createElement('div'); el.className = `${cls} ${cls}--${role}`; this.root.append(el); map.set(role, el); }
    return el;
  }
  private remove(map: Map<DroneRole, HTMLDivElement>, role: DroneRole): void { map.get(role)?.remove(); map.delete(role); }
  private project(el: HTMLDivElement, point: Vector3, opacity: number): void {
    const viewport = this.camera.viewport.toGlobal(this.canvas.width, this.canvas.height);
    const projected = Vector3.Project(point, Matrix.Identity(), this.camera.getTransformationMatrix(), viewport);
    const forward = this.camera.getForwardRay().direction;
    const toPoint = point.subtract(this.camera.globalPosition);
    const visible = projected.z >= 0 && projected.z <= 1 && Vector3.Dot(forward, toPoint) > 0;
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    let x = projected.x * w / this.canvas.width;
    let y = projected.y * h / this.canvas.height;
    if (!visible) {
      const cx = w / 2; const cy = h / 2;
      const behind = Vector3.Dot(forward, toPoint) <= 0;
      const dx = (x - cx) * (behind ? -1 : 1); const dy = (y - cy) * (behind ? -1 : 1);
      const scale = Math.min((w * 0.46) / Math.max(1, Math.abs(dx)), (h * 0.44) / Math.max(1, Math.abs(dy)));
      x = cx + dx * scale; y = cy + dy * scale;
      el.classList.add('is-edge');
      el.style.setProperty('--edge-angle', `${Math.atan2(dy, dx)}rad`);
    } else el.classList.remove('is-edge');
    el.style.left = `${Math.max(8, Math.min(w - 8, x))}px`;
    el.style.top = `${Math.max(8, Math.min(h - 8, y))}px`;
    el.style.opacity = String(opacity);
  }
}
