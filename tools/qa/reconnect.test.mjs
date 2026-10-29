// (c) Reconnect: (1) guest WebSocket drops abnormally -> auto-reconnect, overlay clears, state agrees.
//                (2) guest reloads the page -> seat resumes (overlay and/or auto-rejoin).
import { Client } from '@colyseus/sdk';
import { runTest, url, assert, collectErrors, tryShot, until, waitForGame, createAndJoin, joinRoom, worldState, compareWorld, SERVER_URL } from './lib.mjs';

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
  for (const [n, pg] of [['host', host], ['guest', guest]]) { pg.on('crash', () => errors.push(`${n} CRASHED`)); }
  const code = await createAndJoin(host, guest);
  notes.room = code;
  await Promise.all([waitForGame(host), waitForGame(guest)]);
  await until('initial multiplayer state', async () => {
    const [hostWorld, guestWorld] = await Promise.all([worldState(host), worldState(guest)]);
    const hostHud = await host.getByTestId('network-hud').innerText({ timeout: 5_000 }).catch(() => '');
    const players = ['player-1', 'player-2'];
    const ok = players.every((id) => hostWorld.players[id] && guestWorld.players[id]) && !hostHud.includes('disconnected');
    return { ok, info: { hostPlayers: Object.keys(hostWorld.players), guestPlayers: Object.keys(guestWorld.players), hostHud } };
  }, 20_000);

  // --- 1. transient drop (QA closes the game socket with 4999; reconnect code must reclaim the seat) ---
  const dropped = await guest.evaluate(() => { const s = window.__qaSockets.filter((w) => w.readyState === 1 && !/vite|token=/.test(w.url) && !w.protocol.includes('vite')); s.forEach((w) => w.close(4999, 'qa-drop')); return s.length; });
  notes.socketsDropped = dropped;
  notes.socketUrls = await guest.evaluate(() => window.__qaSockets.map((w) => w.url.replace(/\?.*/, '')));
  assert(dropped >= 1, 'no game WebSocket was open to drop');
  const sawOverlay = await guest.getByTestId('partner-overlay').and(guest.locator('.visible')).waitFor({ timeout: 5_000 }).then(() => true, () => false);
  notes.guestOverlayDuringDrop = sawOverlay ? await guest.getByTestId('partner-overlay').innerText() : null;
  await tryShot(guest, 'reconnect-drop-guest');
  const recovered = await guest.waitForFunction(() => !document.querySelector('[data-testid=partner-overlay]')?.classList.contains('visible'), null, { timeout: 20_000 }).then(() => true, () => false);
  notes.dropRecovered = recovered;
  assert(recovered, 'guest did not auto-reconnect after socket drop (4999)');
  notes.hostHudAfterDrop = await until('host reconnect HUD', async () => {
    const hud = await host.getByTestId('network-hud').innerText({ timeout: 5_000 }).catch(() => '');
    return { ok: !hud.includes('disconnected'), info: hud };
  }, 20_000);
  await until('guest reconnect HUD', async () => {
    const hud = await guest.getByTestId('network-hud').innerText({ timeout: 5_000 }).catch(() => '');
    return { ok: hud.includes('NEE'), info: hud };
  }, 20_000);
  await guest.getByTestId('game-canvas').focus();
  await guest.keyboard.down('w'); await guest.waitForTimeout(800); await guest.keyboard.up('w');
  let agree1 = [];
  try {
    await until('world agreement after drop reconnect', async () => {
      try {
        agree1 = compareWorld(await worldState(host), await worldState(guest));
        return { ok: agree1.length === 0, info: agree1 };
      } catch (e) {
        agree1 = [String(e?.message ?? e)];
        throw e;
      }
    }, 15_000);
  } catch {
    // Assert below with the last issues observed by the poll.
  }
  notes.agreementAfterDrop = agree1;
  assert(agree1.length === 0, `clients disagreed after drop reconnect: ${agree1.join('; ')}`);
  notes.dropFixme = { name: 'auto-reconnect-after-drop', status: 'pass' };

  // --- 2. full reload: host may flash partner-overlay, or guest resumes so fast the overlay is skipped ---
  await guest.reload();
  const overlayShown = await host.waitForFunction(() => document.querySelector('[data-testid=partner-overlay]')?.classList.contains('visible'), null, { timeout: 8_000 }).then(() => true, () => false);
  notes.hostOverlayAfterGuestReload = (await host.getByTestId('partner-overlay').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  await tryShot(host, 'reconnect-reload-host-waiting');
  notes.reloadLandsOn = await guest.getByRole('heading').first().innerText().catch(() => '?');
  // Fast resume via sessionStorage + ?room= can beat the host overlay paint; either is success.
  const guestBackInGame = await guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: overlayShown ? 3_000 : 15_000 }).then(() => true, () => false);
  notes.reloadGuestInGame = guestBackInGame;
  assert(overlayShown || guestBackInGame, 'after guest reload: expected host overlay or guest already back in-game');

  // --- 3. rejoin after reload (sessionStorage token + ?room= / join UI) ---
  const REJOIN_EXPECTED = process.env.QA_EXPECT_REJOIN !== '0';
  const fixme = { name: 'rejoin-after-reload', expected: REJOIN_EXPECTED ? 'pass' : 'fail' };
  let rejoinedInGame = guestBackInGame;
  try {
    if (!rejoinedInGame) {
      const invite = new URL(url());
      invite.searchParams.set('room', code);
      await guest.goto(invite.toString());
      fixme.immediateRejoinStatus = (await guest.locator('.lobby-status').first().innerText().catch(() => '')).slice(0, 200);
      rejoinedInGame = await guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    }
    if (!rejoinedInGame) {
      await joinRoom(guest, code);
      rejoinedInGame = await guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    }
    if (!rejoinedInGame) {
      await guest.waitForTimeout(16_000);
      await joinRoom(guest, code);
      rejoinedInGame = await guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
      fixme.retriedAfterSeconds = 16;
    }
    fixme.rejoined = rejoinedInGame;
    if (rejoinedInGame) {
      await waitForGame(guest);
      let rejoinWaitTimedOut = false;
      fixme.guestHud = '';
      fixme.hostHud = '';
      fixme.agreement = [];
      try {
        await until('rejoin state', async () => {
          fixme.guestHud = await guest.getByTestId('network-hud').innerText({ timeout: 5_000 }).catch(() => '');
          fixme.hostHud = await host.getByTestId('network-hud').innerText({ timeout: 5_000 }).catch(() => '');
          try {
            fixme.agreement = compareWorld(await worldState(host), await worldState(guest));
          } catch (e) {
            fixme.agreement = [String(e?.message ?? e)];
            throw e;
          }
          const ok = fixme.guestHud.includes('NEE') && !fixme.hostHud.includes('disconnected') && fixme.agreement.length === 0;
          return { ok, info: { guestHud: fixme.guestHud, hostHud: fixme.hostHud, agreement: fixme.agreement } };
        }, 20_000);
      } catch (e) {
        rejoinWaitTimedOut = true;
        fixme.error = String(e.message).slice(0, 300);
      }
      fixme.ok = !rejoinWaitTimedOut && fixme.guestHud.includes('NEE') && !fixme.hostHud.includes('disconnected') && fixme.agreement.length === 0;
    } else {
      fixme.ok = false;
    }
  } catch (e) { fixme.ok = false; fixme.error = String(e.message).slice(0, 300); }
  if (rejoinedInGame) {
    await tryShot(guest, 'reconnect-rejoined-guest');
    await tryShot(host, 'reconnect-rejoined-host');
  }
  fixme.status = fixme.ok ? (REJOIN_EXPECTED ? 'pass' : 'XPASS') : (REJOIN_EXPECTED ? 'FAIL' : 'xfail');
  notes.fixme = fixme;
  assert(!(REJOIN_EXPECTED && !fixme.ok), `rejoin expected but failed: ${JSON.stringify(fixme)}`);

  // These clients have completed their assertions; release their renderers before
  // opening the independent banner case on the shared software GPU.
  await guestCtx.close();
  await hostCtx.close();

  // --- 4. partner drop banner (independent room and browser context) ---
  const bannerHostCtx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const bannerHost = await bannerHostCtx.newPage();
  collectErrors(bannerHost, 'banner-host', errors);
  await bannerHost.goto(url({ server: SERVER_URL }));
  await bannerHost.getByTestId('multiplayer').click();
  await bannerHost.getByTestId('create-room').click();
  const bannerCode = (await bannerHost.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
  const rawGuest = await new Client(SERVER_URL).joinById(bannerCode);
  let snapshotTimer;
  const sendRawSnapshot = (room) => {
    const players = room.state?.players;
    if (!players?.values) return;
    const player = [...players.values()].find((candidate) => candidate.playerId === room.sessionId);
    const position = player?.position;
    if (!position) return;
    room.send('snapshot', {
      position: { x: position.x, y: position.y, z: position.z },
      velocity: { x: 0, y: 0, z: 0 },
      orientation: { pitch: 0, yaw: 0, roll: 0 },
      boost: 'off', movement: 'idle', selfPowered: false, tetherPull: 0.9,
    });
  };
  const startSnapshots = (room) => {
    sendRawSnapshot(room);
    snapshotTimer = setInterval(() => sendRawSnapshot(room), 100);
  };
  const stopSnapshots = () => { if (snapshotTimer) clearInterval(snapshotTimer); snapshotTimer = undefined; };
  await Promise.all([
    waitForGame(bannerHost),
    until('raw guest sees both seats', () => ({ ok: rawGuest.state?.players?.size === 2, info: rawGuest.state?.players?.size }), 45_000),
  ]);
  await until('banner host sees connected partner', async () => {
    const status = await bannerHost.getByTestId('network-hud').innerText();
    const world = await worldState(bannerHost);
    return { ok: !!world.players['player-2'] && !status.includes('disconnected'), info: status };
  }, 45_000);
  startSnapshots(rawGuest);
  if (rawGuest.reconnection?.enabled !== undefined) rawGuest.reconnection.enabled = false;
  const token = rawGuest.reconnectionToken;
  assert(typeof token === 'string' && token.length > 0, 'raw guest has no reconnection token');
  stopSnapshots();
  rawGuest.connection.close(4999, 'qa-drop');
  const banner = bannerHost.getByTestId('partner-overlay').and(bannerHost.locator('.visible'));
  await banner.waitFor({ timeout: 45_000 });
  const shownText = await bannerHost.getByTestId('partner-overlay').innerText();
  assert(shownText.includes('Waiting for partner'), 'partner drop banner title missing');
  assert(shownText.includes('Timer paused'), 'partner drop banner timer text missing');
  await tryShot(bannerHost, 'reconnect-partner-banner');
  const back = await new Client(SERVER_URL).reconnect(token);
  startSnapshots(back);
  await bannerHost.waitForFunction(() => !document.querySelector('[data-testid=partner-overlay]')?.classList.contains('visible'), null, { timeout: 45_000 });
  stopSnapshots();
  notes.partnerBanner = { shownText, hiddenAfterRejoin: true };
  await back.leave(true).catch(() => {});
  await bannerHostCtx.close().catch(() => {});

  notes.errors = errors;
  assert(!errors.length, `errors:\n${errors.join('\n')}`);
  await guestCtx.close().catch(() => {});
  await hostCtx.close().catch(() => {});
});
