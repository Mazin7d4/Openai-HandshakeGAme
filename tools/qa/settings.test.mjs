// Settings persist across reload: change a value, reload, confirm it stuck.
import { runTest, url, assert, collectErrors, shot } from './lib.mjs';

await runTest('settings', async (browser, notes) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = collectErrors(page, 'settings', []);
  await page.goto(url());
  await page.getByTestId('title-settings').waitFor({ timeout: 20_000 });
  await page.getByTestId('title-settings').click();
  await page.getByTestId('settings-menu').waitFor({ state: 'visible' });
  await page.getByTestId('settings-tab-visuals').click();
  const shake = page.getByTestId('settings-shake');
  await shake.waitFor();
  const before = await shake.isChecked();
  await shake.click();
  const after = await shake.isChecked();
  assert(after !== before, 'screen shake toggle did not change');
  notes.shakeBefore = before;
  notes.shakeAfter = after;
  await shot(page, 'settings-menu-1280');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('title-settings').waitFor({ timeout: 20_000 });
  await page.getByTestId('title-settings').click();
  await page.getByTestId('settings-menu').waitFor({ state: 'visible' });
  await page.getByTestId('settings-tab-visuals').click();
  const persisted = await page.getByTestId('settings-shake').isChecked();
  assert(persisted === after, `screen shake did not persist (want ${after}, got ${persisted})`);
  notes.shakePersisted = persisted;

  // Touch camera keys via CameraTouchSettings — force touch detection for this page.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
  });
  await page.getByTestId('settings-back').click();
  await page.getByTestId('title-settings').click();
  await page.getByTestId('settings-tab-controls').click();
  const touchSens = page.getByTestId('settings-touch-sensitivity');
  assert(await touchSens.count() === 1, 'touch camera sensitivity missing on touch device');
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="settings-touch-sensitivity"]');
    if (!(el instanceof HTMLInputElement)) throw new Error('missing touch sensitivity');
    el.value = '1.4';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const stored = await page.evaluate(() => localStorage.getItem('pixnee.touch.camSensitivity'));
  assert(stored === '1.4', `expected pixnee.touch.camSensitivity=1.4, got ${stored}`);
  notes.touchSensitivity = stored;

  await page.getByTestId('settings-touch-invert-y').click();
  const invertStored = await page.evaluate(() => localStorage.getItem('pixnee.touch.invertY'));
  assert(invertStored === '1', `expected pixnee.touch.invertY=1, got ${invertStored}`);
  notes.touchInvertY = invertStored;

  notes.errors = errors;
  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
});
