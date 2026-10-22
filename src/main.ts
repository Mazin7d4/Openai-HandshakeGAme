import type { GameApp } from './app/GameApp.ts';
import type { GameMode } from './app/GameMode.ts';
// The engine, physics and level are split into lazy chunks so the menu appears immediately;
// they start downloading in the background as soon as the menu is up.
const loadGame = () => Promise.all([import('./app/GameApp.ts'), import('./level/PrototypeHeist.ts')]);
const gameModules = { promise: null as ReturnType<typeof loadGame> | null };
const preloadGame = () => (gameModules.promise ??= loadGame());
import { MultiplayerSession } from './network/MultiplayerSession.ts';
import type { RoomStatus } from './network/NetworkTypes.ts';
import './style.css';

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

function menuPanel(title: string, subtitle: string): HTMLElement {
  const shell = element('main', 'menu-shell');
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
    return 'Multiplayer server unavailable. Restart with npm run dev, or run npm run server beside npm run dev:client.';
  }
  return message;
}

function showMainMenu(): void {
  const panel = menuPanel('Choose a mode', 'Two drones. One tether.');
  const actions = element('div', 'menu-actions');
  actions.append(
    menuButton('Play now · solo', 'singleplayer', showSinglePlayer, 'btn--primary'),
    menuButton('Play with a friend', 'multiplayer', showMultiplayerMenu),
    menuButton('Dev local', 'dev-local', () => {
      void startGame('dev-local');
    }, 'btn--quiet'),
  );
  panel.append(actions);
}

function showSinglePlayer(): void {
  const panel = menuPanel('Single Player', 'Fly PIX. A CPU NEE follows you (early preview: it follows, it does not hack yet).');
  const actions = element('div', 'menu-actions');
  actions.append(
    menuButton('Start', 'start-singleplayer', () => {
      void startGame('singleplayer');
    }, 'btn--primary'),
    menuButton('Back', 'back', showMainMenu, 'btn--quiet'),
  );
  panel.append(actions);
}

function showMultiplayerMenu(): void {
  const panel = menuPanel('Multiplayer', 'Create a private room or join with a code.');
  const actions = element('div', 'menu-actions');
  actions.append(
    menuButton('Create a room', 'create-room', () => {
      void createRoom();
    }, 'btn--primary'),
    menuButton('Join with a code', 'join-room', showJoinRoom),
    menuButton('Back', 'back', showMainMenu, 'btn--quiet'),
  );
  panel.append(actions);
}

async function createRoom(): Promise<void> {
  const panel = menuPanel('Creating room', 'Connecting to the multiplayer server…');
  const status = element('p', 'lobby-status', 'Please wait.');
  panel.append(status);
  try {
    const session = await MultiplayerSession.createRoom();
    showLobby(session);
  } catch (error) {
    status.textContent = errorMessage(error);
    status.classList.add('error');
    panel.append(menuButton('Back', 'back', showMultiplayerMenu, 'btn--quiet'));
  }
}

function showJoinRoom(): void {
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
  const submit = element('button', 'btn btn--primary menu-button', 'Join');
  submit.dataset.testid = 'join-submit';
  submit.type = 'submit';
  const status = element('p', 'lobby-status');
  const back = menuButton('Back', 'back', showMultiplayerMenu, 'btn--quiet');
  form.append(input, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (code.length !== 4) {
      status.textContent = 'Enter a four-character room code.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Joining…';
    void MultiplayerSession.joinRoom(code)
      .then((session) => {
        showLobby(session);
      })
      .catch((error: unknown) => {
        status.textContent = errorMessage(error);
        status.classList.add('error');
        submit.disabled = false;
      });
  });
  panel.append(form, status, back);
  input.focus();
}

function showLobby(session: MultiplayerSession): void {
  const panel = menuPanel('Room ready', 'Share this code with the second player.');
  const label = element('p', 'panel__kicker room-label', 'Room code');
  const code = element('p', 'room-code', session.roomCode);
  code.dataset.testid = 'room-code';
  const copy = element('button', 'btn btn--primary menu-button', 'Copy code');
  copy.dataset.testid = 'copy-code';
  copy.type = 'button';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(session.roomCode)
      .then(() => { copy.textContent = 'Copied'; window.setTimeout(() => { copy.textContent = 'Copy code'; }, 1500); })
      .catch(() => { copy.textContent = 'Select the code to copy'; });
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
    const menuButtonEl = element('button', 'menu-button', 'RETURN TO MENU');
    menuButtonEl.type = 'button';
    menuButtonEl.addEventListener('click', () => window.location.reload());
    overlay.append(overlayTitle, overlayDetail, menuButtonEl);
    root.append(overlay);
    let partnerLostAt: number | null = null;
    const overlayTimer = window.setInterval(() => {
      const status = session.currentStatus;
      const net = session.connectionState;
      const partner = status.players.get(status.localRole === 'pix' ? 'nee' : 'pix');
      const lost = net === 'disconnected' || net === 'error';
      const partnerGone = !lost && (!partner || partner.connected === false);
      partnerLostAt = partnerGone ? partnerLostAt ?? Date.now() : null;
      overlay.classList.toggle('visible', lost || partnerGone || net === 'reconnecting');
      menuButtonEl.hidden = !lost && !(partnerGone && Date.now() - (partnerLostAt ?? 0) > 15_000);
      if (lost) {
        overlayTitle.textContent = 'CONNECTION LOST';
        overlayDetail.textContent = 'The room closed or your connection dropped.';
      } else if (net === 'reconnecting') {
        overlayTitle.textContent = 'RECONNECTING…';
        overlayDetail.textContent = 'Hold tight. Your drone is parked.';
      } else if (partnerGone) {
        const left = Math.max(0, 15 - Math.floor((Date.now() - (partnerLostAt ?? Date.now())) / 1000));
        const name = status.localRole === 'pix' ? 'NEE' : 'PIX';
        overlayTitle.textContent = `${name} DISCONNECTED`;
        overlayDetail.textContent = left > 0
          ? `Waiting for them to reconnect… ${left}s`
          : 'They did not come back. You can return to the menu.';
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

showMainMenu();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
    game = null;
  });
}

setTimeout(() => { void preloadGame().catch(() => { gameModules.promise = null; }); }, 0);
