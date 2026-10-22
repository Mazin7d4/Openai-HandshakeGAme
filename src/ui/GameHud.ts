import type { GameMode } from '../app/GameMode.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import { controlIcon, keycaps } from './ControlGlyphs.ts';
import { clearOnboardingDone } from './OnboardingCoach.ts';
import { getSettings, saveSettings } from './Settings.ts';
import { isTouchPlayDevice } from './touchDetect.ts';

export interface GameHudOptions {
  onResume: () => void;
  onLeave: () => void;
  onGraphicsQuality: (quality: 'low' | 'medium' | 'high') => void;
  onInteract: () => void;
  onGrabDrop: () => void;
  onThrow: () => void;
  onYank?: () => void;
  /** Settings → Replay tutorial. */
  onReplayTutorial?: () => void;
}

/** Lightweight contextual HUD and pause/settings/controls navigation. */
export class GameHud {
  private readonly prompt: HTMLDivElement;
  private readonly activeDrone: HTMLDivElement;
  private readonly pauseOverlay: HTMLDivElement;
  private readonly panel: HTMLElement;
  private readonly options: GameHudOptions;
  private readonly controlsCard: HTMLDivElement;
  private readonly toastLayer: HTMLDivElement;
  private readonly touch: boolean;
  private controlsTimer = 0;
  private paused = false;
  private promptKey = '';
  private activeDroneText = '';

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'KeyH' && !this.paused && !(event.target instanceof HTMLInputElement)) {
      this.setControlsCard(!this.controlsCard.classList.contains('visible'));
    }
    // While paused, Tab walks the menu (the flight input would otherwise swallow it as "switch drone").
    if (event.code === 'Tab' && this.paused) {
      event.stopPropagation();
      return;
    }
    if (event.code === 'Escape' && this.paused) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.options.onResume();
    }
  };

  constructor(parent: HTMLElement, options: GameHudOptions) {
    this.options = options;
    this.touch = isTouchPlayDevice();
    this.prompt = document.createElement('div');
    this.prompt.className = 'interaction-prompt';
    this.prompt.dataset.testid = 'interaction-prompt';
    this.activeDrone = document.createElement('div');
    this.activeDrone.className = 'active-drone-hud';
    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.className = 'overlay pause-overlay';
    this.pauseOverlay.dataset.testid = 'pause-menu';
    this.panel = document.createElement('section');
    this.panel.className = 'panel pause-panel';
    this.pauseOverlay.append(this.panel);
    // First-time-player card: core controls + the co-op goal. Auto-hides; [H] toggles it any time.
    // Hidden on touch — the virtual pad is the hint surface there.
    this.controlsCard = document.createElement('div');
    this.controlsCard.className = 'controls-card';
    this.controlsCard.dataset.testid = 'controls-card';
    this.controlsCard.setAttribute('aria-label', 'Controls');
    const list = document.createElement('ul');
    list.className = 'glyph-list';
    for (const [keys, glyph, action] of [
      ['W A S D', 'fly', 'Fly'], ['Space / Ctrl', 'updown', 'Up, down'], ['Shift', 'boost', 'Boost'],
      ['F', 'hack', 'Hack'], ['E / Q', 'grab', 'Grab, throw'], ['R', 'yank', 'Yank'], ['Esc', 'pause', 'Pause'],
    ]) {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'glyph-label';
      label.textContent = action;
      item.append(keycaps(keys), controlIcon(glyph), label);
      list.append(item);
    }
    const tip = document.createElement('p');
    tip.className = 'glyph-tip';
    tip.append('Follow the beacon. ', keycaps('H'), ' hides this.');
    this.controlsCard.append(list, tip);
    this.toastLayer = document.createElement('div');
    this.toastLayer.className = 'juice-toasts';
    this.toastLayer.dataset.testid = 'juice-toasts';
    parent.append(this.prompt, this.activeDrone, this.pauseOverlay, this.controlsCard, this.toastLayer);
    if (this.touch) {
      this.controlsCard.classList.add('controls-card--touch-hidden');
    } else {
      const seen = (() => { try { return localStorage.getItem('handshake.controlsSeen') === '1'; } catch { return false; } })();
      this.setControlsCard(true, seen ? 6000 : 16000);
      try { localStorage.setItem('handshake.controlsSeen', '1'); } catch { /* private mode */ }
    }
    this.showPauseHome();
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  update(prompts: readonly string[], mode: GameMode, activeRole: DroneRole): void {
    const promptKey = `${this.touch ? 't' : 'k'}\u0000${prompts.join('\u0000')}`;
    if (promptKey !== this.promptKey) {
      this.promptKey = promptKey;
      this.prompt.replaceChildren(...prompts.map((text) => {
        const item = document.createElement('button');
        item.type = 'button';
        // "[F] Hack the console" -> drawn keycap (or touch glyph) + label.
        const match = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
        if (match) {
          const label = document.createElement('span');
          label.textContent = match[2];
          if (this.touch) {
            const glyph = match[1] === 'F' ? 'hack'
              : match[1] === 'Q' ? 'grab'
              : match[1] === 'R' ? 'yank'
              : match[1] === 'E' ? 'grab'
              : 'touch';
            item.append(controlIcon(glyph), label);
          } else {
            item.append(keycaps(match[1]), label);
          }
        } else item.textContent = text;
        item.addEventListener('click', text.startsWith('[F]')
          ? this.options.onInteract
          : text.startsWith('[Q]') ? this.options.onThrow
          : text.startsWith('[R]') ? () => this.options.onYank?.()
          : text.startsWith('[E]') ? this.options.onGrabDrop : () => undefined);
        return item;
      }));
    }
    this.prompt.classList.toggle('visible', prompts.length > 0 && !this.paused);
    const activeDroneText = mode === 'dev-local'
      ? `Flying ${activeRole.toUpperCase()} · Tab switches`
      : activeRole.toUpperCase();
    if (activeDroneText !== this.activeDroneText) {
      this.activeDroneText = activeDroneText;
      this.activeDrone.textContent = activeDroneText;
    }
  }

  /** Punchy, short-lived callout for tether moves (SLINGSHOT!, RESCUE!, CLOTHESLINED!). */
  toast(text: string, tone: 'pix' | 'nee' | 'good' = 'good'): void {
    if (this.toastLayer.lastElementChild?.textContent === text) return;
    const item = document.createElement('div');
    item.className = `juice-toast ${tone}`;
    item.textContent = text;
    this.toastLayer.append(item);
    while (this.toastLayer.childElementCount > 3) this.toastLayer.firstElementChild?.remove();
    window.setTimeout(() => item.remove(), 1500);
  }

  /** Hide the keyboard controls card while the first-run coach is speaking. */
  setControlsCardSuppressed(suppressed: boolean): void {
    if (this.touch) return;
    if (suppressed) this.setControlsCard(false);
  }

  private setControlsCard(visible: boolean, autoHideMs = 0): void {
    window.clearTimeout(this.controlsTimer);
    this.controlsCard.classList.toggle('visible', visible);
    if (visible && autoHideMs) this.controlsTimer = window.setTimeout(() => this.setControlsCard(false), autoHideMs);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseOverlay.classList.toggle('visible', paused);
    this.prompt.classList.toggle('visible', !paused && this.prompt.childElementCount > 0);
    if (paused) this.showPauseHome();
  }

  /** Keyboard players land on the first action of each pause screen. */
  private focusFirst(): void {
    this.panel.querySelector<HTMLElement>('button, select, input')?.focus({ preventScroll: true });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.prompt.remove();
    this.activeDrone.remove();
    this.pauseOverlay.remove();
    window.clearTimeout(this.controlsTimer);
    this.controlsCard.remove();
    this.toastLayer.remove();
  }

  private showPauseHome(): void {
    this.panel.replaceChildren(this.heading('Paused'));
    this.panel.append(
      this.button('Resume', this.options.onResume, 'btn--primary'),
      this.button('Settings', () => this.showSettings()),
      this.button('Controls', () => this.showControls()),
      this.button('Leave game', this.options.onLeave, 'btn--danger danger'),
    );
    this.focusFirst();
  }

  private showSettings(): void {
    const settings = getSettings();
    this.panel.replaceChildren(this.heading('Settings'));

    const masterVolumeRow = this.rangeRow(
      'Master volume',
      settings.masterVolume,
      0,
      100,
      1,
      '%',
      (val: number) => {
        saveSettings({ masterVolume: val });
      },
    );

    const sensitivityRow = this.rangeRow(
      'Look sensitivity',
      settings.lookSensitivity,
      0.25,
      2,
      0.05,
      'x',
      (val: number) => {
        saveSettings({ lookSensitivity: val });
      },
    );

    const shakeRow = document.createElement('label');
    shakeRow.className = 'settings-row';
    const shakeLabel = document.createElement('span');
    shakeLabel.textContent = 'Screen shake';
    const shakeInput = document.createElement('input');
    shakeInput.type = 'checkbox';
    shakeInput.checked = settings.screenShake;
    shakeInput.addEventListener('change', () => {
      saveSettings({ screenShake: shakeInput.checked });
    });
    shakeRow.append(shakeLabel, shakeInput);

    const row = document.createElement('label');
    row.className = 'settings-row';
    row.append(document.createTextNode('Graphics quality'));
    const select = document.createElement('select');
    for (const value of ['low', 'medium', 'high'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value[0].toUpperCase() + value.slice(1);
      option.selected = value === 'high';
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.options.onGraphicsQuality(select.value as 'low' | 'medium' | 'high');
    });
    row.append(select);

    this.panel.append(
      masterVolumeRow,
      sensitivityRow,
      shakeRow,
      row,
      this.button('Fullscreen', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }),
      this.button('Replay tutorial', () => {
        clearOnboardingDone();
        this.options.onResume();
        this.options.onReplayTutorial?.();
      }, 'btn--quiet'),
      this.button('Back', () => this.showPauseHome(), 'btn--quiet'),
    );
    this.focusFirst();
  }

  private showControls(): void {
    this.panel.replaceChildren(this.heading('Controls'));
    const list = document.createElement('dl');
    list.className = 'controls-list';
    for (const [key, action] of [
      ['W A S D', 'Move'], ['Space', 'Ascend'], ['Ctrl / C', 'Descend'], ['Shift', 'Boost'],
      ['E', 'Grab or drop'], ['Q', 'Throw held object'], ['F', 'Interact or hack'],
      ['Tab', 'Switch drone (dev local)'], ['Esc', 'Pause'], ['H', 'Show or hide the controls card'],
      ['Right-drag / Wheel', 'Look around, adjust framing'],
      ['Two-finger', 'Look or pinch on touch screens'], ['F2', 'Inspection camera'],
    ]) {
      const dt = document.createElement('dt');
      dt.append(keycaps(key));
      const dd = document.createElement('dd');
      dd.textContent = action;
      list.append(dt, dd);
    }
    this.panel.append(list, this.button('Back', () => this.showPauseHome(), 'btn--quiet'));
    this.focusFirst();
  }

  private rangeRow(
    label: string, value: number, min: number, max: number, step: number, unit: string,
    onChange: (value: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const text = document.createElement('span');
    const format = (v: number) => `${label}  ${unit === '%' ? Math.round(v) : v.toFixed(2)}${unit}`;
    text.textContent = format(value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      text.textContent = format(next);
      onChange(next);
    });
    row.append(text, input);
    return row;
  }

  private heading(text: string): HTMLHeadingElement {
    const heading = document.createElement('h2');
    heading.textContent = text;
    return heading;
  }

  private button(label: string, action: () => void, className = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn pause-button ${className}`.trim();
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }
}
