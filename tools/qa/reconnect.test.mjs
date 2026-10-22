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
  const code = await createAndJoin(host, guest);
  notes.room = code;
  await Promise.all([waitForGame(host), waitForGame(guest)]);
  await host.waitForTimeout(1500);

  // --- 1. transient drop ---
  const dropped = await guest.evaluate(() => { const s = window.__qaSockets.filter((w) => w.readyState === 1); s.forEach((w) => w.close(4999, 'qa-drop')); return s.length; });
  notes.socketsDropped = dropped;
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

  // --- 2. full reload ---
  await guest.reload();
  await host.waitForTimeout(1500);
  const hostOverlay = await host.getByTestId('partner-overlay').innerText().catch(() => '');
  notes.hostOverlayAfterGuestReload = hostOverlay.replace(/\s+/g, ' ').trim();
  await shot(host, 'reconnect-reload-host-waiting');
  notes.reloadLandsOn = await guest.getByRole('heading').first().innerText().catch(() => '?');
  await joinRoom(guest, code);
  const immediateStatus = await guest.locator('.lobby-status').innerText({ timeout: 8_000 }).catch(() => '');
  await guest.waitForTimeout(3000);
  notes.immediateRejoin = (await guest.locator('.lobby-status, [data-testid=lobby-status]').first().innerText().catch(() => immediateStatus)).slice(0, 200);
  let inGame = await guest.getByTestId('game-canvas').isVisible().catch(() => false);
  if (!inGame) {
    // Seat is held for RECONNECT_SECONDS (15s) on the server; retry after it expires.
    await guest.waitForTimeout(16_000);
    await joinRoom(guest, code);
    inGame = await guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
    notes.rejoinNeededWaitSeconds = 16;
  }
  notes.rejoinedAfterReload = inGame;
  assert(inGame, `guest could not rejoin room ${code} after reload: ${notes.immediateRejoin}`);
  await waitForGame(guest);
  await host.waitForTimeout(2500);
  notes.guestHudAfterRejoin = await guest.getByTestId('network-hud').innerText();
  notes.hostHudAfterRejoin = await host.getByTestId('network-hud').innerText();
  const [h, g] = await Promise.all([worldState(host), worldState(guest)]);
  notes.agreementAfterRejoin = compareWorld(h, g);
  await shot(guest, 'reconnect-rejoined-guest'); await shot(host, 'reconnect-rejoined-host');
  assert(recovered, 'guest did not auto-recover from a transient socket drop');
  assert(notes.guestHudAfterRejoin.includes('NEE'), `guest role after rejoin: ${notes.guestHudAfterRejoin}`);
  assert(!notes.hostHudAfterRejoin.includes('disconnected'), `host still shows partner disconnected: ${notes.hostHudAfterRejoin}`);
  assert(agree1.length === 0 && notes.agreementAfterRejoin.length === 0, `disagreement: ${[...agree1, ...notes.agreementAfterRejoin].join('; ')}`);
  notes.errors = errors;
});
