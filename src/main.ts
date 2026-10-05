import { GameApp } from './app/GameApp.ts';
import type { GameMode } from './app/GameMode.ts';
import { createTestRoom } from './dev/TestRoom.ts';
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
    return 'Multiplayer server unavailable. Restart with npm run dev, or run npm run server beside npm run dev:client.';
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
  const panel = menuPanel('Single Player', 'CPU companion coming next.');
  const actions = element('div', 'menu-actions');
  actions.append(menuButton('BACK', 'back', showMainMenu));
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
    panel.append(menuButton('BACK', 'back', showMultiplayerMenu));
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
  const submit = element('button', 'menu-button', 'JOIN');
  submit.dataset.testid = 'join-submit';
  submit.type = 'submit';
  const status = element('p', 'lobby-status');
  const back = menuButton('BACK', 'back', showMultiplayerMenu);
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
  const label = element('p', 'room-label', 'ROOM CODE');
  const code = element('p', 'room-code', session.roomCode);
  code.dataset.testid = 'room-code';
  const status = element('p', 'lobby-status', 'Waiting for partner…');
  status.dataset.testid = 'lobby-status';
  panel.append(label, code, status);

  const removeStatus = session.onStatus((next) => {
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
  const boot = element('p', '', 'Loading physics…');
  boot.id = 'boot-status';
  root.replaceChildren(canvas, boot);

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
  }

  try {
    game = await GameApp.create({
      canvas,
      createLevel: createTestRoom,
      devParent: root,
      mode,
      multiplayer: session,
      onLeaveGame: () => {
        removeStatus?.();
        game?.dispose();
        game = null;
        showMainMenu();
      },
    });
    boot.remove();
    canvas.focus();
    game.start();
  } catch (error) {
    removeStatus?.();
    void session?.dispose();
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
