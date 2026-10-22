// (d) Mobile smoke: iPhone 13 emulation (touch), portrait 390x844 and landscape 844x390.
// Checks menu tap flow, in-game HUD overlap/off-screen clipping, tap-target size and whether touch controls exist.
import { runTest, url, assert, collectErrors, shot, waitForGame, layoutAudit, devices, createAndJoin, worldState } from './lib.mjs';

await runTest('mobile', async (browser, notes) => {
  const errors = [];
  for (const [label, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport, screen: viewport });
    const page = await ctx.newPage();
    collectErrors(page, label, errors);
    await page.goto(url());
    await page.getByRole('heading', { name: 'Two drones. One cord.' }).waitFor({ timeout: 20_000 });
    const menu = await layoutAudit(page);
    await shot(page, `mobile-${label}-menu`);
    await page.getByTestId('singleplayer').tap();
    await page.getByTestId('start-singleplayer').tap();
    await waitForGame(page);
    await page.waitForTimeout(2500);
    const game = await layoutAudit(page);
    await shot(page, `mobile-${label}-ingame`);
    const touch = await page.evaluate(() => {
      const hits = [...document.querySelectorAll('*')].filter((el) => /joystick|stick|touch|dpad|virtual/i.test(`${el.className} ${el.id} ${el.dataset?.testid ?? ''}`));
      return {
        touchUiElements: hits.length,
        maxTouchPoints: navigator.maxTouchPoints,
        joystick: !!document.querySelector('[data-testid="touch-joystick"]'),
        actions: ['touch-jump', 'touch-grab', 'touch-yank', 'touch-hack', 'touch-pause']
          .map((id) => !!document.querySelector(`[data-testid="${id}"]`)),
      };
    });
    assert(touch.joystick, `${label}: touch joystick missing`);
    assert(touch.actions.every(Boolean), `${label}: touch action buttons missing ${JSON.stringify(touch.actions)}`);
    // Landscape: drag the virtual joystick and confirm the local drone moves.
    if (label === 'landscape') {
      const before = (await worldState(page)).players['player-1'];
      const joy = await page.getByTestId('touch-joystick').boundingBox();
      assert(joy, 'joystick box missing');
      const cdp = await ctx.newCDPSession(page);
      const ox = joy.x + joy.width * 0.45;
      const oy = joy.y + joy.height * 0.55;
      const pt = (x, y) => [{ x, y, radiusX: 12, radiusY: 12, force: 0.5, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(ox, oy) });
      for (let i = 1; i <= 12; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: pt(ox, oy - i * 10),
        });
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(700);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const after = (await worldState(page)).players['player-1'];
      const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
      notes.joystickMoved = +moved.toFixed(2);
      assert(moved > 0.35, `joystick did not move drone (Δ=${moved})`);
      await shot(page, 'mobile-landscape-joystick');
    }
    notes[label] = { menu, game, touch };
    await ctx.close();
  }
  // Phone landscape (844x390, touch) as player 2 joining a desktop host.
  {
    const hostCtx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const phoneCtx = await browser.newContext({ ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } });
    const host = await hostCtx.newPage(); const phone = await phoneCtx.newPage();
    collectErrors(host, 'p2-host', errors); collectErrors(phone, 'p2-phone', errors);
    const code = await createAndJoin(host, phone);
    await Promise.all([waitForGame(host), waitForGame(phone)]);
    await phone.waitForTimeout(2500);
    const hud = await phone.getByTestId('network-hud').innerText();
    const layout = await layoutAudit(phone);
    // one-finger drag on the canvas: does the drone move? (no touch flight controls expected yet)
    const before = (await worldState(phone)).players['player-2'];
    const box = await phone.getByTestId('game-canvas').boundingBox();
    const cdp = await phoneCtx.newCDPSession(phone);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(box.width * 0.2, box.height * 0.7) });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(box.width * 0.2, box.height * 0.7 - i * 8) }); await phone.waitForTimeout(80); }
    await phone.waitForTimeout(600);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = (await worldState(phone)).players['player-2'];
    const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : null;
    await shot(phone, 'mobile-landscape-p2-phone'); await shot(host, 'mobile-landscape-p2-host');
    notes.phoneAsP2 = { code, hud, roleNee: hud.includes('NEE'), layout, touchDragMovedDrone: moved == null ? null : +moved.toFixed(2) };
    await hostCtx.close(); await phoneCtx.close();
  }
  notes.errors = errors;
  assert(notes.phoneAsP2.roleNee, `phone P2 role: ${notes.phoneAsP2.hud}`);
  // Hard failures: menu must be fully usable on both orientations.
  for (const o of ['portrait', 'landscape']) {
    assert(notes[o].menu.offscreen.filter((s) => /button|singleplayer|multiplayer/.test(s)).length === 0, `${o}: menu buttons off-screen ${notes[o].menu.offscreen}`);
  }
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
});
