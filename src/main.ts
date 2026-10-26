import type { GameApp } from './app/GameApp.ts';
import type { GameMode } from './app/GameMode.ts';
// The engine, physics and level are split into lazy chunks so the menu appears immediately;
// they start downloading in the background as soon as the menu is up.
const loadGame = () => Promise.all([import('./app/GameApp.ts'), import('./level/PrototypeHeist.ts')]);
const gameModules = { promise: null as ReturnType<typeof loadGame> | null };
const preloadGame = () => (gameModules.promise ??= loadGame());
// Colyseus (client + schema) is only needed once a room is created or joined, so it stays out of
// the title's entry chunk; it is prefetched with the game once the title is idle.
import type { MultiplayerSession } from './network/MultiplayerSession.ts';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
let netModule: Promise<typeof import('./network/MultiplayerSession.ts')> | null = null;
const loadNet = () => (netModule ??= import('./network/MultiplayerSession.ts').catch((error) => { netModule = null; throw error; }));
import type { RoomStatus } from './network/NetworkTypes.ts';
import { RECONNECT_GRACE_SECONDS } from './network/ReconnectionToken.ts';
import {
  revalidateWarmup,
  retryWarmup,
  startWarmup,
  waitForServer,
  warmupReadyWithin,
  warmupBudgetMs,
  warmupIsFresh,
} from './network/ServerWarmup.ts';
import {
  getRunState,
  readUrlRunOptions,
  startLocalRun,
  clearRunState,
} from './run/ClientRun.ts';
import {
  clearRunIntent,
  consumeRunIntent,
  dailySeed,
  formatBeatMs,
  getRunInfo,
  prepareChallengeRun,
  prepareDailyRun,
  peekRunIntent,
  runOptionsFromSearch,
} from './net/runInfo.ts';
import './style.css';
import { audio } from './audio/AudioManager.ts';
import { titleMenuNav } from './ui/MenuNavigator.ts';
import { load as loadCampaignProgress, isUnlocked as campaignIsUnlocked, unlockAll as unlockCampaign } from './run/campaignProgress.ts';
import { createWakeOverlay } from './ui/WakeOverlay.ts';
import { enterImmersive } from './ui/fullscreen.ts';
import { isTouchPlayDevice } from './ui/touchDetect.ts';
import type { TitleAttract } from './ui/TitleAttract.ts';
import { mountTitleBestCrew } from './ui/TitleBestCrew.ts';

// Unlock-on-first-gesture, menu UI sounds and M to mute; sound files load lazily once the page is idle.
audio.install();

/** Bind keyboard + gamepad focus for the active title / lobby panel. */
function bindMenuNav(panel: HTMLElement, onBack?: () => void, initialFocus?: string | HTMLElement): void {
  titleMenuNav.attach(panel.closest('.menu-shell') ?? panel, {
    onBack,
    initialFocus: initialFocus ?? '.btn--primary',
  });
}

function roomInviteUrl(code: string): string {
  const current = new URL(window.location.href);
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('room', code.trim().toUpperCase());
  const server = current.searchParams.get('server');
  if (server !== null) url.searchParams.set('server', server);
  return url.toString();
}

function setRoomInUrl(code: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('room', code.trim().toUpperCase());
  window.history.replaceState(null, '', url);
}

function roomCodeFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() ?? '';
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}$/;
function cleanRoomCode(value: string): string {
  return value.toUpperCase().split('').filter((char) => ROOM_ALPHABET.includes(char)).join('').slice(0, 4);
}
function codeFromPastedText(value: string): string {
  try {
    const pastedUrl = new URL(value.trim(), window.location.href);
    const fromUrl = pastedUrl.searchParams.get('room');
    if (fromUrl) return cleanRoomCode(fromUrl);
  } catch { /* bare code or text containing a query */ }
  const query = value.match(/[?&]room=([^&#\s]+)/i)?.[1];
  return cleanRoomCode(query ?? value);
}

const MODE_STASH_KEY = 'pixnee.pendingMode';

const rootNode = document.querySelector('#app');
if (!rootNode || !(rootNode instanceof HTMLElement)) {
  throw new Error('Missing #app');
}
const root: HTMLElement = rootNode;

let game: GameApp | null = null;
let titleAttract: TitleAttract | null = null;
let titleBestCrewDispose: (() => void) | null = null;
let quickMatchInFlight = false;
let soloStartInFlight = false;
const CAMPAIGN_META = [
  ['l1-tethered', 'Tethered', 'Cord basics + carry'],
  ['l2-twin-levers', 'Twin Levers', 'Stretch the cord'],
  ['l3-wrap-and-drag', 'Wrap and Drag', 'Pylon-safe pull'],
  ['l4-fragile-relay', 'Fragile Relay', 'Relay pads + fragile loot'],
  ['l5-big-vault', 'The Big Vault', 'The full tether test'],
] as const;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text) {
    node.textContent = text;
  }
  return node;
}

type ButtonVariant = '' | 'btn--primary' | 'btn--quiet' | 'btn--danger';
function menuButton(label: string, testId: string, action: () => void, variant: ButtonVariant = ''): HTMLButtonElement {
  const button = element('button', `btn menu-button ${variant}`.trim(), label);
  button.type = 'button';
  button.dataset.testid = testId;
  button.setAttribute('aria-label', label || testId.replace(/-/g, ' '));
  button.addEventListener('click', () => {
    if (isTouchPlayDevice() && ['singleplayer', 'start-singleplayer', 'night-shift', 'create-room'].includes(testId)) void enterImmersive();
    action();
  });
  return button;
}

// "Dev local" (both drones on one keyboard) is a developer tool: only on a dev host or with ?dev=1,
// so tools/verify-* (127.0.0.1) keep working and players on the real site never see it.
const devMenuAllowed = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  || new URLSearchParams(window.location.search).get('dev') === '1';

// The menu backdrop is key art rendered from the real spawn room (public/key-art), not a stock gradient.
function menuShell(): HTMLElement {
  const shell = element('main', 'menu-shell');
  shell.append(Object.assign(element('div', 'menu-art'), { ariaHidden: 'true' }));
  return shell;
}

// Wordmark: PIX and NEE joined by the cord instead of an ampersand. Drawn inline so it scales crisply.
const CORD_SVG = '<svg viewBox="0 0 96 48" aria-hidden="true" focusable="false">'
  + '<rect x="2" y="10" width="12" height="10" rx="2"/><rect x="82" y="10" width="12" height="10" rx="2"/>'
  + '<path d="M14 15 C 30 15, 30 42, 48 42 S 66 15, 82 15"/></svg>';
function wordmark(): HTMLElement {
  const mark = element('h1', 'wordmark');
  mark.setAttribute('aria-label', 'PIX & NEE');
  mark.innerHTML = `<span class="wordmark__pix">PIX</span><span class="wordmark__cord">${CORD_SVG}</span><span class="wordmark__nee">NEE</span>`;
  return mark;
}

function menuPanel(title: string, subtitle: string): HTMLElement {
  const shell = menuShell();
  const panel = element('section', 'panel menu-panel');
  panel.append(element('p', 'menu-kicker', 'PIX & NEE'), element('h1', 'panel__title', title));
  panel.append(element('p', 'panel__body menu-subtitle', subtitle));
  shell.append(panel);
  root.replaceChildren(shell);
  return panel;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unable to connect.';
  if (message.toLowerCase().includes('failed to fetch')) {
    return import.meta.env.PROD
      ? "Can't reach the game server right now. Check your connection and try again in a moment."
      : 'Multiplayer server unavailable. Restart with npm run dev, or run npm run server beside npm run dev:client.';
  }
  return message;
}

function showMainMenu(): void {
  titleAttract?.dispose();
  titleAttract = null;
  titleBestCrewDispose?.();
  titleBestCrewDispose = null;
  const params = new URLSearchParams(window.location.search);
  const beatRaw = params.get('beat');
  const beatMs = beatRaw != null && /^\d+$/.test(beatRaw) ? Number(beatRaw) : NaN;
  const blurb = Number.isFinite(beatMs)
    ? `A friend finished in ${formatBeatMs(beatMs)}. Can you beat it?`
    : 'Fly a pair of tethered drones through a sleepy office and lift the core from the vault.';
  const shell = menuShell();
  shell.classList.add('menu-shell--title');
  const attractCanvas = element('canvas', 'title-attract-canvas');
  attractCanvas.setAttribute('aria-hidden', 'true');
  attractCanvas.dataset.titleFallback = 'key-art';
  const panel = element('section', 'panel menu-panel title-panel');
  panel.append(wordmark(), element('h2', 'title-tagline', 'Two drones. One cord.'));
  panel.append(element('p', 'panel__body menu-subtitle', blurb));
  const play = menuButton('', 'singleplayer', showSinglePlayer, 'btn--primary');
  play.classList.add('btn--hero');
  play.dataset.titlePlay = 'true';
  play.setAttribute('aria-label', 'Play now');
  play.append(element('span', 'btn__label', 'Play now'), element('span', 'btn__hint', 'Solo · you fly PIX'));
  const daily = menuButton('Daily Heist', 'daily-heist', () => {
    prepareDailyRun(new Date());
    void startSoloNightShift();
  });
  daily.title = `Night Shift seeded from today's UTC date (${dailySeed(new Date())})`;
  const actions = element('div', 'menu-actions');
  actions.append(
    play,
    daily,
    menuButton('Campaign', 'campaign', showCampaignSelect),
    menuButton('Play with a friend', 'multiplayer', showMultiplayerMenu),
    menuButton('Leaderboards', 'leaderboards', showLeaderboards, 'btn--quiet'),
  );
  if (devMenuAllowed) {
    actions.append(menuButton('Dev local', 'dev-local', () => {
      void startGame('dev-local');
    }, 'btn--quiet'));
  }
  actions.append(menuButton('Settings', 'title-settings', openTitleSettings, 'btn--quiet'));
  panel.append(actions);
  titleBestCrewDispose = mountTitleBestCrew(panel);
  shell.append(attractCanvas, panel);
  root.replaceChildren(shell);
  // PLAY NOW is first in tab order and already focused, so Enter starts it.
  bindMenuNav(panel, undefined, play);
  void import('./ui/TitleAttract.ts').then(({ TitleAttract }) => TitleAttract.mount(attractCanvas, play)).then((mounted) => {
    if (mounted && root.contains(attractCanvas)) titleAttract = mounted;
    else {
      mounted?.dispose();
      shell.classList.add('title-scene-fallback');
    }
  });
  startWarmup();
}

function showCampaignSelect(): void {
  const panel = menuPanel('Campaign', 'Five handmade levels. Each one adds a new tether trick.');
  panel.classList.add('campaign-select-panel');
  panel.dataset.testid = 'level-select';
  const progress = loadCampaignProgress();
  const grid = element('div', 'campaign-level-grid');
  for (const [index, [id, name, teaches]] of CAMPAIGN_META.entries()) {
    const card = element('article', 'campaign-level-card');
    card.dataset.testid = `level-card-${id}`;
    const unlocked = campaignIsUnlocked(index + 1, progress);
    card.dataset.locked = unlocked ? '0' : '1';
    const header = element('div', 'campaign-level-card__header');
    const number = element('span', 'campaign-level-card__number', String(index + 1).padStart(2, '0'));
    const title = element('h2', '', name);
    header.append(number, title);
    const detail = element('p', 'campaign-level-card__teaches', unlocked ? teaches : `Finish ${CAMPAIGN_META[index - 1]?.[1] ?? 'the previous level'} to unlock`);
    const stars = element('div', 'campaign-stars');
    const earned = progress.levels[id]?.stars ?? [false, false, false];
    for (const [starIndex, label] of ['Time star', 'Loot star', 'No-alarm star'].entries()) {
      const star = element('span', earned[starIndex] ? 'campaign-star campaign-star--earned' : 'campaign-star', '★');
      star.setAttribute('aria-label', label);
      star.title = label;
      stars.append(star);
    }
    const start = menuButton(unlocked ? 'Play' : 'Locked', `campaign-play-${id}`, () => {
      if (!unlocked) return;
      const next = new URL(window.location.href);
      next.searchParams.set('level', id);
      window.history.replaceState(null, '', next);
      void startGame('campaign');
    });
    if (!unlocked) start.disabled = true;
    const actions = element('div', 'campaign-level-card__actions');
    const friend = menuButton('Co-op', `campaign-friend-${id}`, () => { if (unlocked) void createRoom({ mode: 'campaign', levelId: id }); });
    if (!unlocked) friend.disabled = true;
    actions.append(start, friend);
    card.append(header, detail, stars, actions);
    grid.append(card);
  }
  const unlock = element('button', 'campaign-unlock', 'Unlock all');
  unlock.type = 'button';
  unlock.addEventListener('click', () => { unlockCampaign(); showCampaignSelect(); });
  const actions = element('div', 'menu-actions');
  actions.append(unlock, menuButton('Back', 'back', showMainMenu, 'btn--quiet'));
  panel.append(grid, actions);
  bindMenuNav(panel, showMainMenu, grid.querySelector('button:not([disabled])') ?? undefined);
}

function openTitleSettings(): void {
  titleMenuNav.detach();
  void import('./ui/SettingsMenu.ts').then(({ SettingsMenu }) => {
    const host = document.createElement('div');
    host.className = 'settings-host';
    root.append(host);
    let menu: InstanceType<typeof SettingsMenu> | null = null;
    menu = new SettingsMenu(host, {
      onClose: () => {
        menu?.dispose();
        host.remove();
        showMainMenu();
      },
    });
  });
}

function showSinglePlayer(): void {
  const panel = menuPanel('Solo heist', 'You fly PIX. A CPU NEE rides the other end of the cord. It follows you, but it can\'t hack yet.');
  const start = menuButton('Start', 'start-singleplayer', () => {
    void startGame('singleplayer');
  }, 'btn--primary');
  const night = menuButton('Night Shift', 'night-shift', () => {
    clearRunIntent();
    void startSoloNightShift();
  });
  night.title = 'Endless seeded floors. Your score carries over.';
  const actions = element('div', 'menu-actions');
  actions.append(start, night, menuButton('Back', 'back', showMainMenu, 'btn--quiet'));
  panel.append(actions);
  bindMenuNav(panel, showMainMenu, start);
  void import('./run/nightShiftScore.ts').then(({ getBest }) => {
    const best = getBest();
    if (!best) return;
    const p = element('p', 'menu-best', `Night Shift best: floor ${best.floor} · ${best.score}`);
    p.dataset.testid = 'night-shift-best';
    panel.append(p);
  });
}

async function startSoloNightShift(): Promise<void> {
  if (soloStartInFlight) return;
  const params = new URLSearchParams(window.location.search);
  if (!warmupReadyWithin(60_000) || params.get('bot') === '0' || params.get('ranked') === '0') {
    void startGame('night-shift');
    return;
  }
  soloStartInFlight = true;
  try {
    const { tryRankedSolo } = await import('./network/RankedSolo.ts');
    const session = await tryRankedSolo({ seed: peekRunIntent()?.seed });
    if (session) {
      clearRunIntent();
      void startGame('multiplayer', session);
      return;
    }
  } catch {
    // The ranked path is optional; fall through to the instant local run.
  } finally {
    soloStartInFlight = false;
  }
  void startGame('night-shift');
}

function showMultiplayerMenu(): void {
  void loadNet().catch(() => {});
  const panel = menuPanel('Play with a friend', 'Make a private room and share its code, join a friend\'s room, or quick-match with another player.');
  const actions = element('div', 'menu-actions');
  actions.append(
    menuButton('Create a room', 'create-room', () => {
      void createRoom();
    }, 'btn--primary'),
    menuButton('Daily (co-op)', 'create-daily-room', () => { void createRoom({ mode: 'daily' }); }),
    menuButton('Join with a code', 'join-room', () => showJoinRoom()),
    menuButton('Quick match', 'quick-match', () => { void quickMatch(); }),
    menuButton('Back', 'back', showMainMenu, 'btn--quiet'),
  );
  panel.append(actions);
  bindMenuNav(panel, showMainMenu, '[data-testid="create-room"]');
}

function showLeaderboards(): void {
  let leaderboard: { dispose: () => void } | null = null;
  const close = () => {
    leaderboard?.dispose();
    leaderboard = null;
    showMainMenu();
  };
  const panel = menuPanel('Leaderboards', 'Global runs from the daily heist and Night Shift.');
  const host = element('div', 'leaderboard-host');
  const actions = element('div', 'menu-actions');
  actions.append(menuButton('Back', 'back', close, 'btn--quiet'));
  panel.append(host, actions);
  bindMenuNav(panel, close, '[data-testid="back"]');
  void import('./ui/LeaderboardPanel.ts').then(({ LeaderboardPanel }) => {
    if (!root.contains(panel)) return;
    leaderboard = new LeaderboardPanel(host);
    bindMenuNav(panel, close, '[data-testid="lb-tab-daily"]');
  }).catch(() => {
    if (!root.contains(panel)) return;
    const status = element('p', 'leaderboard-status', 'Leaderboard unavailable right now');
    status.dataset.testid = 'lb-status';
    host.append(status);
  });
}

function quickMatchKey(): string {
  const options = readUrlRunOptions();
  const mode = options.mode ?? 'standard';
  const seed = options.seed ?? (mode === 'daily' ? dailySeed(new Date()) : undefined);
  let key = seed == null ? mode : `${mode}:${seed}`;
  const pool = new URLSearchParams(window.location.search).get('qmPool');
  const cleanPool = pool?.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) ?? '';
  if (cleanPool) key += `:${cleanPool}`;
  return key;
}

