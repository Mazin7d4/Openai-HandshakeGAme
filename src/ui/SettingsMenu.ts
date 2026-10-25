/**
 * Full Settings + accessibility menu with keyboard / touch / gamepad tabs.
 * Reused from the title screen and the pause menu.
 */
import { audio } from '../audio/AudioManager.ts';
import {
  getCameraTouchSettings,
  saveCameraTouchSettings,
} from './CameraTouchSettings.ts';
import { MenuNavigator } from './MenuNavigator.ts';
import {
  getSettings,
  saveSettings,
  type GameSettings,
  type GraphicsQualitySetting,
  type TouchHandedness,
  type UiScale,
} from './Settings.ts';
import { isTouchPlayDevice } from './touchDetect.ts';
import { COSMETICS, cosmeticRoleHint, getCosmetics, getSelectedCosmetics, selectCosmetic, type CosmeticDefinition } from '../player/Cosmetics.ts';

export type SettingsTab = 'audio' | 'visuals' | 'accessibility' | 'controls' | 'cosmetics';

export interface SettingsMenuOptions {
  /** Called when the user closes the menu (Back / Escape). */
  onClose: () => void;
  /** Optional stub the renderer / QualityManager can also listen to via settings. */
  onGraphicsQuality?: (quality: GraphicsQualitySetting) => void;
  /** Pause settings → clear onboarding and replay the coach. */
  onReplayTutorial?: () => void;
  /** When true, omit the outer overlay and mount into an existing panel host. */
  embedded?: boolean;
  /** Night Shift: read-only seed shown under the Settings title. */
  runSeed?: number | null;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'audio', label: 'Audio' },
  { id: 'visuals', label: 'Visuals' },
  { id: 'accessibility', label: 'Access' },
  { id: 'controls', label: 'Controls' },
  { id: 'cosmetics', label: 'Cosmetics' },
];

const CONTROL_ROWS: readonly (readonly [string, string])[] = [
  ['W A S D', 'Move'],
  ['Space', 'Ascend'],
  ['Ctrl / C', 'Descend'],
  ['Shift', 'Boost'],
  ['E', 'Grab or drop'],
  ['Q', 'Throw held object'],
  ['F', 'Interact or hack'],
  ['R', 'Yank'],
  ['Tab', 'Switch drone (dev local)'],
  ['Esc', 'Pause'],
  ['H', 'Show or hide the controls card'],
  ['Right-drag / Wheel', 'Look around, adjust framing'],
  ['Two-finger', 'Look or pinch on touch screens'],
];

function keycaps(binding: string): HTMLElement {
  const group = document.createElement('span');
  group.className = 'keys';
  for (const part of binding.split(' ')) {
    if (part === '/') {
      group.append(Object.assign(document.createElement('span'), { className: 'keys__or', textContent: 'or' }));
      continue;
    }
    const cap = document.createElement('kbd');
    cap.className = 'keycap';
    cap.textContent = part;
    group.append(cap);
  }
  return group;
}

