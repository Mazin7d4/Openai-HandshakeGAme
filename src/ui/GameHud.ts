import type { GameMode } from '../app/GameMode.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import { controlIcon, keycaps } from './ControlGlyphs.ts';
import { MenuNavigator } from './MenuNavigator.ts';
import { clearOnboardingDone } from './OnboardingCoach.ts';
import type { GraphicsQualitySetting } from './Settings.ts';
import { SettingsMenu } from './SettingsMenu.ts';
import { isTouchPlayDevice } from './touchDetect.ts';
import { gameEvents } from '../gameplay/GameEvents.ts';
import { byInput } from './inputHints.ts';
import { effectiveReducedMotion, getSettings, subscribeSettings } from './Settings.ts';

export interface GameHudOptions {
  onResume: () => void;
  onLeave: () => void;
  onGraphicsQuality: (quality: GraphicsQualitySetting) => void;
  onInteract: () => void;
  onGrabDrop: () => void;
  onThrow: () => void;
  onYank?: () => void;
  /** Settings → Replay tutorial. */
  onReplayTutorial?: () => void;
  /** Night Shift: seed shown small on pause home and in Settings. */
  runSeed?: number | null;
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
  private readonly runSeed: number | null;
  private readonly nav = new MenuNavigator();
  private controlsTimer = 0;
  private paused = false;
  private promptKey = '';
  private activeDroneText = '';
  private settingsMenu: SettingsMenu | null = null;
  private view: 'home' | 'settings' | 'controls' = 'home';
  private readonly objectiveBanner: HTMLDivElement;
  private objectiveStep = 0;
  private objectiveTimer = 0;
  private readonly objectiveOffs: Array<() => void> = [];
  private objectiveSettingsOff!: () => void;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'KeyH' && !this.paused && !(event.target instanceof HTMLInputElement)) {
      this.setControlsCard(!this.controlsCard.classList.contains('visible'));
    }
    // While paused, Tab walks the menu (the flight input would otherwise swallow it as "switch drone").
    if (event.code === 'Tab' && this.paused) {
      event.stopPropagation();
      return;
    }
    // Settings owns Esc via its MenuNavigator. Pause home / controls: Esc here so flight
    // input never sees it (MenuNavigator is also attached; stopImmediate keeps a single action).
    if (event.code === 'Escape' && this.paused && this.view !== 'settings') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.view === 'controls') this.showPauseHome();
      else this.options.onResume();
    }
  };

  constructor(parent: HTMLElement, options: GameHudOptions) {
    this.options = options;
    this.touch = isTouchPlayDevice();
    this.runSeed = options.runSeed ?? null;
    this.prompt = document.createElement('div');
    this.prompt.className = 'interaction-prompt';
    this.prompt.dataset.testid = 'interaction-prompt';
    this.activeDrone = document.createElement('div');
    this.activeDrone.className = 'active-drone-hud';
    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.className = 'overlay pause-overlay';
    this.pauseOverlay.dataset.testid = 'pause-menu';
    this.pauseOverlay.setAttribute('role', 'dialog');
    this.pauseOverlay.setAttribute('aria-modal', 'true');
    this.pauseOverlay.setAttribute('aria-label', 'Paused');
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
    this.objectiveBanner = document.createElement('div');
    this.objectiveBanner.className = 'objective-banner';
    this.objectiveBanner.dataset.testid = 'objective-banner';
    this.objectiveBanner.setAttribute('role', 'status');
    this.objectiveBanner.setAttribute('aria-live', 'polite');
    parent.append(this.prompt, this.activeDrone, this.pauseOverlay, this.controlsCard, this.toastLayer, this.objectiveBanner);
    this.installObjectivePrompts();
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
    else {
      this.closeSettings();
      this.nav.detach();
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.nav.detach();
    this.closeSettings();
    this.prompt.remove();
    this.activeDrone.remove();
    this.pauseOverlay.remove();
    window.clearTimeout(this.controlsTimer);
    this.controlsCard.remove();
    this.toastLayer.remove();
    this.objectiveOffs.forEach((off) => off());
    this.objectiveSettingsOff();
    window.clearTimeout(this.objectiveTimer);
    this.objectiveBanner.remove();
  }

  private installObjectivePrompts(): void {
    this.objectiveSettingsOff = subscribeSettings(() => this.renderObjectivePrompt());
    this.objectiveOffs.push(
      gameEvents.on('boost', () => this.advanceObjective(0)),
      gameEvents.on('heist', (event) => {
        if (event.beat === 'vault') this.advanceObjective(1);
        if (event.beat === 'extract') this.advanceObjective(3);
      }),
      gameEvents.on('yank', () => this.advanceObjective(2)),
    );
    this.renderObjectivePrompt();
    this.objectiveTimer = window.setTimeout(() => {
      this.objectiveBanner.classList.remove('visible');
    }, 90_000);
  }

  private advanceObjective(step: number): void {
    if (!getSettings().objectives || step !== this.objectiveStep || this.objectiveStep >= 4) return;
    this.objectiveStep += 1;
    this.objectiveBanner.classList.add('objective-banner--fading');
    const delay = effectiveReducedMotion(getSettings()) ? 0 : 220;
    window.clearTimeout(this.objectiveTimer);
    this.objectiveTimer = window.setTimeout(() => {
      this.objectiveBanner.classList.remove('objective-banner--fading');
      this.renderObjectivePrompt();
      if (this.objectiveStep >= 4) this.objectiveBanner.classList.remove('visible');
    }, delay);
  }

  private renderObjectivePrompt(): void {
    const enabled = getSettings().objectives && this.objectiveStep < 4;
    this.objectiveBanner.classList.toggle('visible', enabled);
    if (!enabled) return;
    const lines = [
      byInput({ keyboard: 'Move with WASD', touch: 'Move with the stick', gamepad: 'Move with the stick' }),
      'Find the core',
      byInput({ keyboard: 'Use the cord: Yank [R]', touch: 'Use the cord: tap Yank', gamepad: 'Use the cord: Yank' }),
      'Reach the exit',
    ];
    this.objectiveBanner.textContent = lines[this.objectiveStep] ?? '';
  }

  private bindNav(onBack: () => void, initialFocus?: string): void {
    this.nav.attach(this.pauseOverlay, { onBack, initialFocus });
  }

  private showPauseHome(): void {
    this.closeSettings();
    this.view = 'home';
    this.panel.replaceChildren(this.heading('Paused'));
    if (this.runSeed != null) {
      const seed = document.createElement('p');
      seed.className = 'pause-seed';
      seed.dataset.testid = 'pause-seed';
      seed.textContent = `Seed ${this.runSeed}`;
      this.panel.append(seed);
    }
    this.panel.append(
      this.button('Resume', this.options.onResume, 'btn--primary', 'pause-resume'),
      this.button('Settings', () => this.showSettings(), '', 'pause-settings'),
      this.button('Controls', () => this.showControls(), '', 'pause-controls'),
      this.button('Leave game', this.options.onLeave, 'btn--danger danger', 'pause-leave'),
    );
    if (this.paused) this.bindNav(() => this.options.onResume(), '[data-testid="pause-resume"]');
  }

  private showSettings(): void {
    this.closeSettings();
    this.view = 'settings';
    this.nav.detach();
    this.panel.replaceChildren();
    this.settingsMenu = new SettingsMenu(this.panel, {
      embedded: true,
      runSeed: this.runSeed,
      onClose: () => this.showPauseHome(),
      onGraphicsQuality: this.options.onGraphicsQuality,
      onReplayTutorial: () => {
        clearOnboardingDone();
        this.options.onResume();
        this.options.onReplayTutorial?.();
      },
    });
  }

  private closeSettings(): void {
    this.settingsMenu?.dispose();
    this.settingsMenu = null;
  }

  private showControls(): void {
    this.view = 'controls';
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
    this.panel.append(list, this.button('Back', () => this.showPauseHome(), 'btn--quiet', 'pause-controls-back'));
    this.bindNav(() => this.showPauseHome(), '[data-testid="pause-controls-back"]');
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
    button.setAttribute('aria-label', label);
    if (testId) button.dataset.testid = testId;
    button.addEventListener('click', action);
    return button;
  }
}