function quickMatchTimeout(): number {
  const raw = Number.parseInt(new URLSearchParams(window.location.search).get('qmTimeout') ?? '', 10);
  return Number.isFinite(raw) ? Math.max(2_000, Math.min(120_000, raw)) : 45_000;
}

async function quickMatch(): Promise<void> {
  if (quickMatchInFlight) return;
  quickMatchInFlight = true;
  const panel = menuPanel('Quick match', 'Find another player, or invite an AI partner while you wait.');
  panel.dataset.testid = 'qm-panel';
  const status = element('p', 'lobby-status', 'Looking for a partner…');
  status.dataset.testid = 'qm-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const elapsed = element('span', '', 'Searching · 0 s');
  elapsed.dataset.testid = 'qm-elapsed';
  const cancel = menuButton('Cancel', 'qm-cancel', () => { void leave(); }, 'btn--quiet');
  const actions = element('div', 'menu-actions');
  actions.append(cancel);
  panel.append(status, elapsed, actions);
  bindMenuNav(panel, () => { void leave(); }, cancel);

  let session: MultiplayerSession | null = null;
  let pendingJoin: Promise<MultiplayerSession> | null = null;
  let removeStatus: (() => void) | null = null;
  let elapsedTimer: number | undefined;
  let timeoutTimer: number | undefined;
  let startTimer: number | undefined;
  let active = true;
  let botShown = false;
  const startedAt = Date.now();
  let timeoutNote: HTMLElement | null = null;
  const clearTimers = () => {
    if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
    if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
    if (startTimer !== undefined) window.clearTimeout(startTimer);
  };
  const cleanup = () => {
    active = false;
    quickMatchInFlight = false;
    clearTimers();
    removeStatus?.();
    removeStatus = null;
  };
  async function leave(): Promise<void> {
    if (!active) return;
    cleanup();
    const joining = pendingJoin;
    if (session) await session.dispose();
    if (joining) void joining.then((late) => late.dispose()).catch(() => {});
    showMultiplayerMenu();
  }
  function startWhenReady(): void {
    if (!session || !active) return;
    cleanup();
    void startGame('multiplayer', session);
  }
  elapsedTimer = window.setInterval(() => {
    elapsed.textContent = `Searching · ${Math.floor((Date.now() - startedAt) / 1_000)} s`;
  }, 1_000);
  timeoutTimer = window.setTimeout(() => {
    if (!active || botShown) return;
    botShown = true;
    timeoutNote = element('p', 'menu-subtitle', 'No one yet. Keep waiting or play with the AI partner — a player who joins later takes its seat.');
    actions.prepend(menuButton('Play with AI partner', 'qm-play-bot', () => session?.requestBotPartner(), 'btn--primary'));
    panel.append(timeoutNote);
  }, quickMatchTimeout());

  if (!(await ensureServerAwake(panel, () => { void leave(); }, () => {
    cleanup();
    void quickMatch();
  }, () => { void leave(); }))) return;
  if (!active) return; // cancelled while the server was waking
  try {
    pendingJoin = (await loadNet()).MultiplayerSession.quickMatch({ ...readUrlRunOptions(), qmKey: quickMatchKey() });
    session = await pendingJoin;
    if (!active) {
      await session.dispose();
      return;
    }
    removeStatus = session.onStatus((next) => {
      if (!active || !next.started || !next.localRole) return;
      const partnerRole = next.localRole === 'pix' ? 'nee' : 'pix';
      const partner = next.players.get(partnerRole);
      if (partner?.bot !== true) {
        status.textContent = `Partner found! You fly ${next.localRole.toUpperCase()} · they fly ${partnerRole.toUpperCase()}`;
        status.dataset.testid = 'qm-found';
        cancel.hidden = true;
        elapsed.hidden = true;
        actions.querySelector('[data-testid="qm-play-bot"]')?.remove();
        timeoutNote?.remove();
        startTimer = window.setTimeout(startWhenReady, 800);
      } else {
        startWhenReady();
      }
    });
  } catch (error) {
    if (!active) return;
    cleanup();
    status.textContent = errorMessage(error);
    status.classList.add('error');
    panel.append(menuButton('Back', 'back', showMultiplayerMenu, 'btn--quiet'));
    bindMenuNav(panel, showMultiplayerMenu, '[data-testid="back"]');
  }
}

