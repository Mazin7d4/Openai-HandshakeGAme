// Renders the PIX & NEE music loops and stingers offline (original, procedural, no samples).
// Usage: node tools/audio/render-music.mjs <outDir>   -> writes WAVs; encode with tools/audio/encode.sh
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SR = 44100;
const BPM = 112;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const EIGHTH = BEAT / 2;
const SWING = 0.6; // offbeat 8ths land at 60% of the beat
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 1234567;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const noise = () => rnd() * 2 - 1;

class Mix {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
    this.verb = new Float32Array(this.n);
  }
  add(t, samples, gain = 1, pan = 0, send = 0) {
    const start = Math.round(t * SR);
    const gl = gain * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2;
    const gr = gain * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    for (let i = 0; i < samples.length; i++) {
      const j = start + i;
      if (j < 0 || j >= this.n) continue;
      const s = samples[i];
      this.L[j] += s * gl; this.R[j] += s * gr; this.verb[j] += s * gain * send;
    }
  }
  // Small Schroeder reverb on the send bus.
  reverb(wet = 0.25) {
    const combs = [1116, 1188, 1277, 1356].map((d, k) => ({ d, buf: new Float32Array(d), i: 0, fb: 0.78 - k * 0.01, lp: 0 }));
    const aps = [556, 441].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
    const out = new Float32Array(this.n);
    for (let j = 0; j < this.n; j++) {
      let acc = 0;
      for (const c of combs) {
        const y = c.buf[c.i];
        c.lp = y * 0.6 + c.lp * 0.4;
        c.buf[c.i] = this.verb[j] + c.lp * c.fb;
        c.i = (c.i + 1) % c.d; acc += y;
      }
      for (const a of aps) {
        const b = a.buf[a.i];
        const y = -acc + b; a.buf[a.i] = acc + b * 0.5; a.i = (a.i + 1) % a.d; acc = y;
      }
      out[j] = acc * 0.25;
    }
    for (let j = 0; j < this.n; j++) {
      const d = Math.min(this.n - 1, j + 331);
      this.L[j] += out[j] * wet; this.R[d] += out[j] * wet;
    }
  }
}

const env = (len, a, decay) => (i) => (i < a ? i / a : Math.exp(-(i - a) / decay)) * (i > len - 200 ? (len - i) / 200 : 1);

