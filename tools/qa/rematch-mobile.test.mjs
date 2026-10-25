import { Client } from '@colyseus/sdk';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runTest, url, assert, shot, waitForGame, devices } from './lib.mjs';
import { freePort, startTestServer } from '../test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const phone = {
  ...devices['Pixel 5'],
  viewport: { width: 360, height: 640 },
  screen: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
};

await runTest('rematch-mobile', async (browser, notes) => {
  // Own server with test hooks (results are forced via debug-run-clear), independent of the shared qa server.
  const server = await startTestServer({
    port: await freePort(), root,
    env: { HANDSHAKE_TEST_HOOKS: '1', EMPTY_ROOM_SECONDS: '120', LONELY_ROOM_SECONDS: '120' },
  });
  const SERVER_URL = `ws://127.0.0.1:${server.port}`;
  const context = await browser.newContext(phone);
  const host = await context.newPage();
  let partner;
  try {
    await host.goto(url({ server: SERVER_URL }));
    await host.getByTestId('multiplayer').tap();
    await host.getByTestId('create-room').tap();
    const code = (await host.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
    partner = await new Client(SERVER_URL).joinById(code);
    await Promise.all([waitForGame(host), new Promise((resolve) => {
      const check = () => partner.state?.players?.size === 2 ? resolve() : setTimeout(check, 25);
      check();
    })]);
    await host.evaluate(() => window.__autotest?.debugRunClear?.());
    await host.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 15_000 });

    const rematch = host.getByTestId('rematch');
    await rematch.waitFor({ state: 'visible' });
    const box = await rematch.boundingBox();
    assert(box && box.width >= 44 && box.height >= 44, `rematch target too small: ${JSON.stringify(box)}`);
    assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= 360 && box.y + box.height <= 640, `rematch target outside viewport: ${JSON.stringify(box)}`);
    assert(await host.getByTestId('rematch-status').innerText() === 'Rematch?', 'initial rematch status incorrect');
    assert(await host.getByTestId('player-stats').isVisible(), 'player stats table hidden');
    const tableFits = await host.getByTestId('player-stats').evaluate((el) => {
      const t = el.querySelector('table'); const r = t?.getBoundingClientRect();
      return Boolean(r && r.left >= 0 && r.right <= 360);
    });
    assert(tableFits, 'player stats table overflows the phone viewport');
    const focused = await host.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    assert(focused === 'rematch', `initial focus should be rematch, got ${focused}`);
    // The report panel itself must not overflow sideways (the game layer behind it is not ours to judge).
    const overflow = await host.evaluate(() => {
      const panel = document.querySelector('.heist-report');
      const r = panel?.getBoundingClientRect();
      const wide = [...(panel?.querySelectorAll('*') ?? [])].filter((el) => el.getBoundingClientRect().right > 361)
        .slice(0, 3).map((el) => `${el.tagName}.${el.className}`);
      return { left: r?.left ?? -1, right: r?.right ?? 999, scrollWidth: panel?.scrollWidth ?? 0, clientWidth: panel?.clientWidth ?? 0, wide };
    });
    assert(overflow.left >= 0 && overflow.right <= 360 && overflow.scrollWidth <= overflow.clientWidth + 1 && overflow.wide.length === 0,
      `report overflows the phone viewport: ${JSON.stringify(overflow)}`);

    partner.send('rematch-vote', { want: true });
    await host.getByTestId('rematch-status').filter({ hasText: 'Partner wants a rematch!' }).waitFor({ timeout: 5000 });
    await shot(host, 'rematch-mobile-report');
    await rematch.tap();
    await host.getByTestId('mission-complete').waitFor({ state: 'hidden', timeout: 10_000 });
    // rematch-start (message) can land before the state patch; poll the synced state.
    const resetBy = Date.now() + 5000;
    while (Date.now() < resetBy && !(partner.state.mission.stage === 'infiltrate' && partner.state.run.rematches >= 1)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert(partner.state.mission.stage === 'infiltrate' && partner.state.run.rematches >= 1,
      `partner did not reset after rematch: stage=${partner.state.mission.stage} rematches=${partner.state.run.rematches}`);
    Object.assign(notes, { code, rematchBox: box, overflow, reset: true });
  } finally {
    try { await partner?.leave(true); } catch { /* already closed */ }
    await context.close();
    await server.stop();
  }
});
