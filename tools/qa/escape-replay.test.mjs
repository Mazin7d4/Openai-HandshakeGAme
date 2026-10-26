// Slow-mo escape replay: a solo extraction plays the letterboxed replay, any input skips it,
// the Heist Report follows, and "Watch replay" on the report plays it again and returns to the report.
import { runTest, url, assert, collectErrors, shot, openPage, closePage, waitForGame } from './lib.mjs';

const EXTRACTION = { x: 11, y: 2, z: 43.5 };

async function extract(page) {
  // Start a few metres out so the ring buffer holds a real approach, then fly both drones in.
  await page.evaluate(() => {
    window.__autotest.teleport('nee', 8, 2.2, 41);
    window.__autotest.teleport('pix', 9, 2.2, 40);
  });
  await page.waitForTimeout(700);
  await page.evaluate((p) => {
    window.__autotest.goto('nee', p.x, p.y, p.z, 1);
    window.__autotest.goto('pix', p.x + 1.5, p.y, p.z + 1.5, 1);
  }, EXTRACTION);
}

await runTest('escape-replay', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  const errors = collectErrors(page, 'escape-replay', []);
  await page.goto(url({ play: 'solo', stage: 'escape' }));
  await waitForGame(page);
  await page.waitForFunction(() => typeof window.__autotest?.escapeReplay === 'function', null, { timeout: 15_000 });
  await page.waitForTimeout(800);
  await extract(page);

  const replay = page.getByTestId('escape-replay');
  await replay.waitFor({ state: 'visible', timeout: 25_000 });
  const state = await page.evaluate(() => window.__autotest.escapeReplay());
  notes.started = state;
  assert(state.active === true, 'escape replay did not start after extraction');
  assert(!(await page.getByTestId('mission-complete').isVisible()), 'report visible during replay');
  await page.waitForTimeout(1600);
  assert(await page.locator('.escape-replay--stamp').count() === 1, 'HEIST COMPLETE stamp did not land');
  await shot(page, 'escape-replay-1280');

  // Any input skips straight to the report.
  await page.keyboard.press('x');
  await replay.waitFor({ state: 'detached', timeout: 3_000 });
  await page.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 5_000 });
  notes.skippedToReport = true;

  // Report → Watch replay → plays to the end on its own → report again.
  const again = page.getByTestId('report-replay');
  await again.waitFor({ state: 'visible', timeout: 3_000 });
  await again.click();
  await replay.waitFor({ state: 'visible', timeout: 3_000 });
  assert(!(await page.getByTestId('mission-complete').isVisible()), 'report stayed up during the re-watch');
  await replay.waitFor({ state: 'detached', timeout: 8_000 });
  await page.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 5_000 });
  notes.rewatchReturnedToReport = true;

  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
  await closePage(page);
});
