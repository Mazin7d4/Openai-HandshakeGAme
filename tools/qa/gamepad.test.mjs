// Standard Gamepad API smoke: movement, camera look, and the in-game pause edge.
import { runTest, assert, collectErrors, waitForGame, worldState, url, openPage, until, shot } from './lib.mjs';

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

  const before = (await worldState(page)).players['player-1'];
  await page.evaluate(() => { window.__fakePad.axes[1] = -1; });
  await until('gamepad movement', async () => {
    const p = (await worldState(page)).players['player-1'];
    return { ok: p && Math.hypot(p.x - before.x, p.z - before.z) > 1, info: p };
  }, 45_000);
  await page.evaluate(() => { window.__fakePad.axes[1] = 0; });
  const after = (await worldState(page)).players['player-1'];
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  notes.gamepadMove = +moved.toFixed(2);
  assert(moved > 1, `gamepad stick did not move drone (Δ=${moved})`);

  const yawBefore = await page.evaluate(() => window.__pixneeCamera?.getLookYaw?.() ?? null);
  await page.evaluate(() => { window.__fakePad.axes[2] = 1; });
  await page.waitForFunction((before) => Math.abs((window.__pixneeCamera?.getLookYaw?.() ?? before) - before) > 0.05, yawBefore, { timeout: 45_000 });
  await page.evaluate(() => { window.__fakePad.axes[2] = 0; });
  const yawAfter = await page.evaluate(() => window.__pixneeCamera?.getLookYaw?.() ?? 0);
  notes.gamepadYaw = +(Math.abs(yawAfter - yawBefore)).toFixed(3);
  assert(Math.abs(yawAfter - yawBefore) > 0.05, 'gamepad right stick did not turn camera');

  const pauseMenu = page.getByTestId('pause-menu');
  // Hold each edge until its visible effect, then let every input poll see release.
  const pressButton = async (index, effect) => {
    await page.evaluate((i) => { window.__fakePad.buttons[i].pressed = true; window.__fakePad.buttons[i].value = 1; }, index);
    try {
      await effect();
    } finally {
      await page.evaluate((i) => { window.__fakePad.buttons[i].pressed = false; window.__fakePad.buttons[i].value = 0; }, index);
      await page.waitForFunction(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
      }), null, { timeout: 45_000 });
    }
  };
  const waitPause = (visible) => pauseMenu.waitFor({ state: visible ? 'visible' : 'hidden', timeout: 45_000 });
  // Start dismisses the coach and opens pause on the same observed input edge.
  await pressButton(9, () => waitPause(true));
  await waitPause(true);
  await shot(page, 'gamepad-pause');
  await pressButton(9, () => waitPause(false));
  assert(!(await pauseMenu.isVisible()), 'second Start press did not close the pause menu');

  await pressButton(9, () => waitPause(true));
  await pressButton(1, () => waitPause(false));
  assert(!(await pauseMenu.isVisible()), 'B did not close the pause menu');
  await pressButton(9, () => waitPause(true));
  await page.keyboard.press('Escape');
  await waitPause(false);
  assert(!(await pauseMenu.isVisible()), 'Escape did not close the pause menu');
  notes.errors = errors;
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
  await ctx.close();
});
