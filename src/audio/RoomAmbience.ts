/** Environmental beds carry atmosphere only; no gameplay information depends on sound. */
export type AmbienceRoom = 'apron' | 'reception' | 'office' | 'server' | 'lab' | 'dock';
const BEDS: Record<AmbienceRoom, { air: number; cutoff: number; hum: number; hz: number }> = {
  apron: { air: 0.045, cutoff: 700, hum: 0.004, hz: 80 },
  reception: { air: 0.028, cutoff: 1100, hum: 0.002, hz: 90 },
  office: { air: 0.043, cutoff: 1450, hum: 0.004, hz: 100 },
  server: { air: 0.055, cutoff: 850, hum: 0.025, hz: 72 },
  lab: { air: 0.023, cutoff: 1000, hum: 0.006, hz: 120 },
  dock: { air: 0.05, cutoff: 600, hum: 0.01, hz: 60 },
};

/** The same physical room boundaries as the approved shell, including the delivery apron. */
export function ambienceRoomAt(z: number): AmbienceRoom {
  if (z < -55) return 'apron';
  if (z < -43) return 'reception';
  if (z < -26) return 'office';
  if (z < 2) return 'server';
  return z < 27 ? 'lab' : 'dock';
}

/** One seamless air loop plus two quiet mains harmonics, independent of the graphics tier. */
export class RoomAmbience {
  private readonly air: AudioBufferSourceNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly airGain: GainNode;
  private readonly humGain: GainNode;
  private readonly fundamental: OscillatorNode;
  private readonly harmonic: OscillatorNode;
  private readonly output: GainNode;
  private readonly nodes: AudioNode[];
  private stopped = false;
  private room: AmbienceRoom | null = null;

  private readonly ctx: AudioContext;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 173, smooth = 0;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      smooth = smooth * 0.98 + (seed / 0x80000000 - 1) * 0.02;
      data[i] = smooth * 3;
    }
    // Endpoints crossfade over a quarter second, so the shared loop has no tick.
    const fade = Math.floor(ctx.sampleRate / 4);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[data.length - fade + i] = data[data.length - fade + i] * (1 - k) + data[i] * k;
    }
    this.air = ctx.createBufferSource(); this.air.buffer = buffer; this.air.loop = true;
    this.air.loopStart = fade / ctx.sampleRate;
    this.lowpass = ctx.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.Q.value = 0.35;
    this.airGain = ctx.createGain(); this.airGain.gain.value = 0;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    this.output = ctx.createGain(); this.output.gain.value = 0;
    this.fundamental = ctx.createOscillator(); this.fundamental.type = 'sine';
    this.harmonic = ctx.createOscillator(); this.harmonic.type = 'sine';
    const upperGain = ctx.createGain(); upperGain.gain.value = 0.22;
    this.air.connect(this.lowpass).connect(this.airGain).connect(this.output);
    this.fundamental.connect(this.humGain).connect(this.output);
    this.harmonic.connect(upperGain).connect(this.humGain);
    this.output.connect(destination);
    this.nodes = [this.air, this.lowpass, this.airGain, this.humGain, this.fundamental, this.harmonic, upperGain, this.output];
    this.air.start(); this.fundamental.start(); this.harmonic.start();
    this.output.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
  }

  /** Smooth spectral transitions avoid clicks and rapid boundary changes restarting nodes. */
  setRoom(room: AmbienceRoom): void {
    if (this.stopped || room === this.room) return;
    this.room = room;
    const bed = BEDS[room], now = this.ctx.currentTime;
    this.airGain.gain.setTargetAtTime(bed.air, now, 0.7);
    this.humGain.gain.setTargetAtTime(bed.hum, now, 0.7);
    this.lowpass.frequency.setTargetAtTime(bed.cutoff, now, 0.8);
    this.fundamental.frequency.setTargetAtTime(bed.hz, now, 1.1);
    this.harmonic.frequency.setTargetAtTime(bed.hz * 2, now, 1.1);
  }

  /** Release sources after the fade, disconnecting the entire graph when playback ends. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.output.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    for (const source of [this.air, this.fundamental, this.harmonic]) source.stop(this.ctx.currentTime + 0.9);
    this.air.onended = () => { for (const node of this.nodes) node.disconnect(); };
  }
}
