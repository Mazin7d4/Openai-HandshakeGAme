// Shared helpers for the PIX QA regression suite (tools/qa/*.test.mjs).
// Env: QA_BASE_URL / QA_URL (full client URL, e.g. the live Pages site), QA_CLIENT_PORT (5183), QA_SERVER_PORT (2583),
// QA_SERVER_URL (ws URL; default ws://127.0.0.1:$QA_SERVER_PORT, only passed as ?server= for local runs), QA_SHOTS (screenshot dir).
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

export const CLIENT_PORT = process.env.QA_CLIENT_PORT ?? '5183';
export const SERVER_PORT = process.env.QA_SERVER_PORT ?? '2583';
const argUrl = /^https?:/.test(process.argv[2] ?? '') ? process.argv[2] : undefined;
export const BASE_URL = process.env.QA_BASE_URL ?? process.env.QA_URL ?? argUrl ?? `http://127.0.0.1:${CLIENT_PORT}/?scale=4&lowfx`;
export const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(BASE_URL);
export const SHOTS = process.env.QA_SHOTS ?? '/workspace/handshake/sprint/screens/qa';
mkdirSync(SHOTS, { recursive: true });

/** Software-GL flags (no GPU on the box), same as verify-companion / probe-fps. */
export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

/** WS server for co-op/join tests. Passed as ?server= (future override, see WIN_STRATEGY); the
 * current client ignores it and uses VITE_COLYSEUS_URL baked in at vite start (qa:servers sets it). */
export const SERVER_URL = process.env.QA_SERVER_URL ?? `ws://127.0.0.1:${SERVER_PORT}`;
export function url(extra = {}) {
  const u = new URL(BASE_URL);
  u.searchParams.set('debug', '1');
  u.searchParams.set('autotest', '1');
  if (IS_LOCAL || process.env.QA_SERVER_URL || Object.prototype.hasOwnProperty.call(extra, 'server')) {
    u.searchParams.set('server', SERVER_URL);
  }
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

export function assert(cond, msg) { if (!cond) throw new Error(msg); }

export async function launch() {
  // Headless Chromium must not inherit a stale Xvfb DISPLAY. On this box the
  // display can disappear under load while SwiftShader itself is still usable;
  // inheriting that dead display makes ANGLE fail before WebGL context creation.
  const { DISPLAY: _display, WAYLAND_DISPLAY: _waylandDisplay, ...headlessEnv } = process.env;
  return chromium.launch({ headless: true, args: GL_ARGS, env: headlessEnv });
}
export { devices };

/**
 * Collect page errors + console errors. Known-noise patterns go in IGNORE.
 *
 * `Failed to load resource: net::ERR_ABORTED` — Chromium logs this when a new
 * document navigation cancels in-flight module/wasm/font/GLB fetches from the
 * previous page. Harmless if the next boot reaches a ready signal; do not broaden.
 */
const IGNORE = [
  /favicon/i,
  /^Failed to load resource: net::ERR_ABORTED$/,
];
export function collectErrors(page, name, errors) {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errors.push(`${name} console: ${m.text()}`);
  });
  return errors;
}

/** Fresh browser context + page (isolated storage, sockets, and in-flight fetches). */
export async function openPage(browser, options = {}) {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  return { ctx, page };
}

export async function closePage(page) {
  await page.context().close().catch(() => {});
}

export async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

export async function tryShot(page, name, timeout = 10_000) {
  try {
    const path = `${SHOTS}/${name}.png`;
    await page.screenshot({ path, timeout });
    return path;
  } catch {
    return null;
  }
}

export async function until(label, fn, timeout = 15_000, interval = 250) {
  const deadline = Date.now() + timeout;
  let lastInfo = null;
  while (true) {
    try {
      const result = await fn();
      lastInfo = result?.info ?? null;
      if (result?.ok) return result.info;
    } catch (e) {
      lastInfo = String(e?.message ?? e);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
  }
  throw new Error(`${label}: ${JSON.stringify(lastInfo).slice(0, 400)}`);
}

export async function waitForGame(page, timeout = 120_000) {
  await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout });
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout });
}

/** Wait for the first rendered scene frames and the touch pause control to be live. */
export async function waitForSceneReady(page, timeout = 60_000) {
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="touch-pause"]');
    if (!(button instanceof HTMLElement)) return false;
    const style = getComputedStyle(button);
    const box = button.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
      || box.width <= 0 || box.height <= 0) return false;
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    });
  }, null, { timeout });
}

