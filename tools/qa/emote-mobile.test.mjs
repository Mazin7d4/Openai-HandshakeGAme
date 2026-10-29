// Phone emote radial + ping button: hold-drag-release, sticky tap mode, 44px targets, portrait + landscape fit.
import { runTest, url, assert, collectErrors, shot, waitForGame, devices } from './lib.mjs';

const center = async (locator) => {
  const b = await locator.boundingBox();
  assert(b, 'missing box');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
};
const touch = (cdp, type, points) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: 1 })),
});
const emotes = (page) => page.evaluate(() => window.__autotest?.pingEmote?.emotes?.().map((e) => e.id) ?? []);
const pings = (page) => page.evaluate(() => window.__autotest?.pingEmote?.pings?.().length ?? -1);
const radialFits = (page) => page.evaluate(() => ['here', 'wait', 'go', 'yay'].map((id) => {
  const r = document.querySelector(`[data-testid="emote-${id}"]`).getBoundingClientRect();
  return { id, ok: r.width >= 44 && r.height >= 44 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
}));

await runTest('emote-mobile', async (browser, notes) => {
  const errors = [];
  const viewport = { width: 360, height: 640 };
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport, screen: viewport });
  const page = await ctx.newPage();
  collectErrors(page, 'emote-mobile', errors);
  const cdp = await ctx.newCDPSession(page);
  await page.goto(url());
  await page.getByTestId('singleplayer').tap();
  await page.getByTestId('start-singleplayer').tap();
  await waitForGame(page);
  await page.waitForTimeout(1500);
  const ping = page.getByTestId('touch-ping');
  const emote = page.getByTestId('touch-emote');
  const radial = page.getByTestId('emote-radial');
  for (const [name, loc] of [['ping', ping], ['emote', emote]]) {
    const c = await center(loc);
    assert(c.w >= 44 && c.h >= 44, `${name} button ${c.w}x${c.h} < 44px`);
  }

  // Hold, drag onto Go!, release.
  const e = await center(emote);
  await touch(cdp, 'touchStart', [e]);
  await page.waitForTimeout(350);
  assert(await radial.isVisible(), 'radial did not open on hold');
  assert(!await page.getByTestId('touch-grab').isVisible() && !await page.getByTestId('touch-jump').isVisible(), 'emote picker left overlapping flight actions visible');
  const fitsPortrait = await radialFits(page);
  assert(fitsPortrait.every((f) => f.ok), `portrait radial items: ${JSON.stringify(fitsPortrait)}`);
  await shot(page, 'emote-mobile-radial-portrait');
  const go = await center(page.getByTestId('emote-go'));
  await touch(cdp, 'touchMove', [{ x: (e.x + go.x) / 2, y: (e.y + go.y) / 2 }]);
  await touch(cdp, 'touchMove', [go]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForFunction(() => window.__autotest?.pingEmote?.emotes?.().some((x) => x.id === 'go'), null, { timeout: 1000 });
  assert(!(await radial.isVisible()), 'radial stayed open after drag-release');
  assert(await page.getByTestId('touch-grab').isVisible() && await page.getByTestId('touch-jump').isVisible(), 'emote picker did not restore flight actions');

  // Hold and release without dragging cancels.
  await page.waitForTimeout(600);
  await touch(cdp, 'touchStart', [e]);
  await page.waitForTimeout(350);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  assert(!(await radial.isVisible()), 'radial stayed open after hold-release cancel');

  // Quick tap -> sticky radial; tap Yay.
  await page.waitForTimeout(2100);
  await emote.tap();
  await page.waitForTimeout(100);
  assert(await radial.isVisible(), 'radial did not open on quick tap');
  await page.getByTestId('emote-yay').tap();
  await page.waitForFunction(() => window.__autotest?.pingEmote?.emotes?.().some((x) => x.id === 'yay'), null, { timeout: 1000 });
  assert(!(await radial.isVisible()), 'radial stayed open after picking');
  // Sticky radial closes on outside tap.
  await page.waitForTimeout(600);
  await emote.tap();
  await page.waitForTimeout(100);
  await page.touchscreen.tap(viewport.width / 2, 120);
  await page.waitForTimeout(100);
  assert(!(await radial.isVisible()), 'sticky radial did not close on outside tap');

  await ping.tap();
  await page.waitForTimeout(150);
  assert((await pings(page)) === 1, 'ping not placed');
  notes.portrait = { emotes: await emotes(page), pings: await pings(page) };

  await page.setViewportSize({ width: 640, height: 360 });
  await page.waitForTimeout(400);
  await emote.tap();
  await page.waitForTimeout(100);
  const fitsLandscape = await radialFits(page);
  assert(fitsLandscape.every((f) => f.ok), `landscape radial items: ${JSON.stringify(fitsLandscape)}`);
  await shot(page, 'emote-mobile-radial-landscape');
  await page.touchscreen.tap(320, 40);
  await ctx.close();
  assert(errors.length === 0, errors.join('\n'));
});
