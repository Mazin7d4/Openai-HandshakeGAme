import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTest, url, assert, waitForGame, collectErrors, devices } from './lib.mjs';
import { freePort, startTestServer } from '../test-server.mjs';
import { dailySeed } from '../../shared/run.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const phone = {
  ...devices['Pixel 5'],
  viewport: { width: 360, height: 640 },
  screen: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
};

await runTest('leaderboard-solo', async (browser, notes) => {
  const server = await startTestServer({
    port: await freePort(), root,
    env: {
      HANDSHAKE_TEST_HOOKS: '1',
      LEADERBOARD_ACCEPT_DEBUG: '1',
      LEADERBOARD_SOLO_MIN_FLOOR_SECONDS: '0',
      LEADERBOARD_SOLO_MIN_DAILY_SECONDS: '1',
      LEADERBOARD_FILE: 'off',
      EMPTY_ROOM_SECONDS: '120',
      LONELY_ROOM_SECONDS: '120',
    },
  });
  const serverUrl = `ws://127.0.0.1:${server.port}`;
  const context = await browser.newContext(phone);
  const errors = [];
  try {
    // The fresh server's Solo + AI board must have a useful empty state.
    const empty = await context.newPage();
    collectErrors(empty, 'empty', errors);
    await empty.goto(url({ server: serverUrl }));
    await empty.getByTestId('leaderboards').tap();
    await empty.getByTestId('lb-tab-solo').tap();
    await empty.getByTestId('lb-status').filter({ hasText: 'Be the first crew tonight' }).waitFor({ timeout: 15_000 });
    await empty.close();

    const ranked = await context.newPage();
    collectErrors(ranked, 'ranked', errors);
    await ranked.goto(url({ server: serverUrl }));
    await ranked.waitForFunction(() => document.documentElement.dataset.warmup === 'ready', null, { timeout: 15_000 });
    await ranked.getByTestId('daily-heist').tap();
    await waitForGame(ranked);
    await ranked.waitForFunction(() => window.__autotest?.connectionState?.() != null, null, { timeout: 15_000 });
    const run = await ranked.evaluate(() => window.__autotest.runState());
    assert(run?.mode === 'nightshift', `ranked mode ${run?.mode}`);
    assert(run?.seed === dailySeed(new Date()), 'ranked seed is not today\'s daily seed');
    await ranked.evaluate(() => window.__autotest.debugRunClear({ elapsedSeconds: 30 }));
    await ranked.waitForTimeout(500);
    await ranked.evaluate(() => window.__autotest.debugRunEscape());
    await ranked.waitForTimeout(500);
    for (let i = 0; i < 3; i += 1) {
      await ranked.evaluate(() => window.__autotest.debugRunCapture());
      await ranked.waitForTimeout(150);
    }
    await ranked.getByTestId('report-leaderboard').waitFor({ state: 'visible', timeout: 20_000 });
    await ranked.getByTestId('leaderboard-own').waitFor({ state: 'visible', timeout: 20_000 });
    assert((await ranked.getByTestId('report-leaderboard').innerText()).includes('Solo + AI'), 'solo report heading missing');
    const reportLayout = await ranked.evaluate(() => {
      const report = document.querySelector('.heist-report');
      const section = document.querySelector('[data-testid="report-leaderboard"]');
      return {
        report: report?.getBoundingClientRect(),
        section: section?.getBoundingClientRect(),
        scrollWidth: report?.scrollWidth ?? 0,
        clientWidth: report?.clientWidth ?? 0,
      };
    });
    assert(reportLayout.report?.left >= 0 && reportLayout.report?.right <= 360, `solo report overflow: ${JSON.stringify(reportLayout)}`);
    assert(reportLayout.section?.left >= 0 && reportLayout.section?.right <= 360, `solo leaderboard overflow: ${JSON.stringify(reportLayout)}`);
    assert(reportLayout.scrollWidth <= reportLayout.clientWidth + 1, `solo report horizontal scroll: ${JSON.stringify(reportLayout)}`);
    notes.ranked = { mode: run.mode, seed: run.seed };
    await ranked.close();

    const title = await context.newPage();
    collectErrors(title, 'title', errors);
    await title.goto(url({ server: serverUrl }));
    await title.getByTestId('leaderboards').tap();
    await title.getByTestId('lb-tab-solo').tap();
    await title.getByTestId('lb-list').filter({ hasText: 'AI' }).waitFor({ timeout: 15_000 });
    const tabs = await title.locator('.leaderboard-tab').evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }));
    assert(tabs.every((box) => box.left >= 0 && box.right <= 360), `solo tabs overflow: ${JSON.stringify(tabs)}`);
    await title.close();

    const cold = await context.newPage();
    collectErrors(cold, 'cold', { push: (line) => { if (!/ERR_CONNECTION_REFUSED/.test(line)) errors.push(line); } });
    const tapStartedAt = Date.now();
    await cold.goto(url({ server: `ws://127.0.0.1:${await freePort()}` }));
    await cold.getByTestId('daily-heist').tap();
    await waitForGame(cold, 15_000);
    const tapElapsed = Date.now() - tapStartedAt;
    assert(tapElapsed < 15_000, `offline path waited ${tapElapsed}ms`);
    assert((await cold.evaluate(() => window.__autotest?.connectionState?.() ?? null)) == null, 'offline path connected');
    assert(await cold.evaluate(() => document.documentElement.dataset.warmup !== 'ready'), 'offline page unexpectedly warmed');
    await cold.evaluate(() => window.__heistReport.show());
    await cold.getByTestId('leaderboard-unranked').filter({ hasText: 'Unranked (offline)' }).waitFor({ timeout: 10_000 });
    notes.offlineMs = tapElapsed;
    await cold.close();
    assert(errors.length === 0, `browser errors: ${errors.join('; ')}`);
  } finally {
    await context.close();
    await server.stop();
  }
});