/** Retry a touch transition until its visible/selected effect is observed. */
export async function tapUntil(page, testId, effectTestId, { deadline = 45_000 } = {}) {
  const end = Date.now() + deadline;
  const selectedEffect = effectTestId.startsWith('settings-tab-');
  let lastError = 'effect was not observed';

  const effectReady = async () => {
    const effect = page.getByTestId(effectTestId);
    try {
      if (!(await effect.isVisible())) return false;
      if (!selectedEffect) return true;
      return (await effect.getAttribute('aria-selected')) === 'true';
    } catch (error) {
      lastError = String(error?.message ?? error).split('\n', 1)[0];
      return false;
    }
  };

  while (Date.now() < end) {
    if (await effectReady()) return;
    const remaining = end - Date.now();
    try {
      await page.getByTestId(testId).tap({ timeout: Math.min(5_000, remaining) });
    } catch (error) {
      lastError = String(error?.message ?? error).split('\n', 1)[0];
      continue;
    }
    const effectTimeout = Math.min(3_000, end - Date.now());
    if (effectTimeout <= 0) break;
    try {
      await page.waitForFunction(({ id, selected }) => {
        const effect = document.querySelector(`[data-testid="${id}"]`);
        if (!(effect instanceof HTMLElement)) return false;
        const style = getComputedStyle(effect);
        const box = effect.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
          && box.width > 0 && box.height > 0
          && (!selected || effect.getAttribute('aria-selected') === 'true');
      }, { id: effectTestId, selected: selectedEffect }, { timeout: effectTimeout });
      return;
    } catch (error) {
      lastError = String(error?.message ?? error).split('\n', 1)[0];
    }
    if (Date.now() >= end) break;
  }
  throw new Error(`tapUntil ${testId} -> ${effectTestId} timed out after ${deadline}ms: ${lastError}`);
}

