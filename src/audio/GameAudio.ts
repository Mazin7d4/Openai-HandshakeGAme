/** Tiny synthesized sound palette. It avoids asset loading while keeping actions readable. */
export class GameAudio {
  private context: AudioContext | null = null;
  private alarmTimer: number | null = null;

  click(progress = 0): void {
    this.tone(260 + progress * 440, 0.055, 0.025, 'sine');
  }

  success(): void {
    this.sequence([[440, 0], [660, 90], [880, 180]], 0.12, 0.045);
  }

  warning(): void {
    this.sequence([[310, 0], [220, 105]], 0.08, 0.035);
  }

  pickup(): void {
    this.sequence([[180, 0], [520, 75]], 0.09, 0.04);
  }

  throwObject(): void {
    this.sequence([[420, 0], [150, 80]], 0.08, 0.032);
  }

  missionComplete(): void {
    this.sequence([[392, 0], [523, 130], [659, 260], [784, 390]], 0.18, 0.05);
  }

  startAlarm(): void {
    if (this.alarmTimer !== null) return;
    let high = false;
    const pulse = () => {
      this.tone(high ? 720 : 520, 0.17, 0.028, 'sawtooth');
      high = !high;
    };
    pulse();
    this.alarmTimer = window.setInterval(pulse, 440);
  }

  stopAlarm(): void {
    if (this.alarmTimer !== null) window.clearInterval(this.alarmTimer);
    this.alarmTimer = null;
  }

  dispose(): void {
    this.stopAlarm();
    void this.context?.close();
    this.context = null;
  }

  private sequence(notes: readonly (readonly [number, number])[], duration: number, volume: number): void {
    for (const [frequency, delay] of notes) {
      window.setTimeout(() => this.tone(frequency, duration, volume, 'sine'), delay);
    }
  }

  private tone(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    try {
      this.context ??= new AudioContext();
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start();
      oscillator.stop(this.context.currentTime + duration);
    } catch {
      // Browsers may defer audio until user activation; game feedback remains visual.
    }
  }
}
