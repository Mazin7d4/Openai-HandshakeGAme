// Adaptive governor: on a (spoofed) hardware-GPU phone in AUTO, injected 33 ms frames must step the
// resolution ladder down and injected 8 ms frames must step it back up, never above the start tier.
// Phone/low tier because medium/high shaders exceed SwiftShader's uniform limits on this GPU-less box.
import { runTest, url, assert, collectErrors, waitForGame, devices, shot } from './lib.mjs';

const tierIndex = { low: 0, medium: 1, high: 2 };

async function pollStatus(page, predicate, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const status = await page.evaluate(() => window.__pixQuality?.() ?? null);
    if (status && predicate(status)) return status;
    await page.waitForTimeout(250);
  }
  return await page.evaluate(() => window.__pixQuality?.() ?? null);
}

await runTest('governor', async (browser, notes) => {
  const errors = [];
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 } });
  await ctx.addInitScript(() => {
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const get = C.prototype.getParameter;
      C.prototype.getParameter = function (p) { return p === 0x9246 || p === 0x1f01 ? 'Adreno (TM) 642L' : get.call(this, p); };
    }
  });
  const page = await ctx.newPage();
  collectErrors(page, 'governor', errors);
  const firstUrl = new URL(url({ play: 'solo' }));
  firstUrl.searchParams.delete('lowfx');
  firstUrl.searchParams.delete('scale');
  firstUrl.searchParams.delete('quality');
  firstUrl.searchParams.set('govtest', '1');
  firstUrl.searchParams.set('fps', '1');
  await page.goto(firstUrl.toString());
  await waitForGame(page);

  const starting = await page.evaluate(() => window.__pixQuality?.() ?? null);
  assert(starting?.auto === true, `expected AUTO governor, got ${starting?.auto}`);
  assert(starting?.tier === 'low', `phone spoof should guess low, got ${starting?.tier}`);
  const startTier = starting.tier;
  await page.evaluate(() => window.__pixQualityTest?.injectFrameMs(33));
  const down = await pollStatus(page, (s) => s.changes.some((c) => /\bdown\b/.test(c)) && (s.scaleStep > 0 || tierIndex[s.tier] < tierIndex[startTier]), 60_000);
  assert(down?.changes.some((c) => /\bdown\b/.test(c)), `governor did not step down: ${JSON.stringify(down)}`);
  assert(down.scaleStep > 0 || tierIndex[down.tier] < tierIndex[startTier], `down did not change ladder state: ${JSON.stringify(down)}`);
  assert(tierIndex[down.tier] <= tierIndex[startTier], `tier exceeded ceiling after down: ${down.tier}`);

  await page.evaluate(() => window.__pixQualityTest?.injectFrameMs(8));
  const downChanges = down.changes.length;
  const up = await pollStatus(page, (s) => {
    const hasUp = s.changes.some((c, i) => i >= downChanges && /\bup\b/.test(c));
    return hasUp && (s.scaleStep < down.scaleStep || tierIndex[s.tier] > tierIndex[down.tier]);
  }, 60_000);
  assert(up?.changes.some((c, i) => i >= downChanges && /\bup\b/.test(c)), `governor did not step up after down: ${JSON.stringify(up)}`);
  assert(up.scaleStep < down.scaleStep || tierIndex[up.tier] > tierIndex[down.tier], `up did not reverse ladder state: ${JSON.stringify(up)}`);
  assert(tierIndex[up.tier] <= tierIndex[startTier], `tier exceeded starting ceiling: ${up.tier}/${startTier}`);

  const overlay = page.locator('[data-testid="fps-overlay"]');
  assert(await overlay.isVisible(), 'FPS overlay should be visible');
  const overlayInfo = await overlay.evaluate((el) => ({ pointerEvents: getComputedStyle(el).pointerEvents, text: el.textContent }));
  assert(overlayInfo.pointerEvents === 'none', `FPS overlay pointer-events should be none, got ${overlayInfo.pointerEvents}`);
  assert(/fps/i.test(overlayInfo.text ?? ''), `FPS overlay text lacks fps: ${overlayInfo.text}`);

  notes.statuses = { starting, down, up };
  await shot(page, 'governor-recovered');
  await page.close();

  const page2 = await ctx.newPage();
  collectErrors(page2, 'governor-pinned', errors);
  const secondUrl = new URL(url({ play: 'solo' }));
  secondUrl.searchParams.delete('fps');
  secondUrl.searchParams.delete('govtest');
  secondUrl.searchParams.set('lowfx', '');
  await page2.goto(secondUrl.toString());
  await waitForGame(page2);
  assert(await page2.locator('[data-testid="fps-overlay"]').count() === 0, 'FPS overlay should be lazy and absent without fps=1');
  const pinned = await page2.evaluate(() => ({ testHook: window.__pixQualityTest, status: window.__pixQuality?.() ?? null }));
  assert(pinned.testHook === undefined, 'quality test hook should be absent without govtest=1');
  assert(pinned.status?.pinned === 'all', `lowfx should fully pin quality, got ${pinned.status?.pinned}`);
  notes.pinned = pinned.status;
  assert(!errors.length, `errors:\n${errors.join('\n')}`);
});
