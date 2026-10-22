// Deployed smoke test: two separate browser contexts (two "devices") against a live URL.
// Host creates a room, guest joins by code, both fly, each sees the other move.
// Usage: node tools/verify-deployed.mjs [pagesUrl] [serverUrl]
//   pagesUrl  default https://mazin7d4.github.io/Openai-HandshakeGAme/
//   serverUrl optional ws(s)/http(s) Colyseus URL; passed to the client as ?server= and health-checked.
// Allows ~2 minutes for a sleeping free-tier server to wake. Run under `timeout`.
import { chromium } from 'playwright';

const PAGES_URL = process.argv[2] ?? process.env.PAGES_URL ?? 'https://mazin7d4.github.io/Openai-HandshakeGAme/';
const SERVER_URL = process.argv[3] ?? process.env.SERVER_URL ?? '';
const WAKE_MS = Number(process.env.WAKE_MS ?? 150_000);

const url = new URL(PAGES_URL);
url.searchParams.set('debug', '1');
url.searchParams.set('autotest', '1');
url.searchParams.set('scale', '4');
url.searchParams.set('lowfx', '1');
if (SERVER_URL) url.searchParams.set('server', SERVER_URL);
const APP_URL = url.toString();

const t0 = Date.now();
const elapsed = () => +((Date.now() - t0) / 1000).toFixed(1);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function readoutPosition(page, playerId) {
  const text = await page.locator('#dev-readout').innerText();
  const m = text.match(new RegExp(`${playerId}\\s+x\\s+(-?\\d+\\.\\d)\\s+y\\s+(-?\\d+\\.\\d)\\s+z\\s+(-?\\d+\\.\\d)`));
  if (!m) throw new Error(`Could not read ${playerId} position from: ${text.slice(0, 300)}`);
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
}

async function health() {
  if (!SERVER_URL) return null;
  const http = SERVER_URL.replace(/^ws/, 'http').replace(/\/+$/, '');
  const started = Date.now();
  while (Date.now() - started < WAKE_MS) {
    try {
      const res = await fetch(`${http}/__healthcheck`, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        const wakeSeconds = +((Date.now() - started) / 1000).toFixed(1);
        const detail = await fetch(`${http}/health`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        return { wakeSeconds, health: detail ?? 'no /health (older server)' };
      }
    } catch { /* sleeping host: keep polling */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Server ${http}/health did not answer within ${WAKE_MS / 1000}s`);
}

// Fly the local drone a few metres with the autopilot and wait until the partner sees it.
async function flyAndObserve(mover, observer, role, playerId, dx) {
  const before = await mover.evaluate((r) => window.__autotest.position(r), role);
  assert(before, `${role} has no local position`);
  await mover.evaluate(([r, p, d]) => window.__autotest.goto(r, p.x + d, p.y, p.z + 2, 0.8, false), [role, before, dx]);
  await mover.waitForFunction((r) => window.__autotest.arrived(r), role, { timeout: 60_000, polling: 250 });
  const after = await mover.evaluate((r) => window.__autotest.position(r), role);
  const moved = distance(before, after);
  assert(moved > 1.5, `${role} only moved ${moved.toFixed(2)}`);
  let seen = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    seen = await readoutPosition(observer, playerId);
    if (distance(seen, after) < 1.5) break;
    await observer.waitForTimeout(250);
  }
  const lag = distance(seen, after);
  assert(lag < 1.5, `partner sees ${role} ${lag.toFixed(2)} away from its local position`);
  return { moved: +moved.toFixed(2), remoteError: +lag.toFixed(2) };
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const errors = [];
const failedRequests = [];
for (const [name, page] of [['host', host], ['guest', guest]]) {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('requestfailed', (r) => { if (!/\/(health|__healthcheck)/.test(r.url())) failedRequests.push(`${name} ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !/\/(health|__healthcheck)/.test(r.url())) failedRequests.push(`${name} ${r.status()} ${r.url()}`); });
}

const result = { pagesUrl: PAGES_URL, serverUrl: SERVER_URL || '(baked into build)' };
try {
  result.health = await health();

  await host.goto(APP_URL);
  await host.getByTestId('multiplayer').click();
  await host.getByTestId('create-room').click();
  const wakeSeen = host.getByTestId('wake-overlay').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  const codeNode = host.getByTestId('room-code');
  await codeNode.waitFor({ state: 'visible', timeout: WAKE_MS });
  result.wakeOverlayShown = await wakeSeen;
  const code = (await codeNode.innerText()).trim();
  assert(/^[A-Z2-9]{4}$/.test(code), `Unexpected room code: ${code}`);
  result.roomCode = code;
  result.roomCreatedAt = elapsed();

  await guest.goto(APP_URL);
  await guest.getByTestId('multiplayer').click();
  await guest.getByTestId('join-room').click();
  await guest.getByTestId('room-code-input').fill(code);
  await guest.getByTestId('join-submit').click();

  for (const page of [host, guest]) {
    await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 120_000 });
    await page.getByTestId('network-hud').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => window.__autotest?.position, null, { timeout: 30_000 });
  }
  result.bothInGameAt = elapsed();
  assert((await host.getByTestId('network-hud').innerText()).includes('PIX'), 'Host was not assigned PIX.');
  assert((await guest.getByTestId('network-hud').innerText()).includes('NEE'), 'Guest was not assigned NEE.');
  await host.waitForFunction(() => window.__autotest.position('pix'), null, { timeout: 30_000, polling: 250 });
  await guest.waitForFunction(() => window.__autotest.position('nee'), null, { timeout: 30_000, polling: 250 });

  result.pix = await flyAndObserve(host, guest, 'pix', 'player-1', -3);
  result.nee = await flyAndObserve(guest, host, 'nee', 'player-2', 3);

  // Havok wasm and every asset must have loaded under the deployed subpath.
  const badAssets = failedRequests.filter((r) => /\.(wasm|glb|js|css|svg)(\?|\s|$)/.test(r));
  assert(badAssets.length === 0, `Asset requests failed:\n${badAssets.join('\n')}`);
  assert(errors.length === 0, errors.join('\n'));

  await guestContext.close();
  await host.getByTestId('network-hud').filter({ hasText: 'Partner disconnected' }).waitFor({ state: 'visible', timeout: 20_000 });
  result.disconnectNotice = true;
  result.totalSeconds = elapsed();
  result.pass = true;
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.pass = false;
  result.error = error instanceof Error ? error.message : String(error);
  result.errors = errors;
  result.failedRequests = failedRequests.slice(0, 20);
  result.totalSeconds = elapsed();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await hostContext.close().catch(() => undefined);
  await guestContext.close().catch(() => undefined);
  await browser.close();
}
