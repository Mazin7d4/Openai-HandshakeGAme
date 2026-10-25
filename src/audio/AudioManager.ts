import { getSettings, saveSettings, subscribeSettings } from '../ui/Settings.ts';
import { SFX_SPRITE, type SpriteKey } from './sfxSprite.ts';
import {
  alarmCycle, alarmKlaxon, alarmTension, chirpParams, passCue, roomTone, snap, stretchLoop, twang, whoosh, zz, ZZ,
  type ChirpMood, type Voice,
} from './synth.ts';

/**
 * PIX & NEE audio hub. One singleton: `import { audio } from '../audio/AudioManager.ts'`.
 *
 * One-shots: `audio.play(event, opts)`. Every event, what it is and what opts it reads:
 *   UI ......... uiHover, uiClick, uiConfirm, uiBack, uiToggle, uiError (menus wire themselves via data-sound / button text)
 *   Tether ..... twang {intensity 0..1 = tension -> pitch}, snap (cord hits full length), yank {intensity},
 *                yanked (being pulled), slingshot, bump
 *   Flight ..... boost {position}, impact {intensity 0..1 = velocity, position}
 *   Objects .... grab, drop, throw {position}
 *   Hacking .... hackStart, hackTick {progress 0..1 -> pitch}, hackSuccess, hackFail
 *   Security ... suspicious (detection building), spotted {role, position}, stun (clothesline / patrol stunned),
 *                cameraBlind, capture {role, position}, rescue {role, position}
 *   Heist ...... vaultOpen, theft (core grabbed; ducks music), extract (win jingle; stops alarm + music)
 *   Drones ..... chirp {role, mood (face expression), position}
 *   positions are world {x,y,z}; anything with a position is panned/attenuated from the camera.
 *
 * Continuous state (idempotent, safe to call every frame or from replicated room state):
 *   setAlarmStage(0..3)        0 = off; 1..3 = amber pulse escalation; stages 2..3 also bring in the escape music layer
 *   setMusic('off'|'calm'|'escape')
 *   setTension(strain 0..1)    cord stretch creak + auto twang on release / snap on hitting full length
 *   setDroneMotion(role, speed, position, isLocal)  thruster hum per drone (PIX lower, NEE higher)
 *   setListener(position, right)                    camera for panning
 *   endSession()               stops loops when a game ends
 * Volumes: setMasterVolume / setMusicVolume / setSfxVolume / setUiVolume (0..1), setMuted / toggleMute (key M).
 */
export type AudioEvent =
  | 'uiHover' | 'uiClick' | 'uiConfirm' | 'uiBack' | 'uiToggle' | 'uiError'
  | 'twang' | 'snap' | 'yank' | 'yanked' | 'slingshot' | 'bump'
  | 'boost' | 'impact'
  | 'grab' | 'drop' | 'throw' | 'pass'
  | 'hackStart' | 'hackTick' | 'hackSuccess' | 'hackFail'
  | 'suspicious' | 'spotted' | 'stun' | 'cameraBlind' | 'capture' | 'rescue'
  | 'vaultOpen' | 'theft' | 'extract'
  | 'chirp' | 'ping' | 'emote'
  | 'replayDrop';

export const AUDIO_EVENTS: readonly AudioEvent[] = [
  'uiHover', 'uiClick', 'uiConfirm', 'uiBack', 'uiToggle', 'uiError',
  'twang', 'snap', 'yank', 'yanked', 'slingshot', 'bump', 'boost', 'impact', 'grab', 'drop', 'throw',
  'hackStart', 'hackTick', 'hackSuccess', 'hackFail', 'pass',
  'suspicious', 'spotted', 'stun', 'cameraBlind', 'capture', 'rescue', 'vaultOpen', 'theft', 'extract', 'chirp', 'ping', 'emote', 'replayDrop',
];

export type DroneVoice = Voice;
export type { ChirpMood };
export interface Vec3Like { x: number; y: number; z: number }
export interface PlayOptions {
  position?: Vec3Like | null;
  intensity?: number;
  progress?: number;
  role?: DroneVoice | null;
  mood?: ChirpMood;
  volume?: number;
}
export type MusicState = 'off' | 'calm' | 'escape';
type Bus = 'sfx' | 'ui';

const STORE = 'handshake.audio';
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const MAX_VOICES: Partial<Record<string, number>> = { uiHover: 2, hackTick: 3, impact: 4, chirp: 3, twang: 2, snap: 2 };

interface HumVoice { osc: OscillatorNode; osc2: OscillatorNode; lp: BiquadFilterNode; air: AudioBufferSourceNode; airGain: GainNode; gain: GainNode; pan: StereoPannerNode; jitter: number }

