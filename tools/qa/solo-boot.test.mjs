// Solo judge path: cold load -> solo with CPU NEE, with the multiplayer server port BLOCKED.
// Measures time to menu, time to first rendered frame, and checks ?play=solo deep link.
import { runTest, assert, collectErrors, shot, waitForGame, canvasHasContent, BASE_URL, SERVER_PORT } from './lib.mjs';

const serverPort = SERVER_PORT;

await runTest('solo-boot', async (browser, notes) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const blocked = [];
  await ctx.route((u) => u.port === serverPort || /onrender\.com$/.test(u.hostname), (r) => { blocked.push(r.request().url()); return r.abort(); });
  if (ctx.routeWebSocket) await ctx.routeWebSocket((u) => u.port === serverPort || /onrender\.com$/.test(u.hostname), (ws) => { blocked.push(ws.url()); ws.close(); });
  const page = await ctx.newPage();
  const errors = collectErrors(page, 'solo', []);
  const t0 = Date.now();
  await page.goto(BASE_URL);
  await page.getByTestId('singleplayer').waitFor({ timeout: 20_000 });
  notes.msToMenu = Date.now() - t0;
  notes.hasPlayNowButton = await page.getByRole('button', { name: /play now/i }).count() > 0;
  await page.getByTestId('singleplayer').click();
  await page.getByTestId('start-singleplayer').click();
  notes.clicksToPlay = 2;
  await waitForGame(page);
  // first frame = canvas has non-trivial content
  for (let i = 0; i < 40 && !(await canvasHasContent(page)); i++) await page.waitForTimeout(250);
  notes.msToFirstFrame = Date.now() - t0;
  assert(await canvasHasContent(page), 'no rendered frame');
  await page.waitForTimeout(3000);
  await shot(page, 'solo-boot-ingame');
  notes.serverRequestsBlocked = blocked.length;
  notes.fps = await page.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; performance.now() - s < 2000 ? requestAnimationFrame(f) : res(+(n / 2).toFixed(1)); }; requestAnimationFrame(f); }));
  notes.errors = errors;
  // Deep link check (WIN_STRATEGY: ?play=solo should go straight in). Advisory only.
  const p2 = await ctx.newPage();
  const u = new URL(BASE_URL); u.searchParams.set('play', 'solo');
  await p2.goto(u.toString());
  notes.playSoloDeepLink = await p2.getByTestId('game-canvas').waitFor({ timeout: 8_000 }).then(() => 'works', () => 'not implemented (lands on menu)');
  const serious = errors.filter((e) => !/WebSocket|ERR_FAILED|net::/.test(e));
  assert(serious.length === 0, `errors in solo with server blocked:\n${serious.join('\n')}`);
});
