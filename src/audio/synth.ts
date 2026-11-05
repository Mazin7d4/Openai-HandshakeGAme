import { zzfxBuild, type ZzfxParams } from './zzfx.ts';

/** Procedural one-shots and loops, built once into AudioBuffers (no downloads). */

export type Voice = 'pix' | 'nee';
export type ChirpMood =
  | 'neutral' | 'happy' | 'focused' | 'strained' | 'shocked' | 'stunned'
  | 'yanked' | 'panic' | 'dizzy' | 'proud';

// Base chirp shapes (ZzFX params). The voice transform below makes PIX low/steady and NEE high/twitchy.
const CHIRPS: Record<ChirpMood, ZzfxParams> = {
  neutral: [0.5, 0, 520, 0.005, 0.03, 0.05, 0, 1, 2],
  focused: [0.45, 0, 600, 0.004, 0.02, 0.04, 0, 1, 0, 0, 120, 0.03],
  happy: [0.6, 0, 480, 0.01, 0.05, 0.09, 0, 1, 7, 0, 160, 0.06],
  proud: [0.6, 0, 420, 0.01, 0.07, 0.14, 0, 1, 0, 0, 210, 0.08, 0, 0, 0, 0, 0.05],
  strained: [0.55, 0, 300, 0.02, 0.12, 0.08, 1, 1, 2, 0, 0, 0, 0, 0, 6],
  shocked: [0.6, 0, 820, 0.004, 0.03, 0.12, 0, 1, -18],
  stunned: [0.5, 0, 460, 0.01, 0.22, 0.2, 0, 1, -3, 0, 0, 0, 0, 0, 14],
  yanked: [0.6, 0, 700, 0.004, 0.05, 0.14, 0, 1, -14],
  panic: [0.6, 0, 640, 0.004, 0.18, 0.06, 1, 1, 0, 0, -140, 0.04, 0.08],
  dizzy: [0.5, 0, 520, 0.01, 0.3, 0.12, 0, 1, 0, 0, 0, 0, 0, 0, 9],
};

export function chirpParams(voice: Voice, mood: ChirpMood): ZzfxParams {
  const p = [...CHIRPS[mood]];
  const freq = p[2] ?? 220;
  if (voice === 'pix') {
    // PIX: lower, round (sine), steady, a touch of slap echo = confident.
    p[1] = 0.04; p[2] = freq * 0.72; p[6] = 0;
    p[16] = Math.max(p[16] ?? 0, 0.035);
  } else {
    // NEE: higher, brighter (triangle), stuttering tremolo = nervous/twitchy.
    p[1] = 0.12; p[2] = freq * 1.55; p[6] = 1;
    p[12] = p[12] || 0.032; p[19] = 0.55;
    p[8] = (p[8] ?? 0) * 1.6;
  }
  return p;
}

export const ZZ: Record<string, ZzfxParams> = {
  ping: [0.45, 0.02, 680, 0.004, 0.035, 0.07, 0, 1, 0, 0, 420, 0.07],
  spotted: [0.75, 0, 880, 0.004, 0.05, 0.07, 1, 1, 0, 0, 440, 0.07, 0, 0, 0, 0, 0.09, 0.8],
  suspicious: [0.35, 0, 640, 0.01, 0.06, 0.1, 0, 1, 5],
  rescue: [0.6, 0, 523, 0.01, 0.06, 0.16, 0, 1, 0, 0, 262, 0.07, 0.15],
  hackStart: [0.45, 0, 260, 0.01, 0.1, 0.08, 1, 1, 14],
  pickupBlip: [0.5, 0, 330, 0.004, 0.03, 0.08, 1, 1, 0, 0, 330, 0.04],
  stunWarble: [0.5, 0, 900, 0.005, 0.25, 0.25, 0, 1, -2, 0, 0, 0, 0, 0, 20],
};

export function zz(sampleRate: number, params: ZzfxParams): Float32Array {
  return zzfxBuild(sampleRate, params);
}

let seed = 99;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

/** Rubber-band twang: decaying harmonic tone with a fast pitch drop and wobble. Pitch is set by playbackRate. */
export function twang(sr: number): Float32Array {
  const len = Math.floor(sr * 0.55); const out = new Float32Array(len); let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 150 * (1 + 0.35 * Math.exp(-t / 0.025)) * (1 + 0.025 * Math.sin(2 * Math.PI * 19 * t) * Math.exp(-t / 0.2));
    ph += (2 * Math.PI * f) / sr;
    const e = Math.min(1, i / 40) * Math.exp(-t / 0.13);
    out[i] = (Math.sin(ph) + 0.55 * Math.sin(2 * ph + 0.3) + 0.3 * Math.sin(3 * ph) * Math.exp(-t / 0.05)) * e * 0.55;
  }
  return out;
}

/** Cord snapping taut: crack + low thump. */
export function snap(sr: number): Float32Array {
  const len = Math.floor(sr * 0.22); const out = new Float32Array(len); let ph = 0, lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr; const n = noise();
    lp += (n - lp) * 0.35;
    ph += (2 * Math.PI * (70 + 120 * Math.exp(-t / 0.02))) / sr;
    out[i] = (n - lp) * Math.exp(-t / 0.006) * 0.9 + Math.sin(ph) * Math.exp(-t / 0.06) * 0.8;
  }
  return out;
}

