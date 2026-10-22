// (c) Reconnect: (1) guest WebSocket drops abnormally -> auto-reconnect, overlay clears, state agrees.
//                (2) guest reloads the page -> can it rejoin the same room and get NEE back?
import { runTest, url, assert, collectErrors, shot, waitForGame, createAndJoin, joinRoom, worldState, compareWorld } from './lib.mjs';

const TRACK_WS = () => {
  const Native = window.WebSocket; window.__qaSockets = [];
  window.WebSocket = class extends Native { constructor(...a) { super(...a); window.__qaSockets.push(this); } };
};

await runTest('reconnect', async (browser, notes) => {
  const errors = [];
  const hostCtx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const guestCtx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await guestCtx.addInitScript(TRACK_WS);
  const host = await hostCtx.newPage(); const guest = await guestCtx.newPage();
  collectErrors(host, 'host', errors); collectErrors(guest, 'guest', errors);
  for (const [n, pg] of [['host', host], ['guest', guest]]) { pg.on('crash', () => errors.push(`${n} CRASHED`)); pg.on('close', () => errors.push(`${n} closed`)); }
  const code = await createAndJoin(host, guest);
  notes.room = code;
  await Promise.all([waitForGame(host), waitForGame(guest)]);
  await host.waitForTimeout(1500);

  // --- 1. transient drop ---
  const dropped = await guest.evaluate(() => { const s = window.__qaSockets.filter((w) => w.readyState === 1 && !/vite|token=/.test(w.url) && !w.protocol.includes('vite')); s.forEach((w) => w.close(4999, 'qa-drop')); return s.length; });
  notes.socketsDropped = dropped;
  notes.socketUrls = await guest.evaluate(() => window.__qaSockets.map((w) => w.url.replace(/\?.*/, '')));
  const sawOverlay = await guest.getByTestId('partner-overlay').and(guest.locator('.visible')).waitFor({ timeout: 5_000 }).then(() => true, () => false);
  notes.guestOverlayDuringDrop = sawOverlay ? await guest.getByTestId('partner-overlay').innerText() : null;
  await shot(guest, 'reconnect-drop-guest');
  const recovered = await guest.waitForFunction(() => !document.querySelector('[data-testid=partner-overlay]')?.classList.contains('visible'), null, { timeout: 20_000 }).then(() => true, () => false);
  notes.dropRecovered = recovered;
  await host.waitForTimeout(1500);
  const hudAfterDrop = await host.getByTestId('network-hud').innerText();
  notes.hostHudAfterDrop = hudAfterDrop;
  await guest.getByTestId('game-canvas').focus();
  await guest.keyboard.down('w'); await guest.waitForTimeout(800); await guest.keyboard.up('w');
  await host.waitForTimeout(1200);
  const agree1 = compareWorld(await worldState(host), await worldState(guest));
  notes.agreementAfterDrop = agree1;

  // --- 2. full reload: partner overlay must appear on host (required) ---
  await guest.reload();
  const overlayShown = await host.waitForFunction(() => document.querySelector('[data-testid=partner-overlay]')?.classList.contains('visible'), null, { timeout: 10_000 }).then(() => true, () => false);
  notes.hostOverlayAfterGuestReload = (await host.getByTestId('partner-overlay').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  await shot(host, 'reconnect-reload-host-waiting');
  notes.reloadLandsOn = await guest.getByRole('heading').first().innerText().catch(() => '?');

  // --- 3. FIXME / expected-fail until prod-net ships rejoin + state restore ---
  // When it lands: flip REJOIN_EXPECTED to true (or set QA_EXPECT_REJOIN=1) so a failure becomes a real failure.
  const REJOIN_EXPECTED = process.env.QA_EXPECT_REJOIN === '1';
  const fixme = { name: 'rejoin-after-reload', expected: REJOIN_EXPECTED ? 'pass' : 'fail' };
  try {
    await joinRoom(guest, code);
    await guest.waitForTimeout(3000);
    fixme.immediateRejoinStatus = (await guest.locator('.lobby-status').first().innerText().catch(() => '')).slice(0, 200);
    let inGame = await guest.getByTestId('game-canvas').isVisible().catch(() => false);
    if (!inGame) {
      await guest.waitForTimeout(16_000); // server holds the seat RECONNECT_SECONDS=15
      await joinRoom(guest, code);
      inGame = await guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
      fixme.retriedAfterSeconds = 16;
    }
    fixme.rejoined = inGame;
    if (inGame) {
      await waitForGame(guest);
      await host.waitForTimeout(2500);
      fixme.guestHud = await guest.getByTestId('network-hud').innerText();
      fixme.hostHud = await host.getByTestId('network-hud').innerText();
      fixme.agreement = compareWorld(await worldState(host), await worldState(guest));
      await shot(guest, 'reconnect-rejoined-guest'); await shot(host, 'reconnect-rejoined-host');
    }
    fixme.ok = inGame && fixme.guestHud.includes('NEE') && !fixme.hostHud.includes('disconnected') && fixme.agreement.length === 0;
  } catch (e) { fixme.ok = false; fixme.error = String(e.message).slice(0, 300); }
  fixme.status = fixme.ok ? (REJOIN_EXPECTED ? 'pass' : 'XPASS') : (REJOIN_EXPECTED ? 'FAIL' : 'xfail');
  notes.fixme = fixme;

  assert(recovered, 'guest did not auto-recover from a transient socket drop');
  assert(agree1.length === 0, `disagreement after drop: ${agree1.join('; ')}`);
  assert(overlayShown, 'host did not show partner-disconnected overlay after guest reload');
  assert(!(REJOIN_EXPECTED && !fixme.ok), `rejoin expected but failed: ${JSON.stringify(fixme)}`);
  notes.errors = errors;
});
