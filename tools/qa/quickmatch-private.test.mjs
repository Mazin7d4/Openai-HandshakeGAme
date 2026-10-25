import { runTest, url, assert, openPage, closePage } from './lib.mjs';

await runTest('quickmatch-private', async (browser, notes) => {
  const open = url({ qmPool: `t${Date.now().toString(36)}` });
  const { page: a } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  const { page: b } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  await a.goto(open); await a.getByTestId('multiplayer').click(); await a.getByTestId('create-room').click();
  await a.getByTestId('lobby-status').waitFor();
  await b.goto(open); await b.getByTestId('multiplayer').click(); await b.getByTestId('quick-match').click();
  await b.getByTestId('qm-status').waitFor();
  const searchStarted = Date.now();
  await b.waitForFunction((started) => Date.now() - started >= 5_000, searchStarted, { timeout: 7_000 });
  assert(!(await b.locator('[data-testid="game-canvas"]').count()), 'quick match joined private room');
  assert((await a.getByTestId('lobby-status').innerText()).includes('Waiting'), 'private room changed state');
  notes.status = await b.getByTestId('qm-status').innerText();
  await b.getByTestId('qm-cancel').click(); await closePage(a); await closePage(b);
});