/** Band-passed noise sweep (whoosh). */
export function whoosh(sr: number, dur: number, from: number, to: number, q = 1.6): Float32Array {
  const len = Math.floor(sr * dur); const out = new Float32Array(len);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len; const fc = from * (to / from) ** p;
    const w = (2 * Math.PI * fc) / sr; const alpha = Math.sin(w) / (2 * q); const cs = Math.cos(w);
    const a0 = 1 + alpha; const x = noise();
    const y = (alpha * x - alpha * x2 + 2 * cs * y1 - (1 - alpha) * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y * Math.sin(Math.PI * Math.min(1, p * 1.25)) ** 1.5 * 2.2;
  }
  return out;
}

/** Two quick rising handoff blips, deliberately unlike pickup/drop sounds. */
export function passCue(sr: number): Float32Array {
  const len = Math.floor(sr * 0.18);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const start = t < 0.09 ? 0 : 0.1;
    const local = t - start;
    const active = local >= 0 && local < 0.07;
    if (!active) continue;
    const p = local / 0.07;
    const frequency = (t < 0.09 ? 660 : 820) + (t < 0.09 ? 330 : 170) * p;
    phase += 2 * Math.PI * frequency / sr;
    const triangle = 2 * Math.abs(2 * ((phase / (2 * Math.PI)) % 1) - 1) - 1;
    const envelope = Math.min(1, local / 0.006) * Math.exp(-local / 0.055);
    out[i] = (Math.sin(phase) * 0.65 + triangle * 0.35) * envelope * 0.7;
  }
  return out;
}

/** Seamless loop of creaky rubber stretch (rate/gain driven by strain). */
export function stretchLoop(sr: number): Float32Array {
  const len = sr; const out = new Float32Array(len); let lp = 0, bp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr; const n = noise(); lp += (n - lp) * 0.08; bp += (lp - bp) * 0.5;
    const grain = Math.max(0, Math.sin(2 * Math.PI * 23 * t)) ** 8;
    out[i] = (lp - bp * 0.5) * (0.4 + grain * 1.6) * 1.4 + Math.sin(2 * Math.PI * 92 * t) * grain * 0.25;
  }
  return out;
}

/** Office room tone: seamless brown-ish noise bed with a faint HVAC hum. */
export function roomTone(sr: number): Float32Array {
  const len = sr * 4; const raw = new Float32Array(len + sr); let b = 0;
  for (let i = 0; i < raw.length; i++) { b = (b + 0.02 * noise()) * 0.995; raw[i] = b * 3 + Math.sin(2 * Math.PI * 120 * i / sr) * 0.015; }
  const out = raw.slice(0, len);
  for (let i = 0; i < sr; i++) { const k = i / sr; out[i] = out[i] * k + raw[len + i] * (1 - k); }
  return out;
}

/**
 * Amber alarm pulse, one loop cycle per stage. A soft, round "bwom" (not a siren sweep):
 * stage 1 slow single pulse, stage 2 double pulse + sub, stage 3 fast triple with a brighter top.
 */
export function alarmCycle(sr: number, stage: 1 | 2 | 3): Float32Array {
  const period = stage === 1 ? 1.2 : stage === 2 ? 0.9 : 0.6;
  const hits = stage === 1 ? [0] : stage === 2 ? [0, 0.22] : [0, 0.14, 0.28];
  const len = Math.round(sr * period); const out = new Float32Array(len);
  const base = stage === 3 ? 622 : 587; // D5, up to Eb5 at the last stage
  for (const [k, start] of hits.entries()) {
    const f = k === hits.length - 1 && stage > 1 ? base * 0.84 : base;
    const s0 = Math.round(start * sr); const dur = Math.round(sr * (stage === 3 ? 0.12 : 0.2));
    for (let i = 0; i < dur && s0 + i < len; i++) {
      const t = i / sr; const e = Math.min(1, t / 0.012) * Math.exp(-t / (stage === 3 ? 0.05 : 0.08));
      let v = Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(2 * Math.PI * f * 2 * t) * 0.12;
      if (stage >= 2) v += Math.sin(2 * Math.PI * f * 0.5 * t) * 0.35;
      if (stage === 3) v += (2 * ((f * 1.5 * t) % 1) - 1) * 0.1;
      out[s0 + i] += v * e * 0.6;
    }
  }
  return out;
}

/** Low, uneasy two-note pulse for the suspicious stage. */
export function alarmTension(sr: number): Float32Array {
  const len = Math.round(sr * 2.4); const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr; const beat = t % 1.2; const f = beat < 0.52 ? 92 : 69;
    const e = Math.min(1, beat / 0.04) * Math.exp(-Math.max(0, beat - 0.18) / 0.55);
    out[i] = (Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(2 * Math.PI * f * 2.01 * t)) * e * 0.34;
  }
  return out;
}

/** Full alarm klaxon: a bright, unmistakable up/down sweep with a sub body. */
export function alarmKlaxon(sr: number): Float32Array {
  const len = Math.round(sr * 1.8); const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr; const phase = (t % 0.9) / 0.9;
    const f = 520 + 360 * Math.sin(Math.PI * phase) ** 2;
    const e = Math.min(1, (t % 0.9) / 0.025) * Math.min(1, (0.9 - (t % 0.9)) / 0.06);
    out[i] = (Math.sin(2 * Math.PI * f * t) * 0.62 + Math.sin(2 * Math.PI * f * 0.5 * t) * 0.26) * e;
  }
  return out;
}
