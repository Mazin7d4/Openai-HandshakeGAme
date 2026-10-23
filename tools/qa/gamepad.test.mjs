// Standard Gamepad API smoke: movement, camera look, and the in-game pause edge.
import { runTest, assert, collectErrors, waitForGame, worldState, url, openPage } from './lib.mjs';

await runTest('gamepad', async (browser, notes) => {
  const { ctx, page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    window.__fakePad = {
      id: 'QA fake standard pad', index: 0, timestamp: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
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

  const pressStart = async () => {
    await page.evaluate(() => { window.__fakePad.buttons[9].pressed = true; window.__fakePad.buttons[9].value = 1; });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.__fakePad.buttons[9].pressed = false; window.__fakePad.buttons[9].value = 0; });
    await page.waitForTimeout(150);
  };
  const pauseMenu = page.getByTestId('pause-menu');
  // Start mirrors Esc: the first press skips the onboarding coach if it is still up.
  await pressStart();
  if (!(await pauseMenu.isVisible())) await pressStart();
  await pauseMenu.waitFor({ state: 'visible', timeout: 5000 });
  await pressStart();
  await pauseMenu.waitFor({ state: 'hidden', timeout: 5000 });
  notes.errors = errors;
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
  await ctx.close();
});
