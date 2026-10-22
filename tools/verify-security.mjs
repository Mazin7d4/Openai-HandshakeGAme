// Readable, non-lethal security: patrols show '?'/'!' moods, a pod captures and
// carries a drone, and the partner's yank frees it (never a game over).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const RAW = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const APP_URL = RAW + (RAW.includes('?') ? '&' : '?') + 'autotest&stage=escape';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.locator('#dev-readout').waitFor();
  await page.waitForFunction(() => !!globalThis.__security, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const toasts = new Set();
  const moods = new Set();
  const poll = setInterval(async () => {
    try {
      const t = (await page.getByTestId('juice-toasts').innerText()).trim();
      if (t) for (const line of t.split('\n')) toasts.add(line.trim());
      const d = await page.evaluate(() => globalThis.__security?.debug);
      for (const m of d?.patrols ?? []) moods.add(m);
    } catch {}
  }, 120);
  const debug = () => page.evaluate(() => globalThis.__security.debug);
  console.log('initial', JSON.stringify(await debug()));
  assert((await debug()).aimTargets > 0, 'No throw-assist targets while security is active.');

  // Fly both drones into the patrol loop and wait for a capture.
  await page.evaluate(() => { for (const r of ['pix', 'nee']) window.__autotest.goto(r, 0, 2.4, 9, 0.8, true); });
  let captive = null;
  const t0 = Date.now();
  let shotChase = false;
  while (Date.now() - t0 < 40_000) {
    const d = await debug();
    if (SHOTS && !shotChase && d.patrols.includes('chase')) { shotChase = true; await page.screenshot({ path: `${SHOTS}/security-chase.png` }); }
    if (d.captive) { captive = d.captive; break; }
    await page.waitForTimeout(150);
  }
  console.log('moods seen', [...moods], 'captive', captive);
  assert(moods.has('chase'), 'Patrol never showed the chase (!) mood.');
  assert(captive, 'No patrol captured a drone.');
  await page.evaluate(() => { for (const r of ['pix', 'nee']) window.__autotest.stop(r); });
  await page.waitForTimeout(900);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/security-capture.png` });
  assert((await debug()).carrying, 'Capture ended before the partner could help.');

  // Partner yanks the captive free.
  const readout = await page.locator('#dev-readout').innerText();
  const pixId = captive === 'player-1' || /pix/i.test(captive);
  const partner = pixId ? 'nee' : 'pix';
  await page.evaluate((r) => window.__autotest.press(r, 'yank'), partner);
  await page.waitForTimeout(700);
  const after = await debug();
  console.log('after yank', JSON.stringify(after), 'toasts', [...toasts]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/security-freed.png` });
  assert(!after.carrying || after.captive !== captive, 'Partner yank did not free the captive.');
  assert([...toasts].some((t) => t.includes('GRABBED')), 'No capture toast.');
  assert([...toasts].some((t) => t.includes('FREE')), 'No freed toast.');
  assert(!/mission:complete|game over/i.test(readout), 'Unexpected mission end.');
  clearInterval(poll);
  assert(!errors.length, `Page errors: ${errors.join('\n')}`);
  console.log('verify-security: PASS');
} finally {
  await browser.close();
}
