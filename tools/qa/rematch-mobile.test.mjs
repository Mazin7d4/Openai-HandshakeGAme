import { Client } from '@colyseus/sdk';
import { runTest, url, assert, shot, waitForGame, devices, SERVER_URL } from './lib.mjs';

const phone = {
  ...devices['Pixel 5'],
  viewport: { width: 360, height: 640 },
  screen: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
};

await runTest('rematch-mobile', async (browser, notes) => {
  const context = await browser.newContext(phone);
  const host = await context.newPage();
  let partner;
  try {
    await host.goto(url());
    await host.getByTestId('multiplayer').tap();
    await host.getByTestId('create-room').tap();
    const code = (await host.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
    partner = await new Client(SERVER_URL).joinById(code);
    await Promise.all([waitForGame(host), new Promise((resolve) => {
      const check = () => partner.state.players.size === 2 ? resolve() : setTimeout(check, 25);
      check();
    })]);
    await host.evaluate(() => window.__autotest?.debugRunClear?.());
    await host.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 15_000 });

    const rematch = host.getByTestId('rematch');
    await rematch.waitFor({ state: 'visible' });
    const box = await rematch.boundingBox();
    assert(box && box.width >= 44 && box.height >= 44, `rematch target too small: ${JSON.stringify(box)}`);
    assert(box.left >= 0 && box.top >= 0 && box.right <= 360 && box.bottom <= 640, `rematch target outside viewport: ${JSON.stringify(box)}`);
    assert(await host.getByTestId('rematch-status').innerText() === 'Rematch?', 'initial rematch status incorrect');
    assert(await host.getByTestId('player-stats').isVisible(), 'player stats table hidden');
    const overflow = await host.evaluate(() => ({
      scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
      clientWidth: document.scrollingElement?.clientWidth ?? innerWidth,
    }));
    assert(overflow.scrollWidth <= 360, `horizontal document overflow: ${JSON.stringify(overflow)}`);

    partner.send('rematch-vote', { want: true });
    await host.getByTestId('rematch-status').filter({ hasText: 'Partner wants a rematch!' }).waitFor({ timeout: 5000 });
    await shot(host, 'rematch-mobile-report');
    await rematch.tap();
    await host.getByTestId('mission-complete').waitFor({ state: 'hidden', timeout: 10_000 });
    assert(partner.state.mission.stage === 'infiltrate', 'partner did not reset after rematch');
    Object.assign(notes, { code, rematchBox: box, overflow, reset: true });
  } finally {
    try { await partner?.leave(true); } catch { /* already closed */ }
    await context.close();
  }
});