function pluckBass(freq, dur, bright = 0.5) {
  const len = Math.floor(dur * SR); const out = new Float32Array(len);
  const period = Math.max(2, Math.round(SR / freq)); const buf = new Float32Array(period);
  for (let i = 0; i < period; i++) buf[i] = noise() * 0.5 + Math.sin(2 * Math.PI * i / period) * 0.8;
  let idx = 0, lp = 0;
  const e = env(len, 40, SR * 0.35);
  for (let i = 0; i < len; i++) {
    const a = buf[idx], b = buf[(idx + 1) % period];
    buf[idx] = (a + b) * 0.5 * 0.996; idx = (idx + 1) % period;
    lp += (a - lp) * (0.12 + bright * 0.2);
    out[i] = (lp * 0.9 + Math.sin(2 * Math.PI * freq * i / SR) * 0.35) * e(i);
  }
  return out;
}
function vibe(freq, dur, decay = 0.9, mallet = 1) {
  const len = Math.floor(dur * SR); const out = new Float32Array(len);
  const e = env(len, 30, SR * decay); const e2 = env(len, 10, SR * 0.06);
  for (let i = 0; i < len; i++) {
    const t = i / SR; const trem = 1 - 0.18 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 5.2 * t));
    out[i] = (Math.sin(2 * Math.PI * freq * t) * e(i) * trem + Math.sin(2 * Math.PI * freq * 4 * t) * 0.3 * e2(i) * mallet + Math.sin(2 * Math.PI * freq * 10 * t) * 0.08 * e2(i) * mallet) * 0.5;
  }
  return out;
}
function marimba(freq, dur = 0.5) {
  const len = Math.floor(dur * SR); const out = new Float32Array(len);
  const e = env(len, 20, SR * 0.16); const e2 = env(len, 5, SR * 0.02);
  for (let i = 0; i < len; i++) { const t = i / SR; out[i] = (Math.sin(2 * Math.PI * freq * t) * e(i) + Math.sin(2 * Math.PI * freq * 3.93 * t) * 0.4 * e2(i)) * 0.6; }
  return out;
}
function hat(dur = 0.05, open = false) {
  const len = Math.floor((open ? 0.25 : dur) * SR); const out = new Float32Array(len);
  let prev = 0, hp = 0; const e = env(len, 8, SR * (open ? 0.08 : 0.018));
  for (let i = 0; i < len; i++) { const x = noise(); hp = 0.85 * (hp + x - prev); prev = x; out[i] = hp * e(i) * 0.5; }
  return out;
}
function bandNoise(dur, center, q, decay) {
  const len = Math.floor(dur * SR); const out = new Float32Array(len);
  const w = 2 * Math.PI * center / SR; const alpha = Math.sin(w) / (2 * q); const cs = Math.cos(w);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * cs, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const e = env(len, 10, SR * decay);
  for (let i = 0; i < len; i++) { const x = noise(); const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y * e(i); }
  return out;
}
function snap() { const s = bandNoise(0.12, 2200, 3, 0.03); for (let i = 0; i < 60; i++) s[i] += noise() * (1 - i / 60) * 0.6; return s; }
function snare() { const n = bandNoise(0.22, 1800, 0.7, 0.06); const len = n.length; for (let i = 0; i < len; i++) n[i] = n[i] * 1.2 + Math.sin(2 * Math.PI * 185 * i / SR) * Math.exp(-i / (SR * 0.04)) * 0.6; return n; }
function kick(level = 1) {
  const len = Math.floor(0.32 * SR); const out = new Float32Array(len); let ph = 0;
  for (let i = 0; i < len; i++) { const t = i / SR; const f = 45 + 80 * Math.exp(-t * 28); ph += 2 * Math.PI * f / SR; out[i] = Math.sin(ph) * Math.exp(-t * 9) * level; }
  return out;
}
function saw(freq, dur, cutoff = 1200, attack = 0.01, decay = 0.25, detune = 0.006, sustain = 0) {
  const len = Math.floor(dur * SR); const out = new Float32Array(len);
  const ph = [0, 0, 0]; const det = [1 - detune, 1, 1 + detune]; let lp1 = 0, lp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR; let s = 0;
    for (let k = 0; k < 3; k++) { ph[k] = (ph[k] + freq * det[k] / SR) % 1; s += ph[k] * 2 - 1; }
    const amp = t < attack ? t / attack : sustain + (1 - sustain) * Math.exp(-(t - attack) / decay);
    const fc = Math.min(0.99, (cutoff * (0.4 + amp)) / SR * 2 * Math.PI);
    lp1 += (s / 3 - lp1) * fc; lp2 += (lp1 - lp2) * fc;
    const rel = i > len - 400 ? (len - i) / 400 : 1;
    out[i] = lp2 * amp * rel;
  }
  return out;
}
function swell(dur, from, to) { // noise riser / cymbal swell
  const len = Math.floor(dur * SR); const out = new Float32Array(len); let prev = 0, hp = 0;
  for (let i = 0; i < len; i++) { const x = noise(); hp = 0.9 * (hp + x - prev); prev = x; const p = i / len; out[i] = hp * (from + (to - from) * p * p) * 0.4; }
  return out;
}
function crash(dur = 1.6) { const out = hat(dur, true); const len = Math.floor(dur * SR); const o = new Float32Array(len); let prev = 0, hp = 0; for (let i = 0; i < len; i++) { const x = noise(); hp = 0.8 * (hp + x - prev); prev = x; o[i] = hp * Math.exp(-i / (SR * 0.45)) * 0.45; } return o.length ? o : out; }

