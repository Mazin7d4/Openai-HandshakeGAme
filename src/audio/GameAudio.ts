import { getSettings, subscribeSettings } from '../ui/Settings.ts';

/** Tiny synthesized sound palette. It avoids asset loading while keeping actions readable. */
export class GameAudio {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterVolume = 0.8;
  private readonly unsubscribeSettings: (() => void) | null = null;
  private alarmTimer: number | null = null;
  private noise: AudioBuffer | null = null;
  private lastImpact = 0;
  private creak: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private creakLevel = 0;

  constructor() {
    const settings = getSettings();
    this.masterVolume = Math.max(0, Math.min(1, settings.masterVolume / 100));
    this.unsubscribeSettings = subscribeSettings((next) => {
      this.setMasterVolume(next.masterVolume / 100);
    });
  }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.context) {
      try {
        this.masterGain.gain.setValueAtTime(this.masterVolume, this.context.currentTime);
      } catch {
        this.masterGain.gain.value = this.masterVolume;
      }
    }
  }

  private ensureContext(): AudioContext | null {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.masterGain = this.context.createGain();
        this.masterGain.gain.setValueAtTime(this.masterVolume, this.context.currentTime);
        this.masterGain.connect(this.context.destination);
      }
      return this.context;
    } catch {
      return null;
    }
  }

  private get destinationNode(): AudioNode | null {
    if (!this.ensureContext()) return null;
    return this.masterGain ?? this.context?.destination ?? null;
  }

  /** Elastic twang: quick up-then-down sweep. */
  yank(strength = 0.6): void {
    const s = Math.max(0, Math.min(1, strength));
    this.sweep(180 + s * 60, 420 + s * 260, 130 + s * 40, 0.2, 0.035 + s * 0.02, 'triangle');
  }

  /** Being pulled: descending "wheee". */
  yanked(): void {
    this.sweep(900, 640, 220, 0.24, 0.03, 'sine');
  }

  impact(strength = 0.5): void {
    const now = performance.now();
    if (now - this.lastImpact < 90) return;
    this.lastImpact = now;
    const s = Math.max(0.15, Math.min(1, strength));
    this.noiseBurst(0.09, 900, 0.035 * s + 0.01, 'lowpass');
    this.tone(110 + s * 40, 0.09, 0.03 * s + 0.01, 'sine');
  }

  clothesline(): void {
    this.noiseBurst(0.12, 4200, 0.03, 'bandpass');
    this.sweep(1400, 1500, 300, 0.1, 0.022, 'square');
    window.setTimeout(() => this.sweep(520, 520, 140, 0.28, 0.04, 'triangle'), 110);
  }

  slingshot(): void {
    this.noiseSweep(0.32, 400, 3800, 0.04);
    window.setTimeout(() => this.sweep(500, 1300, 900, 0.16, 0.03, 'sine'), 120);
  }

  boostStart(): void {
    this.noiseSweep(0.16, 600, 2400, 0.018);
  }

  rescue(): void {
    this.sequence([[988, 0], [1319, 110]], 0.14, 0.04);
  }

  bump(): void {
    this.sweep(420, 300, 520, 0.08, 0.035, 'sine');
  }

  /** Persistent quiet cord creak that tracks tether strain. Call every frame. */
  cordTension(strain: number): void {
    const target = strain > 0.55 ? Math.min(1, (strain - 0.55) / 0.45) * 0.018 : 0;
    if (target === 0 && !this.creak) return;
    if (Math.abs(target - this.creakLevel) < 0.0008) return;
    this.creakLevel = target;
    try {
      const ctx = this.context;
      const dest = this.masterGain;
      if (!ctx || !dest) return; // Never create audio from the frame loop; wait for an SFX to unlock it.
      if (!this.creak) {
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 74;
        lfo.frequency.value = 11;
        lfoGain.gain.value = 9;
        lfo.connect(lfoGain).connect(osc.frequency);
        gain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 520;
        osc.connect(filter).connect(gain).connect(dest);
        osc.start();
        lfo.start();
        this.creak = { osc, lfo, gain };
      }
      this.creak.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.06);
      this.creak.osc.frequency.setTargetAtTime(70 + target * 2600, ctx.currentTime, 0.1);
    } catch {
      // Audio is optional.
    }
  }

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

  /** Prototype lift-off: rising shimmer + low thump, distinct from ordinary grabs. */
  prototypePickup(): void {
    this.tone(90, 0.35, 0.06, 'triangle');
    this.sweep(300, 1400, 900, 0.45, 0.035, 'sine');
    this.sequence([[784, 120], [988, 220], [1319, 320]], 0.22, 0.03);
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
    this.unsubscribeSettings?.();
    this.stopAlarm();
    try { this.creak?.osc.stop(); this.creak?.lfo.stop(); } catch { /* already stopped */ }
    this.creak = null;
    this.masterGain = null;
    void this.context?.close();
    this.context = null;
  }

  private sequence(notes: readonly (readonly [number, number])[], duration: number, volume: number): void {
    for (const [frequency, delay] of notes) {
      window.setTimeout(() => this.tone(frequency, duration, volume, 'sine'), delay);
    }
  }

  private sweep(from: number, peak: number, to: number, duration: number, volume: number, type: OscillatorType): void {
    try {
      const ctx = this.ensureContext();
      const dest = this.destinationNode;
      if (!ctx || !dest) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, peak), t + duration * 0.3);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.min(0.06, volume), t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(dest);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    } catch {
      // Audio is optional.
    }
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    if (!this.noise) {
      const length = Math.floor(ctx.sampleRate * 0.5);
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    return source;
  }

  private noiseBurst(duration: number, frequency: number, volume: number, type: BiquadFilterType): void {
    try {
      const ctx = this.ensureContext();
      const dest = this.destinationNode;
      if (!ctx || !dest) return;
      const t = ctx.currentTime;
      const source = this.noiseSource(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(Math.min(0.06, volume), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      source.connect(filter).connect(gain).connect(dest);
      source.start(t);
      source.stop(t + duration + 0.02);
    } catch {
      // Audio is optional.
    }
  }

  private noiseSweep(duration: number, from: number, to: number, volume: number): void {
    try {
      const ctx = this.ensureContext();
      const dest = this.destinationNode;
      if (!ctx || !dest) return;
      const t = ctx.currentTime;
      const source = this.noiseSource(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(from, t);
      filter.frequency.exponentialRampToValueAtTime(to, t + duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.min(0.06, volume), t + duration * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      source.connect(filter).connect(gain).connect(dest);
      source.start(t);
      source.stop(t + duration + 0.02);
    } catch {
      // Audio is optional.
    }
  }

  private tone(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    try {
      const ctx = this.ensureContext();
      const dest = this.destinationNode;
      if (!ctx || !dest) return;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      oscillator.connect(gain).connect(dest);
      oscillator.start();
      oscillator.stop(ctx.currentTime + duration);
    } catch {
      // Browsers may defer audio until user activation; game feedback remains visual.
    }
  }
}
