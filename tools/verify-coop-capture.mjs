/**
 * Two-client co-op capture / rescue: server marks capture, partner yank frees,
 * timeout frees on rescue failure. Spawns its own server with HANDSHAKE_TEST_HOOKS=1.
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawUrl = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/?scale=4&lowfx';
const SERVER_PORT = Number(process.env.COOP_CAPTURE_TEST_PORT ?? 2579);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function waitForPort(port, timeoutMs = 20_000) {
  const started = Date.now();
  return new Promise((resolveWait, reject) => {
    const tryConnect = () => {
      const socket = createConnection({ port, host: '127.0.0.1' }, () => {
        socket.end();
        resolveWait();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server did not listen on ${port} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(tryConnect, 150);
      });
    };
    tryConnect();
  });
}

function appUrlWithServer(serverHttp) {
  const url = new URL(rawUrl);
  url.searchParams.set('debug', '1');
  url.searchParams.set('autotest', '1');
  url.searchParams.set('server', serverHttp);
  return url.toString();
}

const caps = (page) => page.evaluate(() => window.__autotest?.security?.()?.captures ?? {});
const sec = (page) => page.evaluate(() => window.__autotest?.security?.() ?? null);

const server = spawn(process.execPath, ['--experimental-strip-types', resolve(root, 'server/index.mjs')], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(SERVER_PORT),
    HANDSHAKE_TEST_HOOKS: '1',
    EMPTY_ROOM_SECONDS: '120',
    LONELY_ROOM_SECONDS: '120',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});

const result = { test: 'coop-capture', pass: false, notes: {} };
const started = Date.now();
let host;
let guest;

try {
  await waitForPort(SERVER_PORT);
  const APP_URL = appUrlWithServer(`http://127.0.0.1:${SERVER_PORT}`);

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  host = await hostContext.newPage();
  guest = await guestContext.newPage();
  const errors = [];
  for (const [name, page] of [['host', host], ['guest', guest]]) {
    page.on('pageerror', (error) => errors.push(`${name} pageerror: ${error.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`);
    });
  }

  await host.addInitScript(() => localStorage.setItem('handshake.onboardingDone', '1'));
  await guest.addInitScript(() => localStorage.setItem('handshake.onboardingDone', '1'));
  await host.goto(APP_URL);
  await host.getByTestId('multiplayer').click();
  await host.getByTestId('create-room').click();
  const code = (await host.getByTestId('room-code').innerText()).trim();
  await guest.goto(APP_URL);
  await guest.getByTestId('multiplayer').click();
  await guest.getByTestId('join-room').click();
  await guest.getByTestId('room-code-input').fill(code);
  await guest.getByTestId('join-submit').click();
  for (const page of [host, guest]) {
    await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 60_000 });
    await page.waitForFunction(() => window.__autotest?.debugForceCapture, null, { timeout: 30_000 });
  }
  result.notes.room = code;

  await host.evaluate(() => window.__autotest.debugStage('escape'));
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__autotest.security().securityActive, null, { timeout: 10_000 });
  }

  // ── 1. Capture ────────────────────────────────────────────────────────
  await host.evaluate(() => window.__autotest.debugForceCapture('pix', 0));
  await host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 8_000 },
  );
  await guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 8_000 },
  );
  const [hCap, gCap] = await Promise.all([caps(host), caps(guest)]);
  assert(hCap.pix?.captured && gCap.pix?.captured, `capture disagree host=${JSON.stringify(hCap)} guest=${JSON.stringify(gCap)}`);
  assert(hCap.pix.capturedBy === 0 && gCap.pix.capturedBy === 0, 'capturedBy should be patrol 0');
  assert(!hCap.nee?.captured && !gCap.nee?.captured, 'NEE should still be free');
  result.notes.capture = { pix: hCap.pix };

  // ── 2. Rescue success ─────────────────────────────────────────────────
  const hold = hCap.pix;
  await guest.evaluate((p) => window.__autotest.teleport('nee', p.x + 1.5, p.y, p.z + 1.5), hold);
  await host.waitForTimeout(250);
  await guest.getByTestId('game-canvas').focus();
  await guest.keyboard.press('r');
  await host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 8_000 },
  );
  await guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 5_000 },
  );
  assert(!(await caps(host)).pix?.captured, 'PIX still captured after yank rescue');
  result.notes.rescueSuccess = true;

  // ── 3. Rescue failure (timeout window) ────────────────────────────────
  // Keep NEE far so a yank cannot succeed; confirm the carry timer advances,
  // then force the timeout free (same server path as CARRY_MAX expiry).
  await host.evaluate(() => window.__autotest.debugForceCapture('pix', 0));
  await host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 8_000 },
  );
  await guest.evaluate(() => window.__autotest.teleport('nee', -20, 3, -60));
  await host.waitForFunction(
    () => {
      const c = window.__autotest.security()?.captures?.pix;
      return c && c.captured === true && c.carryFor > 0.6;
    },
    null,
    { timeout: 8_000 },
  );
  const ticking = (await caps(host)).pix?.carryFor ?? 0;
  assert(ticking > 0.6, `carry timer did not advance (${ticking})`);
  await host.evaluate(() => window.__autotest.debugForceRelease('pix', 'timeout'));
  await host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 8_000 },
  );
  await guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 5_000 },
  );
  assert(!(await caps(host)).pix?.captured, 'PIX should be freed after rescue timeout');
  result.notes.rescueFailure = { carryFor: ticking, freed: true };

  // ── 4. Reconnect while captured ───────────────────────────────────────
  await host.evaluate(() => window.__autotest.debugForceCapture('nee', 1));
  await guest.waitForFunction(
    () => window.__autotest.security()?.captures?.nee?.captured === true,
    null,
    { timeout: 8_000 },
  );
  await guest.evaluate(() => window.__autotest.dropConnection());
  await guest.waitForFunction(
    () => window.__autotest.connectionState() === 'connected',
    null,
    { timeout: 20_000 },
  );
  await guest.waitForFunction(
    () => window.__autotest.security()?.captures?.nee?.captured === true,
    null,
    { timeout: 10_000 },
  );
  const [hRe, gRe] = await Promise.all([caps(host), caps(guest)]);
  assert(hRe.nee?.captured && gRe.nee?.captured, 'reconnect lost NEE capture state');
  result.notes.reconnectCaptured = true;

  await host.evaluate(() => window.__autotest.debugForceRelease('nee', 'yank'));

  result.notes.errors = errors.slice(0, 20);
  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
  result.pass = true;
  await hostContext.close();
  await guestContext.close();
} catch (e) {
  result.error = String(e?.message ?? e).slice(0, 1500);
  result.notes.serverLog = serverLog.slice(-1200);
  try {
    if (host) result.notes.lastHost = await sec(host);
    if (guest) result.notes.lastGuest = await sec(guest);
  } catch { /* ignore */ }
} finally {
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log('QA_RESULT ' + JSON.stringify(result));
  await browser.close().catch(() => {});
  server.kill('SIGTERM');
  process.exit(result.pass ? 0 : 1);
}
