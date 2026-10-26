import { mkdirSync } from 'node:fs';
import { runTest, url, assert, devices, waitForGame, collectErrors } from './lib.mjs';

const out = '/workspace/handshake/playtest/oct25/phone-ui';
mkdirSync(out, { recursive: true });
const sizes = [[1024, 461], [844, 390], [740, 360]];
const variants = ['packet-routing', 'signal-match', 'memory-trace'];

const audit = (page) => page.evaluate(() => {
  const visible = [...document.querySelectorAll('[data-testid="mission-objective"], [data-testid="juice-toasts"], [data-testid="interaction-prompt"], [data-testid="touch-joystick"], [data-testid="touch-pause"], .touch-actions .touch-btn')].filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > .05 && r.width > 1 && r.height > 1; });
  const boxes = visible.map((el) => { const r = el.getBoundingClientRect(); return { n: el.dataset.testid || el.className, x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; });
  const failures = []; const central = { x: innerWidth * .25, y: innerHeight * .25, right: innerWidth * .75, bottom: innerHeight * .75 };
  for (const b of boxes) { if (b.x < -1 || b.y < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1) failures.push(`offscreen ${b.n}`); if (/touch-(?:btn|pause|joystick)/.test(b.n) && (b.w < 40 || b.h < 40)) failures.push(`small ${b.n}`); if (/mission-objective|juice-toasts|interaction-prompt/.test(b.n) && Math.min(b.right, central.right) - Math.max(b.x, central.x) > 2 && Math.min(b.bottom, central.bottom) - Math.max(b.y, central.y) > 2) failures.push(`central ${b.n} ${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.right)},${Math.round(b.bottom)}`); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 2) failures.push(`overlap ${a.n}/${b.n}`); }
  return failures;
});

await runTest('phone-ui', async (browser, notes) => {
  notes.screens = [];
  for (const [width, height] of sizes) {
    const viewport = { width, height }; const context = await browser.newContext({ ...devices['iPhone 13 landscape'], viewport, screen: viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage(); const errors = []; collectErrors(page, `${width}x${height}`, errors);
    await page.goto(url({ stage: 'escape' })); await page.getByTestId('singleplayer').tap(); await page.getByTestId('start-singleplayer').tap(); await waitForGame(page);
    await page.evaluate(() => window.__autotest.debugGrabForUi('pix')); await page.waitForFunction(() => window.__autotest?.heldObject?.('pix') === 'prototype', null, { timeout: 15_000 }); await page.waitForFunction(() => document.querySelector('[data-testid="mission-objective"]')?.dataset.collapsed === '1', null, { timeout: 5_000 }); await page.evaluate(() => window.__autotest.toast('NEE is free!')); await page.waitForTimeout(120);
    assert((await page.getByTestId('touch-grab').innerText()).match(/Drop|Pass/), `${width}x${height}: carry label missing`); assert(await page.getByTestId('touch-throw').isVisible(), `${width}x${height}: throw button missing`); assert(!(await page.getByTestId('interaction-prompt').isVisible()), `${width}x${height}: carry prompt card visible`);
    const failures = await audit(page); assert(!failures.length, `${width}x${height}: ${failures.join(', ')}`);
    const carryPath = `${out}/carry-toast-${width}x${height}.png`; await page.screenshot({ path: carryPath }); notes.screens.push(carryPath);
    for (const variant of variants) {
      await page.evaluate((kind) => window.__autotest.debugOpenHack(kind), variant); const panel = page.locator(`[data-testid="${variant}"] .hack-panel`); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
      const result = await panel.evaluate((node) => { const r = node.getBoundingClientRect(); const buttons = [...node.querySelectorAll('button')].map((el) => { const b = el.getBoundingClientRect(); return { w: b.width, h: b.height, right: b.right, bottom: b.bottom, x: b.x, y: b.y }; }); return { panel: { x: r.x, y: r.y, right: r.right, bottom: r.bottom }, buttons }; });
      const badButtons = result.buttons.filter((b) => b.x < -1 || b.y < -1 || b.right > width + 1 || b.bottom > height + 1 || b.w < 40 || b.h < 40); assert(result.panel.x >= -1 && result.panel.y >= -1 && result.panel.right <= width + 1 && result.panel.bottom <= height + 1, `${width}x${height} ${variant}: panel outside viewport`); assert(!badButtons.length, `${width}x${height} ${variant}: button outside/under 40px ${JSON.stringify(badButtons)}`);
      const path = `${out}/hack-${variant}-${width}x${height}.png`; await page.screenshot({ path }); notes.screens.push(path); await page.locator(`[data-testid="${variant}"] .hack-cancel`).click();
    }
    assert(!errors.length, `${width}x${height}: errors ${errors.join('; ')}`); await context.close();
  }
});
