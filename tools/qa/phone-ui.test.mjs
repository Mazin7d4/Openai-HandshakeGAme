import { mkdirSync } from 'node:fs';
import { runTest, url, assert, devices, waitForGame, collectErrors } from './lib.mjs';

const out = '/workspace/handshake/playtest/oct25/phone-ui';
mkdirSync(out, { recursive: true });
const sizes = [[1024, 461], [844, 390], [740, 360]];
const variants = ['packet-routing', 'signal-match', 'memory-trace'];

const audit = (page) => page.evaluate(() => {
  const visible = [...document.querySelectorAll('[data-testid="mission-objective"], [data-testid="interaction-prompt"], [data-testid="active-drone"], [data-testid="run-hud"], [data-testid="onboarding-coach"], .juice-toast, .touch-controls button, [data-testid="touch-joystick"]')].filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > .05 && r.width > 1 && r.height > 1; });
  const boxes = visible.map((el) => { const r = el.getBoundingClientRect(); return { n: el.dataset.testid || el.className, x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; });
  const failures = []; const central = { x: innerWidth * .25, y: innerHeight * .25, right: innerWidth * .75, bottom: innerHeight * .75 };
  for (const b of boxes) { if (b.x < -1 || b.y < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1) failures.push(`offscreen ${b.n}`); if (/touch-(?:btn|pause|joystick)/.test(b.n) && (b.w < 40 || b.h < 40)) failures.push(`small ${b.n}`); if (Math.min(b.right, central.right) - Math.max(b.x, central.x) > 2 && Math.min(b.bottom, central.bottom) - Math.max(b.y, central.y) > 2) failures.push(`central ${b.n} ${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.right)},${Math.round(b.bottom)}`); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 2) failures.push(`overlap ${a.n}/${b.n}`); }
  return failures;
});

const toastAudit = (page) => page.evaluate(() => {
  const toast = document.querySelector('.juice-toast'); const objective = document.querySelector('[data-testid="mission-objective"]');
  if (!toast) return ['toast not visible'];
  const t = toast.getBoundingClientRect(); const o = objective?.getBoundingClientRect(); const overlap = o && Math.min(t.right, o.right) - Math.max(t.x, o.x) > 2 && Math.min(t.bottom, o.bottom) - Math.max(t.y, o.y) > 2;
  return [t.width > innerWidth * .4 && `toast too wide ${Math.round(t.width)}`, overlap && 'toast/objective overlap'].filter(Boolean);
});

