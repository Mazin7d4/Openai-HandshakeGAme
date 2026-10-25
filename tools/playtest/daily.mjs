import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { freePort, startTestServer } from '../test-server.mjs';
import { runTest, assert, collectErrors, shot, openPage, closePage } from '../qa/lib.mjs';

const root = new URL('../..', import.meta.url).pathname;
const serverPort = await freePort();
const clientPort = await freePort();
const server = await startTestServer({ port: serverPort, root, env: { HANDSHAKE_TEST_HOOKS: '1' } });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(clientPort), '--strictPort', '--host', '127.0.0.1'], {
  cwd: root, env: { ...process.env, VITE_COLYSEUS_URL: `ws://127.0.0.1:${serverPort}` }, stdio: 'ignore',
});
await new Promise((resolve, reject) => {
  const end = Date.now() + 60_000;
  const poll = () => {
    const req = request(`http://127.0.0.1:${clientPort}/`, (res) => { res.resume(); res.once('end', resolve); });
    req.once('error', () => { if (Date.now() < end) setTimeout(poll, 100); else reject(new Error('Vite did not start')); });
    req.end();
  };
  poll();
});

await runTest('daily-playthrough', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  const errors = collectErrors(page, 'daily', []);
  const started = Date.now();
  const dailyUrl = new URL(`http://127.0.0.1:${clientPort}/?debug=1&autotest=1&server=ws://127.0.0.1:${serverPort}&mode=daily`);
  await page.goto(dailyUrl.toString());
  notes.menuMs = Date.now() - started;
  await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 120_000 });
  await page.getByTestId('floor-counter').waitFor({ state: 'visible', timeout: 30_000 });
  notes.floor = (await page.getByTestId('floor-counter').innerText()).trim();
  notes.mode = await page.evaluate(() => document.documentElement.dataset.runMode ?? null);
  await shot(page, 'daily-floor-1');
  await page.getByTestId('game-canvas').focus();
  await page.keyboard.down('w');
  await page.waitForTimeout(1200);
  await page.keyboard.up('w');
  notes.fps = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0; const begin = performance.now();
    const tick = () => { frames++; performance.now() - begin < 1000 ? requestAnimationFrame(tick) : resolve(frames); };
    requestAnimationFrame(tick);
  }));
  notes.errors = errors;
  assert(/^Floor\s+1$/.test(notes.floor), `Daily did not start at Floor 1: ${notes.floor}`);
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
  await closePage(page);
});
await server.stop();
vite.kill('SIGTERM');
