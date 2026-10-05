import { GameApp } from './app/GameApp.ts';
import { createTestRoom } from './dev/TestRoom.ts';
import './style.css';

const root = document.querySelector('#app');
if (!root || !(root instanceof HTMLElement)) {
  throw new Error('Missing #app');
}

const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';
canvas.tabIndex = 0;
root.appendChild(canvas);

const boot = document.createElement('p');
boot.id = 'boot-status';
boot.textContent = 'Loading physics…';
root.appendChild(boot);

const game = await GameApp.create({
  canvas,
  createLevel: createTestRoom,
  devParent: root,
});

boot.remove();
canvas.focus();
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
    canvas.remove();
  });
}
