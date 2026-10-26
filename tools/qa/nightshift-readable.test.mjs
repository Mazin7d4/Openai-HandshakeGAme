import {
  runTest, url, assert, layoutAudit, waitForNightShiftHud, openPage, closePage,
} from './lib.mjs';

const phone = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const desktop = { viewport: { width: 1280, height: 720 } };

async function checkRun(browser, options, name) {
  const { page } = await openPage(browser, options);
  await page.goto(url({ mode: 'nightshift', seed: 'c0ffee', floor: '1' }));
  await waitForNightShiftHud(page);
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="mission-objective"]');
    return el && getComputedStyle(el).visibility !== 'hidden' && el.textContent?.trim().length > 0;
  }, null, { timeout: 3_000 });
  const audit = await layoutAudit(page);
  assert(!audit.scrollOverflow, `${name} has document overflow: ${JSON.stringify(audit)}`);
  assert(!audit.overlaps.some((entry) => entry.includes('mission-objective') && entry.includes('interaction-prompt')),
    `${name} objective overlaps interaction prompt: ${JSON.stringify(audit.overlaps)}`);

  await page.evaluate(() => window.__heistReport.show({
    elapsedSeconds: 42, timesSpotted: 0, objectsThrown: 0, tetherSaves: 0,
    clotheslines: 0, cordTwangs: 0, nearMisses: 0, crateHaulMeters: 0,
    spottedBy: [], yankBy: [], outcome: 'win', seed: 0xc0ffee,
  }));
  const report = page.getByTestId('report-night-shift');
  await report.waitFor({ state: 'visible', timeout: 3_000 });
  const reportAudit = await page.evaluate(() => {
    const root = document.querySelector('.heist-report');
    const section = document.querySelector('[data-testid="report-leaderboard"]');
    if (!root || !section) return null;
    section.hidden = false;
    section.innerHTML = '<ol class="leaderboard-list"><li class="leaderboard-row"><span>#1</span><span>Long player name</span><span>123456</span></li></ol><form class="heist-report__leaderboard-form"><input type="text"><button class="btn">Save</button></form>';
    const controls = [...section.querySelectorAll('input, button')].map((el) => Math.round(el.getBoundingClientRect().height));
    return { overflow: root.scrollWidth > root.clientWidth + 1, controls };
  });
  assert(reportAudit && !reportAudit.overflow, `${name} report leaderboard overflows: ${JSON.stringify(reportAudit)}`);
  assert(reportAudit.controls.every((height) => height >= 48), `${name} leaderboard control below 48px: ${JSON.stringify(reportAudit.controls)}`);
  await closePage(page);
}

await runTest('nightshift-readable', async (browser) => {
  await checkRun(browser, desktop, 'desktop');
  await checkRun(browser, phone, 'phone');
});
