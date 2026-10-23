import {
  runTest, url, assert, collectErrors, shot, waitForNightShiftHud, openPage, closePage,
} from './lib.mjs';

await runTest('night-shift', async (browser, notes) => {
  const errors = [];
  const { page } = await openPage(browser);
  collectErrors(page, 'night-shift', errors);

  const open = url({ seed: '123' });
  await page.goto(open);
  await page.evaluate(() => {
    localStorage.removeItem('pixnee.ns.best');
    sessionStorage.removeItem('pixnee.ns.run');
  });
  await page.reload();
  await waitForNightShiftHud(page);

  const floorCard = page.getByTestId('floor-card');
  await floorCard.waitFor({ state: 'visible', timeout: 10_000 });
  const cardText = (await floorCard.innerText()).trim();
  const twist = (await floorCard.locator('h3').innerText()).trim();
  assert(/Floor 1/.test(cardText), `floor card missing Floor 1: "${cardText}"`);
  assert(twist.length > 0, 'floor card twist label missing');
  assert(/Score 0/.test(cardText), `floor card score missing: "${cardText}"`);
  await floorCard.waitFor({ state: 'detached', timeout: 6_000 });

  const twistText = (await page.getByTestId('twist-chip').innerText()).trim();
  assert(twistText.length > 0, 'twist chip is empty');
  const scoreText = (await page.getByTestId('score-chip').innerText()).trim();
  assert(/^Score 0/.test(scoreText), `initial score chip wrong: "${scoreText}"`);

  await page.evaluate(() => window.__heistReport.show({
    elapsedSeconds: 120,
    timesSpotted: 0,
    objectsThrown: 0,
    tetherSaves: 1,
    clotheslines: 0,
    cordTwangs: 2,
    nearMisses: 0,
    crateHaulMeters: 0,
    spottedBy: [],
    yankBy: [],
    outcome: 'win',
    seed: 123,
  }));
  const report = page.getByTestId('report-night-shift');
  await report.waitFor({ state: 'visible', timeout: 10_000 });
  const reportText = await report.innerText();
  assert(/Floor 1 cleared/.test(reportText), 'report does not show Floor 1 cleared');
  assert(/Run score/.test(reportText), 'report does not show Run score');
  assert(/Next floor:/.test(reportText), 'report does not show Next floor');
  const scoredText = (await page.getByTestId('score-chip').innerText()).trim();
  const scored = Number(scoredText.match(/^Score\s+([\d,]+)/)?.[1]?.replaceAll(',', '') ?? 0);
  assert(scored > 0, `score chip did not increase: "${scoredText}"`);

  const best = await page.evaluate(() => JSON.parse(localStorage.getItem('pixnee.ns.best')));
  assert(best.floor === 1 && best.score > 0, `best score wrong: ${JSON.stringify(best)}`);

  await page.reload();
  await waitForNightShiftHud(page);
  await page.getByTestId('floor-card').waitFor({ state: 'visible', timeout: 10_000 });
  const persisted = await page.evaluate(() => ({
    best: JSON.parse(localStorage.getItem('pixnee.ns.best')),
    hook: window.__nightShift.best(),
  }));
  assert(persisted.best?.floor === 1 && persisted.best.score === best.score, `best score did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.hook?.score === best.score, `night shift hook score mismatch: ${JSON.stringify(persisted.hook)}`);

  await shot(page, 'night-shift-card');
  // Re-open the report for the report screenshot after the persistence reload.
  await page.evaluate(() => window.__heistReport.show({
    elapsedSeconds: 120, timesSpotted: 0, objectsThrown: 0, tetherSaves: 1,
    clotheslines: 0, cordTwangs: 2, nearMisses: 0, crateHaulMeters: 0,
    spottedBy: [], yankBy: [], outcome: 'win', seed: 123,
  }));
  await page.getByTestId('report-night-shift').waitFor({ state: 'visible', timeout: 10_000 });
  await shot(page, 'night-shift-report');

  notes.errors = errors;
  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
  await closePage(page);
});
