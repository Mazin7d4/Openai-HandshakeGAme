// Single-player CPU companion (NEE bot): guards, hauls the Heavy Lab Crate with PIX, and is never in a broken state.
// Usage: node tools/verify-companion.mjs [url]
import { chromium } from 'playwright';
import { clearCrate } from './heist-route.mjs';
const RAW = process.argv[2] ?? 'http://localhost:5173/';
const URL_ = RAW + (RAW.includes('?') ? '&' : '?') + 'autotest&debug&stage=escape';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const readout = () => page.locator('#dev-readout').innerText();
const crate = async () => { const m = (await readout()).match(/crate-blue:(?:free|pix|nee)@(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)/); return { x: +m[1], z: +m[3] }; };
const pilot = async (p) => {
  await page.evaluate((p) => window.__autotest.goto('pix', p.x, p.y ?? 2.2, p.z, p.tolerance ?? 1), p);
  await page.waitForFunction(() => window.__autotest.arrived('pix'), null, { timeout: 90_000, polling: 250 });
};
const states = new Set();
try {
  await page.goto(URL_);
  await page.getByTestId('singleplayer').click();
  await page.getByTestId('start-singleplayer').click();
  await page.locator('#dev-readout').filter({ hasText: 'mission:escape' }).waitFor({ timeout: 120_000 });
  const t = setInterval(async () => { const m = (await readout().catch(() => '')).match(/bot:(\w+)/); if (m) states.add(m[1]); }, 300);
  const initial = await crate();
  for (const p of clearCrate.approach) await pilot(p);
  for (let i = 0; i < 4 && !(await readout()).includes('crate-blue:pix'); i++) {
    await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
    await page.waitForTimeout(1500);
  }
  if (!(await readout()).includes('crate-blue:pix')) throw new Error('PIX failed to grab crate\n' + await readout());
  await page.waitForFunction(() => /bot:haul/.test(document.querySelector('#dev-readout').textContent), null, { timeout: 10_000 });
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/s8-companion-haul.png` });
  for (const p of clearCrate.drag) await pilot(p);
  const fin = await crate();
  const moved = Math.hypot(fin.x - initial.x, fin.z - initial.z);
  clearInterval(t);
  if (moved < 3) throw new Error(`crate moved only ${moved.toFixed(2)}`);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ companionStates: [...states], crateMoved: +moved.toFixed(2) }));
} finally { await browser.close(); }
