/**
 * Two-client co-op capture / rescue: server marks capture, partner yank frees,
 * timeout frees on rescue failure. Spawns its own server with HANDSHAKE_TEST_HOOKS=1.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { freePort, startTestServer } from './test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawUrl = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/?scale=4&lowfx';
const SERVER_PORT = process.env.COOP_CAPTURE_TEST_PORT
  ? Number(process.env.COOP_CAPTURE_TEST_PORT)
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

const caps = (page) => page.evaluate(() => window.__autotest?.security?.()?.captures ?? {});
const sec = (page) => page
  ? page.evaluate(() => window.__autotest?.security?.() ?? null)
  : Promise.resolve(null);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});

const result = { test: 'coop-capture', pass: false, notes: {} };
const started = Date.now();
let server;
let host;
let guest;

const readoutPositions = (page) => (page ? page.evaluate(() => {
  const text = document.querySelector('#dev-readout')?.textContent ?? '';
  const players = {};
  for (const m of text.matchAll(/(player-\d)\s+x\s+(-?\d+\.\d)\s+y\s+(-?\d+\.\d)\s+z\s+(-?\d+\.\d)/g)) {
    players[m[1]] = { x: +m[2], y: +m[3], z: +m[4] };
  }
  return { pix: players['player-1'] ?? null, nee: players['player-2'] ?? null };
}) : Promise.resolve({ pix: null, nee: null })).catch(() => ({ pix: null, nee: null }));

async function step(name, fn) {
  result.notes.step = name;
  try {
    return await fn();
  } catch (error) {
    const [hostSecurity, guestSecurity] = await Promise.all([
      sec(host).catch(() => null),
      sec(guest).catch(() => null),
    ]);
    result.notes.failure = {
      hostPositions: await readoutPositions(host),
      captures: {
        host: hostSecurity?.captures ?? null,
        guest: guestSecurity?.captures ?? null,
      },
    };
    const message = String(error?.message ?? error).split('\n', 1)[0];
    throw new Error(`[${name}] ${message}`);
  }
}

function waitForHostNeeDistance(name, target, comparison, distance) {
  return step(name, () => host.waitForFunction(
    ({ target: point, comparison: mode, distance: limit }) => {
      const text = document.querySelector('#dev-readout')?.textContent ?? '';
      const match = [...text.matchAll(/(player-\d)\s+x\s+(-?\d+\.\d)\s+y\s+(-?\d+\.\d)\s+z\s+(-?\d+\.\d)/g)]
        .find((entry) => entry[1] === 'player-2');
      if (!match) return false;
      const nee = { x: +match[2], y: +match[3], z: +match[4] };
      const actual = Math.hypot(nee.x - point.x, nee.y - point.y, nee.z - point.z);
      return mode === 'near' ? actual <= limit : actual > limit;
    },
    { target, comparison, distance },
    { timeout: 8_000 },
  ));
}

try {
  server = await startTestServer({
    port: SERVER_PORT,
    root,
    env: {
      HANDSHAKE_TEST_HOOKS: '1',
      EMPTY_ROOM_SECONDS: '120',
      LONELY_ROOM_SECONDS: '120',
    },
  });
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
    await step(`${page === host ? 'host' : 'guest'} boot`, () => page.locator('#boot-status').waitFor({ state: 'detached', timeout: 60_000 }));
    await step(`${page === host ? 'host' : 'guest'} debug hooks`, () => page.waitForFunction(() => window.__autotest?.debugForceCapture, null, { timeout: 30_000 }));
  }
  result.notes.room = code;

  await host.evaluate(() => window.__autotest.debugStage('escape'));
  for (const page of [host, guest]) {
    await step(`${page === host ? 'host' : 'guest'} security active`, () => page.waitForFunction(() => window.__autotest.security().securityActive, null, { timeout: 10_000 }));
  }
  await host.evaluate(() => window.__autotest.debugPatrolFreeze?.(true));

  // ── 1. Capture ────────────────────────────────────────────────────────
  await host.evaluate(() => window.__autotest.debugForceCapture('pix', 0));
  await step('host capture state', () => host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 8_000 },
  ));
  await step('guest capture state', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 8_000 },
  ));
  const [hCap, gCap] = await Promise.all([caps(host), caps(guest)]);
  assert(hCap.pix?.captured && gCap.pix?.captured, `capture disagree host=${JSON.stringify(hCap)} guest=${JSON.stringify(gCap)}`);
  assert(hCap.pix.capturedBy === 0 && gCap.pix.capturedBy === 0, 'capturedBy should be patrol 0');
  assert(!hCap.nee?.captured && !gCap.nee?.captured, 'NEE should still be free');
  assert(typeof hCap.pix.rescueProgress === 'number' && typeof gCap.pix.rescueProgress === 'number', 'rescue progress should sync');
  assert(hCap.pix.rescueProgress === gCap.pix.rescueProgress, 'rescue progress should match');
  // Verify input locked: steering or key inputs do not override server-held capture position
  const beforeX = hCap.pix.x, beforeZ = hCap.pix.z;
  await host.keyboard.press('KeyW');
  // Negative check: the captured drone must remain locked while input is held.
  await host.waitForTimeout(100);
  const lockCap = (await caps(host)).pix;
  assert(Math.hypot(lockCap.x - beforeX, lockCap.z - beforeZ) < 0.25, 'captured drone input should be locked');
  result.notes.capture = { pix: hCap.pix };

  // ── 2. Rescue success ─────────────────────────────────────────────────
  const hold = (await caps(host)).pix;
  const rescueTarget = { x: hold.x + 1.5, y: hold.y, z: hold.z + 1.5 };
  await guest.evaluate((p) => window.__autotest.teleport('nee', p.x, p.y, p.z), rescueTarget);
  await waitForHostNeeDistance('rescue NEE server position', rescueTarget, 'near', 3);
  await guest.getByTestId('game-canvas').focus();
  await guest.keyboard.press('r');
  await step('host rescue release', () => host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 8_000 },
  ));
  await step('guest rescue release', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 5_000 },
  ));
  result.notes.rescueSuccess = true;

  // ── 3. Rescue failure (timeout window) ────────────────────────────────
  // Clear any stuns from the previous rescue clothesline and force-capture PIX
  await host.evaluate(() => {
    window.__autotest.debugClearStuns?.();
    window.__autotest.debugForceCapture('pix', 0);
  });
  await step('host recapture state', () => host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 5_000 },
  ));
  await step('guest recapture state', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 5_000 },
  ));
  assert((await caps(host)).pix?.captured === true, 'PIX could not be re-captured for the failure case');

  // (a) with NEE parked far (>12 m) and idle, the drone stays captured for at least 1.5 s of carry
  const holdPix = (await caps(host)).pix;
  const farTarget = { x: holdPix.x, y: holdPix.y, z: holdPix.z - 12.5 };
  // Maintain this negative-case precondition: a single teleport immediately
  // springs back on the elastic cord before the next server snapshot.
  await guest.evaluate((p) => {
    const pin = () => {
      window.__autotest.teleport('nee', p.x, p.y, p.z);
      window.__coopCapturePin = requestAnimationFrame(pin);
    };
    pin();
  }, farTarget);
  await waitForHostNeeDistance('idle-far NEE server position', holdPix, 'far', 11.5);
  await step('idle-far carry timer', () => host.waitForFunction(
    () => {
      const c = window.__autotest.security()?.captures?.pix;
      return c && c.captured === true && c.carryFor >= 1.5;
    },
    null,
    { timeout: 8_000 },
  ));
  const ticking = (await caps(host)).pix?.carryFor ?? 0;
  assert(ticking >= 1.5, `carry timer did not advance past 1.5s (${ticking})`);
  assert((await caps(host)).pix?.captured === true, 'PIX should stay captured while NEE is idle');

  // (b) a 'tether-yank' kind 'yank' sent from beyond 11 m does NOT clear captured.
  // The elastic cord drags NEE back toward PIX every frame and the drone keeps carrying PIX,
  // so one teleport gives no fixed server-side distance when the yank lands (the old fixed
  // sleep raced this: sometimes the yank arrived inside 11 m and rescued). Pin NEE every frame
  // 12.3 m from the live PIX position (past 11 m rescue, inside the 13.5 m relay), wait until
  // the host, fed by the server, sees NEE in that band, then yank.
  await guest.getByTestId('game-canvas').focus();
  await guest.evaluate(() => {
    cancelAnimationFrame(window.__coopCapturePin);
    const t = window.__autotest;
    const pin = () => {
      const p = t.security()?.captures?.pix;
      if (p) t.teleport('nee', p.x, p.y, p.z - 12.3);
      window.__coopCapturePin = requestAnimationFrame(pin);
    };
    pin();
  });
  await step('tether-yank NEE server position', () => host.waitForFunction(
    ({ min, max }) => {
      const text = document.querySelector('#dev-readout')?.textContent ?? '';
      const match = [...text.matchAll(/(player-\d)\s+x\s+(-?\d+\.\d)\s+y\s+(-?\d+\.\d)\s+z\s+(-?\d+\.\d)/g)]
        .find((entry) => entry[1] === 'player-2');
      const pix = window.__autotest.security()?.captures?.pix;
      if (!match || !pix) return false;
      const d = Math.hypot(+match[2] - pix.x, +match[3] - pix.y, +match[4] - pix.z);
      return d > min && d < max;
    },
    { min: 11.6, max: 13.2 },
    { timeout: 8_000 },
  ));
  await guest.keyboard.press('r');
  // Negative check: allow the server to process the yank, then assert capture remains.
  await host.waitForTimeout(300);
  const afterYank = (await caps(host)).pix;
  await guest.evaluate(() => cancelAnimationFrame(window.__coopCapturePin));
  assert(afterYank?.captured === true, 'a tether-yank from beyond 11 m must not clear captured');

  // (c) after the carry window (CARRY_MAX 4.5 s, allow up to ~7 s) the server runs the timeout outcome
  await step('host rescue timeout release', () => host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 7_000 },
  ));
  await step('guest rescue timeout release', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 5_000 },
  ));
  assert(!(await caps(host)).pix?.captured, 'PIX should be freed after rescue timeout');
  result.notes.rescueFailure = { carryFor: ticking, freed: true };

  // ── 4. Reconnect while captured ───────────────────────────────────────
  await host.evaluate(() => {
    window.__autotest.debugClearStuns?.();
    window.__autotest.debugForceCapture('nee', 1);
  });
  await step('guest NEE recapture state', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.nee?.captured === true,
    null,
    { timeout: 8_000 },
  ));
  await guest.evaluate(() => window.__autotest.dropConnection());
  await step('guest reconnect', () => guest.waitForFunction(
    () => window.__autotest.connectionState() === 'connected',
    null,
    { timeout: 20_000 },
  ));
  await step('guest NEE capture after reconnect', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.nee?.captured === true,
    null,
    { timeout: 10_000 },
  ));
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
  result.notes.serverLog = server?.log().slice(-1200);
  try {
    if (host) result.notes.lastHost = await sec(host);
    if (guest) result.notes.lastGuest = await sec(guest);
  } catch { /* ignore */ }
} finally {
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log('QA_RESULT ' + JSON.stringify(result));
  await browser.close().catch(() => {});
  await server?.stop();
  process.exit(result.pass ? 0 : 1);
}
