// (d) Mobile smoke: iPhone 13 emulation (touch), portrait 390x844 and landscape 844x390.
// Checks menu tap flow, in-game HUD overlap/off-screen clipping, tap-target size and whether touch controls exist.
import { runTest, url, assert, collectErrors, shot, waitForGame, layoutAudit, devices } from './lib.mjs';

await runTest('mobile', async (browser, notes) => {
  const errors = [];
  for (const [label, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport, screen: viewport });
    const page = await ctx.newPage();
    collectErrors(page, label, errors);
    await page.goto(url());
    await page.getByRole('heading', { name: 'Choose a mode' }).waitFor({ timeout: 20_000 });
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
      return { touchUiElements: hits.length, maxTouchPoints: navigator.maxTouchPoints };
    });
    // Does a one-finger drag do anything? (camera needs two fingers per FIRST_MISSION)
    notes[label] = { menu, game, touch };
    await ctx.close();
  }
  notes.errors = errors;
  // Hard failures: menu must be fully usable on both orientations.
  for (const o of ['portrait', 'landscape']) {
    assert(notes[o].menu.offscreen.filter((s) => /button|singleplayer|multiplayer/.test(s)).length === 0, `${o}: menu buttons off-screen ${notes[o].menu.offscreen}`);
  }
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
});
