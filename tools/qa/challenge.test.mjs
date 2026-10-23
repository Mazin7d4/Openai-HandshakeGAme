/**
 * Challenge-link smoke: ?seed=123 shows the Night Shift floor counter, and the
 * Heist Report "Copy challenge link" round-trips seed + beat via shared/run challengeUrl.
 *
 * Uses a fresh browser context per navigation so aborted in-flight fetches from the
 * previous document cannot pollute the console-error assert.
 */
import { formatSeed, parseSeed } from '../../shared/run.ts';
import {
  runTest, url, assert, collectErrors, shot, waitForNightShiftHud, devices, openPage, closePage,
} from './lib.mjs';

const SEED = 123;
const SEED_CODE = formatSeed(SEED);

await runTest('challenge', async (browser, notes) => {
  const errors = [];
  const device = {
    ...devices['iPhone 13 landscape'],
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
  };

  const { page } = await openPage(browser, device);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  collectErrors(page, 'challenge', errors);

  const open = new URL(url({ seed: String(SEED), beat: '342000' }));
  // lib.url() adds debug/autotest; keep seed + beat (decimal accepted by parseSeed).
  open.searchParams.set('seed', String(SEED));
  open.searchParams.set('beat', '342000');
  await page.goto(open.toString());
  await waitForNightShiftHud(page, { beat: true });

  const floorText = (await page.getByTestId('floor-counter').innerText()).trim();
  notes.floorText = floorText;
  assert(/^Floor\s+\d+$/.test(floorText), `floor counter missing: "${floorText}"`);

  const beatText = (await page.getByTestId('beat-chip').innerText()).trim();
  notes.beatText = beatText;
  assert(beatText === 'Beat 5:42', `beat chip wrong: "${beatText}"`);

  // Open the report via the existing screenshot/test hook and copy the challenge link.
  await page.evaluate((seed) => {
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
      seed,
    });
  }, SEED);
  await page.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 10_000 });
  const seedLine = (await page.getByTestId('report-seed').innerText()).trim();
  notes.reportSeed = seedLine;
  assert(seedLine === `Seed ${SEED}`, `report seed wrong: "${seedLine}"`);

  await page.getByTestId('challenge-friend').click();
  const hint = page.locator('[data-heist="challenge-hint"]');
  await hint.waitFor({ state: 'visible', timeout: 5_000 });
  const hintText = (await hint.innerText()).trim();
  notes.challengeHint = hintText.slice(0, 200);

  let challengeUrl = await page.evaluate(() => window.__heistReport?.challengeUrl?.() ?? null);
  if (!challengeUrl && /^https?:/.test(hintText)) challengeUrl = hintText;
  assert(challengeUrl, 'challenge URL missing');
  const roundTrip = new URL(challengeUrl);
  const roundSeed = roundTrip.searchParams.get('seed');
  notes.roundTrip = { seed: roundSeed, beat: roundTrip.searchParams.get('beat') };
  assert(roundSeed === SEED_CODE, `challenge seed: ${roundSeed} (expected ${SEED_CODE})`);
  assert(parseSeed(roundSeed) === SEED, `challenge seed parse: ${roundSeed}`);
  assert(roundTrip.searchParams.get('beat') === '342000', `challenge beat: ${roundTrip.searchParams.get('beat')}`);

  // Fresh context for the copied link — avoids aborted-fetch console noise from the first boot.
  await closePage(page);
  const { page: reload } = await openPage(browser, device);
  collectErrors(reload, 'challenge-reload', errors);
  await reload.goto(challengeUrl);
  await waitForNightShiftHud(reload, { beat: true });
  const floor2 = (await reload.getByTestId('floor-counter').innerText()).trim();
  const beat2 = (await reload.getByTestId('beat-chip').innerText()).trim();
  notes.afterReload = { floor: floor2, beat: beat2 };
  assert(/^Floor\s+\d+$/.test(floor2), `reload floor counter: "${floor2}"`);
  assert(beat2 === 'Beat 5:42', `reload beat chip: "${beat2}"`);

  await shot(reload, 'challenge-844x390');
  notes.errors = errors;
  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
  await closePage(reload);
});
