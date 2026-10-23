export interface NumericVector3 { x: number; y: number; z: number }

export interface SnapshotSample {
  /** Optional receive-clock timestamp; `push` accepts it as its second argument too. */
  t?: number;
  pos: NumericVector3;
  vel?: NumericVector3;
  yaw?: number;
  pitch?: number;
  roll?: number;
  connected?: boolean;
  captured?: boolean;
}

type BufferedSample = SnapshotSample & { t: number };

export interface InterpolatedSnapshot {
  pos: NumericVector3;
  vel: NumericVector3;
  yaw: number;
  pitch: number;
  roll: number;
  extrapolating: boolean;
  delayMs: number;
}

const MAX_SNAPSHOTS = 32;
const MAX_SPEED = 60;
const MAX_EXTRAPOLATION = 150;
const CORRECTION_TAU = 120;

function copy(v: NumericVector3): NumericVector3 { return { x: v.x, y: v.y, z: v.z }; }
function finiteVector(v?: NumericVector3): v is NumericVector3 {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
function speed(v?: NumericVector3): number {
  return finiteVector(v) ? Math.hypot(v.x, v.y, v.z) : Number.POSITIVE_INFINITY;
}
function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
function angleLerp(a: number, b: number, f: number): number { return a + angleDelta(a, b) * f; }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

/** A small, clock-domain-agnostic snapshot buffer for remote presentation. */
export class SnapshotInterpolator {
  private readonly snapshots: BufferedSample[] = [];
  private meanInterval = 50;
  private jitter = 0;
  private delayMs = 100;
  private renderTime = -Infinity;
  private lastOutput: InterpolatedSnapshot | null = null;
  private lastOutputAt = 0;
  private correction: NumericVector3 = { x: 0, y: 0, z: 0 };
  private angleCorrection = { yaw: 0, pitch: 0, roll: 0 };
  private previousConnected: boolean | undefined;
  private previousCaptured: boolean | undefined;
  private wasExtrapolating = false;
  private lastReceivedAt = -Infinity;

  push(sample: SnapshotSample, receivedAtMs?: number): void {
    const timestamp = receivedAtMs ?? sample.t;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || !finiteVector(sample.pos)) return;
    const next: BufferedSample = {
      ...sample,
      t: timestamp,
      pos: copy(sample.pos),
      vel: finiteVector(sample.vel) ? copy(sample.vel) : undefined,
      yaw: sample.yaw ?? 0,
      pitch: sample.pitch ?? 0,
      roll: sample.roll ?? 0,
    };
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && next.t < last.t) return;
    if (last && next.t === last.t) this.snapshots[this.snapshots.length - 1] = next;
    else {
      if (this.lastReceivedAt > -Infinity) {
        const interval = next.t - this.lastReceivedAt;
        if (interval > 0 && interval < 1000) {
          this.jitter += (Math.abs(interval - this.meanInterval) - this.jitter) * 0.12;
          this.meanInterval += (interval - this.meanInterval) * 0.12;
          const wanted = clamp(this.meanInterval + 2.5 * this.jitter + 16, 80, 220);
          this.delayMs += clamp(wanted - this.delayMs, -4, 4);
        }
      }
      if (last) {
        const interval = next.t - last.t;
        if (interval <= 0) return;
      }
      this.snapshots.push(next);
      if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    }
    this.lastReceivedAt = Math.max(this.lastReceivedAt, next.t);

    const reconnect = this.previousConnected === false && next.connected === true;
    const recapture = this.previousCaptured !== undefined && this.previousCaptured !== next.captured;
    const teleport = this.lastOutput !== null && Math.hypot(
      next.pos.x - this.lastOutput.pos.x, next.pos.y - this.lastOutput.pos.y, next.pos.z - this.lastOutput.pos.z,
    ) > 6;
    if (reconnect || recapture || teleport) this.snap(next);
    else if (this.wasExtrapolating && this.lastOutput) {
      const raw = this.evaluate(this.renderTime);
      this.correction = { x: this.lastOutput.pos.x - raw.pos.x, y: this.lastOutput.pos.y - raw.pos.y, z: this.lastOutput.pos.z - raw.pos.z };
      this.angleCorrection = {
        yaw: angleDelta(raw.yaw, this.lastOutput.yaw), pitch: angleDelta(raw.pitch, this.lastOutput.pitch), roll: angleDelta(raw.roll, this.lastOutput.roll),
      };
    }
    this.previousConnected = next.connected;
    this.previousCaptured = next.captured;
  }

  reset(): void {
    this.snapshots.length = 0;
    this.lastOutput = null;
    this.correction = { x: 0, y: 0, z: 0 };
    this.angleCorrection = { yaw: 0, pitch: 0, roll: 0 };
    this.renderTime = -Infinity;
    this.previousConnected = undefined;
    this.previousCaptured = undefined;
    this.wasExtrapolating = false;
    this.lastReceivedAt = -Infinity;
  }

  sample(nowMs: number): InterpolatedSnapshot | null {
    if (!this.snapshots.length) return this.lastOutput;
    const newest = this.snapshots[this.snapshots.length - 1];
    if (newest.connected === false) {
      const frozen = this.lastOutput ?? this.evaluate(newest.t);
      this.lastOutput = { ...frozen, pos: copy(frozen.pos), vel: { x: 0, y: 0, z: 0 }, extrapolating: false, delayMs: this.delayMs };
      this.wasExtrapolating = false;
      return this.lastOutput;
    }
    const requested = nowMs - this.delayMs;
    this.renderTime = Math.max(this.renderTime, requested);
    const raw = this.evaluate(this.renderTime);
    const dt = this.lastOutput ? Math.max(0, nowMs - this.lastOutputAt) : 0;
    const factor = Math.exp(-dt / CORRECTION_TAU);
    this.correction.x *= factor; this.correction.y *= factor; this.correction.z *= factor;
    this.angleCorrection.yaw *= factor; this.angleCorrection.pitch *= factor; this.angleCorrection.roll *= factor;
    const out: InterpolatedSnapshot = {
      pos: { x: raw.pos.x + this.correction.x, y: raw.pos.y + this.correction.y, z: raw.pos.z + this.correction.z },
      vel: copy(raw.vel), yaw: raw.yaw + this.angleCorrection.yaw, pitch: raw.pitch + this.angleCorrection.pitch, roll: raw.roll + this.angleCorrection.roll,
      extrapolating: raw.extrapolating, delayMs: this.delayMs,
    };
    this.lastOutputAt = nowMs;
    this.lastOutput = out;
    // Keep the correction path armed after the 150 ms extrapolation window too:
    // once the buffer is empty ahead of renderTime, a newly received sample
    // can otherwise make the held pose jump an entire buffer gap in one frame.
    this.wasExtrapolating = raw.extrapolating || this.renderTime > newest.t;
    return out;
  }

  private snap(sample: BufferedSample): void {
    this.snapshots.length = 0;
    this.snapshots.push({ ...sample, pos: copy(sample.pos), vel: finiteVector(sample.vel) ? copy(sample.vel) : undefined });
    this.correction = { x: 0, y: 0, z: 0 };
    this.angleCorrection = { yaw: 0, pitch: 0, roll: 0 };
    this.renderTime = sample.t;
    this.lastOutput = null;
    this.lastOutputAt = 0;
    this.wasExtrapolating = false;
    this.lastReceivedAt = sample.t;
  }

  private evaluate(t: number): InterpolatedSnapshot {
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    if (t <= first.t) return this.pose(first, false);
    for (let i = 1; i < this.snapshots.length; i++) {
      const b = this.snapshots[i];
      if (t <= b.t) return this.between(this.snapshots[i - 1], b, t);
    }
    const age = t - last.t;
    if (age <= MAX_EXTRAPOLATION && finiteVector(last.vel) && speed(last.vel) <= MAX_SPEED) {
      return { ...this.pose(last, true), pos: { x: last.pos.x + last.vel.x * age / 1000, y: last.pos.y + last.vel.y * age / 1000, z: last.pos.z + last.vel.z * age / 1000 }, vel: copy(last.vel) };
    }
    if (finiteVector(last.vel) && speed(last.vel) <= MAX_SPEED) {
      // Hold the end of the permitted extrapolation, rather than jumping back
      // to the snapshot when the limit expires.
      return {
        ...this.pose(last, false),
        pos: {
          x: last.pos.x + last.vel.x * MAX_EXTRAPOLATION / 1000,
          y: last.pos.y + last.vel.y * MAX_EXTRAPOLATION / 1000,
          z: last.pos.z + last.vel.z * MAX_EXTRAPOLATION / 1000,
        },
        vel: { x: 0, y: 0, z: 0 },
      };
    }
    return { ...this.pose(last, false), vel: { x: 0, y: 0, z: 0 } };
  }

  private pose(s: BufferedSample, extrapolating: boolean): InterpolatedSnapshot {
    return { pos: copy(s.pos), vel: finiteVector(s.vel) ? copy(s.vel) : { x: 0, y: 0, z: 0 }, yaw: s.yaw ?? 0, pitch: s.pitch ?? 0, roll: s.roll ?? 0, extrapolating, delayMs: this.delayMs };
  }

  private between(a: BufferedSample, b: BufferedSample, t: number): InterpolatedSnapshot {
    const f = clamp((t - a.t) / (b.t - a.t), 0, 1);
    const dt = (b.t - a.t) / 1000;
    const av = finiteVector(a.vel) ? a.vel : undefined;
    const bv = finiteVector(b.vel) ? b.vel : undefined;
    const usable = !!av && !!bv && speed(av) <= MAX_SPEED && speed(bv) <= MAX_SPEED;
    if (!usable) {
      return { ...this.pose(b, false), pos: { x: a.pos.x + (b.pos.x - a.pos.x) * f, y: a.pos.y + (b.pos.y - a.pos.y) * f, z: a.pos.z + (b.pos.z - a.pos.z) * f }, vel: { x: (b.pos.x - a.pos.x) / dt, y: (b.pos.y - a.pos.y) / dt, z: (b.pos.z - a.pos.z) / dt } };
    }
    const h00 = 2*f*f*f - 3*f*f + 1, h10 = f*f*f - 2*f*f + f, h01 = -2*f*f*f + 3*f*f, h11 = f*f*f - f*f;
    const dh00 = 6*f*f - 6*f, dh10 = 3*f*f - 4*f + 1, dh01 = -6*f*f + 6*f, dh11 = 3*f*f - 2*f;
    const pos = { x: h00*a.pos.x + h10*av!.x*dt + h01*b.pos.x + h11*bv!.x*dt, y: h00*a.pos.y + h10*av!.y*dt + h01*b.pos.y + h11*bv!.y*dt, z: h00*a.pos.z + h10*av!.z*dt + h01*b.pos.z + h11*bv!.z*dt };
    const vel = {
      x: (dh00*a.pos.x + dh10*av!.x*dt + dh01*b.pos.x + dh11*bv!.x*dt) / dt,
      y: (dh00*a.pos.y + dh10*av!.y*dt + dh01*b.pos.y + dh11*bv!.y*dt) / dt,
      z: (dh00*a.pos.z + dh10*av!.z*dt + dh01*b.pos.z + dh11*bv!.z*dt) / dt,
    };
    return { pos, vel, yaw: angleLerp(a.yaw ?? 0, b.yaw ?? 0, f), pitch: angleLerp(a.pitch ?? 0, b.pitch ?? 0, f), roll: angleLerp(a.roll ?? 0, b.roll ?? 0, f), extrapolating: false, delayMs: this.delayMs };
  }
}