async function ensureServerAwake(
  panel: HTMLElement,
  back: () => void,
  retry: () => void,
  onCancel: () => void = back,
): Promise<boolean> {
  panel.querySelectorAll('.wake-overlay').forEach((node) => node.remove());
  if (warmupIsFresh()) return true;
  revalidateWarmup();

  const controller = new AbortController();
  const budgetMs = warmupBudgetMs();
  let choseSolo = false;
  const wake = createWakeOverlay(menuButton, budgetMs, {
    cancel: () => controller.abort(),
    playSolo: () => {
      choseSolo = true;
      controller.abort();
      showSinglePlayer();
    },
    retry: () => {
      retryWarmup();
      retry();
    },
    back,
  });
  // Only show the overlay once the first ping actually failed ('waking'), so a fast answer never flashes it.
  const result = await waitForServer({
    signal: controller.signal,
    onTick(elapsedMs, current) {
      wake.update(elapsedMs);
      if (current !== 'ready' && current !== 'unknown' && !wake.overlay.isConnected) panel.append(wake.overlay);
    },
  });
  if (!wake.overlay.isConnected) panel.append(wake.overlay);
  if (result === 'ready') {
    wake.markReady();
    wake.overlay.remove();
    return true;
  }
  if (result === 'cancelled') {
    wake.overlay.remove();
    if (!choseSolo) onCancel();
    return false;
  }

  wake.showFailure();
  return false;
}

