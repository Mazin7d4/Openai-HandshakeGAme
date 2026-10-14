// Headless art review: renders each mission area from a fixed camera and records scene stats.
// Usage: ANGLE=swiftshader node tools/capture-areas.mjs <outDir> <prefix>
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const out = process.argv[2] ?? 'artifacts/areas';
const prefix = process.argv[3] ?? 'area';
const url = process.env.APP_URL ?? 'http://localhost:5173/?debug=1';
const shots = [
  ['reception', [6, 9, -64], [-3, 3.5, -47]],
  ['vent', [4, 7, -52], [-5, 6, -43]],
  ['office', [12, 10, -42], [-1, 3.5, -31]],
  ['server', [10, 9, -26], [-2, 4, -12]],
  ['lab-vault', [0, 9, 5], [0, 4.5, 19]],
  ['escape', [-15.5, 9, 10], [-15.5, 2, -22]],
  ['gameplay-camera', null, null],
];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', `--use-angle=${process.env.ANGLE ?? 'swiftshader'}`, '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await mkdir(out, { recursive: true });
const t0 = Date.now();
await page.goto(url);
await page.getByTestId('dev-local').click();
await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 120000 });
const loadMs = Date.now() - t0;
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${prefix}-gameplay-camera.png` });
const stats = await page.evaluate(async () => {
  const u = performance.getEntriesByType('resource').find(e => /@babylonjs_core\.js\?/.test(e.name))?.name;
  const B = await import(u);
  const scene = B.EngineStore.LastCreatedScene;
  const inst = new B.SceneInstrumentation(scene); inst.captureFrameTime = true;
  await new Promise(r => setTimeout(r, 4000));
  const engine = scene.getEngine();
  return { meshes: scene.meshes.length, activeMeshes: scene.getActiveMeshes().length,
    materials: scene.materials.length, textures: scene.textures.length, lights: scene.lights.length,
    drawCalls: engine._drawCalls?.current ?? null, fps: Math.round(engine.getFps() * 10) / 10,
    frameMs: Math.round(inst.frameTimeCounter.average * 10) / 10,
    triangles: Math.round(scene.meshes.reduce((s, m) => s + (m.isEnabled() ? m.getTotalIndices() / 3 : 0), 0)) };
});
for (const el of ['#dev-readout', '.mission-objective']) await page.locator(el).evaluate(e => e.style.display = 'none').catch(() => {});
for (const [name, pos, target] of shots) {
  if (!pos) continue;
  await page.evaluate(async ([pos, target]) => {
    const u = performance.getEntriesByType('resource').find(e => /@babylonjs_core\.js\?/.test(e.name))?.name;
    const B = await import(u);
    const scene = B.EngineStore.LastCreatedScene;
    let cam = scene.getCameraByName('art-review');
    if (!cam) { cam = new B.FreeCamera('art-review', new B.Vector3(...pos), scene); cam.fov = 1.05; cam.minZ = 0.1; }
    cam.position.set(...pos); cam.setTarget(new B.Vector3(...target)); scene.activeCamera = cam;
  }, [pos, target]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${prefix}-${name}.png` });
}
console.log(JSON.stringify({ loadMs, ...stats, errors }, null, 1));
await browser.close();
