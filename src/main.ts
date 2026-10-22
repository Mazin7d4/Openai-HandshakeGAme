import type { GameApp } from './app/GameApp.ts';
import type { GameMode } from './app/GameMode.ts';
// The engine, physics and level are split into lazy chunks so the menu appears immediately;
// they start downloading in the background as soon as the menu is up.
const loadGame = () => Promise.all([import('./app/GameApp.ts'), import('./level/PrototypeHeist.ts')]);
const gameModules = { promise: null as ReturnType<typeof loadGame> | null };
const preloadGame = () => (gameModules.promise ??= loadGame());
import { MultiplayerSession } from './network/MultiplayerSession.ts';
import type { RoomStatus } from './network/NetworkTypes.ts';
import { RECONNECT_GRACE_SECONDS } from './network/ReconnectionToken.ts';
import { pingServer, wakeServer } from './network/ServerEndpoint.ts';
import './style.css';
import { audio } from './audio/AudioManager.ts';

// Unlock-on-first-gesture, menu UI sounds and M to mute; sound files load lazily once the page is idle.
audio.install();

function roomInviteUrl(code: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('room', code.trim().toUpperCase());
  return url.toString();
}

function setRoomInUrl(code: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('room', code.trim().toUpperCase());
  window.history.replaceState(null, '', url);
}

function roomCodeFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() ?? '';
  return /^[A-Z2-9]{4}$/.test(code) ? code : null;
}

const rootNode = document.querySelector('#app');
if (!rootNode || !(rootNode instanceof HTMLElement)) {
  throw new Error('Missing #app');
}
const root: HTMLElement = rootNode;

let game: GameApp | null = null;

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
  button.addEventListener('click', action);
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
  const beat = new URLSearchParams(window.location.search).get('beat');
  const blurb = beat && /^\d+:\d{2}$/.test(beat)
    ? `A friend finished in ${beat}. Can you beat it?`
    : 'Fly a pair of tethered drones through a sleepy office and lift the core from the vault.';
  const shell = menuShell();
  shell.classList.add('menu-shell--title');
  const panel = element('section', 'panel menu-panel title-panel');
  panel.append(wordmark(), element('h2', 'title-tagline', 'Two drones. One cord.'));
  panel.append(element('p', 'panel__body menu-subtitle', blurb));
  const play = menuButton('', 'singleplayer', showSinglePlayer, 'btn--primary');
  play.classList.add('btn--hero');
  play.append(element('span', 'btn__label', 'Play now'), element('span', 'btn__hint', 'Solo · you fly PIX'));
  const actions = element('div', 'menu-actions');
  actions.append(play, menuButton('Play with a friend', 'multiplayer', showMultiplayerMenu));
  if (devMenuAllowed) {
    actions.append(menuButton('Dev local', 'dev-local', () => {
      void startGame('dev-local');
    }, 'btn--quiet'));
  }
  actions.append(menuButton('Settings', 'title-settings', openTitleSettings, 'btn--quiet'));
  panel.append(actions);
  shell.append(panel);
  root.replaceChildren(shell);
  // PLAY NOW is first in tab order and already focused, so Enter starts it.
  play.focus();
}

function openTitleSettings(): void {
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
  const actions = element('div', 'menu-actions');
  actions.append(start, menuButton('Back', 'back', showMainMenu, 'btn--quiet'));
  panel.append(actions);
  start.focus();
}

function showMultiplayerMenu(): void {
  const panel = menuPanel('Play with a friend', 'Make a private room and share its code, or join a friend\'s room.');
  const actions = element('div', 'menu-actions');
  actions.append(
    menuButton('Create a room', 'create-room', () => {
      void createRoom();
    }, 'btn--primary'),
    menuButton('Join with a code', 'join-room', () => showJoinRoom()),
    menuButton('Back', 'back', showMainMenu, 'btn--quiet'),
  );
  panel.append(actions);
  void pingServer(2500);
}

