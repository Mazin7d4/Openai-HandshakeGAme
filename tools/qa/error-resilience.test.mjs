// Error resilience & build info QA: verifies WebGL context loss handling,
// global error boundary with friendly recovery card, and settings build identifier.
import { runTest, url, assert, collectErrors, openPage, closePage, waitForGame, tryShot } from './lib.mjs';

await runTest('error-resilience', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  const errors = [];
  collectErrors(page, 'resilience', errors);

  await page.goto(url());

  // 1. Verify build sha in settings menu
  await page.getByTestId('title-settings').waitFor({ timeout: 20_000 });
  await page.getByTestId('title-settings').click();
  await page.getByTestId('settings-menu').waitFor({ state: 'visible' });
  const versionEl = page.getByTestId('settings-version');
  await versionEl.waitFor({ state: 'visible' });
  const versionText = await versionEl.innerText();
  notes.versionText = versionText;
  assert(/PIX & NEE · build [a-f0-9]{7}/.test(versionText), `unexpected version line: "${versionText}"`);
  await page.getByTestId('settings-back').click();

  // 2. Start game and test WebGL context lost event
  await page.getByTestId('singleplayer').click();
  await page.getByTestId('start-singleplayer').click();
  await waitForGame(page);

  // Trigger webglcontextlost on the canvas
  const lostHandled = await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return false;
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    return event.defaultPrevented;
  });
  notes.lostPreventDefault = lostHandled;
  assert(lostHandled === true, 'webglcontextlost did not preventDefault to allow restoration');

  // 3. Test global error boundary fallback
  await page.evaluate(() => {
    window.__triggerFatalError?.('Simulated test error: GPU out of memory');
  });

  const banner = page.getByTestId('global-error-fallback');
  await banner.waitFor({ state: 'visible', timeout: 5_000 });
  const cardText = await banner.innerText();
  notes.bannerText = cardText;
  assert(cardText.includes('Something went wrong'), `unexpected banner text: "${cardText}"`);
  assert(cardText.includes('Reload game'), 'missing reload button');
  await tryShot(page, 'global-error-fallback');

  const unexpectedErrors = errors.filter((e) => !/WebGL context lost|Simulated test error/i.test(e));
  assert(unexpectedErrors.length === 0, `unexpected errors logged: ${unexpectedErrors.join('; ')}`);
  await closePage(page);
});
