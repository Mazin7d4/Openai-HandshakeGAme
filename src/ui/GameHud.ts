import type { GameMode } from '../app/GameMode.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import { getSettings, saveSettings, type GraphicsQualitySetting } from './Settings.ts';

export interface GameHudOptions {
  onResume: () => void;
  onLeave: () => void;
  onGraphicsQuality: (quality: GraphicsQualitySetting) => void;
  onInteract: () => void;
  onGrabDrop: () => void;
  onThrow: () => void;
  onYank?: () => void;
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
  private controlsTimer = 0;
  private paused = false;
  private promptKey = '';
  private activeDroneText = '';

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'KeyH' && !this.paused && !(event.target instanceof HTMLInputElement)) {
      this.setControlsCard(!this.controlsCard.classList.contains('visible'));
    }
    if (event.code === 'Escape' && this.paused) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.options.onResume();
    }
  };

  constructor(parent: HTMLElement, options: GameHudOptions) {
    this.options = options;
    this.prompt = document.createElement('div');
    this.prompt.className = 'interaction-prompt';
    this.prompt.dataset.testid = 'interaction-prompt';
    this.activeDrone = document.createElement('div');
    this.activeDrone.className = 'active-drone-hud';
    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.className = 'pause-overlay';
    this.pauseOverlay.dataset.testid = 'pause-menu';
    this.panel = document.createElement('section');
    this.panel.className = 'pause-panel';
    this.pauseOverlay.append(this.panel);
    // First-time-player card: core controls + the co-op goal. Auto-hides; [H] toggles it any time.
    this.controlsCard = document.createElement('div');
    this.controlsCard.className = 'controls-card';
    this.controlsCard.dataset.testid = 'controls-card';
    const title = document.createElement('strong');
    title.textContent = 'PIX + NEE · QUICK CONTROLS';
    const list = document.createElement('dl');
    for (const [key, action] of [
      ['WASD', 'Fly'], ['SPACE / CTRL', 'Up / down'], ['SHIFT', 'Boost'], ['F', 'Hack / interact'],
      ['E', 'Grab · Q throw'], ['R', 'Yank partner · slingshot'], ['ESC', 'Pause & all controls'],
    ]) {
      const dt = document.createElement('dt'); dt.textContent = key;
      const dd = document.createElement('dd'); dd.textContent = action;
      list.append(dt, dd);
    }
    const tip = document.createElement('p');
    tip.textContent = 'You are tethered — stay together. Follow the glowing beacon to the next objective. [H] hides this.';
    this.controlsCard.append(title, list, tip);
    this.toastLayer = document.createElement('div');
    this.toastLayer.className = 'juice-toasts';
    this.toastLayer.dataset.testid = 'juice-toasts';
    parent.append(this.prompt, this.activeDrone, this.pauseOverlay, this.controlsCard, this.toastLayer);
    const seen = (() => { try { return localStorage.getItem('handshake.controlsSeen') === '1'; } catch { return false; } })();
    this.setControlsCard(true, seen ? 6000 : 16000);
    try { localStorage.setItem('handshake.controlsSeen', '1'); } catch { /* private mode */ }
    this.showPauseHome();
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  update(prompts: readonly string[], mode: GameMode, activeRole: DroneRole): void {
    const promptKey = prompts.join('\u0000');
    if (promptKey !== this.promptKey) {
      this.promptKey = promptKey;
      this.prompt.replaceChildren(...prompts.map((text) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = text;
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
      ? `ACTIVE: ${activeRole.toUpperCase()}  ·  [TAB] SWITCH`
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
    this.panel.replaceChildren(this.heading('PAUSED'));
    this.panel.append(
      this.button('RESUME', this.options.onResume),
      this.button('SETTINGS', () => this.showSettings()),
      this.button('CONTROLS', () => this.showControls()),
      this.button('LEAVE GAME', this.options.onLeave, 'danger'),
    );
  }

  private showSettings(): void {
    const settings = getSettings();
    this.panel.replaceChildren(this.heading('SETTINGS'));

    const masterVolumeRow = this.rangeRow(
      'MASTER VOLUME',
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
      'LOOK SENSITIVITY',
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
    shakeLabel.textContent = 'SCREEN SHAKE';
    const shakeInput = document.createElement('input');
    shakeInput.type = 'checkbox';
    shakeInput.checked = settings.screenShake;
    shakeInput.addEventListener('change', () => {
      saveSettings({ screenShake: shakeInput.checked });
    });
    shakeRow.append(shakeLabel, shakeInput);

    const row = document.createElement('label');
    row.className = 'settings-row';
    row.append(document.createTextNode('GRAPHICS QUALITY'));
    const select = document.createElement('select');
    for (const value of ['auto', 'low', 'medium', 'high'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.toUpperCase();
      option.selected = value === settings.graphicsQuality;
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.options.onGraphicsQuality(select.value as GraphicsQualitySetting);
    });
    row.append(select);

    this.panel.append(
      masterVolumeRow,
      sensitivityRow,
      shakeRow,
      row,
      this.button('TOGGLE FULLSCREEN', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }),
      this.button('BACK', () => this.showPauseHome()),
    );
  }

  private showControls(): void {
    this.panel.replaceChildren(this.heading('CONTROLS'));
    const list = document.createElement('dl');
    list.className = 'controls-list';
    for (const [key, action] of [
      ['WASD', 'Move'], ['SPACE', 'Ascend'], ['CTRL / C', 'Descend'], ['SHIFT', 'Boost'],
      ['E', 'Grab / Drop'], ['Q', 'Throw held object'], ['F', 'Interact / Hack'],
      ['TAB', 'Switch drone (Dev Local)'], ['ESC', 'Pause'], ['H', 'Show / hide quick controls'],
      ['RIGHT DRAG / WHEEL', 'Look a little / adjust framing'],
      ['TWO FINGERS', 'Look / pinch on touch screens'], ['F2', 'Inspection camera'],
    ]) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = action;
      list.append(dt, dd);
    }
    this.panel.append(list, this.button('BACK', () => this.showPauseHome()));
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
    button.className = `pause-button ${className}`.trim();
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }
}