async function ensureServerAwake(
  panel: HTMLElement,
  back: () => void,
  retry: () => void,
): Promise<boolean> {
  panel.querySelectorAll('.wake-overlay').forEach((node) => node.remove());
  const ui = { overlay: null as HTMLElement | null, title: null as HTMLElement | null, detail: null as HTMLElement | null };

  const result = await wakeServer({
    onWaiting(attempt) {
      if (!ui.overlay) {
        ui.overlay = element('div', 'wake-overlay');
        ui.overlay.dataset.testid = 'wake-overlay';
        ui.title = element('p', 'wake-title', 'Waking server…');
        ui.detail = element('p', 'wake-detail', `Free server is starting up (up to a minute). Attempt ${attempt}`);
        ui.overlay.append(ui.title, ui.detail);
        panel.append(ui.overlay);
      } else {
        ui.detail!.textContent = `Free server is starting up (up to a minute). Attempt ${attempt}`;
      }
    },
  });

  if (result) {
    ui.overlay?.remove();
    return true;
  }

  // Failed — show error UI
  if (!ui.overlay) {
    ui.overlay = element('div', 'wake-overlay');
    ui.overlay.dataset.testid = 'wake-overlay';
    ui.title = element('p', 'wake-title');
    ui.detail = element('p', 'wake-detail');
    ui.overlay.append(ui.title, ui.detail);
    panel.append(ui.overlay);
  }
  ui.title!.textContent = "Server didn't wake up";
  ui.detail!.textContent = 'Check your connection and retry.';
  ui.overlay.append(
    menuButton('RETRY', 'wake-retry', retry),
    menuButton('BACK', 'back', back),
  );
  return false;
}

async function createRoom(): Promise<void> {
  const panel = menuPanel('Creating room', 'Connecting to the multiplayer server…');
  const status = element('p', 'lobby-status', 'Please wait.');
  panel.append(status);
  if (!(await ensureServerAwake(panel, showMultiplayerMenu, () => { void createRoom(); }))) return;
  try {
    const session = await MultiplayerSession.createRoom();
    showLobby(session);
  } catch (error) {
    status.textContent = errorMessage(error);
    status.classList.add('error');
    panel.append(menuButton('Back', 'back', showMultiplayerMenu, 'btn--quiet'));
  }
}

function showJoinRoom(prefill?: string): void {
  // menuButton passes the click event when used directly as the action; only strings count.
  const initial = typeof prefill === 'string' ? prefill.trim().toUpperCase() : '';
  const panel = menuPanel('Join a room', 'Type the four-character code your friend sees.');
  const form = element('form', 'join-form');
  const input = element('input', 'room-code-input');
  input.dataset.testid = 'room-code-input';
  input.name = 'room-code';
  input.autocomplete = 'off';
  input.maxLength = 4;
  input.placeholder = 'XXXX';
  input.setAttribute('aria-label', 'Room code');
  input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  if (initial) input.value = initial;
  const submit = element('button', 'btn btn--primary menu-button', 'Join');
  submit.dataset.testid = 'join-submit';
  submit.type = 'submit';
  const status = element('p', 'lobby-status');
  const back = menuButton('Back', 'back', showMultiplayerMenu, 'btn--quiet');
  form.append(input, submit);

  async function doJoin(code: string): Promise<void> {
    submit.disabled = true;
    status.textContent = 'Connecting…';
    if (!(await ensureServerAwake(panel, showMultiplayerMenu, () => { void doJoin(code); }))) {
      submit.disabled = false;
      return;
    }
    try {
      const session = await MultiplayerSession.joinRoom(code);
      showLobby(session);
    } catch (error: unknown) {
      status.textContent = errorMessage(error);
      status.classList.add('error');
      submit.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (code.length !== 4) {
      status.textContent = 'Enter a four-character room code.';
      return;
    }
    void doJoin(code);
  });
  panel.append(form, status, back);
  input.focus();
  if (initial.length === 4) {
    void doJoin(initial);
  }
}

