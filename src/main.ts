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

function menuButton(label: string, testId: string, action: () => void): HTMLButtonElement {
  const button = element('button', 'menu-button', label);
  button.type = 'button';
  button.dataset.testid = testId;
  button.addEventListener('click', action);
  return button;
}

function menuPanel(title: string, subtitle: string): HTMLElement {
  const shell = element('main', 'menu-shell');
  const panel = element('section', 'menu-panel');
  panel.append(element('p', 'menu-kicker', 'HANDSHAKE'), element('h1', '', title));
  panel.append(element('p', 'menu-subtitle', subtitle));
  shell.append(panel);
  root.replaceChildren(shell);
  return panel;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unable to connect.';
  if (message.toLowerCase().includes('failed to fetch')) {
    return import.meta.env.PROD
      ? 'Multiplayer server unavailable. Try again in a minute.'
      : 'Multiplayer server unavailable. Restart with npm run dev, or run npm run server beside npm run dev:client.';
  }
  return message;
}

function showMainMenu(): void {
  const panel = menuPanel('Choose a mode', 'Two drones. One tether.');
  const actions = element('div', 'menu-actions');
  actions.append(
    menuButton('SINGLE PLAYER', 'singleplayer', showSinglePlayer),
    menuButton('MULTIPLAYER', 'multiplayer', showMultiplayerMenu),
    menuButton('DEV LOCAL', 'dev-local', () => {
      void startGame('dev-local');
    }),
  );
  panel.append(actions);
}

function showSinglePlayer(): void {
  const panel = menuPanel('Single Player', 'Fly PIX. A CPU NEE follows you (early preview: it follows, it does not hack yet).');
  const actions = element('div', 'menu-actions');
  actions.append(
    menuButton('START', 'start-singleplayer', () => {
      void startGame('singleplayer');
    }),
    menuButton('BACK', 'back', showMainMenu),
  );
  panel.append(actions);
}

function showMultiplayerMenu(): void {
  const panel = menuPanel('Multiplayer', 'Create a private room or join with a code.');
  const actions = element('div', 'menu-actions');
  actions.append(
    menuButton('CREATE ROOM', 'create-room', () => {
      void createRoom();
    }),
    menuButton('JOIN ROOM', 'join-room', showJoinRoom),
    menuButton('BACK', 'back', showMainMenu),
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
    panel.append(menuButton('BACK', 'back', showMultiplayerMenu));
  }
}

function showJoinRoom(prefill?: string): void {
  const panel = menuPanel('Join Room', 'Enter the four-character room code.');
  const form = element('form', 'join-form');
  const input = element('input', 'room-code-input');
  input.dataset.testid = 'room-code-input';
  input.name = 'room-code';
  input.autocomplete = 'off';
  input.maxLength = 4;
  input.placeholder = 'XXXX';
  input.setAttribute('aria-label', 'Room code');
  input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  if (prefill) input.value = prefill.trim().toUpperCase();
  const submit = element('button', 'menu-button', 'JOIN');
  submit.dataset.testid = 'join-submit';
  submit.type = 'submit';
  const status = element('p', 'lobby-status');
  const back = menuButton('BACK', 'back', showMultiplayerMenu);
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
  if (prefill && prefill.trim().length === 4) {
    void doJoin(prefill.trim().toUpperCase());
  }
}

function showLobby(session: MultiplayerSession): void {
  setRoomInUrl(session.roomCode);
  const panel = menuPanel('Room ready', 'Share this code with the second player.');
  const label = element('p', 'room-label', 'ROOM CODE');
  const code = element('p', 'room-code', session.roomCode);
  code.dataset.testid = 'room-code';
  const copy = element('button', 'menu-button', 'COPY LINK');
  copy.dataset.testid = 'copy-code';
  copy.type = 'button';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(roomInviteUrl(session.roomCode))
      .then(() => { copy.textContent = 'COPIED!'; window.setTimeout(() => { copy.textContent = 'COPY LINK'; }, 1500); })
      .catch(() => { copy.textContent = 'SELECT + COPY'; });
  });
  const role = element('p', 'room-label', '');
  const status = element('p', 'lobby-status', 'Waiting for partner…');
  status.dataset.testid = 'lobby-status';
  panel.append(label, code, copy, role, status);

  const removeStatus = session.onStatus((next) => {
    const me = next.localRole;
    role.textContent = me ? `YOU ARE ${me.toUpperCase()} · PARTNER IS ${me === 'pix' ? 'NEE' : 'PIX'}` : '';
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
    element('p', 'boot-title', 'HANDSHAKE'),
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
    const menuButtonEl = element('button', 'menu-button', 'RETURN TO MENU');
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
        overlayTitle.textContent = 'CONNECTION LOST';
        overlayDetail.textContent = 'The room closed or your connection dropped.';
      } else if (net === 'reconnecting') {
        const left = session.reconnectSecondsLeft
          ?? Math.max(0, RECONNECT_GRACE_SECONDS - Math.floor((Date.now() - (selfReconnectAt ?? Date.now())) / 1000));
        overlayTitle.textContent = 'RECONNECTING…';
        overlayDetail.textContent = `Reconnecting… ${left}s`;
      } else if (partnerReconnecting) {
        const left = Math.max(0, RECONNECT_GRACE_SECONDS - Math.floor((Date.now() - (partnerLostAt ?? Date.now())) / 1000));
        const name = status.localRole === 'pix' ? 'NEE' : 'PIX';
        overlayTitle.textContent = `${name} DISCONNECTED`;
        overlayDetail.textContent = `Partner reconnecting… ${left}s`;
      } else if (partnerLeft) {
        overlayTitle.textContent = 'PARTNER LEFT';
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

if (roomCodeFromUrl()) {
  void bootFromInviteLink();
} else {
  showMainMenu();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
    game = null;
  });
}

setTimeout(() => { void preloadGame().catch(() => { gameModules.promise = null; }); }, 0);
