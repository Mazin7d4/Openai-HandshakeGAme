// (d) Mobile smoke: phone touch layouts in portrait and landscape.
// Checks menu tap flow, in-game HUD overlap/off-screen clipping, tap-target size and whether touch controls exist.
import { runTest, url, assert, collectErrors, shot, waitForGame, layoutAudit, devices, createAndJoin, worldState } from './lib.mjs';

await runTest('mobile', async (browser, notes) => {
  const errors = [];
  for (const [label, viewport] of [
    ['portrait-small', { width: 360, height: 640 }], ['portrait', { width: 390, height: 844 }],
    ['landscape-small', { width: 640, height: 360 }], ['landscape', { width: 844, height: 390 }], ['landscape-wide', { width: 915, height: 412 }],
  ]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport, screen: viewport, hasTouch: true, isMobile: true });
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
        actions: ['touch-jump', 'touch-up', 'touch-down', 'touch-grab', 'touch-yank', 'touch-hack', 'touch-pause']
          .map((id) => !!document.querySelector(`[data-testid="${id}"]`)),
      };
    });
    const boxes = await page.evaluate(() => {
      const nodes = [
        document.querySelector('[data-testid="touch-joystick"]'),
        ...document.querySelectorAll('.touch-btn'),
        document.querySelector('[data-testid="touch-pause"]'),
        document.querySelector('[data-testid="interaction-prompt"]'),
        document.querySelector('[data-testid="mission-objective"]'),
        document.querySelector('[data-testid="floor-counter"]'),
        document.querySelector('.active-drone-hud'),
      ].filter((node) => node && (node.dataset?.testid !== 'interaction-prompt' || node.textContent.trim()));
      const rects = nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { tap: /^touch-/.test(node.dataset?.testid ?? ''), name: node.dataset?.testid || node.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      });
      const failures = [];
      for (const r of rects) {
        if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 || (r.tap && (r.width < 44 || r.height < 44))) failures.push(`bounds ${r.name} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlap > 2 && overlapY > 2) failures.push(`overlap ${a.name}/${b.name}`);
      }
      return { rects, failures };
    });
    assert(boxes.failures.length === 0, `${label}: touch layout ${boxes.failures.join(', ')}`);
    assert(touch.joystick, `${label}: touch joystick missing`);
    assert(touch.actions.every(Boolean), `${label}: touch action buttons missing ${JSON.stringify(touch.actions)}`);
    assert(boxes.rects.filter((r) => /touch-(up|down)/.test(r.name)).every((r) => r.width >= 44 && r.height >= 44), `${label}: lift buttons too small`);
    // Pause mirrors Esc: the first tap may only skip the onboarding coach.
    await page.getByTestId('touch-pause').tap();
    await page.waitForTimeout(250);
    if (!(await page.getByTestId('pause-menu').isVisible())) await page.getByTestId('touch-pause').tap();
    await page.getByTestId('pause-menu').waitFor({ state: 'visible', timeout: 5000 });
    assert(await page.getByTestId('pause-fullscreen').isVisible().catch(() => false) || await page.evaluate(() => !document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen), `${label}: fullscreen pause control missing`);
    await page.getByTestId('pause-resume').tap();
    await page.getByTestId('pause-menu').waitFor({ state: 'hidden', timeout: 5000 });
    if (label === 'portrait') {
      notes.rotateHint = await page.getByTestId('touch-rotate-hint').isVisible().catch(() => false);
    }
    // Landscape: drag the virtual joystick and confirm the local drone moves.
    if (label.startsWith('landscape')) {
      // Playwright's tap may scroll the debug readout's overflow; measure from the origin.
      await page.evaluate(() => { window.scrollTo(0, 0); if (document.scrollingElement) document.scrollingElement.scrollLeft = 0; });
      const centers = await page.evaluate(() => [...document.querySelectorAll('.touch-actions .touch-btn')].map((node) => { const r = node.getBoundingClientRect(); return Math.round(r.left + r.width / 2); }));
      assert(centers.every((x) => x < viewport.width / 3 || x > 2 * viewport.width / 3), `${label}: action in central third ${centers} (innerWidth ${await page.evaluate(() => innerWidth)})`);
      const before = (await worldState(page)).players['player-1'];
      const joy = await page.getByTestId('touch-joystick').boundingBox();
      assert(joy, 'joystick box missing');
      const cdp = await ctx.newCDPSession(page);
      const ox = joy.x + joy.width * 0.45;
      const oy = joy.y + joy.height * 0.55;
      const pt = (x, y, id = 1) => [{ x, y, radiusX: 12, radiusY: 12, force: 0.5, id }];
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

      // Drag on the right-half look pad and assert camera yaw ("alpha") changes.
      const yawBefore = await page.evaluate(() => window.__pixneeCamera?.getLookYaw?.() ?? null);
      assert(yawBefore != null, 'debug camera hook missing');
      const look = await page.getByTestId('touch-look').boundingBox();
      assert(look, 'touch look pad missing');
      const lx = look.x + look.width * 0.55;
      const ly = look.y + look.height * 0.45;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(lx, ly, 2) });
      for (let i = 1; i <= 14; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: pt(lx + i * 12, ly, 2),
        });
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(200);
      const yawAfter = await page.evaluate(() => window.__pixneeCamera?.getLookYaw?.() ?? 0);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      notes.cameraYawDelta = +(Math.abs(yawAfter - yawBefore)).toFixed(4);
      assert(Math.abs(yawAfter - yawBefore) > 0.01, `camera alpha unchanged (${yawBefore} -> ${yawAfter})`);
      const zoomBefore = await page.evaluate(() => window.__pixneeCamera?.getZoom?.() ?? null);
      assert(zoomBefore != null, 'debug camera zoom hook missing');
      const cx = look.x + look.width * 0.7;
      const cy = look.y + look.height * 0.35;
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 35, y: cy, id: 3 }, { x: cx + 35, y: cy, id: 4 }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 35 - i * 6, y: cy, id: 3 }, { x: cx + 35 + i * 6, y: cy, id: 4 }] });
        await page.waitForTimeout(35);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(150);
      const zoomAfter = await page.evaluate(() => window.__pixneeCamera?.getZoom?.() ?? 0);
      notes.cameraZoomDelta = +(Math.abs(zoomAfter - zoomBefore)).toFixed(4);
      assert(Math.abs(zoomAfter - zoomBefore) > 0.005, `camera zoom unchanged (${zoomBefore} -> ${zoomAfter})`);
      const up = await page.getByTestId('touch-up').boundingBox();
      const down = await page.getByTestId('touch-down').boundingBox();
      const hold = async (box, id = 5) => {
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
        await page.waitForTimeout(700);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      const yBefore = (await worldState(page)).players['player-1'].y;
      await hold(up);
      const yUp = (await worldState(page)).players['player-1'].y;
      await hold(down, 6);
      const yDown = (await worldState(page)).players['player-1'].y;
      assert(yUp > yBefore + 0.08 && yDown < yUp - 0.08, `${label}: vertical touch flight failed (${yBefore}, ${yUp}, ${yDown})`);
      await shot(page, 'mobile-landscape-look');
    }
    if (label === 'landscape') {
      await page.waitForTimeout(2600);
      const objective = page.getByTestId('mission-objective');
      const collapsed = await objective.evaluate((node) => ({ state: node.dataset.collapsed, height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width }));
      assert(collapsed.state === '1' && collapsed.height <= 48 && collapsed.width <= viewport.width * 0.4, `objective not compact: ${JSON.stringify(collapsed)}`);
      await objective.tap();
      assert(await objective.getAttribute('data-collapsed') !== '1', 'objective pill did not expand');
    }
    notes[label] = { menu, game, touch };
    await ctx.close();
  }
  // Extra landscape sizes for Android phones and iPhone Pro Max.
  for (const [tag, viewport] of [
    ['android-915', { width: 915, height: 412 }],
    ['iphone-932', { width: 932, height: 430 }],
  ]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport, screen: viewport, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    collectErrors(page, tag, errors);
    await page.goto(url());
    await page.getByTestId('singleplayer').tap();
    await page.getByTestId('start-singleplayer').tap();
    await waitForGame(page);
    await page.waitForTimeout(2000);
    assert(await page.getByTestId('touch-joystick').isVisible(), `${tag}: joystick missing`);
    await shot(page, `mobile-landscape-${tag}`);
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
