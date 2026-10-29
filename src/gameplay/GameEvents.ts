import type { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { DroneRole } from '../network/NetworkTypes.ts';

/** Presentation-level gameplay events (juice, audio, hints). Never authoritative state. */
export interface GameEventMap {
  impact: { droneId: string; strength: number; position: Vector3 };
  boost: { droneId: string; position: Vector3 };
  clothesline: { position: Vector3 };
  knockback: { droneId: string; position: Vector3 };
  /** Authored heist beats, fired identically on both clients from replicated mission state. */
  heist: { beat: 'vault' | 'pickup' | 'extract'; position: Vector3; role?: DroneRole | null };
  /** Physical control/door feedback; contains no mission state. */
  mechanism: { kind: 'hack' | 'door'; position: Vector3; complete: boolean };
  /** The cord swept a free prop (knock / drag). */
  'cord-knock': { id: string; position: Vector3 };
  /** A thrown prop blinded the security camera. */
  'camera-blind': { position: Vector3 };
  /** A patrol pod grabbed a drone (capture-and-carry) or let it go. */
  capture: { droneId: string; position: Vector3; freed: boolean };
  /** Cord crank progress changed meaningfully (0..1), or completed. */
  crank: { progress: number; position: Vector3; done: boolean };
  /** Apron warm-up progress (cord playground). */
  warmup: { kind: 'topple' | 'hoop'; position: Vector3; count: number };
  /** Generic HUD toast request from gameplay systems. */
  toast: { text: string; tone: 'pix' | 'nee' | 'good' };
  yank: { kind: 'yank' | 'sling' | 'bump'; from: DroneRole; strength: number; rescue: boolean; position: Vector3 };
}

type Handler<K extends keyof GameEventMap> = (event: GameEventMap[K]) => void;

class GameEvents {
  private readonly handlers = new Map<keyof GameEventMap, Set<Handler<never>>>();

  on<K extends keyof GameEventMap>(name: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => set?.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEventMap>(name: K, event: GameEventMap[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const handler of set) {
      try { (handler as Handler<K>)(event); } catch { /* juice must never break the sim */ }
    }
  }

  clear(): void { this.handlers.clear(); }
}

export const gameEvents = new GameEvents();
