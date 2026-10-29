import { mkdirSync } from 'node:fs';
import { runTest, url, assert, collectErrors, waitForGame, createAndJoin } from './lib.mjs';

const out = process.env.QA_TOUCH_SHOTS ?? '/workspace/handshake/sprint/playtest/touch';
mkdirSync(out, { recursive: true });
const sizes = [[1024, 461], [844, 390], [740, 360], [932, 430], [390, 844], [1280, 720]];

await runTest('phone-overlays', async (browser, notes) => {
  const errors = [];
  const hostContext = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await hostContext.addInitScript(() => localStorage.setItem('handshake.rotateHintDismissed', '1'));
  const guestContext = await browser.newContext({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  collectErrors(host, 'host overlays', errors);
  try {
    await createAndJoin(host, guest);
    await Promise.all([waitForGame(host), waitForGame(guest)]);
    const skip = host.getByTestId('onboarding-skip'); if (await skip.isVisible()) await skip.click();
    await host.addStyleTag({ content: '#dev-readout, #dev-controls { opacity: 0 !important; }' });
    const guestSkip = guest.getByTestId('onboarding-skip'); if (await guestSkip.isVisible()) await guestSkip.click();
    await guest.waitForFunction(() => document.querySelector('[data-testid="touch-controls"]')?.dataset.role === 'nee');
    await guest.locator('#dev-readout, #dev-controls').evaluateAll(nodes => nodes.forEach(el => el.style.setProperty('opacity', '0', 'important')));
    await guest.screenshot({ path: `${out}/after-844x390-nee-coop.png` });
    await guestContext.close();
    const overlay = host.getByTestId('partner-overlay');
    await overlay.waitFor({ state: 'visible' });
    const capture = async label => {
      for (const [width, height] of sizes) {
        await host.setViewportSize({ width, height });
        const problems = await overlay.evaluate(root => {
          const r = root.getBoundingClientRect(), problems = [];
          const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
          if (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight) problems.push('banner offscreen');
          if (intersects(r, { x: innerWidth * .25, y: innerHeight * .25, right: innerWidth * .75, bottom: innerHeight * .75 })) problems.push('banner covers centre');
          for (const el of document.querySelectorAll('.touch-controls button, .touch-stick')) {
            if (el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && intersects(r, el.getBoundingClientRect())) problems.push(`banner overlaps ${el.dataset.testid}`);
          }
          for (const button of root.querySelectorAll('button')) {
            if (!button.checkVisibility()) continue;
            const b = button.getBoundingClientRect();
            if (b.width < 48 || b.height < 48) problems.push('banner action below 48px');
          }
          return problems;
        });
        assert(!problems.length, `${width}x${height} ${label}: ${problems.join('; ')}`);
        await host.screenshot({ path: `${out}/after-${width}x${height}-${label}.png` });
      }
    };
    await capture('waiting-partner');
    await host.locator('.partner-title').filter({ hasText: 'Partner left' }).waitFor({ timeout: 45_000 });
    await capture('partner-left');
    notes.screens = sizes.length * 2;
    assert(!errors.length, errors.join('\n'));
  } finally { await hostContext.close(); await guestContext.close().catch(() => {}); }
});