async function createRoom(override: { mode?: 'daily' | 'campaign'; levelId?: string } = {}): Promise<void> {
  const panel = menuPanel('Creating room', 'Connecting to the multiplayer server…');
  const status = element('p', 'lobby-status', 'Please wait.');
  status.setAttribute('role', 'alert');
  status.setAttribute('aria-live', 'polite');
  panel.append(status);
  bindMenuNav(panel, showMultiplayerMenu);
  if (!(await ensureServerAwake(panel, showMultiplayerMenu, () => { void createRoom(override); }))) return;
  try {
    const session = await (await loadNet()).MultiplayerSession.createRoom({ ...readUrlRunOptions(), ...override, bot: new URLSearchParams(location.search).get('bot') === '1' });
    showLobby(session);
  } catch (error) {
    status.textContent = errorMessage(error);
    status.classList.add('error');
    panel.append(menuButton('Back', 'back', showMultiplayerMenu, 'btn--quiet'));
    bindMenuNav(panel, showMultiplayerMenu, '[data-testid="back"]');
  }
}

function showJoinRoom(prefill?: string, initialError = ''): void {
  void loadNet().catch(() => {});
  // menuButton passes the click event when used directly as the action; only strings count.
  const initial = typeof prefill === 'string' ? cleanRoomCode(prefill) : '';
  const panel = menuPanel('Join a room', 'Type the four-character code your friend sees.');
  panel.classList.add('join-panel');
  const form = element('form', 'join-form');
  const input = element('input', 'room-code-input');
  input.dataset.testid = 'room-code-input';
  input.name = 'room-code';
  input.inputMode = 'text';
  input.autocapitalize = 'characters';
  input.setAttribute('autocorrect', 'off');
  input.spellcheck = false;
  input.enterKeyHint = 'go';
  input.autocomplete = 'off';
  input.maxLength = 4;
  input.pattern = '[A-HJ-NP-Z2-9]{4}';
  input.placeholder = 'XXXX';
  input.setAttribute('aria-label', 'Room code');
  input.addEventListener('input', () => {
    input.value = cleanRoomCode(input.value);
    submit.disabled = input.value.length !== 4;
    status.classList.remove('error');
  });
  input.addEventListener('paste', (event) => {
    const code = codeFromPastedText(event.clipboardData?.getData('text') ?? '');
    if (!code) return;
    event.preventDefault();
    input.value = code;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (code.length === 4) void doJoin(code);
  });
  if (initial) input.value = initial;
  const submit = element('button', 'btn btn--primary menu-button', 'Join');
  submit.dataset.testid = 'join-submit';
  submit.type = 'submit';
  const status = element('p', 'lobby-status');
  const back = menuButton('Back', 'back', showMultiplayerMenu, 'btn--quiet');
  form.append(input, submit);
  let joinInFlight = false;

  async function doJoin(code: string): Promise<void> {
    if (joinInFlight) return;
    joinInFlight = true;
    if (isTouchPlayDevice()) void enterImmersive();
    submit.disabled = true;
    status.textContent = 'Connecting…';
    status.classList.remove('error');
    try {
      if (!(await ensureServerAwake(panel, showMultiplayerMenu, () => { void doJoin(input.value); }, () => {
        submit.disabled = false;
        status.textContent = '';
      }))) return;
      const session = await (await loadNet()).MultiplayerSession.joinRoom(code, readUrlRunOptions());
      showLobby(session);
    } catch (error: unknown) {
      status.textContent = await loadNet().then((net) => net.classifyJoinError(error, code).message, () => errorMessage(error));
      status.classList.add('error');
      submit.disabled = false;
    } finally {
      joinInFlight = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = cleanRoomCode(input.value);
    if (!ROOM_CODE_PATTERN.test(code)) {
      status.textContent = 'Enter the 4-character code.';
      status.classList.add('error');
      return;
    }
    void doJoin(code);
  });
  const hint = element('p', 'room-code-hint', 'Codes use letters and 2–9');
  status.setAttribute('role', 'alert');
  status.setAttribute('aria-live', 'polite');
  status.textContent = initialError;
  if (initialError) status.classList.add('error');
  submit.disabled = initial.length !== 4;
  panel.append(form, hint, status, back);
  bindMenuNav(panel, showMultiplayerMenu, input);
  window.requestAnimationFrame(() => input.focus({ preventScroll: true }));
  if (initial.length === 4 && !initialError) {
    void doJoin(initial);
  }
}

