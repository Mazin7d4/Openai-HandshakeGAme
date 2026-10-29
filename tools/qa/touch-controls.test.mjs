import { mkdirSync, readFileSync } from 'node:fs';
import { runTest, url, assert, waitForGame, collectErrors, worldState, until } from './lib.mjs';

const out = process.env.QA_TOUCH_SHOTS ?? '/workspace/handshake/sprint/playtest/touch';
mkdirSync(out, { recursive: true });
const sizes = [[1024, 461], [844, 390], [740, 360], [932, 430], [390, 844]];
const center = async locator => {
  const b = await locator.boundingBox();
  assert(b, 'control has no box');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const send = (cdp, type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

async function audit(page, selector, central = true) {
  return page.locator(selector).evaluateAll((nodes, central) => {
    const visible = nodes.filter(el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
    const boxes = visible.map(el => ({ name: el.dataset.testid || el.className, ...el.getBoundingClientRect().toJSON() }));
    const errors = [];
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
    const middle = { x: innerWidth / 4, y: innerHeight / 4, right: innerWidth * .75, bottom: innerHeight * .75 };
    for (const b of boxes) {
      if (b.x < 0 || b.y < 0 || b.right > innerWidth + .1 || b.bottom > innerHeight + .1) errors.push(`offscreen ${b.name}`);
      if (/touch-/.test(b.name) && (b.width < 48 || b.height < 48)) errors.push(`under 48px ${b.name}: ${b.width}x${b.height}`);
      if (central && intersects(b, middle)) errors.push(`central ${b.name}`);
    }
    for (let i = 0; i < boxes.length; i++) for (const b of boxes.slice(i + 1)) if (intersects(boxes[i], b)) errors.push(`overlap ${boxes[i].name}/${b.name}`);
    return errors;
  }, central);
}

await runTest('touch-controls', async (browser, notes) => {
  const errors = [];
  notes.screens = []; notes.sizes = sizes.length;
  for (const [width, height] of sizes) {
    const viewport = { width, height };
    const context = await browser.newContext({ viewport, screen: viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    collectErrors(page, `${width}x${height}`, errors);
    try {
      await page.goto(url({ play: 'solo', stage: 'escape' })); await waitForGame(page);
      const rotate = page.getByRole('button', { name: 'Got it', exact: true });
      if (await rotate.isVisible()) await rotate.click();
      const skip = page.getByTestId('onboarding-skip');
      if (await skip.isVisible()) await skip.click();
      await page.waitForFunction(() => document.querySelector('[data-testid="mission-objective"]')?.dataset.collapsed === '1');
      await page.addStyleTag({ content: '#dev-readout, #dev-controls { opacity: 0 !important; }' });
      const shot = async label => { await page.locator('#dev-readout, #dev-controls').evaluateAll(nodes => nodes.forEach(el => el.style.setProperty('opacity', '0', 'important'))); const path = `${out}/after-${width}x${height}-${label}.png`; await page.screenshot({ path }); notes.screens.push(path); };
      await shot('flight');
      let problems = await audit(page, height < width ? '.touch-controls button, .touch-stick, .touch-look' : '.touch-controls button, .touch-stick');
      assert(!problems.length, `${width}x${height}: ${problems.join('; ')}`);
      if (width > height) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        const before = await until('live drone readout', async () => {
          const y = (await worldState(page)).players['player-1']?.y;
          return { ok: Number.isFinite(y), info: y };
        });
        const up = await center(page.getByTestId('touch-up'));
        await send(cdp, 'touchStart', [{ ...up, id: 11 }]);
        let raised;
        try { raised = await until('Up raises the drone', async () => {
          const y = (await worldState(page)).players['player-1'].y;
          return { ok: y > before + .15, info: y };
        }); } finally { await send(cdp, 'touchEnd', []); }
        const down = await center(page.getByTestId('touch-down'));
        await send(cdp, 'touchStart', [{ ...down, id: 12 }]);
        let lowered;
        try { lowered = await until('Down lowers the drone', async () => {
          const y = (await worldState(page)).players['player-1'].y;
          return { ok: y < raised - .15, info: y };
        }); } finally { await send(cdp, 'touchEnd', []); }
        (notes.altitude ??= []).push({ width, before, raised, lowered });
      }
      await page.evaluate(() => window.__autotest.debugGrabForUi('pix'));
      await page.waitForFunction(() => window.__autotest.heldObject('pix') === 'prototype');
      await page.waitForFunction(() => /Drop|Pass/.test(document.querySelector('[data-testid="touch-grab"]').textContent));
      await page.evaluate(() => window.__autotest.toast('Touch audit toast'));
      await page.locator('.juice-toast').filter({ hasText: 'Touch audit toast' }).waitFor();
      problems = await audit(page, '.touch-controls button, .touch-stick, .juice-toast');
      assert(!problems.length, `${width}x${height} carrying/toast: ${problems.join('; ')}`);
      await shot('carry-toast');
      for (const variant of ['packet-routing', 'signal-match', 'memory-trace']) {
        await page.evaluate(kind => window.__autotest.debugOpenHack(kind), variant);
        const panel = page.locator('.hack-panel'); await panel.waitFor();
        await panel.evaluate(node => Promise.all(node.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished)));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        problems = await audit(page, '.hack-panel', false);
        assert(!problems.length, `${width}x${height} ${variant}: ${problems.join('; ')}`);
        const controls = await panel.locator('button, input').evaluateAll(nodes => nodes.map(el => ({ name: el.textContent || el.type, ...el.getBoundingClientRect().toJSON() })));
        assert(controls.every(b => b.width >= 47.9 && b.height >= 47.9 && b.x >= 0 && b.y >= 0 && b.right <= width && b.bottom <= height), `${width}x${height} ${variant}: clipped/small hack controls ${JSON.stringify(controls)}`);
        assert(!await page.getByTestId('touch-controls').isVisible(), `${variant}: flight controls visible during hack`);
        await shot(variant); await page.locator('.hack-cancel').click();
      }
    } finally { await context.close(); }
  }
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  collectErrors(page, 'input fixture', errors);
  try {
    await page.goto(url());
    await page.evaluate(async () => {
      const { TouchControls } = await import('/src/ui/TouchControls.ts');
      const { VirtualControlInput } = await import('/src/input/VirtualControlInput.ts');
      const parent = document.createElement('div'); parent.className = 'touch-play';
      parent.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(parent);
      const virtual = new VirtualControlInput();
      const stats = { grab: 0, hack: 0, yank: 0, yaw: 0, lookHeld: false };
      const controls = new TouchControls(parent, {
        virtual, solo: true, onGrab: () => stats.grab++, onInteract: () => stats.hack++, onYank: () => stats.yank++, onPause: () => {}, onSwitch: () => {},
        camera: { touchLook: dx => stats.yaw += dx, touchLookHold: () => stats.lookHeld = true, touchLookRelease: () => stats.lookHeld = false, touchZoom: () => {}, touchRecenter: () => {} },
      });
      window.touchFixture = { controls, virtual, stats };
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const stick = await center(page.getByTestId('touch-joystick'));
    const look = await center(page.getByTestId('touch-look'));
    const action = await center(page.getByTestId('touch-grab'));
    const moving = { x: stick.x, y: stick.y - 35, id: 1 };
    const looking = { x: look.x + 20, y: look.y, id: 2 };
    await send(cdp, 'touchStart', [{ ...stick, id: 1 }]);
    await send(cdp, 'touchMove', [moving]);
    await send(cdp, 'touchStart', [moving, { ...look, id: 2 }]);
    await send(cdp, 'touchMove', [moving, looking]);
    await send(cdp, 'touchStart', [moving, looking, { ...action, id: 3 }]);
    await page.waitForFunction(() => window.touchFixture.stats.grab === 1 && window.touchFixture.stats.yaw > 0 && window.touchFixture.virtual.sample().thrust > .5);
    // CDP touchEnd lists the released fingers. Omitting the other two keeps them down.
    await send(cdp, 'touchEnd', [{ ...action, id: 3 }]);
    assert(await page.evaluate(() => window.touchFixture.virtual.sample().thrust > .5 && window.touchFixture.stats.lookHeld), 'action release cancelled movement/look');
    await send(cdp, 'touchEnd', []);
    assert(await page.evaluate(() => window.touchFixture.virtual.sample().thrust === 0 && !window.touchFixture.stats.lookHeld), 'touch release left flight/look held');
    // Two lift sources: releasing Boost must preserve an independently held Up.
    const up = { ...await center(page.getByTestId('touch-up')), id: 4 };
    const boost = { ...await center(page.getByTestId('touch-jump')), id: 5 };
    await send(cdp, 'touchStart', [up]); await send(cdp, 'touchStart', [up, boost]);
    await send(cdp, 'touchEnd', [boost]);
    assert(await page.evaluate(() => window.touchFixture.virtual.sample().lift === 1 && !window.touchFixture.virtual.sample().boost), 'Boost release erased held Up');
    await page.evaluate(() => window.touchFixture.controls.setVisible(false));
    assert(await page.evaluate(() => Object.values(window.touchFixture.virtual.sample()).every(v => !v)), 'hidden controls left input held');
    await send(cdp, 'touchEnd', []);
    await page.evaluate(() => window.touchFixture.controls.setVisible(true));
    for (const [prompt, verb, command] of [['[F] Hack console', 'Hack', 'hack'], ['[E] Grab crate', 'Grab', 'grab'], ['[R] Yank NEE to safety', 'Yank', 'yank']]) {
      await page.evaluate(prompt => window.touchFixture.controls.setContext([prompt], 'nee'), prompt);
      assert(await page.getByTestId('touch-grab').getAttribute('aria-label') === verb, `context verb missing: ${verb}`);
      const before = await page.evaluate(command => window.touchFixture.stats[command], command);
      await page.getByTestId('touch-grab').tap();
      assert(await page.evaluate(command => window.touchFixture.stats[command], command) === before + 1, `${verb} sent wrong command`);
    }
    await page.evaluate(() => { window.touchFixture.controls.setCarryState(true, true); window.touchFixture.controls.setContext(['[F] Hack console'], 'nee'); });
    assert(await page.getByTestId('touch-grab').getAttribute('aria-label') === 'Pass', 'hack proximity overwrote Pass');
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const handedness of ['left', 'right']) {
        await page.evaluate(async handedness => { const { saveSettings } = await import('/src/ui/Settings.ts'); saveSettings({ touchHandedness: handedness, touchOpacity: .6 }); }, handedness);
        const problems = await audit(page, height < width ? '.touch-controls button, .touch-stick, .touch-look' : '.touch-controls button, .touch-stick');
        assert(!problems.length, `${width}x${height} ${handedness}: ${problems.join('; ')}`);
        assert(await page.getByTestId('touch-controls').evaluate(el => +getComputedStyle(el).opacity) === .6, 'opacity setting ignored');
      }
    }
    await page.evaluate(async () => {
      const { GameHud } = await import('/src/ui/GameHud.ts');
      const noop = () => {};
      const hud = new GameHud(document.querySelector('.touch-play'), { onResume: noop, onLeave: noop, onGraphicsQuality: noop, onInteract: noop, onGrabDrop: noop, onThrow: noop });
      hud.toast('First queued toast'); hud.toast('Second queued toast'); hud.toast('Second queued toast'); hud.toast('Third queued toast');
      window.toastFixture = hud;
    });
    assert(await page.locator('.juice-toast').count() === 1 && await page.locator('.juice-toast').textContent() === 'First queued toast', 'callout burst stacked or dropped first toast');
    await page.waitForFunction(() => document.querySelector('.juice-toast')?.textContent === 'Second queued toast');
    assert(await page.locator('.juice-toast').count() === 1, 'queue displayed multiple toasts');
    await page.waitForFunction(() => document.querySelector('.juice-toast')?.textContent === 'Third queued toast');
    await page.evaluate(() => window.toastFixture.dispose());
    assert(await page.locator('.juice-toasts').count() === 0, 'disposed HUD left queued callouts');
    await page.evaluate(() => window.touchFixture.controls.dispose());
    notes.multitouch = 'move + look + action; independent lift sources; hide resets; context dispatch; both handedness settings';
  } finally { await context.close(); }
  // Real proximity prompts must reach the action button through GameApp, not just the fixture seam.
  const sceneContext = await browser.newContext({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const scenePage = await sceneContext.newPage(); collectErrors(scenePage, 'context integration', errors);
  try {
    await scenePage.goto(url({ play: 'solo' })); await waitForGame(scenePage);
    const skip = scenePage.getByTestId('onboarding-skip'); if (await skip.isVisible()) await skip.click();
    const layout = JSON.parse(readFileSync(new URL('../../src/level/heist-layout.json', import.meta.url), 'utf8'));
    await scenePage.evaluate(point => { window.__autotest.teleport('pix', point.x, point.y, point.z); window.__autotest.teleport('nee', point.x + 1, point.y, point.z); }, layout.terminals['terminal-a']);
    await scenePage.waitForFunction(() => document.querySelector('[data-testid="touch-grab"]')?.getAttribute('aria-label') === 'Hack');
    await scenePage.getByTestId('touch-grab').tap(); await scenePage.locator('.hack-panel').waitFor();
    await scenePage.locator('.hack-cancel').click();
    const crate = (await worldState(scenePage)).objects['crate-blue'];
    assert(crate, 'context integration crate missing');
    await scenePage.evaluate(point => { window.__autotest.teleport('pix', point.x, point.y + 1, point.z); window.__autotest.teleport('nee', point.x + 1, point.y + 1, point.z); }, crate);
    await scenePage.waitForFunction(() => document.querySelector('[data-testid="touch-grab"]')?.getAttribute('aria-label') === 'Grab');
    await scenePage.getByTestId('touch-grab').tap();
    await scenePage.waitForFunction(() => /Drop|Pass/.test(document.querySelector('[data-testid="touch-grab"]')?.getAttribute('aria-label') ?? ''));
    await scenePage.getByTestId('touch-controls').evaluate(el => el.dataset.integration = 'passed');
    notes.contextIntegration = 'near console: Hack opens puzzle; near crate: Grab becomes Drop/Pass';
  } finally { await sceneContext.close(); }
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const desktop = await desktopContext.newPage(); collectErrors(desktop, 'desktop', errors);
  try {
    await desktop.goto(url({ play: 'solo', stage: 'escape' })); await waitForGame(desktop);
    await desktop.addStyleTag({ content: '#dev-readout, #dev-controls { display: none !important; }' });
    await desktop.screenshot({ path: `${out}/after-1280x720-flight.png` });
    for (const variant of ['packet-routing', 'signal-match', 'memory-trace']) {
      await desktop.evaluate(kind => window.__autotest.debugOpenHack(kind), variant); await desktop.locator('.hack-panel').waitFor();
      await desktop.screenshot({ path: `${out}/after-1280x720-${variant}.png` }); await desktop.locator('.hack-cancel').click();
    }
  } finally { await desktopContext.close(); }
  assert(!errors.length, errors.join('\n'));
});
