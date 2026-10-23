/**
 * On-screen visual cues for audio alerts and optional drone bark captions.
 * Hooks the same events the AudioManager hub plays (alarm stages, spotted, cord snap).
 * Live region always announces alarm stage changes (and optional captions).
 */
import { audio, type AudioEvent, type PlayOptions } from '../audio/AudioManager.ts';
import { effectiveReducedMotion, getSettings, subscribeSettings } from './Settings.ts';

const BARKS: Partial<Record<AudioEvent | 'alarm', string>> = {
  snap: 'Cord: Snap!',
  spotted: 'Security: Spotted!',
  alarm: 'Alarm!',
  yank: 'PIX: Hang on!',
  yanked: 'NEE: Being pulled!',
  slingshot: 'PIX: Slingshot!',
  capture: 'Security: Caught!',
  rescue: 'NEE: Got you!',
  theft: 'NEE: Core secured!',
  extract: 'PIX: Extract!',
  stun: 'PIX: Clothesline!',
  chirp: '…',
};

const ALERT_EVENTS = new Set<AudioEvent>(['spotted', 'snap', 'yank', 'yanked', 'capture', 'stun']);

/** Presentation-only accessibility feedback layer. */
export class AccessibilityFeedback {
  private readonly root: HTMLDivElement;
  private readonly pulse: HTMLDivElement;
  private readonly captions: HTMLDivElement;
  private readonly live: HTMLDivElement;
  private visualAlerts = false;
  private subtitles = false;
  private reducedMotion = false;
  private readonly unsubSettings: () => void;
  private readonly unsubs: (() => void)[] = [];
  private captionTimer = 0;
  private pulseTimer = 0;
  private lastAlarmStage = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'a11y-feedback';
    this.root.dataset.testid = 'a11y-feedback';

    this.pulse = document.createElement('div');
    this.pulse.className = 'a11y-pulse';
    this.pulse.setAttribute('aria-hidden', 'true');

    this.captions = document.createElement('div');
    this.captions.className = 'a11y-captions';
    this.captions.dataset.testid = 'a11y-captions';
    this.captions.setAttribute('aria-hidden', 'true');

    // Dedicated live region so alarm / heist announcements are not tied to visual captions.
    this.live = document.createElement('div');
    this.live.className = 'a11y-live';
    this.live.dataset.testid = 'a11y-live';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'assertive');
    this.live.setAttribute('aria-atomic', 'true');

    this.root.append(this.pulse, this.captions, this.live);
    parent.append(this.root);

    const apply = () => {
      const s = getSettings();
      this.visualAlerts = s.visualAudioAlerts;
      this.subtitles = s.subtitles;
      this.reducedMotion = effectiveReducedMotion(s);
      this.root.classList.toggle('a11y-feedback--on', this.visualAlerts || this.subtitles);
    };
    apply();
    this.unsubSettings = subscribeSettings(apply);

    this.unsubs.push(
      audio.onPlay((event, opts) => this.onHubPlay(event, opts)),
      audio.onAlarmStage((stage) => this.onAlarmStage(stage)),
    );
  }

  /** Announce heist outcome for screen readers (called from HeistReport). */
  announce(text: string): void {
    // Clear then set so repeated identical strings still fire.
    this.live.textContent = '';
    window.requestAnimationFrame(() => {
      this.live.textContent = text;
    });
  }

  private onHubPlay(event: AudioEvent, opts: PlayOptions): void {
    if (event === 'chirp' && this.subtitles) {
      const who = opts.role === 'nee' ? 'NEE' : 'PIX';
      const mood = opts.mood ? ` (${opts.mood})` : '';
      this.caption(`${who}${mood}`);
      return;
    }
    if (!ALERT_EVENTS.has(event) && event !== 'theft' && event !== 'extract' && event !== 'rescue') return;
    const tone = event === 'spotted' || event === 'capture' || event === 'snap' ? 'alert'
      : event === 'rescue' || event === 'extract' ? 'good'
      : 'yank';
    if (this.visualAlerts && ALERT_EVENTS.has(event) && !this.reducedMotion) this.flash(tone);
    if (this.subtitles || (this.visualAlerts && ALERT_EVENTS.has(event))) {
      const line = BARKS[event];
      if (line) this.caption(line);
    }
  }

  private onAlarmStage(stage: number): void {
    if (stage > 0 && stage !== this.lastAlarmStage) {
      const line = `Alarm stage ${stage}`;
      this.announce(line);
      if (this.visualAlerts && !this.reducedMotion) this.flash('alert');
      if (this.visualAlerts || this.subtitles) this.caption(line);
    } else if (stage === 0 && this.lastAlarmStage > 0) {
      this.announce('Alarm cleared');
    }
    this.lastAlarmStage = stage;
  }

  private flash(tone: string): void {
    window.clearTimeout(this.pulseTimer);
    this.pulse.className = `a11y-pulse a11y-pulse--${tone} a11y-pulse--active`;
    this.pulseTimer = window.setTimeout(() => {
      this.pulse.classList.remove('a11y-pulse--active');
    }, 700);
  }

  private caption(text: string): void {
    window.clearTimeout(this.captionTimer);
    this.captions.textContent = text;
    this.captions.classList.add('visible');
    this.captionTimer = window.setTimeout(() => {
      this.captions.classList.remove('visible');
    }, 2200);
  }

  dispose(): void {
    this.unsubSettings();
    for (const off of this.unsubs) off();
    window.clearTimeout(this.captionTimer);
    window.clearTimeout(this.pulseTimer);
    this.root.remove();
  }
}