function showLobby(session: MultiplayerSession): void {
  setRoomInUrl(session.roomCode);
  const panel = menuPanel('Room ready', 'Share this code with the second player.');
  panel.classList.add('lobby-panel');
  const label = element('p', 'panel__kicker room-label', 'Room code');
  const code = element('p', 'room-code', session.roomCode);
  code.dataset.testid = 'room-code';
  const qrHost = element('div');
  const copy = element('button', 'btn btn--primary menu-button', 'Copy invite link');
  copy.dataset.testid = 'copy-code';
  copy.type = 'button';
  const invite = element('input', 'invite-link');
  invite.dataset.testid = 'invite-link';
  invite.type = 'url';
  invite.readOnly = true;
  invite.value = roomInviteUrl(session.roomCode);
  invite.setAttribute('aria-label', 'Invite link');
  copy.addEventListener('click', () => {
    const write = navigator.clipboard?.writeText(invite.value) ?? Promise.reject(new Error('clipboard unavailable'));
    void write
      .then(() => { copy.textContent = 'Copied'; window.setTimeout(() => { copy.textContent = 'Copy invite link'; }, 1500); })
      .catch(() => { invite.focus({ preventScroll: true }); invite.select(); copy.textContent = 'Select the link to copy'; });
  });
  const share = element('button', 'btn menu-button', 'Share');
  share.dataset.testid = 'share-invite';
  share.type = 'button';
  if (typeof navigator.share === 'function') {
    share.addEventListener('click', () => void navigator.share({
      title: 'PIX & NEE room', text: `Join my PIX & NEE room: ${session.roomCode}`, url: invite.value,
    }));
  } else share.hidden = true;
  const role = element('p', 'room-label', '');
  const status = element('p', 'lobby-status', 'Waiting for partner…');
  status.dataset.testid = 'lobby-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const reconnecting = element('p', 'lobby-reconnecting');
  reconnecting.dataset.testid = 'lobby-reconnecting';
  reconnecting.setAttribute('aria-live', 'polite');
  reconnecting.hidden = true;
  panel.append(label, code, qrHost, invite, copy, share, role, status, reconnecting);
  void import('./ui/InviteQr.ts').then(({ renderInviteQr }) => renderInviteQr(qrHost, invite.value));
  bindMenuNav(panel, () => {
    void session.dispose();
    showMultiplayerMenu();
  }, copy);

  const removeStatus = session.onStatus((next) => {
    const me = next.localRole;
    role.textContent = me ? `You fly ${me.toUpperCase()} · your friend flies ${me === 'pix' ? 'NEE' : 'PIX'}` : '';
    status.textContent = next.started ? 'Partner connected. Starting…' : 'Waiting for partner…';
    const partner = next.players.get(me === 'pix' ? 'nee' : 'pix');
    const selfReconnecting = session.connectionState === 'reconnecting';
    const partnerReconnecting = !!partner && partner.connected === false;
    reconnecting.hidden = !selfReconnecting && !partnerReconnecting;
    reconnecting.textContent = selfReconnecting ? 'Reconnecting…' : 'Partner reconnecting…';
  });
  void session.waitForStart().then(() => {
    removeStatus();
    return startGame('multiplayer', session);
  });
}

