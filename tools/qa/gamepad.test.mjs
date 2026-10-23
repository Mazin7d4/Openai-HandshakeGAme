// Standard Gamepad API smoke: movement, camera look, and the in-game pause edge.
import { runTest, assert, collectErrors, waitForGame, worldState, url, openPage } from './lib.mjs';

await runTest('gamepad', async (browser, notes) => {
  const { ctx, page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    window.__fakePad = {
      connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__fakePad] });
  });
  const errors = collectErrors(page, 'gamepad', []);
  const target = new URL(url());
  target.searchParams.set('debug', '1');
  await page.goto(target.toString());
  await page.getByTestId('singleplayer').click();
  await page.getByTestId('start-singleplayer').click();
  await waitForGame(page);
  await page.waitForTimeout(1200);

  const before = (await worldState(page)).players['player-1'];
  await page.evaluate(() => { window.__fakePad.axes[1] = -1; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__fakePad.axes[1] = 0; });
  const after = (await worldState(page)).players['player-1'];
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  notes.gamepadMove = +moved.toFixed(2);
  assert(moved > 1, `gamepad stick did not move drone (Δ=${moved})`);

  const yawBefore = await page.evaluate(() => window.__pixneeCamera?.getLookYaw?.() ?? null);
  await page.evaluate(() => { window.__fakePad.axes[2] = 1; });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__fakePad.axes[2] = 0; });
  const yawAfter = await page.evaluate(() => window.__pixneeCamera?.getLookYaw?.() ?? 0);
  notes.gamepadYaw = +(Math.abs(yawAfter - yawBefore)).toFixed(3);
  assert(Math.abs(yawAfter - yawBefore) > 0.05, 'gamepad right stick did not turn camera');

  await page.evaluate(() => { window.__fakePad.buttons[9].pressed = true; window.__fakePad.buttons[9].value = 1; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__fakePad.buttons[9].pressed = false; window.__fakePad.buttons[9].value = 0; });
  await page.getByTestId('pause-menu').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.__fakePad.buttons[9].pressed = true; window.__fakePad.buttons[9].value = 1; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__fakePad.buttons[9].pressed = false; window.__fakePad.buttons[9].value = 0; });
  await page.getByTestId('pause-menu').waitFor({ state: 'hidden' });
  notes.errors = errors;
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
  await ctx.close();
});
