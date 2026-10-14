// Fast co-op crate check: ?autotest&stage=escape starts in the alarm escape (vault hacked,
// NEE carrying the prototype) beside the Heavy Lab Crate. Proves the drag clears the relief
// vent and the extraction is reachable, without the ~10 min software-WebGL heist route.
import { chromium } from 'playwright';
import { clearCrate, escape } from './heist-route.mjs';

const RAW_URL = process.argv[2] ?? 'http://localhost:5173/';
const APP_URL = RAW_URL + (RAW_URL.includes('?') ? '&' : '?') + 'autotest&stage=escape';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', process.env.ANGLE ? `--use-angle=${process.env.ANGLE}` : '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const readout = () => page.locator('#dev-readout').innerText();
const shot = async (name, delay = 0) => {
  if (!process.env.SHOTS) return;
  if (delay) await page.waitForTimeout(delay);
  await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
};
async function cratePosition() {
  const m = (await readout()).match(/crate-blue:(?:free|pix|nee)@(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) throw new Error(`Missing crate-blue: ${await readout()}`);
  return { x: +m[1], y: +m[2], z: +m[3] };
}
const pilot = async (roles, point, timeout = 90_000) => {
  const tol = point.tolerance ?? 1;
  await page.evaluate(({ roles, p, tol }) => { for (const r of roles) window.__autotest.goto(r, p.x, p.y ?? 2.2, p.z, tol); }, { roles, p: point, tol });
  try {
    await page.waitForFunction((roles) => roles.every((r) => window.__autotest.arrived(r)) || document.querySelector('#dev-readout')?.textContent.includes('mission:complete'), roles, { timeout, polling: 250 });
  } catch {
    const at = await page.evaluate((roles) => roles.map((r) => [r, window.__autotest.position(r)]), roles);
    throw new Error(`autopilot ${roles} failed to reach ${JSON.stringify(point)} at ${JSON.stringify(at)}\nREADOUT:\n${await readout()}`);
  }
};
const step = (label) => { if (process.env.TRACE) console.log(new Date().toISOString().slice(11, 19), label); };
try {
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.locator('#dev-readout').filter({ hasText: 'mission:escape' }).waitFor({ timeout: 120_000 });
  step('escape stage');
  if (!/prototype:nee/.test(await readout())) throw new Error(`NEE not carrying prototype: ${await readout()}`);
  const initial = await cratePosition();
  await page.evaluate(() => window.__autotest.goto('nee', -9, 4.5, 13, 1));
  for (const point of clearCrate.approach) await pilot(['pix'], point);
  step('pix at crate');
  for (let attempt = 0; attempt < 4 && !(await readout()).includes('crate-blue:pix'); attempt++) {
    await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
    await page.locator('#dev-readout').filter({ hasText: 'crate-blue:pix' }).waitFor({ timeout: 4000 }).catch(() => {});
  }
  if (!(await readout()).includes('crate-blue:pix')) throw new Error(`PIX failed to grab crate: ${await readout()}`);
  await shot('s7-crate-grab', 300);
  for (const point of clearCrate.drag) await pilot(['pix'], point);
  await shot('s7-crate-drag');
  await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
  await page.locator('#dev-readout').filter({ hasText: 'crate-blue:free' }).waitFor({ timeout: 10_000 });
  const final = await cratePosition();
  const moved = Math.hypot(final.x - initial.x, final.z - initial.z);
  step(`crate moved ${moved.toFixed(2)}`);
  if (moved <= 3) throw new Error(`Crate only moved ${moved.toFixed(2)} units`);
  for (const point of escape.slice(3)) {
    await pilot(['pix'], point);
    await pilot(['nee'], point);
    if (point.z === 3) step('vent cleared');
  }
  await page.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 15_000 });
  await shot('s7-crate-extraction', 700);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ escapeStage: true, crateMoved: +moved.toFixed(2), ventCleared: true, extraction: true }));
} finally {
  await browser.close();
}
