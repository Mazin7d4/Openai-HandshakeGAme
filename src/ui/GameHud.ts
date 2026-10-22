import type { GameMode } from '../app/GameMode.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import type { GraphicsQualitySetting } from './Settings.ts';
import { SettingsMenu } from './SettingsMenu.ts';

export interface GameHudOptions {
  onResume: () => void;
  onLeave: () => void;
  onGraphicsQuality: (quality: GraphicsQualitySetting) => void;
  onInteract: () => void;
  onGrabDrop: () => void;
  onThrow: () => void;
  onYank?: () => void;
}

// One drawn icon style for every control glyph: 24px grid, 2px graphite stroke, round caps, no fills.
const ICONS: Record<string, string> = {
  fly: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  updown: '<path d="M8 4v16M8 4L5 7M8 4l3 3M16 20V4M16 20l-3-3M16 20l3-3"/>',
  boost: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  hack: '<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3"/>',
  grab: '<path d="M12 3v5M7 8h10M7 8l-2 6 3 4M17 8l2 6-3 4"/>',
  yank: '<path d="M3 8h4M17 8h4M7 8c0 9 10 9 10 0"/><path d="M12 15v5M9 18l3 3 3-3"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
};
function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('glyph');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}
/** Keycaps for a binding like "W A S D" or "Space / Ctrl"; "/" becomes a quiet separator. */
function keycaps(binding: string): HTMLElement {
  const group = document.createElement('span');
  group.className = 'keys';
  for (const part of binding.split(' ')) {
    if (part === '/') { group.append(Object.assign(document.createElement('span'), { className: 'keys__or', textContent: 'or' })); continue; }
    const cap = document.createElement('kbd');
    cap.className = 'keycap';
    cap.textContent = part;
    group.append(cap);
  }
  return group;
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
  private settingsMenu: SettingsMenu | null = null;

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
      if (this.settingsMenu) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closeSettings();
        this.showPauseHome();
        return;
      }
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
    this.activeDrone.dataset.testid = 'active-drone-hud';
    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.className = 'overlay pause-overlay';
    this.pauseOverlay.dataset.testid = 'pause-menu';
    this.panel = document.createElement('section');
    this.panel.className = 'panel pause-panel';
    this.pauseOverlay.append(this.panel);
    // First-time-player card: core controls + the co-op goal. Auto-hides; [H] toggles it any time.
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
      item.append(keycaps(keys), icon(glyph), label);
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
        // "[F] Hack the console" -> drawn keycap + label, so the key reads as a key, not as brackets.
        const match = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
        if (match) {
          const label = document.createElement('span');
          label.textContent = match[2];
          item.append(keycaps(match[1]), label);
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
      this.activeDrone.dataset.role = activeRole;
      this.activeDrone.replaceChildren();
      const mark = document.createElement('span');
      mark.className = `role-mark role-mark--${activeRole}`;
      mark.setAttribute('aria-hidden', 'true');
      this.activeDrone.append(mark, document.createTextNode(activeDroneText));
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
    else this.closeSettings();
  }

  /** Keyboard players land on the first action of each pause screen. */
  private focusFirst(): void {
    this.panel.querySelector<HTMLElement>('button, select, input')?.focus({ preventScroll: true });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.closeSettings();
    this.prompt.remove();
    this.activeDrone.remove();
    this.pauseOverlay.remove();
    window.clearTimeout(this.controlsTimer);
    this.controlsCard.remove();
    this.toastLayer.remove();
  }

  private showPauseHome(): void {
    this.closeSettings();
    this.panel.replaceChildren(this.heading('Paused'));
    this.panel.append(
      this.button('Resume', this.options.onResume, 'btn--primary'),
      this.button('Settings', () => this.showSettings(), '', 'pause-settings'),
      this.button('Controls', () => this.showControls()),
      this.button('Leave game', this.options.onLeave, 'btn--danger danger'),
    );
    this.focusFirst();
  }

  private showSettings(): void {
    this.closeSettings();
    this.panel.replaceChildren();
    this.settingsMenu = new SettingsMenu(this.panel, {
      embedded: true,
      onClose: () => this.showPauseHome(),
      onGraphicsQuality: this.options.onGraphicsQuality,
    });
  }

  private closeSettings(): void {
    this.settingsMenu?.dispose();
    this.settingsMenu = null;
  }

  private showControls(): void {
    this.closeSettings();
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

  private heading(text: string): HTMLHeadingElement {
    const heading = document.createElement('h2');
    heading.textContent = text;
    return heading;
  }

  private button(label: string, action: () => void, className = '', testId = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn pause-button ${className}`.trim();
    button.textContent = label;
    if (testId) button.dataset.testid = testId;
    button.addEventListener('click', action);
    return button;
  }
}
