import { audio, type Vec3Like } from './AudioManager.ts';

/**
 * Per-game facade kept for existing call sites (TetherMoves, hack views, MissionDirector...).
 * Everything forwards to the shared AudioManager hub; new code should call `audio.play()` directly.
 */
export class GameAudio {
  private escalation: number[] = [];

  constructor() {
    audio.install();
    audio.beginSession();
  }

  /** Kept for the settings slider path; master volume lives in Settings. */
  setMasterVolume(v: number): void { audio.setMasterVolume(v); }

  yank(strength = 0.6): void { audio.play('yank', { intensity: strength }); }
  yanked(): void { audio.play('yanked'); }
  impact(strength = 0.5, position?: Vec3Like): void { audio.play('impact', { intensity: strength, position }); }
  clothesline(position?: Vec3Like): void { audio.play('stun', { position }); }
  slingshot(): void { audio.play('slingshot'); }
  boostStart(position?: Vec3Like): void { audio.play('boost', { position }); }
  rescue(): void { audio.play('rescue'); }
  bump(): void { audio.play('bump'); }
  cordTension(strain: number): void { audio.setTension(strain); }
  click(progress = 0): void { audio.play('hackTick', { progress }); }
  success(): void { audio.play('hackSuccess'); }
  fail(): void { audio.play('hackFail'); }
  /** Detection building on a camera. */
  warning(): void { audio.play('suspicious'); }
  spotted(): void { audio.play('spotted'); }
  pickup(): void { audio.play('grab'); }
  prototypePickup(): void { audio.play('theft'); }
  throwObject(): void { audio.play('throw'); }
  missionComplete(): void { this.clearEscalation(); audio.play('extract'); }

  /**
   * Solo/local alarm: stage 1 now, escalating on a fixed clock so both clients agree.
   * Replicated room state can override any time with audio.setAlarmStage(n).
   */
  startAlarm(): void {
    if (audio.alarmStage > 0) return;
    audio.setAlarmStage(1);
    this.clearEscalation();
    this.escalation.push(
      window.setTimeout(() => { if (audio.alarmStage === 1) audio.setAlarmStage(2); }, 35_000),
      window.setTimeout(() => { if (audio.alarmStage === 2) audio.setAlarmStage(3); }, 75_000),
    );
  }

  stopAlarm(): void { this.clearEscalation(); audio.setAlarmStage(0); }

  dispose(): void {
    this.clearEscalation();
    audio.endSession();
  }

  private clearEscalation(): void {
    for (const id of this.escalation) window.clearTimeout(id);
    this.escalation = [];
  }
}
