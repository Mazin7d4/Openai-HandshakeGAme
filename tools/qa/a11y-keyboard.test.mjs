// Keyboard-only: main menu → solo run, open/close Settings, a11y prefs persist across reload.
import { runTest, url, assert, collectErrors, shot, waitForGame, openPage, closePage } from './lib.mjs';

await runTest('a11y-keyboard', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  const errors = collectErrors(page, 'a11y-keyboard', []);
  await page.goto(url());
  await page.getByTestId('singleplayer').waitFor({ timeout: 20_000 });

  // Primary CTA should already hold focus on the title screen.
  const focusedAtStart = await page.evaluate(() => document.activeElement?.dataset?.testid ?? '');
  notes.initialFocus = focusedAtStart;
  assert(focusedAtStart === 'singleplayer', `expected Play now focused, got ${focusedAtStart}`);

  // Tab to Settings and open it with Enter (keyboard only).
  let guard = 0;
  while (guard++ < 12) {
    const id = await page.evaluate(() => document.activeElement?.dataset?.testid ?? '');
    if (id === 'title-settings') break;
    await page.keyboard.press('Tab');
  }
  const onSettings = await page.evaluate(() => document.activeElement?.dataset?.testid ?? '');
  assert(onSettings === 'title-settings', `could not Tab to Settings (on ${onSettings})`);
  await page.keyboard.press('Enter');
  await page.getByTestId('settings-menu').waitFor({ state: 'visible', timeout: 10_000 });
  notes.settingsOpened = true;

  // Tab to Visuals, enable reduced motion + set UI text size, then Access for colourblind.
  await page.getByTestId('settings-tab-visuals').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('settings-reduced-motion').waitFor({ state: 'visible' });

  await page.getByTestId('settings-reduced-motion').focus();
  const reducedBefore = await page.getByTestId('settings-reduced-motion').isChecked();
  if (!reducedBefore) await page.keyboard.press('Space');
  assert(await page.getByTestId('settings-reduced-motion').isChecked(), 'reduced motion not enabled');

  await page.getByTestId('settings-ui-scale').selectOption('125');
  notes.uiScaleSet = '125';

  await page.getByTestId('settings-tab-accessibility').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('settings-colour-blind').waitFor({ state: 'visible' });
  await page.getByTestId('settings-colour-blind').focus();
  if (!(await page.getByTestId('settings-colour-blind').isChecked())) {
    await page.keyboard.press('Space');
  }
  assert(await page.getByTestId('settings-colour-blind').isChecked(), 'colourblind cues not enabled');

  const stored = await page.evaluate(() => ({
    reduced: localStorage.getItem('pixnee.a11y.reducedMotion'),
    colour: localStorage.getItem('pixnee.a11y.colourBlindSafe'),
    scale: localStorage.getItem('pixnee.a11y.uiScale'),
  }));
  notes.a11yStored = stored;
  assert(stored.reduced === '1', `pixnee.a11y.reducedMotion want 1 got ${stored.reduced}`);
  assert(stored.colour === '1', `pixnee.a11y.colourBlindSafe want 1 got ${stored.colour}`);
  assert(stored.scale === '125', `pixnee.a11y.uiScale want 125 got ${stored.scale}`);

  // Esc closes Settings and returns to the title menu.
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-menu').waitFor({ state: 'detached', timeout: 10_000 }).catch(async () => {
    // Overlay may stay in DOM briefly; ensure title CTA is back.
    await page.getByTestId('singleplayer').waitFor({ state: 'visible', timeout: 10_000 });
  });
  await page.getByTestId('singleplayer').waitFor({ state: 'visible', timeout: 10_000 });
  notes.settingsClosed = true;

  // Reload — a11y keys must still be present, and Settings reflects them.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('title-settings').waitFor({ timeout: 20_000 });
  const afterReload = await page.evaluate(() => ({
    reduced: localStorage.getItem('pixnee.a11y.reducedMotion'),
    colour: localStorage.getItem('pixnee.a11y.colourBlindSafe'),
    scale: localStorage.getItem('pixnee.a11y.uiScale'),
    uiScaleAttr: document.documentElement.dataset.uiScale,
    colourBlindAttr: document.documentElement.dataset.colourBlind,
    reducedAttr: document.documentElement.dataset.reducedMotion,
  }));
  notes.afterReload = afterReload;
  assert(afterReload.reduced === '1', 'reduced motion did not persist across reload');
  assert(afterReload.colour === '1', 'colourblind did not persist across reload');
  assert(afterReload.scale === '125', 'ui scale did not persist across reload');
  assert(afterReload.uiScaleAttr === '125', 'html data-ui-scale not applied');
  assert(afterReload.colourBlindAttr === '1', 'html data-colour-blind not applied');

  // Keyboard path into a solo run: Tab to Play now → Enter → Start → Enter.
  await page.getByTestId('singleplayer').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('start-singleplayer').waitFor({ timeout: 10_000 });
  const soloFocus = await page.evaluate(() => document.activeElement?.dataset?.testid ?? '');
  notes.soloFocus = soloFocus;
  assert(soloFocus === 'start-singleplayer', `expected Start focused, got ${soloFocus}`);
  await page.keyboard.press('Enter');
  await waitForGame(page);
  notes.soloStarted = true;
  await shot(page, 'a11y-keyboard-solo');

  notes.errors = errors;
  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
  await closePage(page);
});
