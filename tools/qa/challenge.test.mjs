/**
 * Challenge-link smoke: ?seed=123 shows the Night Shift floor counter, and the
 * Heist Report "Copy challenge link" round-trips seed + beat back into a bootable URL.
 */
import { runTest, url, assert, collectErrors, shot, waitForGame, devices } from './lib.mjs';

await runTest('challenge', async (browser, notes) => {
  const errors = [];
  const ctx = await browser.newContext({
    ...devices['iPhone 13 landscape'],
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  collectErrors(page, 'challenge', errors);

  const open = new URL(url({ seed: '123', beat: '342000' }));
  // lib.url() adds debug/autotest; keep seed + beat.
  open.searchParams.set('seed', '123');
  open.searchParams.set('beat', '342000');
  await page.goto(open.toString());
  await waitForGame(page);
  await page.waitForTimeout(1500);

  const floor = page.getByTestId('floor-counter');
  await floor.waitFor({ state: 'visible', timeout: 15_000 });
  const floorText = (await floor.innerText()).trim();
  notes.floorText = floorText;
  assert(/^Floor\s+\d+$/.test(floorText), `floor counter missing: "${floorText}"`);

  const beat = page.getByTestId('beat-chip');
  await beat.waitFor({ state: 'visible', timeout: 5_000 });
  const beatText = (await beat.innerText()).trim();
  notes.beatText = beatText;
  assert(beatText === 'Beat 5:42', `beat chip wrong: "${beatText}"`);

  // Open the report via the existing screenshot/test hook and copy the challenge link.
  await page.evaluate(() => {
    window.__heistReport?.show({
      elapsedSeconds: 5 * 60 + 42,
      timesSpotted: 0,
      objectsThrown: 0,
      tetherSaves: 1,
      clotheslines: 0,
      cordTwangs: 2,
      nearMisses: 0,
      crateHaulMeters: 0,
      spottedBy: [],
      yankBy: ['pix'],
      outcome: 'win',
      seed: 123,
    });
  });
  await page.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 10_000 });
  const seedLine = (await page.getByTestId('report-seed').innerText()).trim();
  notes.reportSeed = seedLine;
  assert(seedLine === 'Seed 123', `report seed wrong: "${seedLine}"`);

  await page.getByTestId('challenge-friend').click();
  const hint = page.locator('[data-heist="challenge-hint"]');
  await hint.waitFor({ state: 'visible', timeout: 5_000 });
  const hintText = (await hint.innerText()).trim();
  notes.challengeHint = hintText.slice(0, 200);

  let challengeUrl = await page.evaluate(() => window.__heistReport?.challengeUrl?.() ?? null);
  if (!challengeUrl && /^https?:/.test(hintText)) challengeUrl = hintText;
  assert(challengeUrl, 'challenge URL missing');
  const roundTrip = new URL(challengeUrl);
  notes.roundTrip = { seed: roundTrip.searchParams.get('seed'), beat: roundTrip.searchParams.get('beat') };
  assert(roundTrip.searchParams.get('seed') === '123', `challenge seed: ${roundTrip.searchParams.get('seed')}`);
  assert(roundTrip.searchParams.get('beat') === '342000', `challenge beat: ${roundTrip.searchParams.get('beat')}`);

  // Reload from the copied challenge link and confirm floor + beat again.
  await page.goto(challengeUrl);
  await waitForGame(page);
  await page.waitForTimeout(1200);
  const floor2 = (await page.getByTestId('floor-counter').innerText()).trim();
  const beat2 = (await page.getByTestId('beat-chip').innerText()).trim();
  notes.afterReload = { floor: floor2, beat: beat2 };
  assert(/^Floor\s+\d+$/.test(floor2), `reload floor counter: "${floor2}"`);
  assert(beat2 === 'Beat 5:42', `reload beat chip: "${beat2}"`);

  await shot(page, 'challenge-844x390');
  notes.errors = errors;
  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
  await ctx.close();
});
