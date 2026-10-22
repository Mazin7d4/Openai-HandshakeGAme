// (a) Boot smoke: menu renders, no console errors, single-player boots and the canvas draws.
import { runTest, url, assert, collectErrors, shot, waitForGame, canvasHasContent } from './lib.mjs';

await runTest('smoke', async (browser, notes) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = collectErrors(page, 'page', []);
  const t0 = Date.now();
  await page.goto(url());
  await page.getByRole('heading', { name: 'Choose a mode' }).waitFor({ timeout: 20_000 });
  notes.menuMs = Date.now() - t0;
  notes.title = await page.title();
  for (const id of ['singleplayer', 'multiplayer', 'dev-local']) assert(await page.getByTestId(id).isVisible(), `${id} button missing`);
  // keyboard reachability of the first menu button
  await page.keyboard.press('Tab');
  notes.firstTabFocus = await page.evaluate(() => document.activeElement?.dataset?.testid ?? document.activeElement?.tagName);
  await shot(page, 'smoke-menu');
  await page.getByTestId('singleplayer').click();
  await page.getByTestId('start-singleplayer').click();
  const t1 = Date.now();
  await waitForGame(page);
  notes.bootMs = Date.now() - t1;
  await page.waitForTimeout(2500);
  assert(await canvasHasContent(page), 'canvas looks blank');
  notes.controlsCard = await page.getByTestId('controls-card').isVisible().catch(() => false);
  notes.objective = (await page.getByTestId('mission-objective').innerText().catch(() => '')).slice(0, 120);
  await shot(page, 'smoke-ingame');
  notes.errors = errors;
  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
});
