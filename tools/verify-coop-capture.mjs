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
/** Test-only carry window (server default 4.5 s) so loaded round-trips fit inside it. */
const TEST_CARRY_MAX = 15;
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

const { DISPLAY: _display, WAYLAND_DISPLAY: _waylandDisplay, ...headlessEnv } = process.env;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  env: headlessEnv,
});

const result = { test: 'coop-capture', pass: false, notes: {} };
const started = Date.now();
let server;
let host;
let guest;
const errors = [];

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

async function pressYank() {
  await guest.keyboard.down('r');
  await guest.evaluate(() => new Promise((done) => {
    let frames = 0;
    const tick = () => (++frames >= 3 ? done() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));
  await guest.keyboard.up('r');
}

async function forceCaptureUntil(name, role, index, { deadline = 30_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < deadline) {
    await host.evaluate(({ captureRole, patrolIndex }) => {
      const t = window.__autotest;
      window.__coopCaptureStableSince = null;
      t.debugClearStuns?.();
      t.debugForceCapture(captureRole, patrolIndex);
    }, { captureRole: role, patrolIndex: index });

    const remaining = deadline - (Date.now() - startedAt);
    const timeout = Math.min(1500, Math.max(1, remaining));
    const states = await Promise.allSettled([
      host.waitForFunction(
        ({ captureRole }) => window.__autotest.security()?.captures?.[captureRole]?.captured === true,
        { captureRole: role },
        { timeout },
      ),
      guest.waitForFunction(
        ({ captureRole }) => window.__autotest.security()?.captures?.[captureRole]?.captured === true,
        { captureRole: role },
        { timeout },
      ),
    ]);
    if (states.every((state) => state.status === 'fulfilled')) {
      const stabilityTimeout = Math.min(1500, Math.max(1, deadline - (Date.now() - startedAt)));
      const stability = await host.waitForFunction(
        ({ captureRole }) => {
          const captured = window.__autotest.security()?.captures?.[captureRole]?.captured === true;
          if (!captured) {
            window.__coopCaptureStableSince = null;
            return 'lost';
          }
          const now = performance.now();
          window.__coopCaptureStableSince ??= now;
          return now - window.__coopCaptureStableSince >= 500 ? 'stable' : false;
        },
        { captureRole: role },
        { timeout: stabilityTimeout },
      ).catch(() => null);
      if (stability) {
        const stabilityState = await stability.jsonValue();
        await stability.dispose();
        if (stabilityState === 'stable') return;
      }
    }
  }

  throw new Error(`${name}: capture did not become active before the ${deadline}ms deadline`);
}

try {
  server = await startTestServer({
    port: SERVER_PORT,
    root,
    env: {
      HANDSHAKE_TEST_HOOKS: '1',
      HANDSHAKE_TEST_CARRY_MAX: String(TEST_CARRY_MAX),
      EMPTY_ROOM_SECONDS: '120',
      LONELY_ROOM_SECONDS: '120',
    },
  });
  const APP_URL = appUrlWithServer(`http://127.0.0.1:${SERVER_PORT}`);

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  host = await hostContext.newPage();
  guest = await guestContext.newPage();
  errors.length = 0;
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
  await Promise.all([
    host.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 90_000 }),
    guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 90_000 }),
  ]);
  const waitForBoot = async (page, name) => {
    const poll = async () => {
      const err = await page.locator('#boot-status.error').textContent().catch(() => null);
      if (err) throw new Error(`${name} boot failed: ${err}`);
      const isDetached = await page.locator('#boot-status').count().then((c) => c === 0).catch(() => false);
      return isDetached;
    };
    const start = Date.now();
    while (Date.now() - start < 90_000) {
      if (await poll()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    const current = await page.locator('#boot-status').textContent().catch(() => 'unknown');
    throw new Error(`${name} boot timed out (status: ${current})`);
  };
  await Promise.all([waitForBoot(host, 'host'), waitForBoot(guest, 'guest')]);
  await step('host debug hooks', () => host.waitForFunction(() => window.__autotest?.debugForceCapture, null, { timeout: 60_000 }));
  await step('guest debug hooks', () => guest.waitForFunction(() => window.__autotest?.debugForceCapture, null, { timeout: 60_000 }));
  result.notes.room = code;

  await host.evaluate(() => window.__autotest.debugStage('escape'));
  for (const page of [host, guest]) {
    await step(`${page === host ? 'host' : 'guest'} security active`, () => page.waitForFunction(() => window.__autotest.security().securityActive, null, { timeout: 60_000 }));
  }
  await host.evaluate(() => window.__autotest.debugPatrolFreeze?.(true));

  // ── 1. Capture ────────────────────────────────────────────────────────
  await step('host capture state', () => forceCaptureUntil('host capture state', 'pix', 0));
  await step('guest capture state', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 30_000 },
  ));
  const [hCap, gCap] = await Promise.all([caps(host), caps(guest)]);
  assert(hCap.pix?.captured && gCap.pix?.captured, `capture disagree host=${JSON.stringify(hCap)} guest=${JSON.stringify(gCap)}`);
  assert(hCap.pix.capturedBy === 0 && gCap.pix.capturedBy === 0, 'capturedBy should be patrol 0');
  assert(!hCap.nee?.captured && !gCap.nee?.captured, 'NEE should still be free');
  assert(typeof hCap.pix.rescueProgress === 'number' && typeof gCap.pix.rescueProgress === 'number', 'rescue progress should sync');
  assert(hCap.pix.rescueProgress === gCap.pix.rescueProgress, 'rescue progress should match');
  // Verify input is locked while allowing server-authoritative hauling under load.
  const lockBefore = await host.evaluate(() => {
    const pix = window.__autotest.security()?.captures?.pix;
    return {
      position: pix ? { x: pix.x, y: pix.y, z: pix.z } : null,
      now: performance.now(),
    };
  });
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(300);
  await host.keyboard.up('KeyW');
  const lockAfter = await host.evaluate(() => {
    const pix = window.__autotest.security()?.captures?.pix;
    return {
      position: pix ? { x: pix.x, y: pix.y, z: pix.z } : null,
      now: performance.now(),
    };
  });
  const lockElapsedSeconds = Math.max(0, (lockAfter.now - lockBefore.now) / 1000);
  const lockDx = (lockAfter.position?.x ?? 0) - (lockBefore.position?.x ?? 0);
  const lockDy = (lockAfter.position?.y ?? 0) - (lockBefore.position?.y ?? 0);
  const lockDz = (lockAfter.position?.z ?? 0) - (lockBefore.position?.z ?? 0);
  const lockDisplacement = Math.hypot(lockDx, lockDy, lockDz);
  const lockAllowance = 2.2 * lockElapsedSeconds + 0.5;
  const carryDirectionX = 0 - (lockBefore.position?.x ?? 0);
  const carryDirectionZ = 10 - (lockBefore.position?.z ?? 0);
  const carryDirectionLength = Math.hypot(carryDirectionX, carryDirectionZ);
  const carryDot = lockDx * carryDirectionX + lockDz * carryDirectionZ;
  const lockDirectionOkay = lockDisplacement <= 0.15
    || (carryDirectionLength > 0 && carryDot > 0);
  assert(
    Boolean(lockBefore.position && lockAfter.position)
      && lockDisplacement <= lockAllowance
      && lockDirectionOkay,
    `captured drone input should be locked (displacement=${lockDisplacement.toFixed(3)}m `
      + `allowance=${lockAllowance.toFixed(3)}m elapsed=${lockElapsedSeconds.toFixed(3)}s `
      + `carryDot=${carryDot.toFixed(3)})`,
  );
  result.notes.capture = { pix: hCap.pix };

  // Shared helpers for the rescue checks: everything waits on server-observed state.
  const neeFromPix = () => {
    const text = document.querySelector('#dev-readout')?.textContent ?? '';
    const match = [...text.matchAll(/(player-\d)\s+x\s+(-?\d+\.\d)\s+y\s+(-?\d+\.\d)\s+z\s+(-?\d+\.\d)/g)]
      .find((entry) => entry[1] === 'player-2');
    const pix = window.__autotest.security()?.captures?.pix;
    if (!match || !pix) return null;
    const d = Math.hypot(+match[2] - pix.x, +match[3] - pix.y, +match[4] - pix.z);
    const recent = (window.__coopRecentDs ??= []);
    if (pix.captured) { recent.push(+d.toFixed(2)); if (recent.length > 8) recent.shift(); }
    return { pix, d };
  };
  await host.evaluate((src) => { window.__coopNeeFromPix = (0, eval)(`(${src})`); }, neeFromPix.toString());
  const pinNee = (target) => guest.evaluate((t) => {
    cancelAnimationFrame(window.__coopCapturePin);
    const pin = () => {
      window.__autotest.teleport('nee', t.x, t.y, t.z);
      window.__coopCapturePin = requestAnimationFrame(pin);
    };
    pin();
  }, target);
  const unpinNee = () => guest.evaluate(() => cancelAnimationFrame(window.__coopCapturePin));
  // Server hauls a captive to the holding pen and then holds it still; wait for that so the
  // NEE<->PIX distance the server measures is fixed while we act on it.
  const waitPixParked = (name) => step(name, () => host.waitForFunction(() => {
    const pix = window.__autotest.security()?.captures?.pix;
    if (!pix) return false;
    if (pix.captured === false) return 'released';
    const now = performance.now();
    const prev = window.__coopParkPrev;
    if (!prev || Math.hypot(pix.x - prev.x, pix.y - prev.y, pix.z - prev.z) > 0.05) {
      window.__coopParkPrev = { x: pix.x, y: pix.y, z: pix.z, t: now };
      return false;
    }
    return now - prev.t >= 400 ? { x: pix.x, y: pix.y, z: pix.z, carryFor: pix.carryFor } : false;
  }, null, { timeout: 45_000, polling: 100 }).then((h) => h.jsonValue()));
  const freshParkedCapture = async (name) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await step(name, () => forceCaptureUntil(name, 'pix', 0));
      await host.evaluate(() => { window.__coopParkPrev = null; });
      const parked = await waitPixParked(`${name} parked`);
      if (parked !== 'released' && parked.carryFor < TEST_CARRY_MAX - 5) return parked;
    }
    throw new Error(`${name}: PIX never parked with enough carry window left`);
  };

  // ── 2. Rescue success ─────────────────────────────────────────────────
  // Park PIX in the pen, then pin NEE 4.5 m away: inside the server's 11 m rescue range and
  // outside the client's 2.6 m bump range, so R is a real yank (at 2 m it is a harmless bump).
  let rescuePark = await waitPixParked('rescue PIX parked');
  if (rescuePark === 'released' || rescuePark.carryFor > TEST_CARRY_MAX - 5) rescuePark = await freshParkedCapture('rescue recapture');
  await pinNee({ x: rescuePark.x + 3.2, y: rescuePark.y, z: rescuePark.z + 3.2 });
  const rescueBand = await step('rescue NEE server position', () => host.waitForFunction(() => {
    const r = window.__coopNeeFromPix();
    if (!r) return false;
    if (r.pix.captured === false) return { released: true };
    return r.d > 2.8 && r.d < 9 ? { released: false, d: r.d } : false;
  }, null, { timeout: 45_000, polling: 100 }).then((h) => h.jsonValue()));
  assert(!rescueBand.released, `PIX freed before NEE reached rescue range (recent d=${JSON.stringify(await host.evaluate(() => window.__coopRecentDs))})`);
  await guest.getByTestId('game-canvas').focus();
  // Keyboard input is sampled once per rendered frame, so a bare press() can fall between two
  // frames on a loaded box and never reach the game; hold R across a few guest frames instead.
  // Retry until the server frees PIX, and require that it was the yank, not the carry timeout.
  await host.evaluate(() => { window.__coopRescueCarry = 0; });
  let rescued = null;
  for (let attempt = 1; attempt <= 6 && !rescued; attempt += 1) {
    await pressYank();
    rescued = await host.waitForFunction(() => {
      const c = window.__autotest.security()?.captures?.pix;
      if (!c) return false;
      if (c.captured) { window.__coopRescueCarry = c.carryFor; return false; }
      return { carryFor: window.__coopRescueCarry };
    }, null, { timeout: 4_000, polling: 100 }).then((h) => h.jsonValue()).catch(() => null);
  }
  await unpinNee();
  assert(rescued, 'a partner yank within 11 m did not free PIX');
  assert(rescued.carryFor < TEST_CARRY_MAX - 1, `PIX was freed by the carry timeout, not the rescue yank (last carryFor=${rescued.carryFor})`);
  await step('guest rescue release', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 30_000 },
  ));
  result.notes.rescueSuccess = true;

  // ── 3. Rescue failure (timeout window) ────────────────────────────────
  // Under box load the client->server->client round-trips can exceed the real 4.5 s carry, so
  // the hooked server runs a longer test carry window (HANDSHAKE_TEST_CARRY_MAX) and every
  // step below waits on server-observed state (positions, carryFor), never on wall-clock sleeps.
  // (a) with NEE parked far (>11.2 m; the client cord can hold it near 11.3 m) and idle, PIX stays captured for >= 1.5 s more carry.
  const idlePark = await freshParkedCapture('host recapture state');
  await step('guest recapture state', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === true,
    null,
    { timeout: 30_000 },
  ));
  await guest.getByTestId('game-canvas').focus();
  await pinNee({ x: idlePark.x, y: idlePark.y, z: idlePark.z - 12.5 });
  const farState = await step('idle-far NEE server position', () => host.waitForFunction(({ distance }) => {
    const r = window.__coopNeeFromPix();
    if (!r) return false;
    if (r.pix.captured === false) return { released: true, carryFor: r.pix.carryFor };
    return r.d > distance ? { released: false, carryFor: r.pix.carryFor, d: r.d } : false;
  }, { distance: 11.2 }, { timeout: 45_000, polling: 100 }).then((h) => h.jsonValue()));
  assert(!farState.released, `PIX freed before NEE reached the idle-far spot (recent d=${JSON.stringify(await host.evaluate(() => window.__coopRecentDs))})`);
  const carryState = await step('idle-far carry advance', () => host.waitForFunction(({ from }) => {
    const r = window.__coopNeeFromPix();
    if (!r) return false;
    if (r.pix.captured === false) return { released: true, carryFor: r.pix.carryFor };
    return r.pix.carryFor >= from + 1.5 ? { released: false, carryFor: r.pix.carryFor, d: r.d } : false;
  }, { from: farState.carryFor }, { timeout: 60_000, polling: 100 }).then((h) => h.jsonValue()));
  assert(!carryState.released, `an idle far partner must not free PIX (freed at carryFor=${carryState.carryFor}, far at ${farState.carryFor})`);
  assert(carryState.d > 11, `NEE drifted inside 11 m during the idle-far check (${carryState.d.toFixed(2)} m)`);
  const ticking = carryState.carryFor;

  // (c) after the carry window the server runs the timeout outcome (NEE still idle far).
  await step('host rescue timeout release', () => host.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 60_000 },
  ));
  await step('guest rescue timeout release', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.pix?.captured === false,
    null,
    { timeout: 30_000 },
  ));
  assert(!(await caps(host)).pix?.captured, 'PIX should be freed after rescue timeout');
  await unpinNee();
  result.notes.rescueFailure = { carryFor: ticking, farAt: farState.carryFor, freed: true };

  // (b) a 'tether-yank' kind 'yank' sent from beyond 11 m does NOT clear captured.
  // PIX is parked in the pen (server holds it still) and NEE is pinned every frame 12.3 m away
  // (past the 11 m rescue range, inside the 13.5 m relay), so the server-side distance is fixed
  // when the yank lands. After the yank we wait for >= 2 s of further server carry time.
  const yankPark = await freshParkedCapture('host tether recapture state');
  await guest.getByTestId('game-canvas').focus();
  await pinNee({ x: yankPark.x, y: yankPark.y, z: yankPark.z - 12.3 });
  try {
    const band = await step('tether-yank NEE server position', () => host.waitForFunction(({ min, max }) => {
      const r = window.__coopNeeFromPix();
      if (!r) return false;
      if (r.pix.captured === false) return { released: true, carryFor: r.pix.carryFor };
      const now = performance.now();
      if (!(r.d > min && r.d < max)) { window.__coopBandSince = null; return false; }
      window.__coopBandSince ??= now;
      return now - window.__coopBandSince >= 400 ? { released: false, carryFor: r.pix.carryFor, d: r.d } : false;
    }, { min: 11.2, max: 13.3 }, { timeout: 45_000, polling: 100 }).then((h) => h.jsonValue()));
    assert(!band.released, `PIX freed before the tether-yank band check (recent d=${JSON.stringify(await host.evaluate(() => window.__coopRecentDs))})`);
    await pressYank();
    const afterYank = await step('tether-yank server carry advance', () => host.waitForFunction(({ from }) => {
      const r = window.__coopNeeFromPix();
      if (!r) return false;
      if (r.pix.captured === false) return { released: true, carryFor: r.pix.carryFor, d: r.d };
      return r.pix.carryFor >= from + 2 ? { released: false, carryFor: r.pix.carryFor, d: r.d } : false;
    }, { from: band.carryFor }, { timeout: 60_000, polling: 100 }).then((h) => h.jsonValue()));
    assert(!afterYank.released, `a tether-yank from beyond 11 m must not clear captured (carryFor=${band.carryFor}, d=${band.d.toFixed(2)})`);
    result.notes.tetherYankFar = { d: band.d, carryFor: afterYank.carryFor };
  } finally {
    await unpinNee();
  }

  // ── 4. Reconnect while captured ───────────────────────────────────────
  await step('guest NEE recapture state', () => forceCaptureUntil('guest NEE recapture state', 'nee', 1));
  await guest.evaluate(() => window.__autotest.dropConnection());
  await step('guest reconnect', () => guest.waitForFunction(
    () => window.__autotest.connectionState() === 'connected',
    null,
    { timeout: 20_000 },
  ));
  await step('guest NEE capture after reconnect', () => guest.waitForFunction(
    () => window.__autotest.security()?.captures?.nee?.captured === true,
    null,
    { timeout: 30_000 },
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
  try {
    const hostText = await host?.locator('body').innerText().catch(() => '');
    const guestText = await guest?.locator('body').innerText().catch(() => '');
    result.error = `${e?.message ?? e}\nHOST BODY: ${hostText}\nGUEST BODY: ${guestText}\nPAGE ERRORS:\n${errors.join('\n')}`;
    result.notes.serverLog = typeof server?.log === 'function' ? server.log().slice(-1200) : '';
    result.notes.errors = errors;
    result.notes.hostUrl = host?.url();
    result.notes.guestUrl = guest?.url();
  } catch (err) {
    result.error = `Catch failure: ${err?.message} while handling ${e?.message}`;
  }
} finally {
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log(`coop-capture ${result.pass ? 'PASS' : 'FAIL'} (${result.seconds}s)`);
  console.log('QA_RESULT ' + JSON.stringify(result));
  await browser.close().catch(() => {});
  await server?.stop();
  process.exit(result.pass ? 0 : 1);
}