export class AudioManager {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private buses: Record<'music' | 'sfx' | 'ui' | 'duck', GainNode> | null = null;
  private sprite: AudioBuffer | null = null;
  private spriteBytes: Promise<ArrayBuffer | null> | null = null;
  private spriteDecode: Promise<void> | null = null;
  private readonly synthCache = new Map<string, AudioBuffer>();
  private readonly voices = new Map<string, { src: AudioBufferSourceNode; end: number }[]>();
  private activeTotal = 0;
  private maxTotal = 24;
  private volumes = { master: 0.8, music: 0.55, sfx: 0.9, ui: 0.7 };
  private muted = false;
  private listenerPos: Vec3Like = { x: 0, y: 0, z: 0 };
  private listenerRight: Vec3Like = { x: 1, y: 0, z: 0 };
  private readonly hums = new Map<DroneVoice, HumVoice>();
  private stretch: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private strain = 0;
  private strainPeak = 0;
  private lastSnap = 0;
  private lastTwang = 0;
  private alarm: {
    stage: number;
    src: AudioBufferSourceNode | null;
    gain: GainNode | null;
    tensionSrc: AudioBufferSourceNode | null;
    tensionGain: GainNode | null;
    klaxonSrc: AudioBufferSourceNode | null;
    klaxonGain: GainNode | null;
  } = { stage: 0, src: null, gain: null, tensionSrc: null, tensionGain: null, klaxonSrc: null, klaxonGain: null };
  private music: MusicState = 'off';
  private musicBuffers: Promise<Record<'calm' | 'escape', AudioBuffer> | null> | null = null;
  private musicNodes: { calm: GainNode; escape: GainNode; srcs: AudioBufferSourceNode[] } | null = null;
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private lastHover = 0;
  private installed = false;
  private hiddenSuspended = false;
  /** Count of sounds started, per event (read by tools/verify-audio.mjs). */
  readonly stats: Record<string, number> = {};

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      for (const k of ['music', 'sfx', 'ui'] as const) if (typeof saved[k] === 'number') this.volumes[k] = clamp(saved[k]);
      this.muted = saved.muted === true;
    } catch { /* defaults */ }
    this.volumes.master = clamp(getSettings().masterVolume / 100);
    subscribeSettings((s) => { this.volumes.master = clamp(s.masterVolume / 100); this.applyVolumes(); });
  }

  /** Global listeners: unlock on first gesture, menu UI sounds, M to mute, pause on hidden tab. Idempotent. */
  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'touchend', 'keydown'] as const) window.addEventListener(type, unlock, { capture: true, passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      this.toggleMute();
    });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden && this.ctx.state === 'running') { this.hiddenSuspended = true; void this.ctx.suspend(); }
      else if (!document.hidden && this.hiddenSuspended) { this.hiddenSuspended = false; void this.ctx.resume(); }
    });
    // Delegated UI sounds: any <button> (and [data-sound]) in menus, HUD and overlays.
    document.addEventListener('pointerover', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const el = this.soundTarget(e.target);
      if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
      if (el.matches(':disabled')) return;
      const now = performance.now();
      if (now - this.lastHover < 45) return;
      this.lastHover = now;
      this.play('uiHover');
    }, true);
    document.addEventListener('click', (e) => {
      const el = this.soundTarget(e.target);
      if (!el || el.matches(':disabled')) return;
      this.play(this.clickSound(el));
    }, true);
    document.addEventListener('change', (e) => {
      if (e.target instanceof HTMLInputElement && ['range', 'checkbox', 'radio'].includes(e.target.type)) this.play('uiToggle');
    }, true);
    // Fetch the small SFX sprite once the page is idle so it never competes with the first frame.
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500));
    idle(() => { this.spriteBytes ??= this.fetchFirst('sfx'); });
  }

  private soundTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>('[data-sound],button,[role="button"],summary,select');
    if (!el || el.dataset.sound === 'none') return null;
    return el;
  }

  private clickSound(el: HTMLElement): AudioEvent {
    const explicit = el.dataset.sound;
    if (explicit === 'confirm') return 'uiConfirm';
    if (explicit === 'back') return 'uiBack';
    if (explicit === 'toggle') return 'uiToggle';
    if (explicit === 'click') return 'uiClick';
    const text = `${el.dataset.testid ?? ''} ${el.textContent ?? ''} ${el.className}`.toLowerCase();
    if (/\b(back|leave|cancel|close|quit|exit)\b/.test(text)) return 'uiBack';
    if (/(start|play|create|join|primary|resume|again|confirm|invite|copy)/.test(text)) return 'uiConfirm';
    return 'uiClick';
  }

  /** Create/resume the context inside a user gesture (required by iOS Safari and Chrome autoplay rules). */
  unlock(): void {
    try {
      if (!this.ctx) this.createGraph();
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state !== 'running' && !document.hidden) void ctx.resume();
      // iOS: playing any buffer inside the gesture fully unlocks output.
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination); silent.start();
      this.spriteBytes ??= this.fetchFirst('sfx');
      this.spriteDecode ??= this.decodeSprite();
    } catch { /* audio is optional */ }
  }

  get unlocked(): boolean { return this.ctx?.state === 'running'; }

  private createGraph(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 4; this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.18;
    const music = ctx.createGain(); const duck = ctx.createGain(); const sfx = ctx.createGain(); const ui = ctx.createGain();
    music.connect(duck).connect(this.master); sfx.connect(this.master); ui.connect(this.master);
    this.master.connect(this.limiter).connect(ctx.destination);
    this.buses = { music, duck, sfx, ui };
    // Weak/phone devices (the "low" graphics tier heuristics) get fewer simultaneous voices.
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || matchMedia('(pointer: coarse)').matches;
    if (weak) this.maxTotal = 14;
    ctx.onstatechange = () => { if (ctx.state === 'running') this.resync(); };
    this.applyVolumes();
    (window as unknown as { __pixAudio?: AudioManager }).__pixAudio = this;
  }

  /** Re-apply wanted state once the context actually runs (resume is async after the unlocking gesture). */
  private resync(): void {
    if (this.alarm.stage > 0 && !this.alarm.src) { const st = this.alarm.stage; this.alarm.stage = -1; this.setAlarmStage(st); }
    if (this.sessionActive) this.beginSession();
    else if (this.music !== 'off' && !this.musicNodes) { const m = this.music; this.music = 'off'; this.setMusic(m); }
  }

  /** Low tier keeps fewer simultaneous voices. */
  setQuality(tier: 'low' | 'medium' | 'high'): void { this.maxTotal = tier === 'low' ? 12 : tier === 'medium' ? 18 : 24; }

  private applyVolumes(): void {
    if (!this.ctx || !this.buses || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.03);
    this.buses.music.gain.setTargetAtTime(this.volumes.music, t, 0.03);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.03);
    this.buses.ui.gain.setTargetAtTime(this.volumes.ui, t, 0.03);
  }

  private persist(): void {
    try { localStorage.setItem(STORE, JSON.stringify({ music: this.volumes.music, sfx: this.volumes.sfx, ui: this.volumes.ui, muted: this.muted })); } catch { /* private mode */ }
  }

  setMasterVolume(v: number): void { saveSettings({ masterVolume: Math.round(clamp(v) * 100) }); }
  setMusicVolume(v: number): void { this.volumes.music = clamp(v); this.applyVolumes(); this.persist(); }
  setSfxVolume(v: number): void { this.volumes.sfx = clamp(v); this.applyVolumes(); this.persist(); }
  setUiVolume(v: number): void { this.volumes.ui = clamp(v); this.applyVolumes(); this.persist(); }
  setMuted(muted: boolean): void {
    this.muted = muted; this.applyVolumes(); this.persist();
    window.dispatchEvent(new CustomEvent('pix-audio-mute', { detail: { muted } }));
  }
  toggleMute(): boolean { this.setMuted(!this.muted); return this.muted; }
  get isMuted(): boolean { return this.muted; }
  get volumeLevels(): Readonly<{ master: number; music: number; sfx: number; ui: number }> { return { ...this.volumes }; }

  setListener(position: Vec3Like, right: Vec3Like): void {
    this.listenerPos = { x: position.x, y: position.y, z: position.z };
    const len = Math.hypot(right.x, right.y, right.z) || 1;
    this.listenerRight = { x: right.x / len, y: right.y / len, z: right.z / len };
  }

  /** gain 0..1 and pan -1..1 for a world position (5 units = 1 m). */
  private spatial(pos: Vec3Like | null | undefined): { gain: number; pan: number } {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listenerPos.x, dy = pos.y - this.listenerPos.y, dz = pos.z - this.listenerPos.z;
    const d = Math.hypot(dx, dy, dz);
    const gain = d > 140 ? 0 : 1 / (1 + Math.max(0, d - 10) / 22) ** 1.4;
    const pan = d < 0.01 ? 0 : clamp((dx * this.listenerRight.x + dy * this.listenerRight.y + dz * this.listenerRight.z) / Math.max(d, 6), -0.8, 0.8);
    return { gain, pan };
  }

  // ---------------------------------------------------------------- loading
  private fetchFirst(name: string): Promise<ArrayBuffer | null> {
    const probe = document.createElement('audio');
    const ogg = probe.canPlayType('audio/ogg; codecs="vorbis"') !== '';
    const base = `${import.meta.env.BASE_URL}audio/`;
    const url = `${base}${name}.${ogg ? 'ogg' : 'm4a'}`;
    return fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  }

  private async decode(bytes: ArrayBuffer | null): Promise<AudioBuffer | null> {
    if (!bytes || !this.ctx) return null;
    try { return await this.ctx.decodeAudioData(bytes.slice(0)); } catch { return null; }
  }

  private async decodeSprite(): Promise<void> {
    this.sprite = await this.decode(await (this.spriteBytes ?? Promise.resolve(null)));
  }

  /** Resolves when the SFX sprite is decoded (tests). */
  async ready(): Promise<boolean> {
    this.spriteBytes ??= this.fetchFirst('sfx');
    if (this.ctx) { this.spriteDecode ??= this.decodeSprite(); await this.spriteDecode; }
    return this.sprite !== null;
  }

  private synth(key: string, build: (sr: number) => Float32Array): AudioBuffer | null {
    const ctx = this.ctx; if (!ctx) return null;
    let buf = this.synthCache.get(key);
    if (!buf) {
      const data = build(ctx.sampleRate);
      buf = ctx.createBuffer(1, Math.max(1, data.length), ctx.sampleRate);
      buf.getChannelData(0).set(data);
      this.synthCache.set(key, buf);
    }
    return buf;
  }

  // ---------------------------------------------------------------- voices
  private start(
    event: string, buffer: AudioBuffer | null, opts: { bus?: Bus; gain?: number; rate?: number; pos?: Vec3Like | null; offset?: number; duration?: number; delay?: number },
  ): AudioBufferSourceNode | null {
    const ctx = this.ctx; const buses = this.buses;
    if (!ctx || !buses || !buffer || ctx.state !== 'running') return null;
    const { gain: g, pan } = this.spatial(opts.pos);
    const level = (opts.gain ?? 1) * g;
    if (level < 0.003) return null;
    const now = ctx.currentTime;
    const list = (this.voices.get(event) ?? []).filter((v) => v.end > now);
    const cap = Math.max(1, Math.round((MAX_VOICES[event] ?? 4) * (this.maxTotal < 20 ? 0.5 : 1)));
    while (list.length >= cap) { const old = list.shift(); try { old?.src.stop(); } catch { /* ended */ } }
    if (this.activeTotal >= this.maxTotal) return null;
    const src = ctx.createBufferSource(); src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1;
    const gn = ctx.createGain(); gn.gain.value = level;
    let node: AudioNode = src.connect(gn);
    if (pan !== 0) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(opts.bus === 'ui' ? buses.ui : buses.sfx);
    const when = now + (opts.delay ?? 0);
    const offset = opts.offset ?? 0; const dur = opts.duration ?? buffer.duration - offset;
    src.start(when, offset, dur);
    this.activeTotal++;
    src.onended = () => { this.activeTotal = Math.max(0, this.activeTotal - 1); gn.disconnect(); };
    list.push({ src, end: when + dur / (opts.rate ?? 1) });
    this.voices.set(event, list);
    this.stats[event] = (this.stats[event] ?? 0) + 1;
    return src;
  }

  private spr(event: string, key: SpriteKey, opts: { bus?: Bus; gain?: number; rate?: number; pos?: Vec3Like | null; delay?: number } = {}): void {
    if (!this.sprite) { this.spriteDecode ??= this.ctx ? this.decodeSprite() : null; return; }
    const [start, dur] = SFX_SPRITE[key];
    // Small pads absorb AAC encoder priming offsets.
    this.start(event, this.sprite, { ...opts, offset: Math.max(0, start - 0.01), duration: dur + 0.03 });
  }

  private duckMusic(seconds: number, depth = 0.3): void {
    const ctx = this.ctx; const duck = this.buses?.duck; if (!ctx || !duck) return;
    const t = ctx.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setTargetAtTime(depth, t, 0.03);
    duck.gain.setTargetAtTime(1, t + seconds, 0.35);
  }

  private readonly playListeners = new Set<(event: AudioEvent, opts: PlayOptions) => void>();
  private readonly alarmListeners = new Set<(stage: number) => void>();

  /** Subscribe to one-shots the hub actually plays (a11y visual cues, captions). */
  onPlay(listener: (event: AudioEvent, opts: PlayOptions) => void): () => void {
    this.playListeners.add(listener);
    return () => { this.playListeners.delete(listener); };
  }

  /** Subscribe to alarm stage changes (0 = off, 1..3 escalation). */
  onAlarmStage(listener: (stage: number) => void): () => void {
    this.alarmListeners.add(listener);
    return () => { this.alarmListeners.delete(listener); };
  }

  // ---------------------------------------------------------------- one-shots
  play(event: AudioEvent, opts: PlayOptions = {}): void {
    try {
      this.playInner(event, opts);
      for (const listener of this.playListeners) {
        try { listener(event, opts); } catch { /* a11y must never break audio */ }
      }
    } catch { /* audio must never break the game */ }
  }

  private playInner(event: AudioEvent, o: PlayOptions): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let pos: Vec3Like | null = o.position ?? null;
    const k = clamp(o.intensity ?? 0.6);
    const vol = o.volume ?? 1;
    switch (event) {
      case 'uiHover': return this.spr(event, 'ui_hover', { bus: 'ui', gain: 0.35 * vol, rate: 0.95 + Math.random() * 0.1 });
      case 'uiClick': return this.spr(event, 'ui_click', { bus: 'ui', gain: 0.8 * vol });
      case 'uiConfirm': return this.spr(event, 'ui_confirm', { bus: 'ui', gain: 0.7 * vol });
      case 'uiBack': return this.spr(event, 'ui_back', { bus: 'ui', gain: 0.7 * vol });
      case 'uiToggle': return this.spr(event, 'ui_toggle', { bus: 'ui', gain: 0.5 * vol });
      case 'uiError': return this.spr(event, 'ui_error', { bus: 'ui', gain: 0.6 * vol });
      case 'twang': {
        this.lastTwang = performance.now();
        this.start(event, this.synth('twang', twang), { gain: (0.45 + 0.4 * k) * vol, rate: 0.75 + k * 1.1 + Math.random() * 0.05, pos });
        return;
      }
      case 'snap': this.start(event, this.synth('snap', snap), { gain: 0.6 * vol, rate: 0.9 + Math.random() * 0.2, pos }); return;
      case 'yank':
        this.play('twang', { intensity: k, position: pos, volume: vol });
        this.start(event, this.synth('whoosh-yank', (r) => whoosh(r, 0.28, 500, 3200)), { gain: (0.35 + 0.35 * k) * vol, pos });
        return;
      case 'yanked': this.start(event, this.synth('whoosh-down', (r) => whoosh(r, 0.32, 2600, 600)), { gain: 0.5 * vol, pos }); return;
      case 'slingshot':
        this.play('twang', { intensity: 1, position: pos });
        this.start(event, this.synth('whoosh-sling', (r) => whoosh(r, 0.55, 300, 4200, 2.2)), { gain: 0.7 * vol, pos, delay: 0.05 });
        return;
      case 'bump': this.start(event, this.synth('twang', twang), { gain: 0.3 * vol, rate: 0.55, pos }); return;
      case 'boost': this.start(event, this.synth('whoosh-boost', (r) => whoosh(r, 0.22, 700, 2600, 1.2)), { gain: 0.35 * vol, pos }); return;
      case 'impact': {
        const tier = k < 0.33 ? 'light' : k < 0.7 ? 'med' : 'heavy';
        const key = `imp_${tier}_${Math.floor(Math.random() * 3)}` as SpriteKey;
        this.spr(event, key, { gain: (0.3 + 0.7 * k) * vol, rate: 0.92 + Math.random() * 0.16, pos });
        return;
      }
      case 'grab':
        this.spr(event, 'grab', { gain: 0.8 * vol, pos });
        this.start(event, this.synth('pickupBlip', (r) => zz(r, ZZ.pickupBlip)), { gain: 0.35 * vol, pos });
        return;
      case 'drop': this.spr(event, 'drop', { gain: 0.7 * vol, pos }); return;
      case 'throw': this.start(event, this.synth('whoosh-throw', (r) => whoosh(r, 0.3, 900, 2400, 1.4)), { gain: 0.55 * vol, pos }); return;
      case 'pass': this.start(event, this.synth('pass', passCue), { gain: 0.65 * vol, pos }); return;
      case 'hackStart': this.start(event, this.synth('hackStart', (r) => zz(r, ZZ.hackStart)), { bus: 'ui', gain: 0.5 * vol }); return;
      case 'hackTick': this.spr(event, 'hack_tick', { bus: 'ui', gain: 0.6 * vol, rate: 0.85 + clamp(o.progress ?? 0) * 0.6 }); return;
      case 'hackSuccess': this.spr(event, 'hack_ok', { bus: 'ui', gain: 0.75 * vol }); return;
      case 'hackFail': this.spr(event, 'hack_fail', { bus: 'ui', gain: 0.7 * vol }); return;
      case 'suspicious': this.start(event, this.synth('suspicious', (r) => zz(r, ZZ.suspicious)), { gain: 0.35 * vol, pos }); return;
      case 'spotted': {
        if (!pos && o.role) pos = this.dronePos.get(o.role) ?? null;
        // Pan to the drone that was spotted; a local hit stays centred and loud.
        this.start(event, this.synth('spotted', (r) => zz(r, ZZ.spotted)), { gain: 0.65 * vol, pos, rate: o.role === 'nee' ? 1.12 : 1 });
        this.duckMusic(0.5, 0.55);
        return;
      }
      case 'stun':
        this.spr(event, 'zap', { gain: 0.5 * vol, pos });
        this.start(event, this.synth('stunWarble', (r) => zz(r, ZZ.stunWarble)), { gain: 0.35 * vol, pos, delay: 0.1 });
        return;
      case 'cameraBlind': this.spr(event, 'glitch', { gain: 0.7 * vol, pos }); this.spr(event, 'zap', { gain: 0.25 * vol, pos, rate: 1.4 }); return;
      case 'capture': this.spr(event, 'capture', { gain: 0.8 * vol, pos }); this.duckMusic(0.9, 0.5); return;
      case 'rescue': this.start(event, this.synth('rescue', (r) => zz(r, ZZ.rescue)), { gain: 0.6 * vol, pos }); return;
      case 'vaultOpen':
        this.spr(event, 'vault_door', { gain: 0.8 * vol, pos });
        this.spr(event, 'sting_vault', { gain: 0.7 * vol, delay: 0.15 });
        this.duckMusic(2, 0.4);
        return;
      case 'theft': this.spr(event, 'sting_theft', { gain: 0.95 * vol }); this.duckMusic(2.2, 0.15); return;
      case 'extract':
        this.setAlarmStage(0); this.setMusic('off');
        this.spr(event, 'sting_win', { gain: 1 * vol });
        return;
      case 'replayDrop':
        // Slow-mo replay: falling whoosh into a sub-bass drop; music ducks under it.
        this.start(event, this.synth('whoosh-replay', (r) => whoosh(r, 0.9, 3400, 180, 1.4)), { gain: 0.55 * vol });
        this.start(event, this.synth('bass-drop', bassDrop), { gain: 0.9 * vol, delay: 0.08 });
        this.duckMusic(2.5, 0.35);
        return;
      case 'chirp': {
        const role: DroneVoice = o.role ?? 'pix'; const mood: ChirpMood = o.mood ?? 'neutral';
        this.start(event, this.synth(`chirp-${role}-${mood}`, (r) => zz(r, chirpParams(role, mood))), {
          gain: 0.4 * vol, pos, rate: 1 + (Math.random() - 0.5) * (role === 'nee' ? 0.12 : 0.04),
        });
        return;
      }
      case 'ping':
        this.start(event, this.synth('ping', (r) => zz(r, ZZ.ping)), { bus: 'ui', gain: 0.5 * vol, pos, rate: o.role === 'nee' ? 1.12 : 1 });
        return;
      case 'emote': {
        const role: DroneVoice = o.role ?? 'pix'; const mood: ChirpMood = o.mood ?? 'neutral';
        this.start(event, this.synth(`emote-${role}-${mood}`, (r) => zz(r, chirpParams(role, mood))), { gain: 0.48 * vol, pos, rate: mood === 'happy' ? 1.12 : mood === 'proud' ? 0.92 : 1 });
        return;
      }
    }
  }

  // ---------------------------------------------------------------- continuous
  /** Thruster hum for one drone. speed in world units/s (cruise ~9). Remote drones are spatialised. */
  setDroneMotion(role: DroneVoice, speed: number, position: Vec3Like, isLocal: boolean): void {
    const ctx = this.ctx; const buses = this.buses;
    if (!ctx || !buses || ctx.state !== 'running') return;
    try {
      let hum = this.hums.get(role);
      if (!hum) {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth';
        const osc2 = ctx.createOscillator(); osc2.type = 'triangle';
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
        const air = ctx.createBufferSource(); air.buffer = this.synth('stretch', stretchLoop); air.loop = true;
        const airBp = ctx.createBiquadFilter(); airBp.type = 'bandpass'; airBp.frequency.value = role === 'pix' ? 900 : 1500; airBp.Q.value = 0.8;
        const airGain = ctx.createGain(); airGain.gain.value = 0;
        const gain = ctx.createGain(); gain.gain.value = 0;
        const pan = ctx.createStereoPanner();
        osc.connect(lp); osc2.connect(lp); lp.connect(gain);
        air.connect(airBp).connect(airGain).connect(gain);
        gain.connect(pan).connect(buses.sfx);
        osc.start(); osc2.start(); air.start();
        hum = { osc, osc2, lp, air, airGain, gain, pan, jitter: 0 };
        this.hums.set(role, hum);
      }
      this.dronePos.set(role, { x: position.x, y: position.y, z: position.z });
      const n = clamp(speed / 10);
      // PIX lower and steady; NEE higher with a nervous flutter.
      const base = role === 'pix' ? 82 : 128;
      hum.jitter = role === 'nee' ? Math.sin(performance.now() / 55) * 3 + Math.sin(performance.now() / 23) * 1.5 : 0;
      const f = base * (1 + 0.55 * n) + hum.jitter;
      const t = ctx.currentTime;
      hum.osc.frequency.setTargetAtTime(f, t, 0.08);
      hum.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.08);
      hum.lp.frequency.setTargetAtTime(380 + 1600 * n, t, 0.1);
      hum.airGain.gain.setTargetAtTime(0.02 + 0.09 * n, t, 0.1);
      const sp = isLocal ? { gain: 1, pan: 0 } : this.spatial(position);
      const level = (0.05 + 0.1 * n) * sp.gain * (this.maxTotal < 20 && !isLocal ? 0.7 : 1);
      hum.gain.gain.setTargetAtTime(level, t, 0.08);
      hum.pan.pan.setTargetAtTime(sp.pan, t, 0.08);
    } catch { /* optional */ }
  }

  /** Cord strain 0..1 every frame: creak loop + snap when pulled to full length + twang on sudden release. */
  setTension(strain: number, position?: Vec3Like | null): void {
    const ctx = this.ctx; const buses = this.buses;
    if (!ctx || !buses || ctx.state !== 'running') return;
    const s = clamp(strain);
    const now = performance.now();
    if (s >= 0.97 && this.strain < 0.9 && now - this.lastSnap > 700) { this.lastSnap = now; this.play('snap', { position }); }
    this.strainPeak = Math.max(s, this.strainPeak * 0.97);
    if (this.strainPeak > 0.8 && s < 0.35 && now - this.lastTwang > 500) { this.play('twang', { intensity: this.strainPeak, position }); this.strainPeak = s; }
    this.strain = s;
    try {
      const target = s > 0.45 ? ((s - 0.45) / 0.55) ** 1.5 * 0.5 : 0;
      if (!this.stretch && target <= 0) return;
      if (!this.stretch) {
        const src = ctx.createBufferSource(); src.buffer = this.synth('stretch', stretchLoop); src.loop = true;
        const gain = ctx.createGain(); gain.gain.value = 0;
        src.connect(gain).connect(buses.sfx); src.start();
        this.stretch = { src, gain };
      }
      const t = ctx.currentTime;
      this.stretch.gain.gain.setTargetAtTime(target, t, 0.06);
      this.stretch.src.playbackRate.setTargetAtTime(0.7 + s * 0.9, t, 0.08);
    } catch { /* optional */ }
  }

  /** 0 = off, 1..3 = amber pulse escalation. Drive from local mission state or replicated room state. */
  setAlarmStage(stage: number): void {
    const ctx = this.ctx; const buses = this.buses;
    const next = Math.max(0, Math.min(3, Math.round(stage)));
    if (next === this.alarm.stage && (next === 0 || this.alarm.src)) return;
    this.alarm.stage = next;
    for (const listener of this.alarmListeners) {
      try { listener(next); } catch { /* a11y must never break audio */ }
    }
    if (next >= 2 && this.music !== 'off') this.setMusic('escape');
    if (next === 0 && this.music === 'escape') this.setMusic('calm');
    if (!ctx || !buses || ctx.state !== 'running') { if (next === 0) this.alarm.src = null; return; }
    const t = ctx.currentTime;
    const old = this.alarm;
    for (const layer of [
      [old.src, old.gain], [old.tensionSrc, old.tensionGain], [old.klaxonSrc, old.klaxonGain],
    ] as const) {
      const [src, gain] = layer;
      if (gain && src) { gain.gain.setTargetAtTime(0, t, 0.14); try { src.stop(t + 0.7); } catch { /* ended */ } }
    }
    this.alarm = { stage: next, src: null, gain: null, tensionSrc: null, tensionGain: null, klaxonSrc: null, klaxonGain: null };
    if (next === 0) return;
    const pulse = ctx.createBufferSource(); pulse.buffer = this.synth(`alarm${next}`, (r) => alarmCycle(r, next as 1 | 2 | 3)); pulse.loop = true;
    const pulseGain = ctx.createGain(); pulseGain.gain.value = 0; pulse.connect(pulseGain).connect(buses.sfx); pulse.start();
    pulseGain.gain.setTargetAtTime(next === 1 ? 0.045 : next === 2 ? 0.13 : 0.2, t, 0.16);
    this.alarm.src = pulse; this.alarm.gain = pulseGain;
    this.stats.alarm = (this.stats.alarm ?? 0) + 1;
    if (next >= 1) {
      const tension = ctx.createBufferSource(); tension.buffer = this.synth('alarm-tension', alarmTension); tension.loop = true;
      const tensionGain = ctx.createGain(); tensionGain.gain.value = 0; tension.connect(tensionGain).connect(buses.sfx); tension.start();
      tensionGain.gain.setTargetAtTime(next === 1 ? 0.22 : next === 2 ? 0.16 : 0.08, t, 0.2);
      this.alarm.tensionSrc = tension; this.alarm.tensionGain = tensionGain;
      this.stats.alarmTension = (this.stats.alarmTension ?? 0) + 1;
    }
    if (next === 3) {
      const klaxon = ctx.createBufferSource(); klaxon.buffer = this.synth('alarm-klaxon', alarmKlaxon); klaxon.loop = true;
      const klaxonGain = ctx.createGain(); klaxonGain.gain.value = 0; klaxon.connect(klaxonGain).connect(buses.sfx); klaxon.start();
      klaxonGain.gain.setTargetAtTime(0.42, t, 0.2);
      this.alarm.klaxonSrc = klaxon; this.alarm.klaxonGain = klaxonGain;
      this.stats.alarmKlaxon = (this.stats.alarmKlaxon ?? 0) + 1;
    }
  }

  get alarmStage(): number { return this.alarm.stage; }

  private readonly dronePos = new Map<DroneVoice, Vec3Like>();

  /** Test/debug snapshot (tools/verify-audio.mjs). */
  debugState(): Record<string, unknown> {
    return {
      state: this.ctx?.state ?? 'none', sprite: this.sprite !== null, music: this.music, musicPlaying: this.musicNodes !== null,
      alarm: this.alarm.stage, hums: [...this.hums.keys()], stretch: this.stretch !== null, ambience: this.ambience !== null,
      muted: this.muted, voices: this.activeTotal, maxVoices: this.maxTotal, stats: { ...this.stats },
    };
  }

  /** Mirror of the final mix as a MediaStream (preview recording in tests). */
  captureStream(): MediaStream | null {
    if (!this.ctx || !this.limiter) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.limiter.connect(dest);
    return dest.stream;
  }

  /** Music: calm sneak loop, escape layer on top (crossfade), or off. Files load on first request. */
  setMusic(state: MusicState): void {
    if (state === this.music && (state === 'off' || this.musicNodes)) return;
    this.music = state;
    const ctx = this.ctx; const buses = this.buses;
    if (!ctx || !buses) return;
    if (state === 'off') {
      const nodes = this.musicNodes; if (!nodes) return;
      const t = ctx.currentTime;
      nodes.calm.gain.setTargetAtTime(0, t, 0.4); nodes.escape.gain.setTargetAtTime(0, t, 0.4);
      for (const s of nodes.srcs) { try { s.stop(t + 2.5); } catch { /* ended */ } }
      this.musicNodes = null;
      return;
    }
    this.musicBuffers ??= Promise.all([this.fetchFirst('music-calm'), this.fetchFirst('music-escape')])
      .then(async ([a, b]) => {
        const [calm, escape] = await Promise.all([this.decode(a), this.decode(b)]);
        return calm && escape ? { calm, escape } : null;
      });
    void this.musicBuffers.then((bufs) => {
      if (!bufs || this.music === 'off' || !this.ctx || !this.buses) return;
      const c = this.ctx; const t = c.currentTime;
      if (!this.musicNodes) {
        const calm = c.createGain(); const escape = c.createGain(); calm.gain.value = 0; escape.gain.value = 0;
        calm.connect(this.buses.music); escape.connect(this.buses.music);
        const when = t + 0.05;
        const srcs = (['calm', 'escape'] as const).map((k) => {
          const s = c.createBufferSource(); s.buffer = bufs[k]; s.loop = true;
          s.connect(k === 'calm' ? calm : escape); s.start(when); return s;
        });
        this.musicNodes = { calm, escape, srcs };
        this.stats.music = (this.stats.music ?? 0) + 1;
      }
      const esc = this.music === 'escape';
      this.musicNodes.calm.gain.setTargetAtTime(esc ? 0.55 : 0.8, t, esc ? 0.4 : 1.2);
      this.musicNodes.escape.gain.setTargetAtTime(esc ? 0.85 : 0, t, esc ? 0.5 : 1.5);
    });
  }

  /** Quiet office room tone under everything while a game runs. */
  setAmbience(on: boolean): void {
    const ctx = this.ctx; const buses = this.buses;
    if (!ctx || !buses || ctx.state !== 'running') return;
    if (on && !this.ambience) {
      const src = ctx.createBufferSource(); src.buffer = this.synth('room', roomTone); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(lp).connect(gain).connect(buses.sfx); src.start();
      gain.gain.setTargetAtTime(0.12, ctx.currentTime, 1);
      this.ambience = { src, gain };
    } else if (!on && this.ambience) {
      const a = this.ambience; this.ambience = null;
      a.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      try { a.src.stop(ctx.currentTime + 1.5); } catch { /* ended */ }
    }
  }

  /** Start-of-game: called when gameplay begins (also retries after unlock). */
  beginSession(): void {
    this.sessionActive = true;
    if (!this.unlocked) return;
    this.setAmbience(true);
    const want: MusicState = this.alarm.stage >= 1 ? 'escape' : 'calm';
    if (this.music !== want || !this.musicNodes) { this.music = 'off'; this.setMusic(want); }
  }
  private sessionActive = false;
  get inSession(): boolean { return this.sessionActive; }

  /** Game over / leave: stop hums, creak, alarm, ambience and music. */
  endSession(): void {
    this.sessionActive = false;
    const ctx = this.ctx;
    this.setAlarmStage(0);
    this.setMusic('off');
    this.setAmbience(false);
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const hum of this.hums.values()) {
      hum.gain.gain.setTargetAtTime(0, t, 0.05);
      try { hum.osc.stop(t + 0.4); hum.osc2.stop(t + 0.4); hum.air.stop(t + 0.4); } catch { /* ended */ }
    }
    this.hums.clear();
    if (this.stretch) { this.stretch.gain.gain.setTargetAtTime(0, t, 0.05); try { this.stretch.src.stop(t + 0.4); } catch { /* ended */ } this.stretch = null; }
    this.strain = 0; this.strainPeak = 0;
  }
}

export const audio = new AudioManager();

/** Sub-bass drop for the escape replay: 95 Hz falling to 32 Hz with a soft click and long decay. */
function bassDrop(sr: number): Float32Array {
  const dur = 1.4;
  const out = new Float32Array(Math.floor(sr * dur));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = 32 + 63 * Math.exp(-t * 3.2);
    phase += (2 * Math.PI * f) / sr;
    const env = Math.min(1, t / 0.012) * Math.exp(-t * 2.1);
    const body = Math.sin(phase) + 0.25 * Math.sin(phase * 2);
    out[i] = Math.tanh(body * 1.6) * env * 0.85;
  }
  return out;
}
