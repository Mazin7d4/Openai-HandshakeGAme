import { Color4, Engine, FreeCamera, HemisphericLight, Scene, Vector3 } from '@babylonjs/core';
import './style.css';

const app = document.querySelector('#app');
if (!app) {
  throw new Error('Missing #app');
}

const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';
app.appendChild(canvas);

const engine = new Engine(canvas, true, { antialias: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.93, 0.91, 0.88, 1);

const camera = new FreeCamera('camera', new Vector3(0, 2, -8), scene);
camera.setTarget(Vector3.Zero());

const light = new HemisphericLight('light', new Vector3(0.15, 1, 0.25), scene);
light.intensity = 0.85;

window.addEventListener('resize', () => {
  engine.resize();
});

engine.runRenderLoop(() => {
  scene.render();
});
