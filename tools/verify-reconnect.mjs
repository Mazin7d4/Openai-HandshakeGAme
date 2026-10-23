// Two-client reconnect check: seat held during grace, restored after socket drop / reload,
// and partner-left after the grace window. Spawns its own server with a short RECONNECT_SECONDS
// so the expiry path stays fast without changing the default 30s production grace.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { freePort, startTestServer } from './test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawUrl = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/?scale=4&lowfx';
const GRACE_SECONDS = Number(process.env.RECONNECT_SECONDS ?? 5);
const SERVER_PORT = process.env.RECONNECT_TEST_PORT
  ? Number(process.env.RECONNECT_TEST_PORT)
  : await freePort();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function appUrlWithServer(serverHttp) {
  const url = new URL(rawUrl);
  url.searchParams.set('debug', '1');
  url.searchParams.set('autotest', '1');
  url.searchParams.set('server', serverHttp);
  return url.toString();
}

async function joinMatch(host, guest, appUrl) {
  await host.goto(appUrl);
  await host.getByTestId('multiplayer').click();
  await host.getByTestId('create-room').click();
  const code = (await host.getByTestId('room-code').innerText()).trim();
  assert(/^[A-Z2-9]{4}$/.test(code), `Unexpected room code: ${code}`);

  await guest.goto(appUrl);
  await guest.getByTestId('multiplayer').click();
  await guest.getByTestId('join-room').click();
  await guest.getByTestId('room-code-input').fill(code);
  await guest.getByTestId('join-submit').click();

  for (const page of [host, guest]) {
    await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 60_000 });
    await page.waitForFunction(() => window.__autotest?.dropConnection, null, { timeout: 30_000 });
  }
  return code;
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const result = {
  graceSeconds: GRACE_SECONDS,
  socketReconnect: false,
  reloadReconnect: false,
  partnerLeftAfterGrace: false,
};
let server;

try {
  server = await startTestServer({
    port: SERVER_PORT,
    root,
    env: {
      RECONNECT_SECONDS: String(GRACE_SECONDS),
      HANDSHAKE_TEST_HOOKS: '1',
      EMPTY_ROOM_SECONDS: '120',
      LONELY_ROOM_SECONDS: '120',
    },
  });
  const serverHttp = `http://127.0.0.1:${SERVER_PORT}`;
  const APP_URL = appUrlWithServer(serverHttp);

  // --- 1) Unexpected socket drop: seat returns within grace ---
  {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const code = await joinMatch(host, guest, APP_URL);
    result.roomCodeSocket = code;

    await host.getByTestId('partner-overlay').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
    await guest.evaluate(() => window.__autotest.dropConnection());

    await host.getByTestId('partner-overlay').filter({ hasText: 'Partner reconnecting' }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    await guest.getByTestId('partner-overlay').filter({ hasText: 'Reconnecting' }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });

    await guest.waitForFunction(() => window.__autotest.connectionState() === 'connected', null, {
      timeout: (GRACE_SECONDS + 10) * 1000,
    });
    await host.waitForFunction(() => window.__autotest.partnerConnected() === true, null, {
      timeout: (GRACE_SECONDS + 10) * 1000,
    });
    await host.getByTestId('partner-overlay').waitFor({ state: 'hidden', timeout: 10_000 });
    await guest.getByTestId('partner-overlay').waitFor({ state: 'hidden', timeout: 10_000 });
    assert((await host.getByTestId('network-hud').innerText()).includes('PIX'), 'Host lost PIX after reconnect.');
    assert((await guest.getByTestId('network-hud').innerText()).includes('NEE'), 'Guest lost NEE after reconnect.');
    result.socketReconnect = true;
    await hostContext.close();
    await guestContext.close();
  }

  // --- 2) Page reload / invite link: sessionStorage token restores the seat ---
  {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const code = await joinMatch(host, guest, APP_URL);
    result.roomCodeReload = code;

    const invite = new URL(APP_URL);
    invite.searchParams.set('room', code);

    await guest.reload({ waitUntil: 'domcontentloaded' });
    // Same-tab reload keeps sessionStorage; bootFromInviteLink should resume via ?room=.
    await guest.waitForFunction(() => window.location.search.includes(`room=${code}`), null, { timeout: 5_000 }).catch(() => undefined);
    if (!guest.url().includes(`room=${code}`)) {
      await guest.goto(invite.toString());
    }

    await guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    await guest.locator('#boot-status').waitFor({ state: 'detached', timeout: 60_000 });
    await guest.waitForFunction(() => window.__autotest?.partnerConnected != null, null, { timeout: 30_000 });
    await host.waitForFunction(() => window.__autotest.partnerConnected() === true, null, {
      timeout: (GRACE_SECONDS + 15) * 1000,
    });
    await guest.waitForFunction(() => window.__autotest.connectionState() === 'connected', null, {
      timeout: 15_000,
    });
    assert((await guest.getByTestId('network-hud').innerText()).includes('NEE'), 'Reload did not restore NEE seat.');
    result.reloadReconnect = true;
    await hostContext.close();
    await guestContext.close();
  }

  // --- 3) Grace expiry → existing partner-left path ---
  {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    await joinMatch(host, guest, APP_URL);

    await guestContext.close();
    await host.getByTestId('partner-overlay').filter({ hasText: 'Partner reconnecting' }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    await host.getByTestId('partner-overlay').filter({ hasText: /PARTNER LEFT|did not come back/i }).waitFor({
      state: 'visible',
      timeout: (GRACE_SECONDS + 12) * 1000,
    });
    await host.getByTestId('network-hud').filter({ hasText: 'Partner disconnected' }).waitFor({
      state: 'visible',
      timeout: 5_000,
    });
    result.partnerLeftAfterGrace = true;
    await hostContext.close();
  }

  result.pass = result.socketReconnect && result.reloadReconnect && result.partnerLeftAfterGrace;
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
} catch (error) {
  result.pass = false;
  result.error = error instanceof Error ? error.message : String(error);
  result.serverLog = server?.log().slice(-2_000);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => undefined);
  await server?.stop();
}