// Progression in D minor: Dm9 Dm9 Gm9 Gm9 Bbmaj9 A7b9 Dm9 A7b9
const ROOTS = [38, 38, 43, 43, 34, 33, 38, 33];
const VOICINGS = { 38: [65, 69, 72, 76], 43: [58, 62, 65, 69], 34: [62, 65, 69, 72], 33: [55, 61, 65, 70] };
const BARS = 16;
const LOOP = BAR * BARS;
const at = (bar, eighth) => bar * BAR + Math.floor(eighth / 2) * BEAT + (eighth % 2 ? BEAT * SWING : 0);

function fold(mix) { // wrap the tail past LOOP onto the start for a seamless loop
  const n = Math.round(LOOP * SR);
  for (let j = n; j < mix.n; j++) { mix.L[j - n] += mix.L[j]; mix.R[j - n] += mix.R[j]; }
  return { L: mix.L.subarray(0, n), R: mix.R.subarray(0, n) };
}

function calmLayer() {
  const m = new Mix(LOOP + 3);
  for (let bar = 0; bar < BARS; bar++) {
    const root = ROOTS[bar % 8]; const next = ROOTS[(bar + 1) % 8];
    for (const [e, off, v] of [[0, 0, 1], [3, 0, 0.7], [4, 3, 0.85], [6, 5, 0.8], [7, next - root - 1 + 12 * 0, 0.7]]) {
      m.add(at(bar, e), pluckBass(mtof(root + off), e === 0 ? 0.5 : 0.32), 0.55 * v, -0.05, 0.05);
    }
    for (let e = 0; e < 8; e++) m.add(at(bar, e), hat(), (e % 2 ? 0.16 : 0.1) * (0.85 + rnd() * 0.3), 0.35, 0.02);
    m.add(at(bar, 2), snap(), 0.42, -0.25, 0.25); m.add(at(bar, 6), snap(), 0.42, -0.25, 0.25);
    m.add(at(bar, 0), kick(0.8), 0.34); m.add(at(bar, 5), kick(0.6), 0.24);
    const chord = VOICINGS[root];
    chord.forEach((n, k) => { m.add(at(bar, 3) + k * 0.004, vibe(mtof(n), 0.9, 0.35), 0.11, 0.3 - k * 0.15, 0.35); });
    if (bar % 2 === 1) chord.forEach((n, k) => m.add(at(bar, 6) + k * 0.004, vibe(mtof(n), 0.6, 0.2), 0.07, 0.25 - k * 0.12, 0.35));
  }
  // Sneaky marimba motif (bars 1-2 and 5-6, varied in the second half)
  const motif = [
    [1, 4, 69], [1, 5, 72], [1, 6, 74], [1, 7, 77], [2, 0, 76], [2, 3, 74], [2, 5, 72],
    [5, 4, 69], [5, 5, 70], [5, 6, 69], [5, 7, 68], [6, 0, 69], [6, 2, 76], [6, 4, 74],
  ];
  for (const half of [0, 8]) for (const [b, e, n] of motif) {
    const note = half && b > 4 ? n + 12 : n;
    m.add(at(b + half, e), marimba(mtof(note)), 0.2, 0.15, 0.3);
  }
  m.reverb(0.35);
  return fold(m);
}

function escapeLayer() {
  const m = new Mix(LOOP + 3);
  for (let bar = 0; bar < BARS; bar++) {
    const root = ROOTS[bar % 8];
    for (let e = 0; e < 8; e++) m.add(at(bar, e), saw(mtof(root + (e % 2 ? 12 : 0)), 0.2, 700, 0.005, 0.09), 0.32, 0, 0);
    for (let b = 0; b < 4; b++) m.add(bar * BAR + b * BEAT, kick(1), 0.36);
    m.add(bar * BAR + BEAT, snare(), 0.32, 0.1, 0.2); m.add(bar * BAR + 3 * BEAT, snare(), 0.32, 0.1, 0.2);
    for (let s = 0; s < 16; s++) m.add(bar * BAR + s * BEAT / 4, bandNoise(0.05, 6500, 1.2, 0.012), s % 4 === 2 ? 0.14 : 0.07, -0.4, 0);
    // Amber pulse: soft square-ish 8th-note pulse on the chord's top two notes
    const chord = VOICINGS[root];
    for (let e = 0; e < 8; e += 1) for (const n of chord.slice(2)) m.add(at(bar, e), saw(mtof(n), 0.16, 1800, 0.004, 0.05, 0.01), e % 2 ? 0.05 : 0.08, 0.35, 0.15);
    if (bar % 2 === 0) chord.forEach((n, k) => m.add(bar * BAR, saw(mtof(n - 12), 0.7, 2400, 0.01, 0.25, 0.008), 0.12, -0.3 + k * 0.2, 0.3));
    if (bar % 8 === 7) for (let s = 0; s < 4; s++) m.add(bar * BAR + 3 * BEAT + s * BEAT / 4, kick(0.7).map((x, i) => x * Math.sin(i / 30)), 0.25, 0.2 - s * 0.15);
  }
  m.reverb(0.25);
  return fold(m);
}