const hackHudAudit = (page) => page.evaluate(() => {
  const panel = document.querySelector('.hack-panel')?.getBoundingClientRect();
  if (!panel) return ['hack panel missing'];
  return [...document.querySelectorAll('[data-testid="mission-objective"], .juice-toast, [data-testid="interaction-prompt"]')]
    .filter((el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')
    .filter((el) => { const r = el.getBoundingClientRect(); return Math.min(r.right, panel.right) - Math.max(r.x, panel.x) > 2 && Math.min(r.bottom, panel.bottom) - Math.max(r.y, panel.y) > 2; })
    .map((el) => `HUD intersects hack panel: ${el.dataset.testid || el.className}`);
});

await runTest('phone-ui', async (browser, notes) => {
  notes.screens = [];
  for (const [width, height] of sizes) {
    const viewport = { width, height }; const context = await browser.newContext({ ...devices['iPhone 13 landscape'], viewport, screen: viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage(); const errors = []; collectErrors(page, `${width}x${height}`, errors);
    await page.goto(url({ stage: 'escape' })); await page.getByTestId('singleplayer').tap(); await page.getByTestId('start-singleplayer').tap(); await waitForGame(page);
    await page.evaluate(() => window.__autotest.debugGrabForUi('pix')); await page.waitForFunction(() => window.__autotest?.heldObject?.('pix') === 'prototype', null, { timeout: 15_000 }); await page.waitForFunction(() => document.querySelector('[data-testid="mission-objective"]')?.dataset.collapsed === '1', null, { timeout: 5_000 }); await page.evaluate(() => window.__autotest.toast('NEE is free!')); await page.waitForFunction(() => [...document.querySelectorAll('.juice-toast')].some((el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > .05; })); await page.waitForTimeout(500);
    assert((await page.getByTestId('touch-grab').innerText()).match(/Drop|Pass/), `${width}x${height}: carry label missing`); assert(await page.getByTestId('touch-throw').isVisible(), `${width}x${height}: throw button missing`); assert(!(await page.getByTestId('interaction-prompt').isVisible()), `${width}x${height}: carry prompt card visible`);
    assert(!(await toastAudit(page)).length, `${width}x${height}: toast audit failed`); const failures = await audit(page); assert(!failures.length, `${width}x${height}: ${failures.join(', ')}`);
    await page.evaluate(() => window.__autotest.toast('Prototype grabbed!')); await page.waitForFunction(() => [...document.querySelectorAll('.juice-toast')].some((el) => el.textContent === 'Prototype grabbed!'));
    const carryPath = `${out}/carry-toast-${width}x${height}.png`; await page.screenshot({ path: carryPath }); notes.screens.push(carryPath);
    for (const variant of variants) {
      await page.evaluate((kind) => window.__autotest.debugOpenHack(kind), variant); const panel = page.locator(`[data-testid="${variant}"] .hack-panel`); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
      const result = await panel.evaluate((node) => { const r = node.getBoundingClientRect(); const buttons = [...node.querySelectorAll('button')].map((el) => { const b = el.getBoundingClientRect(); return { w: b.width, h: b.height, right: b.right, bottom: b.bottom, x: b.x, y: b.y }; }); return { panel: { x: r.x, y: r.y, right: r.right, bottom: r.bottom }, buttons }; });
      const badButtons = result.buttons.filter((b) => b.x < -1 || b.y < -1 || b.right > width + 1 || b.bottom > height + 1 || b.w < 40 || b.h < 40); assert(result.panel.x >= -1 && result.panel.y >= -1 && result.panel.right <= width + 1 && result.panel.bottom <= height + 1, `${width}x${height} ${variant}: panel outside viewport`); assert(!badButtons.length, `${width}x${height} ${variant}: button outside/under 40px ${JSON.stringify(badButtons)}`);
      const hudFailures = await hackHudAudit(page); assert(!hudFailures.length, `${width}x${height} ${variant}: ${hudFailures.join(', ')}`); const path = `${out}/hack-${variant}-${width}x${height}.png`; await page.screenshot({ path }); notes.screens.push(path); await page.locator(`[data-testid="${variant}"] .hack-cancel`).click();
    }
    assert(!errors.length, `${width}x${height}: errors ${errors.join('; ')}`); await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, screen: { width: 1280, height: 720 }, hasTouch: false, isMobile: false });
  const page = await context.newPage(); const errors = []; collectErrors(page, '1280x720 desktop', errors);
  await page.goto(url({ stage: 'escape' })); await page.getByTestId('singleplayer').click(); await page.getByTestId('start-singleplayer').click(); await waitForGame(page);
  await page.evaluate(() => window.__autotest.debugGrabForUi('pix')); await page.waitForFunction(() => window.__autotest?.heldObject?.('pix') === 'prototype', null, { timeout: 15_000 }); await page.waitForFunction(() => document.querySelector('[data-testid="interaction-prompt"]')?.classList.contains('visible'), null, { timeout: 5_000 });
  const desktopPrompt = await page.getByTestId('interaction-prompt').evaluate((el) => { const r = el.getBoundingClientRect(); const c = { x: innerWidth * .25, y: innerHeight * .25, right: innerWidth * .75, bottom: innerHeight * .75 }; return { text: el.textContent ?? '', width: r.width, central: Math.min(r.right, c.right) - Math.max(r.x, c.x) > 2 && Math.min(r.bottom, c.bottom) - Math.max(r.y, c.y) > 2 }; });
  assert(/Drop|Throw/.test(desktopPrompt.text), '1280x720: carry prompt missing'); assert(desktopPrompt.width <= 1280 * .45 + 1 && !desktopPrompt.central, `1280x720: desktop prompt placement ${JSON.stringify(desktopPrompt)}`); assert(!errors.length, `1280x720: errors ${errors.join('; ')}`); await context.close();
});
