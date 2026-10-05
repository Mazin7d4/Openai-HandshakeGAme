import './style.css';
import { GameScene } from './game/GameScene';

// Get or create canvas
let canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) {
  canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';

  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '';
    app.appendChild(canvas);
    app.style.width = '100%';
    app.style.height = '100vh';
    app.style.margin = '0';
    app.style.padding = '0';
    app.style.overflow = 'hidden';
  }
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.height = '100vh';
  document.documentElement.style.height = '100vh';
}

// Initialize game
const game = new GameScene(canvas);

async function startGame(): Promise<void> {
  try {
    await game.initialize();
    game.run();
    console.log('Monsoon Run - First Playable Slice running');
  } catch (error) {
    console.error('Failed to start game:', error);
  }
}

// Handle page lifecycle
window.addEventListener('beforeunload', () => {
  game.dispose();
});

// Start
startGame();