function showLobby(session: MultiplayerSession): void {
  setRoomInUrl(session.roomCode);
  const panel = menuPanel('Room ready', 'Share this code with the second player.');
  const label = element('p', 'panel__kicker room-label', 'Room code');
  const code = element('p', 'room-code', session.roomCode);
  code.dataset.testid = 'room-code';
  const copy = element('button', 'btn btn--primary menu-button', 'Copy invite link');
  copy.dataset.testid = 'copy-code';
  copy.type = 'button';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(roomInviteUrl(session.roomCode))
      .then(() => { copy.textContent = 'Copied'; window.setTimeout(() => { copy.textContent = 'Copy invite link'; }, 1500); })
      .catch(() => { copy.textContent = 'Select the link to copy'; });
  });
  const role = element('p', 'room-label', '');
  const status = element('p', 'lobby-status', 'Waiting for partner…');
  status.dataset.testid = 'lobby-status';
  panel.append(label, code, copy, role, status);

  const removeStatus = session.onStatus((next) => {
    const me = next.localRole;
    role.textContent = me ? `You fly ${me.toUpperCase()} · your friend flies ${me === 'pix' ? 'NEE' : 'PIX'}` : '';
    status.textContent = next.started ? 'Partner connected. Starting…' : 'Waiting for partner…';
  });
  void session.waitForStart().then(() => {
    removeStatus();
    return startGame('multiplayer', session);
  });
}

async function startGame(mode: GameMode, session?: MultiplayerSession): Promise<void> {
  const canvas = element('canvas');
  canvas.id = 'game-canvas';
  canvas.dataset.testid = 'game-canvas';
  canvas.tabIndex = 0;
  const boot = element('div', 'boot-card');
  boot.id = 'boot-status';
  const bootStep = element('p', 'boot-step', 'Loading physics…');
  boot.append(
    element('p', 'boot-title', 'PIX & NEE'),
    Object.assign(element('div', 'boot-dots'), { innerHTML: '<span class="pix"></span><span class="nee"></span>' }),
    Object.assign(element('div', 'boot-bar'), { innerHTML: '<span></span>' }),
    bootStep,
  );
  root.replaceChildren(canvas, boot);
  const bootSteps = ['Loading physics…', 'Building the lab…', 'Waking PIX and NEE…'];
  let bootIndex = 0;
  const bootTimer = window.setInterval(() => {
    bootIndex = Math.min(bootSteps.length - 1, bootIndex + 1);
    bootStep.textContent = bootSteps[bootIndex];
    boot.style.setProperty('--boot-progress', `${(bootIndex + 1) / bootSteps.length}`);
  }, 1400);

  let removeStatus: (() => void) | null = null;
  if (session) {
    const networkHud = element('aside', 'network-hud');
    networkHud.dataset.testid = 'network-hud';
    root.append(networkHud);
    const updateHud = (status: RoomStatus) => {
      const localRole = status.localRole?.toUpperCase() ?? 'PLAYER';
      const partnerRole = status.localRole === 'pix' ? 'nee' : 'pix';
      const partner = status.players.get(partnerRole);
      const partnerDisconnected = !partner || partner.connected === false;
      networkHud.textContent = `${status.roomCode} · ${localRole}`;
      networkHud.classList.toggle('partner-disconnected', partnerDisconnected);
      if (partnerDisconnected) {
        networkHud.textContent += ' · Partner disconnected';
      }
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
        overlayTitle.textContent = `${name} disconnected`;
        overlayDetail.textContent = `Waiting for them to reconnect… ${left}s`;
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
      onLeaveGame: () => {
        removeStatus?.();
        game?.dispose();
        game = null;
        showMainMenu();
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
  const code = roomCodeFromUrl();
  if (!code) return false;

  const panel = menuPanel('Rejoining room', `Room ${code}`);
  const status = element('p', 'lobby-status', 'Checking for a saved seat…');
  panel.append(status);

  if (!(await ensureServerAwake(panel, showMainMenu, () => { void bootFromInviteLink(); }))) {
    return true;
  }

  const resumed = await MultiplayerSession.resumeRoom(code);
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

const bootParams = new URLSearchParams(window.location.search);
if (bootParams.has('report')) {
  void showHeistReportDemo();
} else if (roomCodeFromUrl()) {
  void bootFromInviteLink();
  setTimeout(() => { void preloadGame().catch(() => { gameModules.promise = null; }); }, 0);
} else if (bootParams.get('play') === 'solo') {
  void startGame('singleplayer');
  setTimeout(() => { void preloadGame().catch(() => { gameModules.promise = null; }); }, 0);
} else {
  showMainMenu();
  setTimeout(() => { void preloadGame().catch(() => { gameModules.promise = null; }); }, 0);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
    game = null;
  });
}
