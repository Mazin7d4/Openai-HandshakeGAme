// Single-player smoke test: PIX (autopilot via ?autotest) flies away; the CPU NEE must follow on its own.
import { chromium } from 'playwright';
import { arrival } from './heist-route.mjs';
const RAW = process.argv[2] ?? process.env.APP_URL ?? 'http://localhost:5173/?scale=4&lowfx';
const url = RAW + (RAW.includes('?') ? '&' : '?') + 'autotest';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(url);
  await page.getByTestId('singleplayer').click();
  await page.getByTestId('start-singleplayer').click();
  await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => window.__autotest?.position('nee'), null, { timeout: 60_000, polling: 250 });
  const start = await page.evaluate(() => ({ pix: window.__autotest.position('pix'), nee: window.__autotest.position('nee') }));
  for (const g of arrival.slice(0, 3)) {
    await page.evaluate((g) => window.__autotest.goto('pix', g.x, g.y ?? 2.2, g.z, 1, true), g);
    await page.waitForFunction(() => window.__autotest.arrived('pix'), null, { timeout: 90_000, polling: 250 })
      .catch(async () => { throw new Error('PIX stuck at ' + JSON.stringify(await page.evaluate(() => window.__autotest.position('pix')))); });
  }
  // Give NEE time to catch up, then assert it closed the gap under its own control.
  await page.waitForTimeout(15_000);
  const end = await page.evaluate(() => ({ pix: window.__autotest.position('pix'), nee: window.__autotest.position('nee') }));
  const gap = Math.hypot(end.pix.x - end.nee.x, end.pix.z - end.nee.z);
  const neeMoved = Math.hypot(end.nee.x - start.nee.x, end.nee.z - start.nee.z);
  const result = { start, end, pass: gap < 4.5 && neeMoved > 4 && errors.length === 0, gap: +gap.toFixed(2), neeMoved: +neeMoved.toFixed(2), errors };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
} finally { await browser.close(); }
