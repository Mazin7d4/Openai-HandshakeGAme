// Phone auto-quality: on a (spoofed) mid-range Android GPU the boot guess must pick the low tier in
// AUTO mode, keep the governor on, and render below native resolution. No ?lowfx / ?scale here,
// so this exercises the real device path judges hit on phones.
import { runTest, url, assert, collectErrors, waitForGame, devices } from './lib.mjs';

await runTest('quality-phone', async (browser, notes) => {
  const errors = [];
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 } });
  // Report a hardware GPU instead of SwiftShader (0x9246 = UNMASKED_RENDERER_WEBGL, 0x1F01 = RENDERER).
  await ctx.addInitScript(() => {
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const get = C.prototype.getParameter;
      C.prototype.getParameter = function (p) { return p === 0x9246 || p === 0x1f01 ? 'Adreno (TM) 642L' : get.call(this, p); };
    }
  });
  const page = await ctx.newPage();
  collectErrors(page, 'phone', errors);
  const u = new URL(url({ play: 'solo' }));
  u.searchParams.delete('lowfx'); u.searchParams.delete('scale'); u.searchParams.delete('quality');
  await page.goto(u.toString());
  await waitForGame(page);
  await page.waitForTimeout(1500);
  const q = await page.evaluate(() => {
    const status = window.__pixQuality?.();
    const c = document.querySelector('[data-testid="game-canvas"]') ?? document.querySelector('canvas');
    return { status, attr: document.documentElement.dataset.quality, canvas: c ? [c.width, c.height] : null, css: c ? [c.clientWidth, c.clientHeight] : null, dpr: devicePixelRatio };
  });
  notes.quality = q;
  assert(q.status, 'window.__pixQuality missing');
  assert(q.status.tier === 'low' && q.attr === 'low', `phone should boot on the low tier, got ${q.status.tier}/${q.attr}`);
  assert(q.status.auto === true, 'phone should run the auto governor');
  assert(/phone/.test(q.status.reason), `unexpected tier reason: ${q.status.reason}`);
  assert(typeof q.status.dynScale === 'number' && q.status.dynScale >= 1, 'governor status lacks dynScale');
  const [w, h] = q.canvas; const [cw, ch] = q.css;
  assert(w * h <= cw * ch, `low tier should render at most one pixel per CSS pixel: ${w}x${h} for ${cw}x${ch}@${q.dpr}`);
  assert(!errors.length, `errors:\n${errors.join('\n')}`);
});