/** Night Shift HUD ready: floor chip visible (and beat chip when a ?beat= is in play). */
export async function waitForNightShiftHud(page, { beat = false, timeout = 30_000 } = {}) {
  await waitForGame(page, timeout);
  await page.getByTestId('floor-counter').waitFor({ state: 'visible', timeout });
  if (beat) await page.getByTestId('beat-chip').waitFor({ state: 'visible', timeout });
}
/** Host creates a room, guest joins with the code. Returns the room code. */
export async function createAndJoin(host, guest, { open = url() } = {}) {
  await host.goto(open);
  await host.getByTestId('multiplayer').click();
  await host.getByTestId('create-room').click();
  const code = (await host.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
  assert(/^[A-Z0-9]{4}$/.test(code), `Unexpected room code: ${code}`);
  await joinRoom(guest, code, open);
  return code;
}

export async function joinRoom(page, code, open = url()) {
  await page.goto(open);
  await page.getByTestId('multiplayer').click();
  await page.getByTestId('join-room').click();
  await page.getByTestId('room-code-input').fill(code);
  await page.getByTestId('join-submit').click();
}

/** Canvas actually drew something (not a flat single colour). */
export async function canvasHasContent(page) {
  const buf = await page.getByTestId('game-canvas').screenshot();
  // cheap entropy proxy: count distinct byte values in a PNG sample
  const sample = buf.subarray(Math.floor(buf.length / 4), Math.floor(buf.length / 4) + 20000);
  return new Set(sample).size > 64 && buf.length > 15_000;
}

/**
 * Parse the debug dev readout into a comparable world snapshot.
 * Extend here when server-authoritative enemies land: add `patrols` parsing and
 * compareWorld() will automatically include them.
 */
export async function worldState(page) {
  const text = await page.locator('#dev-readout').innerText({ timeout: 10_000 });
  const players = {};
  for (const m of text.matchAll(/(player-\d)\s+x\s+(-?\d+\.\d)\s+y\s+(-?\d+\.\d)\s+z\s+(-?\d+\.\d)/g)) {
    players[m[1]] = { x: +m[2], y: +m[3], z: +m[4] };
  }
  const mission = text.match(/mission:(\w+)/)?.[1] ?? null;
  const objects = {};
  for (const m of text.matchAll(/([a-z][\w-]*):(free|pix|nee)@(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)/g)) {
    objects[m[1]] = { holder: m[2], x: +m[3], y: +m[4], z: +m[5] };
  }
  let patrols = parsePatrols(text);
  // Server-owned security (production >= 3114574): read via the ?autotest hook when present.
  const security = await page.evaluate(() => window.__autotest?.security?.() ?? null).catch(() => null);
  if (security) {
    patrols = (security.patrols ?? []).map((p, i) => ({ id: String(i), state: '', x: p.x, y: p.y, z: p.z }));
  }
  const sec = security && { stage: security.stage, alarm: security.alarm, securityActive: security.securityActive, timesSpotted: security.timesSpotted };
  return { players, mission, objects, patrols, security: sec, raw: text };
}

/** Placeholder: returns [] until the readout (or a window hook) exposes patrol state. */
export function parsePatrols(text) {
  const out = [];
  for (const m of text.matchAll(/patrol-?(\d+)[:\s]+(\w+)?@?(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)/g)) {
    out.push({ id: m[1], state: m[2] ?? '', x: +m[3], y: +m[4], z: +m[5] });
  }
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Compare two clients' world views. Returns a list of disagreement strings (empty = agree). */
export function compareWorld(a, b, { playerTol = 1.5, objectTol = 1.5, patrolTol = 1.0 } = {}) {
  const issues = [];
  for (const id of new Set([...Object.keys(a.players), ...Object.keys(b.players)])) {
    if (!a.players[id] || !b.players[id]) { issues.push(`${id} missing on one client`); continue; }
    const d = dist(a.players[id], b.players[id]);
    if (d > playerTol) issues.push(`${id} differs by ${d.toFixed(2)}`);
  }
  if (a.mission !== b.mission) issues.push(`mission ${a.mission} vs ${b.mission}`);
  for (const id of Object.keys(a.objects)) {
    const o = b.objects[id];
    if (!o) continue;
    if (o.holder !== a.objects[id].holder) issues.push(`${id} holder ${a.objects[id].holder} vs ${o.holder}`);
    else if (dist(o, a.objects[id]) > objectTol) issues.push(`${id} pos differs ${dist(o, a.objects[id]).toFixed(2)}`);
  }
  if (a.security && b.security) {
    for (const k of ['stage', 'alarm', 'securityActive', 'timesSpotted']) {
      if (a.security[k] !== b.security[k]) issues.push(`security.${k} ${a.security[k]} vs ${b.security[k]}`);
    }
  }
  // Enemy agreement (activates automatically once parsePatrols returns data on both clients).
  if (a.patrols.length && b.patrols.length) {
    for (const p of a.patrols) {
      const q = b.patrols.find((x) => x.id === p.id);
      if (!q) { issues.push(`patrol ${p.id} missing`); continue; }
      if (p.state !== q.state) issues.push(`patrol ${p.id} state ${p.state} vs ${q.state}`);
      if (dist(p, q) > patrolTol) issues.push(`patrol ${p.id} pos differs ${dist(p, q).toFixed(2)}`);
    }
  }
  return issues;
}

/** Visible, non-canvas overlay boxes; reports pairwise overlaps and off-screen clipping. */
export async function layoutAudit(page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const sel = 'button, input, [data-testid], .menu-panel, .network-hud, .partner-overlay.visible, aside, #dev-readout, h1, p';
    const els = [...document.querySelectorAll(sel)].filter((el) => {
      if (el.id === 'game-canvas' || el.closest('#dev-readout') && el.id !== 'dev-readout') return false;
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 1 && r.height > 1;
    });
    const name = (el) => el.dataset.testid || el.id || `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` + (el.textContent ? `("${el.textContent.trim().slice(0, 18)}")` : '');
    const boxes = els.map((el) => ({ el, n: name(el), r: el.getBoundingClientRect() }));
    const offscreen = boxes.filter(({ r }) => r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1).map((b) => `${b.n} [${Math.round(b.r.left)},${Math.round(b.r.top)},${Math.round(b.r.right)},${Math.round(b.r.bottom)}]`);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 4 && h > 4) overlaps.push(`${a.n} x ${b.n} (${Math.round(w)}x${Math.round(h)})`);
    }
    const smallTargets = [...document.querySelectorAll('button, input, [role=button]')].filter((el) => {
      const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44);
    }).map((el) => `${name(el)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    return { vw, vh, overlaps, offscreen, smallTargets, scrollOverflow: document.documentElement.scrollWidth > vw + 1 || document.documentElement.scrollHeight > vh + 1 };
  });
}

/** Run a test body with a browser, always closing it. Prints a JSON result line. */
export async function runTest(name, body) {
  const started = Date.now();
  const result = { test: name, pass: false, notes: {} };
  const deadlineMs = Number(process.env.QA_TEST_DEADLINE_MS ?? (name === 'mobile' ? 595_000 : 295_000));
  const watchdog = setTimeout(() => {
    result.pass = false;
    result.error = `hard deadline exceeded after ${deadlineMs}ms`;
    result.seconds = Math.round((Date.now() - started) / 1000);
    console.log('QA_RESULT ' + JSON.stringify(result));
    process.exit(124);
  }, deadlineMs);
  let browser;
  try {
    browser = await launch();
    browser.on('disconnected', () => { result.notes.browserDisconnectedAt = Math.round((Date.now() - started) / 1000); });
    await body(browser, result.notes);
    result.pass = true;
  } catch (e) {
    result.error = String(e?.message ?? e).slice(0, 1500);
  } finally {
    await browser?.close().catch(() => {});
    clearTimeout(watchdog);
    result.seconds = Math.round((Date.now() - started) / 1000);
    console.log('QA_RESULT ' + JSON.stringify(result));
    process.exitCode = result.pass ? 0 : 1;
  }
}
