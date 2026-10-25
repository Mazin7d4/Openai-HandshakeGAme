import { runTest, url, assert, openPage, closePage, layoutAudit } from './lib.mjs';

await runTest('quickmatch-cancel', async (browser, notes) => {
  const open = url({ qmPool: `t${Date.now().toString(36)}`, qmTimeout: '3000' });
  // Phone layout (360x640): the menu with the new button and the panel in its fullest state must fit.
  const fits = async (label) => {
    const audit = await layoutAudit(page);
    assert(!audit.scrollOverflow && audit.offscreen.length === 0, `${label} overflows at 360x640: ${JSON.stringify(audit.offscreen)}`);
  };
  const { page } = await openPage(browser, { viewport: { width: 360, height: 640 } });
  await page.goto(open); await page.getByTestId('multiplayer').click();
  await page.getByTestId('quick-match').waitFor(); await fits('multiplayer menu');
  await page.getByTestId('quick-match').click();
  await page.getByTestId('qm-panel').waitFor();
  await page.getByTestId('qm-play-bot').waitFor({ timeout: 10_000 }); await fits('quick-match panel');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="qm-elapsed"]')?.textContent?.match(/(\d+) s/)?.[1] ?? 0) >= 2, null, { timeout: 10_000 });
  await page.getByTestId('qm-cancel').click(); await page.getByTestId('quick-match').waitFor();
  const { page: second } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  await second.goto(open); await second.getByTestId('multiplayer').click(); await second.getByTestId('quick-match').click();
  await second.getByTestId('qm-status').waitFor();
  const searchStarted = Date.now();
  await second.waitForFunction((started) => Date.now() - started >= 4_000, searchStarted, { timeout: 6_000 });
  assert(await second.getByTestId('qm-panel').isVisible(), 'cancelled seat was reused');
  assert(!(await second.locator('[data-testid="game-canvas"]').count()), 'unexpected game after cancellation');
  notes.searching = await second.getByTestId('qm-status').innerText();
  await second.getByTestId('qm-cancel').click(); await closePage(page); await closePage(second);
});
