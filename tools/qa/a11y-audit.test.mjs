// UI + integration evidence: visible modal focus and input-specific first-run coaching.
import { runTest, url, assert } from './lib.mjs';

await runTest('a11y-audit', async (browser, notes) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto(url());
    await page.getByTestId('title-settings').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.waitFor();
    for (let n = 0; n < 20; n++) {
      await page.keyboard.press(n % 2 ? 'Shift+Tab' : 'Tab');
      assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'Settings lost modal keyboard focus');
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await page.getByTestId('singleplayer').waitFor();
    notes.modalFocus = true;

    const mount = async mode => page.evaluate(async mode => {
      localStorage.removeItem('handshake.onboardingDone');
      const { OnboardingCoach } = await import('/src/ui/OnboardingCoach.ts');
      const { markGamepadActivity } = await import('/src/ui/inputHints.ts');
      window.coachFixture?.coach.dispose();
      const parent = document.createElement('div'); parent.style.cssText = 'position:fixed;inset:0';
      document.body.replaceChildren(parent);
      let now = 100; Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
      const axes = { thrust: 0, strafe: 0, lift: 0, boost: false };
      const actions = { interact: false, grabDrop: false, throwObject: false, switchDrone: false, yank: false, pause: false };
      const coach = new OnboardingCoach(parent, mode);
      window.coachFixture = { coach, axes, actions, markGamepadActivity, tick: () => { now += 10000; coach.observe(axes, actions); } };
    }, mode);
    await mount('singleplayer');
    const prompt = page.locator('.onboarding-coach__prompt');
    await page.evaluate(() => { const f = window.coachFixture; f.markGamepadActivity(); f.coach.observe(f.axes, f.actions); });
    assert(!/W A S D|WASD/.test(await page.getByTestId('onboarding-coach').innerText()), 'controller coach still teaches keyboard bindings');
    assert(/stick|LS/i.test(await page.getByTestId('onboarding-coach').innerText()), 'controller coach has no flight binding');
    // Switch is available only in the developer two-drone mode, never solo CPU mode.
    await page.evaluate(() => { const f = window.coachFixture; f.coach.observe({ ...f.axes, thrust: 1 }, f.actions); f.coach.observe({ ...f.axes, lift: 1 }, f.actions); });
    assert(!/Switch drone/.test(await prompt.innerText()), 'solo coach teaches an unavailable drone switch');
    const mutations = await page.evaluate(() => {
      const f = window.coachFixture; let count = 0;
      const observer = new MutationObserver(records => count += records.length);
      observer.observe(document.querySelector('[data-testid="onboarding-coach"]'), { subtree: true, childList: true, characterData: true, attributes: true });
      for (let n = 0; n < 120; n++) f.coach.observe(f.axes, f.actions);
      count += observer.takeRecords().length; observer.disconnect(); return count;
    });
    assert(mutations === 0, `idle coach changed DOM ${mutations} times`);
    await mount('singleplayer');
    await page.evaluate(() => { for (let n = 0; n < 6; n++) window.coachFixture.tick(); });
    assert(!/you.ve got it|mastered/i.test(await prompt.innerText()), 'timed-out coach claims mastery without input');
    notes.coach = { controllerBindings: true, soloSwitchExcluded: true, idleMutations: mutations, timeoutHonest: true };
    await page.evaluate(() => window.coachFixture.coach.dispose());
    await page.setViewportSize({ width: 740, height: 360 });
    await page.evaluate(async () => {
      const { HeistReport, demoRunStats } = await import('/src/ui/HeistReport.ts');
      const { TouchControls } = await import('/src/ui/TouchControls.ts');
      const { VirtualControlInput } = await import('/src/input/VirtualControlInput.ts');
      const parent = document.createElement('div'); parent.className = 'touch-play';
      parent.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(parent);
      const noop = () => {};
      const controls = new TouchControls(parent, { virtual: new VirtualControlInput(), solo: true,
        onGrab: noop, onInteract: noop, onYank: noop, onPause: noop, onSwitch: noop,
        camera: { touchLook: noop, touchLookHold: noop, touchLookRelease: noop, touchZoom: noop, touchRecenter: noop } });
      const report = new HeistReport(parent, { onPlayAgain: noop, onLeave: noop });
      report.show(demoRunStats()); window.reportFixture = { report, controls };
    });
    await page.getByTestId('mission-complete').waitFor({ state: 'visible' });
    assert(!await page.getByTestId('touch-controls').isVisible(), 'flight controls cover the Heist Report');
    const clipped = await page.locator('.heist-report__actions button').evaluateAll(nodes => nodes.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
    assert(!clipped.length, `report button text clipped: ${clipped.join(', ')}`);
    await page.evaluate(() => window.reportFixture.report.hide());
    assert(await page.getByTestId('touch-controls').isVisible(), 'closing report did not restore flight controls');
    await page.evaluate(() => { window.reportFixture.report.dispose(); window.reportFixture.controls.dispose(); });
    notes.reportModal = { flightSuppressed: true, textFits: true, restoresFlight: true };
  } finally { await context.close(); }
});