/** Tabbed settings panel. Keyboard + gamepad via MenuNavigator; arrow keys on tabs. */
export class SettingsMenu {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly tablist: HTMLElement;
  private readonly body: HTMLElement;
  private readonly options: SettingsMenuOptions;
  private readonly nav = new MenuNavigator();
  private tab: SettingsTab = 'audio';
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.root.isConnected) return;
    if (event.target instanceof HTMLElement && event.target.closest('[role="tablist"]')) {
      const order = TABS.map((t) => t.id);
      const idx = order.indexOf(this.tab);
      if (event.code === 'ArrowRight' || event.code === 'ArrowDown') {
        event.preventDefault();
        this.setTab(order[(idx + 1) % order.length]!);
        this.focusTab();
      } else if (event.code === 'ArrowLeft' || event.code === 'ArrowUp') {
        event.preventDefault();
        this.setTab(order[(idx - 1 + order.length) % order.length]!);
        this.focusTab();
      } else if (event.code === 'Home') {
        event.preventDefault();
        this.setTab(order[0]!);
        this.focusTab();
      } else if (event.code === 'End') {
        event.preventDefault();
        this.setTab(order[order.length - 1]!);
        this.focusTab();
      }
    }
  };

  constructor(parent: HTMLElement, options: SettingsMenuOptions) {
    this.options = options;
    if (options.embedded) {
      this.root = document.createElement('div');
      this.root.className = 'settings-menu settings-menu--embedded';
      this.panel = this.root;
    } else {
      this.root = document.createElement('div');
      this.root.className = 'overlay settings-overlay visible';
      this.root.dataset.testid = 'settings-menu';
      this.root.setAttribute('role', 'dialog');
      this.root.setAttribute('aria-modal', 'true');
      this.root.setAttribute('aria-label', 'Settings');
      this.panel = document.createElement('section');
      this.panel.className = 'panel settings-panel';
      this.root.append(this.panel);
    }
    this.root.dataset.testid = this.root.dataset.testid ?? 'settings-menu';

    const heading = document.createElement('h2');
    heading.className = 'panel__title';
    heading.id = 'settings-title';
    heading.textContent = 'Settings';
    if (!options.embedded) {
      this.root.setAttribute('aria-labelledby', 'settings-title');
    }

    this.tablist = document.createElement('div');
    this.tablist.className = 'settings-tabs';
    this.tablist.setAttribute('role', 'tablist');
    this.tablist.setAttribute('aria-label', 'Settings sections');

    this.body = document.createElement('div');
    this.body.className = 'settings-body';
    this.body.setAttribute('role', 'tabpanel');
    this.body.dataset.testid = 'settings-body';

    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn settings-tab';
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      btn.dataset.testid = `settings-tab-${t.id}`;
      btn.id = `settings-tab-${t.id}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('aria-label', `${t.label} settings`);
      btn.addEventListener('click', () => this.setTab(t.id));
      this.tablist.append(btn);
    }

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn--quiet';
    back.textContent = 'Back';
    back.dataset.testid = 'settings-back';
    back.setAttribute('aria-label', 'Back');
    back.addEventListener('click', () => this.options.onClose());

    this.panel.append(heading);
    if (options.runSeed != null) {
      const seed = document.createElement('p');
      seed.className = 'pause-seed settings-seed';
      seed.dataset.testid = 'settings-seed';
      seed.textContent = `Seed ${options.runSeed}`;
      this.panel.append(seed);
    }
    this.panel.append(this.tablist, this.body, back);
    parent.append(this.root);
    window.addEventListener('keydown', this.onKeyDown, true);
    this.setTab('audio');
    this.nav.attach(this.root, {
      onBack: () => this.options.onClose(),
      initialFocus: `[data-tab="audio"]`,
    });
  }

  private focusTab(): void {
    this.tablist.querySelector<HTMLElement>(`[data-tab="${this.tab}"]`)?.focus({ preventScroll: true });
  }

  focusFirst(): void {
    this.focusTab();
  }

  private setTab(tab: SettingsTab): void {
    this.tab = tab;
    for (const btn of this.tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      const selected = btn.dataset.tab === tab;
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.tabIndex = selected ? 0 : -1;
      btn.classList.toggle('settings-tab--active', selected);
    }
    this.body.id = `settings-panel-${tab}`;
    this.body.setAttribute('aria-labelledby', `settings-tab-${tab}`);
    this.renderBody();
  }

  private renderBody(): void {
    const s = getSettings();
    this.body.replaceChildren();
    switch (this.tab) {
      case 'audio':
        this.renderAudio(s);
        break;
      case 'visuals':
        this.renderVisuals(s);
        break;
      case 'accessibility':
        this.renderAccessibility(s);
        break;
      case 'controls':
        this.renderControls();
        break;
      case 'cosmetics':
        this.renderCosmetics();
        break;
    }
  }

  private renderAudio(s: GameSettings): void {
    const levels = audio.volumeLevels;
    this.body.append(
      this.rangeRow(
        'Master',
        s.masterVolume,
        0,
        100,
        1,
        '%',
        (v) => audio.setMasterVolume(v / 100),
        'settings-master',
      ),
      this.rangeRow(
        'Music',
        Math.round(levels.music * 100),
        0,
        100,
        1,
        '%',
        (v) => audio.setMusicVolume(v / 100),
        'settings-music',
      ),
      this.rangeRow(
        'SFX',
        Math.round(levels.sfx * 100),
        0,
        100,
        1,
        '%',
        (v) => audio.setSfxVolume(v / 100),
        'settings-sfx',
      ),
      this.rangeRow(
        'UI',
        Math.round(levels.ui * 100),
        0,
        100,
        1,
        '%',
        (v) => audio.setUiVolume(v / 100),
        'settings-ui',
      ),
      this.checkRow('Mute', audio.isMuted, (v) => audio.setMuted(v), 'settings-mute'),
    );
  }

  private renderVisuals(s: GameSettings): void {
    const quality = this.selectRow(
      'Graphics quality',
      s.graphicsQuality,
      [
        ['auto', 'Auto'],
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
      ],
      (v) => {
        const graphicsQuality = v as GraphicsQualitySetting;
        saveSettings({ graphicsQuality });
        this.options.onGraphicsQuality?.(graphicsQuality);
      },
      'settings-graphics',
    );
    this.body.append(
      quality,
      this.rangeRow('Field of view', s.fovScale, 0.85, 1.2, 0.01, 'x', (v) => saveSettings({ fovScale: v }), 'settings-fov'),
      this.rangeRow('Camera distance', s.cameraDistance, 0.85, 1.25, 0.01, 'x', (v) => saveSettings({ cameraDistance: v }), 'settings-camera-distance'),
      this.checkRow('Screen shake', s.screenShake, (v) => saveSettings({ screenShake: v }), 'settings-shake'),
      this.checkRow(
        'Reduced motion',
        s.reducedMotion,
        (v) => saveSettings({ reducedMotion: v }),
        'settings-reduced-motion',
      ),
      this.selectRow(
        'UI text size',
        String(s.uiScale),
        [
          ['100', '100%'],
          ['125', '125%'],
          ['150', '150%'],
        ],
        (v) => saveSettings({ uiScale: Number(v) as UiScale }),
        'settings-ui-scale',
      ),
      this.checkRow('High-contrast HUD', s.highContrastHud, (v) => saveSettings({ highContrastHud: v }), 'settings-high-contrast'),
      this.button('Fullscreen', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }),
    );
    if (this.options.onReplayTutorial) {
      this.body.append(
        this.button('Replay tutorial', () => this.options.onReplayTutorial?.()),
      );
    }
  }

  private renderAccessibility(s: GameSettings): void {
    this.body.append(
      this.checkRow(
        'Colourblind-safe alarm cues',
        s.colourBlindSafe,
        (v) => saveSettings({ colourBlindSafe: v }),
        'settings-colour-blind',
      ),
      this.checkRow(
        'Visual cues for audio alerts',
        s.visualAudioAlerts,
        (v) => saveSettings({ visualAudioAlerts: v }),
        'settings-visual-alerts',
      ),
      this.checkRow('Subtitles / captions', s.subtitles, (v) => saveSettings({ subtitles: v }), 'settings-subtitles'),
      this.checkRow(
        'Hold to toggle grab & boost',
        s.holdToToggle,
        (v) => saveSettings({ holdToToggle: v }),
        'settings-hold-toggle',
      ),
      this.rangeRow(
        'Camera sensitivity',
        s.lookSensitivity,
        0.25,
        2,
        0.05,
        'x',
        (v) => saveSettings({ lookSensitivity: v }),
        'settings-sensitivity',
      ),
      this.checkRow('Invert look Y', s.invertY, (v) => saveSettings({ invertY: v }), 'settings-invert-y'),
    );
    const hint = document.createElement('p');
    hint.className = 'panel__body settings-hint';
    hint.textContent =
      'Colourblind-safe mode adds shapes and text labels to alarm and security states (amber stays security-only). Visual alerts stay on their own toggle.';
    this.body.append(hint);
  }

  private renderControls(): void {
    const list = document.createElement('dl');
    list.className = 'controls-list';
    list.dataset.testid = 'settings-keymap';
    for (const [key, action] of CONTROL_ROWS) {
      const dt = document.createElement('dt');
      dt.append(keycaps(key));
      const dd = document.createElement('dd');
      dd.textContent = action;
      list.append(dt, dd);
    }
    this.body.append(list);

    if (isTouchPlayDevice()) {
      const s = getSettings();
      const touch = getCameraTouchSettings();
      const heading = document.createElement('p');
      heading.className = 'panel__kicker settings-touch-heading';
      heading.textContent = 'Touch';
      this.body.append(
        heading,
        this.selectRow(
          'Touch layout',
          s.touchHandedness,
          [
            ['right', 'Right-handed'],
            ['left', 'Left-handed'],
          ],
          (v) => saveSettings({ touchHandedness: v as TouchHandedness }),
          'settings-touch-handedness',
        ),
        this.rangeRow(
          'Touch opacity',
          s.touchOpacity,
          0.35,
          1,
          0.05,
          '',
          (v) => saveSettings({ touchOpacity: v }),
          'settings-touch-opacity',
        ),
        this.rangeRow(
          'Touch look sensitivity',
          touch.camSensitivity,
          0.25,
          2,
          0.05,
          'x',
          (v) => saveCameraTouchSettings({ camSensitivity: v }),
          'settings-touch-sensitivity',
        ),
        this.checkRow(
          'Invert touch look Y',
          touch.invertY,
          (v) => saveCameraTouchSettings({ invertY: v }),
          'settings-touch-invert-y',
        ),
      );
    }

    const note = document.createElement('p');
    note.className = 'panel__body settings-hint';
    note.textContent = 'Keymap is read-only in this build.';
    this.body.append(note);
  }

  private renderCosmetics(): void {
    const state = getCosmetics();
    const selected = getSelectedCosmetics();
    const intro = document.createElement('p');
    intro.className = 'panel__body settings-hint';
    intro.textContent = `${cosmeticRoleHint('pix')} · selections save on this device. Pick one face and one topper.`;
    this.body.append(intro);
    for (const kind of ['expression', 'hat'] as const) {
      const heading = document.createElement('h3');
      heading.className = 'settings-cosmetics-heading';
      heading.textContent = kind === 'expression' ? 'Face-screen expressions' : 'Beveled toppers';
      this.body.append(heading);
      const grid = document.createElement('div');
      grid.className = 'settings-cosmetics-grid';
      const noneId = kind === 'expression' ? selected.expression : selected.hat;
      grid.append(this.cosmeticButton('none', kind, 'None', 'Default face / no topper', true, noneId === 'none'));
      for (const item of COSMETICS.filter((cosmetic) => cosmetic.kind === kind)) {
        grid.append(this.cosmeticButton(item.id, kind, item.label, item.unlock, state.unlocked.includes(item.id), noneId === item.id));
      }
      this.body.append(grid);
    }
    const note = document.createElement('p');
    note.className = 'panel__body settings-hint';
    note.textContent = 'Multiplayer note: the current schema has no cosmetic field, so your choice is local and is not sent to your partner.';
    this.body.append(note);
  }

  private cosmeticButton(
    id: 'none' | CosmeticDefinition['id'], kind: CosmeticDefinition['kind'], label: string, hint: string, unlocked: boolean, selected: boolean,
  ): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn settings-cosmetic${selected ? ' is-selected' : ''}`;
    button.dataset.testid = `cosmetic-${id}`;
    button.disabled = !unlocked;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.setAttribute('aria-label', `${label}${unlocked ? '' : `, locked: ${hint}`}`);
    const title = document.createElement('strong'); title.textContent = label;
    const detail = document.createElement('span'); detail.textContent = unlocked ? (selected ? 'Equipped' : 'Unlocked') : `Locked · ${hint}`;
    button.append(title, detail);
    button.addEventListener('click', () => {
      selectCosmetic(id, kind);
      this.renderBody();
      this.body.querySelector<HTMLElement>(`[data-testid="cosmetic-${id}"]`)?.focus({ preventScroll: true });
    });
    return button;
  }

  private rangeRow(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
    onChange: (value: number) => void,
    testId: string,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const text = document.createElement('span');
    const format = (v: number) => {
      const shown = unit === '%' ? Math.round(v) : Number(v.toFixed(2));
      return `${label}  ${shown}${unit}`;
    };
    text.textContent = format(value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.dataset.testid = testId;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      text.textContent = format(next);
      onChange(next);
    });
    row.append(text, input);
    return row;
  }

  private checkRow(label: string, value: boolean, onChange: (value: boolean) => void, testId: string): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.dataset.testid = testId;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.checked));
    row.append(text, input);
    return row;
  }

  private selectRow(
    label: string,
    value: string,
    options: readonly (readonly [string, string])[],
    onChange: (value: string) => void,
    testId: string,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    row.append(document.createTextNode(label));
    const select = document.createElement('select');
    select.dataset.testid = testId;
    select.setAttribute('aria-label', label);
    for (const [val, text] of options) {
      const option = document.createElement('option');
      option.value = val;
      option.textContent = text;
      option.selected = val === value;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    row.append(select);
    return row;
  }

  private button(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  dispose(): void {
    this.nav.detach();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }
}
