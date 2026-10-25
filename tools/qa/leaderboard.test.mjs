import { Client } from '@colyseus/sdk';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runTest, url, assert, tryShot, waitForGame, collectErrors, devices } from './lib.mjs';
import { freePort, startTestServer } from '../test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const phone = {
  ...devices['Pixel 5'],
  viewport: { width: 360, height: 640 },
  screen: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
};

await runTest('leaderboard', async (browser, notes) => {
  const server = await startTestServer({
    port: await freePort(), root,
    env: {
      HANDSHAKE_TEST_HOOKS: '1',
      LEADERBOARD_ACCEPT_DEBUG: '1',
      LEADERBOARD_MIN_DAILY_SECONDS: '1',
      LEADERBOARD_FILE: 'off',
      EMPTY_ROOM_SECONDS: '120',
      LONELY_ROOM_SECONDS: '120',
    },
  });
  const SERVER_URL = `ws://127.0.0.1:${server.port}`;
  const context = await browser.newContext(phone);
  const host = await context.newPage();
  const errors = [];
  collectErrors(host, 'host', errors);
  let partner;
  try {
    // The menu's ?mode=daily boots solo, so a co-op daily room is joined through its invite link.
    partner = await new Client(SERVER_URL).create('handshake', { mode: 'daily' });
    const code = partner.roomId;
    await host.goto(url({ server: SERVER_URL, room: code }));
    await Promise.all([
      waitForGame(host),
      new Promise((resolve) => {
        const check = () => partner.state?.players?.size === 2 ? resolve() : setTimeout(check, 25);
        check();
      }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 3000));
    await host.evaluate(() => window.__autotest.debugRunClear({ elapsedSeconds: 2, timesSpotted: 0 }));
    await host.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 15_000 });
    await host.getByTestId('report-leaderboard').waitFor({ state: 'visible', timeout: 15_000 });
    await host.getByTestId('leaderboard-own').waitFor({ state: 'visible', timeout: 15_000 });
    assert((await host.getByTestId('leaderboard-rank').innerText()).includes('#1'), 'leaderboard rank did not show #1');

    await host.getByTestId('leaderboard-name-input').fill('Ace');
    await host.getByTestId('leaderboard-name-save').tap();
    await host.getByTestId('leaderboard-name-status').filter({ hasText: 'Saved' }).waitFor({ timeout: 10_000 });
    await host.getByTestId('leaderboard-own').filter({ hasText: 'Ace' }).waitFor({ timeout: 10_000 });
    await host.getByTestId('leaderboard-name-input').fill('sh1t');
    await host.getByTestId('leaderboard-name-save').tap();
    await host.getByTestId('leaderboard-name-status').filter({ hasText: 'Please pick another name' }).waitFor({ timeout: 10_000 });

    const layout = await host.evaluate(() => {
      const panel = document.querySelector('.heist-report');
      const board = document.querySelector('[data-testid="report-leaderboard"]');
      const panelRect = panel?.getBoundingClientRect();
      const boardRect = board?.getBoundingClientRect();
      return {
        panel: panelRect && { left: panelRect.left, right: panelRect.right },
        board: boardRect && { left: boardRect.left, right: boardRect.right },
        scrollWidth: panel?.scrollWidth ?? 0,
        clientWidth: panel?.clientWidth ?? 0,
      };
    });
    assert(layout.panel && layout.panel.left >= 0 && layout.panel.right <= 360, `report panel overflows: ${JSON.stringify(layout)}`);
    assert(layout.board && layout.board.left >= 0 && layout.board.right <= 360, `leaderboard section overflows: ${JSON.stringify(layout)}`);
    assert(layout.scrollWidth <= layout.clientWidth + 1, `report scrolls horizontally: ${JSON.stringify(layout)}`);
    await tryShot(host, 'leaderboard-report');

    const title = await context.newPage();
    await title.goto(url({ server: SERVER_URL }));
    await title.getByTestId('leaderboards').tap();
    await title.getByTestId('lb-list').filter({ hasText: 'Ace' }).waitFor({ timeout: 15_000 });
    const titleBox = await title.getByTestId('lb-list').boundingBox();
    assert(titleBox && titleBox.x >= 0 && titleBox.x + titleBox.width <= 360, `leaderboard list overflows: ${JSON.stringify(titleBox)}`);
    await tryShot(title, 'leaderboard-title');

    const cold = await context.newPage();
    const coldErrors = [];
    collectErrors(cold, 'cold', coldErrors);
    await cold.goto(url({ server: 'ws://127.0.0.1:9' }));
    await cold.getByTestId('leaderboards').tap();
    await cold.getByTestId('lb-status').waitFor({ timeout: 10_000 });
    const coldStatus = await cold.getByTestId('lb-status').innerText();
    assert(coldStatus === 'Leaderboard waking…' || coldStatus.includes('Leaderboard unavailable'), `unexpected cold status: ${coldStatus}`);
    assert(coldErrors.filter((error) => !/Failed to load resource|ERR_CONNECTION_REFUSED/i.test(error)).length === 0,
      `cold page errors: ${coldErrors.join('; ')}`);
    await tryShot(cold, 'leaderboard-cold');
    await cold.close();
    await title.close();
    Object.assign(notes, { code, layout, titleBox, coldStatus });
  } finally {
    try { await partner?.leave(true); } catch { /* already closed */ }
    assert(errors.length === 0, `browser errors: ${errors.join('; ')}`);
    await context.close();
    await server.stop();
  }
});