async function startGame(mode: GameMode, session?: MultiplayerSession): Promise<void> {
  titleAttract?.dispose();
  titleAttract = null;
  titleBestCrewDispose?.();
  titleBestCrewDispose = null;
  if (isTouchPlayDevice() && (mode === 'singleplayer' || mode === 'night-shift' || mode === 'campaign' || mode === 'multiplayer')) void enterImmersive();
  titleMenuNav.detach();
  try { sessionStorage.removeItem(MODE_STASH_KEY); } catch { /* private mode */ }
  const canvas = element('canvas');
  canvas.id = 'game-canvas';
  canvas.dataset.testid = 'game-canvas';
  canvas.tabIndex = 0;
  const boot = element('div', 'boot-card');
  boot.id = 'boot-status';
  const bootStep = element('p', 'boot-step', 'Loading physics…');

  // Solo / offline: same shared run module, never contacts the server.
  // Consume Daily / challenge / replay intent so ClientRun (and getRunInfo) share one seed.
  if (!session && (mode === 'singleplayer' || mode === 'dev-local' || mode === 'night-shift' || mode === 'campaign')) {
    const prepared = consumeRunIntent();
    const fromUrl = readUrlRunOptions();
    startLocalRun(
      mode === 'night-shift' || mode === 'campaign'
        ? {
            ...fromUrl,
            ...(prepared?.seed != null ? { seed: prepared.seed } : {}),
            ...(prepared?.floor != null ? { floor: prepared.floor } : {}),
            ...(prepared?.captures != null ? { captures: prepared.captures } : {}),
            ...(prepared?.timeToBeatMs != null ? { beat: prepared.timeToBeatMs } : {}),
            mode: mode === 'campaign' ? 'campaign' : (prepared?.mode ?? fromUrl.mode ?? 'nightshift'),
            ...(mode === 'campaign' ? { levelId: new URLSearchParams(window.location.search).get('level') ?? 'l1-tethered' } : {}),
          }
        : { ...fromUrl, ...(prepared ?? {}) },
    );
  }

  const runInfo = mode === 'night-shift' || mode === 'campaign' ? getRunInfo() : undefined;
  boot.append(
    element('p', 'boot-title', 'PIX & NEE'),
    Object.assign(element('div', 'boot-dots'), { innerHTML: '<span class="pix"></span><span class="nee"></span>' }),
    Object.assign(element('div', 'boot-bar'), { innerHTML: '<span></span>' }),
    bootStep,
  );
  if (runInfo) {
    boot.append(element('p', 'boot-seed', `Seed ${runInfo.seed} · Floor ${runInfo.floor}`));
  }
  root.replaceChildren(canvas, boot);
  const bootSteps = ['Loading physics…', 'Building the lab…', 'Waking PIX and NEE…'];
  let bootIndex = 0;
  const bootTimer = window.setInterval(() => {
    bootIndex = Math.min(bootSteps.length - 1, bootIndex + 1);
    bootStep.textContent = bootSteps[bootIndex];
    boot.style.setProperty('--boot-progress', `${(bootIndex + 1) / bootSteps.length}`);
  }, 1400);

  let removeStatus: (() => void) | null = null;
  const runHud = element('aside', 'network-hud');
  runHud.dataset.testid = 'run-hud';
  const paintRunHud = (base = '') => {
    const run = getRunState();
    if (!run) {
      runHud.textContent = base;
      return;
    }
    const parts = [base, `Floor ${run.floor}`, run.seedCode].filter(Boolean);
    if (run.mode !== 'standard') parts.push(run.mode.toUpperCase());
    runHud.textContent = parts.join(' · ');
  };
  root.append(runHud);
  paintRunHud();

  if (session) {
    const networkHud = runHud;
    networkHud.dataset.testid = 'network-hud';
    const updateHud = (status: RoomStatus) => {
      const localRole = status.localRole?.toUpperCase() ?? 'Player';
      const partnerRole = status.localRole === 'pix' ? 'nee' : 'pix';
      const partner = status.players.get(partnerRole);
      const partnerDisconnected = !partner || partner.connected === false;
      let base = `${status.roomCode} · ${localRole}`;
      if (partnerDisconnected) base += ' · Partner disconnected';
      networkHud.classList.toggle('partner-disconnected', partnerDisconnected);
      paintRunHud(base);
    };
    removeStatus = session.onStatus(updateHud);

    // Partner-left / connection-lost card. Read-only view of existing session state.
    const overlay = element('div', 'partner-overlay');
    overlay.dataset.testid = 'partner-overlay';
    const overlayTitle = element('p', 'partner-title', '');
    const overlayDetail = element('p', 'partner-detail', '');
    const menuButtonEl = element('button', 'btn menu-button', 'Back to menu');
    menuButtonEl.type = 'button';
    menuButtonEl.addEventListener('click', () => window.location.reload());
    overlay.append(overlayTitle, overlayDetail, menuButtonEl);
    root.append(overlay);
    let partnerLostAt: number | null = null;
    let selfReconnectAt: number | null = null;
    const overlayTimer = window.setInterval(() => {
      const status = session.currentStatus;
      const net = session.connectionState;
      const partner = status.players.get(status.localRole === 'pix' ? 'nee' : 'pix');
      const lost = net === 'disconnected' || net === 'error';
      const partnerReconnecting = !lost && !!partner && partner.connected === false;
      const partnerLeft = !lost && !partner;
      partnerLostAt = partnerReconnecting || partnerLeft ? partnerLostAt ?? Date.now() : null;
      selfReconnectAt = net === 'reconnecting' ? selfReconnectAt ?? Date.now() : null;
      const graceMs = RECONNECT_GRACE_SECONDS * 1000;
      overlay.classList.toggle('visible', lost || partnerReconnecting || partnerLeft || net === 'reconnecting');
      menuButtonEl.hidden = !lost && !(partnerLeft || (partnerReconnecting && Date.now() - (partnerLostAt ?? 0) > graceMs));
      if (lost) {
        overlayTitle.textContent = 'Connection lost';
        overlayDetail.textContent = 'The room closed or your connection dropped.';
      } else if (net === 'reconnecting') {
        const left = session.reconnectSecondsLeft
          ?? Math.max(0, RECONNECT_GRACE_SECONDS - Math.floor((Date.now() - (selfReconnectAt ?? Date.now())) / 1000));
        overlayTitle.textContent = 'Reconnecting…';
        overlayDetail.textContent = `Hold tight. Your drone is parked. ${left}s`;
      } else if (partnerReconnecting) {
        const left = Math.max(0, RECONNECT_GRACE_SECONDS - Math.floor((Date.now() - (partnerLostAt ?? Date.now())) / 1000));
        const name = status.localRole === 'pix' ? 'NEE' : 'PIX';
        overlayTitle.textContent = 'Waiting for partner';
        overlayDetail.textContent = `${name} disconnected. Timer paused. ${left}s to rejoin`;
      } else if (partnerLeft) {
        overlayTitle.textContent = 'Partner left';
        overlayDetail.textContent = 'They did not come back. You can return to the menu.';
      }
    }, 500);
    const previousRemove = removeStatus;
    removeStatus = () => { previousRemove(); window.clearInterval(overlayTimer); overlay.remove(); };
  }

  try {
    const [{ GameApp }, { createPrototypeHeist }] = await preloadGame();
    game = await GameApp.create({
      canvas,
      createLevel: createPrototypeHeist,
      uiParent: root,
      devParent: mode === 'dev-local' || new URLSearchParams(window.location.search).has('debug')
        ? root
        : undefined,
      mode,
      multiplayer: session,
      runSeed: runInfo ? { seed: runInfo.seed, floor: runInfo.floor } : undefined,
      onLeaveGame: () => {
        removeStatus?.();
        clearRunState();
        game?.dispose();
        game = null;
        // Next-floor stub stashes seed then leaves; resume the same mode when pending.
        let resume: GameMode | null = null;
        try {
          const pending = sessionStorage.getItem(MODE_STASH_KEY);
          if (pending === 'singleplayer' || pending === 'night-shift' || pending === 'dev-local') {
            resume = pending;
            sessionStorage.removeItem(MODE_STASH_KEY);
          }
        } catch { /* private mode */ }
        if (resume) void startGame(resume);
        else showMainMenu();
      },
    });
    window.clearInterval(bootTimer);
    boot.remove();
    canvas.focus();
    game.start();
  } catch (error) {
    removeStatus?.();
    void session?.dispose();
    window.clearInterval(bootTimer);
    boot.textContent = errorMessage(error);
    boot.classList.add('error');
  }
}

