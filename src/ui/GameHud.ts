import type { GameMode } from '../app/GameMode.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';

export interface GameHudOptions {
  onResume: () => void;
  onLeave: () => void;
  onGraphicsQuality: (quality: 'low' | 'medium' | 'high') => void;
}

/** Lightweight contextual HUD and pause/settings/controls navigation. */
export class GameHud {
  private readonly prompt: HTMLDivElement;
  private readonly activeDrone: HTMLDivElement;
  private readonly pauseOverlay: HTMLDivElement;
  private readonly panel: HTMLElement;
  private readonly options: GameHudOptions;
  private paused = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
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
    parent.append(this.prompt, this.activeDrone, this.pauseOverlay);
    this.showPauseHome();
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  update(prompts: readonly string[], mode: GameMode, activeRole: DroneRole): void {
    this.prompt.replaceChildren(...prompts.map((text) => {
      const item = document.createElement('span');
      item.textContent = text;
      return item;
    }));
    this.prompt.classList.toggle('visible', prompts.length > 0 && !this.paused);
    this.activeDrone.textContent = mode === 'dev-local'
      ? `ACTIVE: ${activeRole.toUpperCase()}  ·  [TAB] SWITCH`
      : activeRole.toUpperCase();
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
    this.panel.replaceChildren(this.heading('SETTINGS'));
    this.panel.append(
      this.range('MASTER VOLUME', 80),
      this.range('MUSIC VOLUME', 50, true),
      this.range('SFX VOLUME', 80),
    );
    const row = document.createElement('label');
    row.className = 'settings-row';
    row.append(document.createTextNode('GRAPHICS QUALITY'));
    const select = document.createElement('select');
    for (const value of ['low', 'medium', 'high'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.toUpperCase();
      option.selected = value === 'high';
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.options.onGraphicsQuality(select.value as 'low' | 'medium' | 'high');
    });
    row.append(select);
    this.panel.append(row);
    this.panel.append(this.button('TOGGLE FULLSCREEN', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    }));
    this.panel.append(this.button('BACK', () => this.showPauseHome()));
  }

  private showControls(): void {
    this.panel.replaceChildren(this.heading('CONTROLS'));
    const list = document.createElement('dl');
    list.className = 'controls-list';
    for (const [key, action] of [
      ['WASD', 'Move'], ['SPACE', 'Ascend'], ['CTRL / C', 'Descend'], ['SHIFT', 'Boost'],
      ['E', 'Grab / Drop'], ['Q', 'Throw held object'], ['F', 'Interact / Hack'],
      ['TAB', 'Switch drone (Dev Local)'], ['ESC', 'Pause'], ['F2', 'Inspection camera'],
    ]) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = action;
      list.append(dt, dd);
    }
    this.panel.append(list, this.button('BACK', () => this.showPauseHome()));
  }

  private range(label: string, value: number, placeholder = false): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    row.append(document.createTextNode(placeholder ? `${label} (COMING SOON)` : label));
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(value);
    input.disabled = placeholder;
    row.append(input);
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