function sting(kind) {
  const m = new Mix(4);
  if (kind === 'theft') {
    m.add(0, kick(1.2), 0.9); m.add(0, crash(2), 0.5, 0.2, 0.3);
    [62, 65, 69, 74].forEach((n, k) => m.add(0, saw(mtof(n - 12), 0.9, 2600, 0.005, 0.3, 0.01), 0.22, -0.3 + k * 0.2, 0.4));
    for (let s = 0; s < 8; s++) m.add(0.55 + s * 0.07, marimba(mtof(69 + s)), 0.3, 0.2, 0.3);
    m.add(0.55, swell(0.56, 0, 1), 0.5, -0.2, 0.2);
    m.add(1.12, kick(1), 0.7); [57, 61, 64, 67].forEach((n, k) => m.add(1.12, saw(mtof(n), 1.2, 2200, 0.005, 0.4, 0.01), 0.2, -0.3 + k * 0.2, 0.4));
  } else if (kind === 'win') {
    const arp = [62, 66, 69, 74, 76, 78, 81, 86];
    arp.forEach((n, k) => m.add(k * 0.09, marimba(mtof(n), 0.6), 0.32, -0.4 + k * 0.1, 0.3));
    m.add(0.72, kick(1), 0.8); m.add(0.72, crash(2.4), 0.5, 0, 0.4);
    [50, 62, 66, 69, 73, 76].forEach((n, k) => m.add(0.72 + k * 0.006, vibe(mtof(n), 2.6, 1.2), 0.16, -0.4 + k * 0.16, 0.5));
    m.add(0.72, pluckBass(mtof(38), 1.2), 0.7);
    m.add(1.15, snap(), 0.5, -0.3, 0.3); m.add(1.42, snap(), 0.5, 0.3, 0.3);
  } else if (kind === 'vault') {
    [57, 60, 64, 69, 72].forEach((n, k) => m.add(k * 0.06, vibe(mtof(n), 1.6, 0.7), 0.2, -0.3 + k * 0.15, 0.5));
    m.add(0, swell(0.3, 1, 0), 0.25);
  }
  m.reverb(0.4);
  return { L: m.L, R: m.R };
}

function writeWav(path, { L, R }, peakDb = -1) {
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0 ? 10 ** (peakDb / 20) / peak : 1;
  const n = L.length; const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.tanh(L[i] * g * 1.1) / Math.tanh(1.1), r = Math.tanh(R[i] * g * 1.1) / Math.tanh(1.1);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), 46 + i * 4);
  }
  writeFileSync(path, buf);
  return g;
}

const out = process.argv[2] ?? 'audio-build';
mkdirSync(out, { recursive: true });
// Each layer is peak-normalised; the runtime mixes the escape layer on top of the calm one.
const calm = calmLayer(); const esc = escapeLayer();
writeWav(join(out, 'music-calm.wav'), calm, -3);
writeWav(join(out, 'music-escape.wav'), esc, -3);
for (const k of ['theft', 'win', 'vault']) writeWav(join(out, `sting-${k}.wav`), sting(k), -1);
console.log(`loop ${LOOP.toFixed(3)} s at ${BPM} BPM`);
