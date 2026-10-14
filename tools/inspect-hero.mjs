import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await mkdir('artifacts', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5173/?debug=1');
  await page.getByTestId('dev-local').click();
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 60000 });
  await page.waitForTimeout(1200);
  const cameraState = async () => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => /\/deps\/@babylonjs_core\.js\?/.test(e.name))?.name;
    const { EngineStore } = await import(url);
    const camera = EngineStore.LastCreatedScene.activeCamera;
    return { name: camera.name, direction: camera.getForwardRay().direction.asArray() };
  });
  const before = await cameraState();
  await page.mouse.move(700, 400);
  await page.mouse.down({button:'right'});
  await page.mouse.move(1300, 550, {steps:5});
  await page.mouse.up({button:'right'});
  await page.waitForTimeout(200);
  const after = await cameraState();
  const dot = before.direction.reduce((sum, value, i) => sum + value * after.direction[i], 0);
  const change = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (change < 0.04 || change > 0.23) throw new Error(`Bounded camera look failed: ${change}`);
  await page.keyboard.press('F2');
  if ((await cameraState()).name !== 'dev-orbit-camera') throw new Error('F2 inspection did not activate');
  await page.keyboard.press('F2');
  if ((await cameraState()).name !== 'cinematic-camera') throw new Error('F2 inspection did not restore gameplay');
  console.log(JSON.stringify({cameraLookRadians:change, ...await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => /\/deps\/@babylonjs_core\.js\?/.test(e.name))?.name;
    if (!url) throw new Error('Babylon module URL missing');
    const { EngineStore, FreeCamera, Vector3 } = await import(url);
    const scene = EngineStore.LastCreatedScene;
    if (!scene) throw new Error('No scene');
    const camera = new FreeCamera('art-review', new Vector3(0, 9, 5), scene);
    camera.setTarget(new Vector3(0, 4.5, 19)); camera.fov = 1.02;
    scene.activeCamera = camera;
    return { meshes: scene.meshes.length, triangles: scene.meshes.reduce((sum,m) => sum + m.getTotalIndices() / 3, 0), hero: scene.meshes.filter(m => m.name.startsWith('Hero_')).map(m => ({ name:m.name, position:m.getBoundingInfo().boundingBox.centerWorld.asArray() })) };
  })}, null, 2));
  await page.locator('#dev-readout').evaluate(el => el.style.display = 'none');
  await page.locator('.mission-objective').evaluate(el => el.style.display = 'none');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'artifacts/robotics-hero.png' });
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
