// Apron cord playground: warm-up checklist shows; flying the pair through the
// desk-toy tower topples it (checklist tick + toast); a yank ticks its box.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const APP_URL = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(m); };
const objective = (page) => page.getByTestId('mission-objective').innerText();
const toasts = [];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.locator('#dev-readout').waitFor();
  await page.waitForTimeout(2500);
  const poll = setInterval(async () => {
    try { const t = await page.getByTestId('juice-toasts').innerText(); if (t.trim()) toasts.push(t.trim()); } catch {}
  }, 150);
  let text = await objective(page);
  console.log('objective:', JSON.stringify(text));
  assert(/WARM UP/i.test(text) && text.includes('topple the desk toys'), 'Warm-up checklist missing.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/playground-start.png` });

  // Fly forward into the toy tower (PIX leads, cord drags NEE through it), weaving.
  let toppled = false;
  for (const keys of [['w'], ['w', 'd'], ['s'], ['w', 'a'], ['s', 'd'], ['w']]) {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(1100);
    for (const k of keys) await page.keyboard.up(k);
    const probe = await page.evaluate(() => ({ cups: globalThis.__playground?.cupsToppled, state: globalThis.__playground?.state }));
    console.log('leg', keys.join('+'), JSON.stringify(probe));
    if (probe.state?.toppled) { toppled = true; break; }
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/playground-topple.png` });
  console.log('after flying:', JSON.stringify(text), 'toasts', JSON.stringify([...new Set(toasts)]));
  assert(toppled, 'Desk-toy tower never toppled.');

  // Yank ticks the yank box.
  await page.keyboard.down('a'); await page.waitForTimeout(1400); await page.keyboard.up('a');
  await page.waitForTimeout(500);
  await page.keyboard.press('r');
  await page.waitForTimeout(600);
  text = await objective(page);
  console.log('after yank:', JSON.stringify(text));
  await page.waitForTimeout(300);
  assert(toasts.some((t) => /the cord is a tool/i.test(t)), 'Yank did not complete the warm-up step.');
  clearInterval(poll);
  assert(!errors.length, `Page errors: ${errors.join('\n')}`);
  console.log('verify-playground: PASS');
} finally {
  await browser.close();
}
