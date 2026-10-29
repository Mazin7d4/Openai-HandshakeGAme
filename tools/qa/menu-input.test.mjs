import { runTest, url, assert, collectErrors } from './lib.mjs';

await runTest('menu-input', async (browser, notes) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__menuPad = { id: 'QA standard controller', index: 0, timestamp: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__menuPad] });
  });
  const page = await context.newPage();
  const errors = collectErrors(page, 'menu-input', []);
  try {
    await page.goto(url()); await page.getByTestId('title-settings').click();
    const press = async (button, predicate) => {
      // Observe at least one menu polling frame for both edges, instead of a fixed sleep.
      await page.evaluate(button => { window.__menuPad.buttons[button] = { pressed: true, value: 1 }; }, button);
      try { await predicate(); } finally {
        await page.evaluate(button => new Promise(resolve => {
          window.__menuPad.buttons[button] = { pressed: false, value: 0 };
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }), button);
      }
    };
    await page.getByTestId('settings-master').focus();
    const before = Number(await page.getByTestId('settings-master').inputValue());
    await press(15, () => page.waitForFunction(before => Number(document.querySelector('[data-testid="settings-master"]').value) > before, before));
    const after = Number(await page.getByTestId('settings-master').inputValue());
    assert(after > before, 'D-pad right did not adjust volume');
    const ring = await page.getByTestId('settings-master').evaluate(el => {
      const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
    });
    assert(ring, 'gamepad focus has no visible ring');
    await press(13, () => page.waitForFunction(() => document.activeElement?.dataset.testid === 'settings-music'));
    await page.getByTestId('settings-mute').focus();
    await press(0, () => page.waitForFunction(() => document.querySelector('[data-testid="settings-mute"]').checked));
    await page.getByTestId('settings-tab-visuals').click();
    await page.getByTestId('settings-graphics').focus();
    await press(15, () => page.waitForFunction(() => document.querySelector('[data-testid="settings-graphics"]').value === 'low'));
    // Roving tab index: Tab moves into the selected panel, arrows change tab.
    await page.getByTestId('settings-tab-visuals').focus(); await page.keyboard.press('ArrowRight');
    assert(await page.getByTestId('settings-tab-accessibility').getAttribute('aria-selected') === 'true', 'arrow did not select next Settings tab');
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.dataset.testid);
    assert(active === 'settings-colour-blind', `Tab visited inactive Settings tab: ${active}`);
    await press(1, () => page.getByTestId('singleplayer').waitFor({ state: 'visible' }));
    notes.controls = { volume: [before, after], select: 'low', toggle: true, gamepadBack: true, rovingTabs: true };
    notes.errors = errors;
    assert(!errors.length, `console/page errors:\n${errors.join('\n')}`);
  } finally { await context.close(); }
});