/** Dev / screenshot hook: `?report` mounts the Heist Report with demo stats (no Havok boot). */
async function showHeistReportDemo(): Promise<void> {
  const shell = menuShell();
  shell.classList.add('heist-report-demo');
  root.replaceChildren(shell);
  const { HeistReport, demoRunStats } = await import('./ui/HeistReport.ts');
  const report = new HeistReport(shell, {
    onPlayAgain: () => {
      const next = new URL(window.location.href);
      next.searchParams.delete('report');
      next.searchParams.set('play', 'solo');
      window.location.href = next.toString();
    },
    onLeave: () => {
      const next = new URL(window.location.href);
      next.searchParams.delete('report');
      window.location.href = next.toString();
    },
  });
  report.show(demoRunStats());
  (window as unknown as { __heistReport?: unknown }).__heistReport = {
    show: (stats?: Parameters<typeof report.show>[0]) => report.show(stats ?? demoRunStats()),
    hide: () => report.hide(),
    visible: () => report.visible,
  };
}

async function bootFromInviteLink(): Promise<boolean> {
  void loadNet().catch(() => {});
  const code = roomCodeFromUrl();
  if (!code) return false;

  const panel = menuPanel('Rejoining room', `Room ${code}`);
  const status = element('p', 'lobby-status', 'Checking for a saved seat…');
  panel.append(status);

  if (!(await ensureServerAwake(panel, showMainMenu, () => { void bootFromInviteLink(); }))) {
    return true;
  }

  const resumed = await (await loadNet()).MultiplayerSession.resumeRoom(code, readUrlRunOptions().beat);
  if (resumed) {
    status.textContent = resumed.currentStatus.started
      ? 'Seat restored. Returning to the match…'
      : 'Seat restored. Waiting for partner…';
    if (resumed.currentStatus.started && resumed.currentStatus.localRole) {
      await startGame('multiplayer', resumed);
    } else {
      showLobby(resumed);
    }
    return true;
  }

  showJoinRoom(code);
  return true;
}

/** Warm the HTTP cache for the Havok wasm (same URL + credentials as the Havok loader's fetch). */
function prefetchHavokWasm(): void {
  void fetch(havokWasmUrl, { credentials: 'same-origin' }).then((response) => response.arrayBuffer()).catch(() => {});
}
function preloadNow(): void {
  setTimeout(() => {
    void preloadGame().catch(() => { gameModules.promise = null; });
    prefetchHavokWasm();
  }, 0);
}
/** Title path: let the title paint (fonts, key art) first, then fetch the game in the background. */
function preloadWhenIdle(): void {
  const run = () => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const go = () => {
      void preloadGame().catch(() => { gameModules.promise = null; })
        .finally(() => { prefetchHavokWasm(); void loadNet().catch(() => {}); });
    };
    if (idle) idle(go, { timeout: 1500 }); else setTimeout(go, 200);
  };
  if (document.readyState === 'complete') run(); else window.addEventListener('load', run, { once: true });
}

const bootParams = new URLSearchParams(window.location.search);
const urlRun = runOptionsFromSearch(bootParams);
if (bootParams.has('report')) {
  void showHeistReportDemo();
} else if (roomCodeFromUrl()) {
  void bootFromInviteLink();
  preloadNow();
} else if (urlRun.seed != null) {
  prepareChallengeRun(urlRun.seed, urlRun.beat, urlRun.floor ?? 1);
  void startGame('night-shift');
  preloadNow();
} else if (bootParams.get('level')) {
  void startGame('campaign');
  preloadNow();
} else if (bootParams.get('play') === 'solo') {
  void startGame('singleplayer');
  preloadNow();
} else if (bootParams.get('play') === 'daily' || urlRun.mode === 'daily') {
  prepareDailyRun(new Date());
  void startGame('night-shift');
  preloadNow();
} else {
  showMainMenu();
  preloadWhenIdle();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
    game = null;
  });
}
