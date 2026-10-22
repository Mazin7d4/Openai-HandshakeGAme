// Shared helpers for the PIX QA regression suite (tools/qa/*.test.mjs).
// Env: QA_URL (default http://127.0.0.1:5183/?scale=4&lowfx), QA_SHOTS (screenshot dir).
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

export const BASE_URL = process.env.QA_URL ?? process.argv[2] ?? 'http://127.0.0.1:5183/?scale=4&lowfx';
export const SHOTS = process.env.QA_SHOTS ?? '/workspace/handshake/sprint/screens/qa';
mkdirSync(SHOTS, { recursive: true });

/** Software-GL flags (no GPU on the box), same as verify-companion / probe-fps. */
export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

export function url(extra = {}) {
  const u = new URL(BASE_URL);
  u.searchParams.set('debug', '1');
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

export function assert(cond, msg) { if (!cond) throw new Error(msg); }

export async function launch() { return chromium.launch({ headless: true, args: GL_ARGS }); }
export { devices };

/** Collect page errors + console errors. Known-noise patterns can be added to IGNORE. */
const IGNORE = [/favicon/i];
export function collectErrors(page, name, errors) {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errors.push(`${name} console: ${m.text()}`);
  });
  return errors;
}

export async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

export async function waitForGame(page, timeout = 120_000) {
  await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout });
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout });
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
  const patrols = parsePatrols(text);
  return { players, mission, objects, patrols, raw: text };
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
  const browser = await launch();
  const result = { test: name, pass: false, notes: {} };
  try {
    await body(browser, result.notes);
    result.pass = true;
  } catch (e) {
    result.error = String(e?.message ?? e).slice(0, 1500);
  } finally {
    await browser.close().catch(() => {});
    result.seconds = Math.round((Date.now() - started) / 1000);
    console.log('QA_RESULT ' + JSON.stringify(result));
    process.exitCode = result.pass ? 0 : 1;
  }
}
