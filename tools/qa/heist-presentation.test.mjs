import { runTest, url, assert, openPage, closePage, waitForGame } from './lib.mjs';

await runTest('heist-presentation', async (browser, notes) => {
  const { page } = await openPage(browser);
  await page.goto(url());
  await page.getByTestId('dev-local').click();
  await waitForGame(page);
  await page.waitForFunction(() => window.__autotest);
  const diagnostics = await page.evaluate(() => window.__autotest.cameraDiagnostics());
  assert(diagnostics.objectiveMarkers.length === 0, `objective markers remain: ${diagnostics.objectiveMarkers}`);
  const objective = await page.getByTestId('mission-objective').innerText();
  assert(objective.length > 5, 'objective HUD data missing');
  notes.objective = objective;
  await closePage(page);
});
