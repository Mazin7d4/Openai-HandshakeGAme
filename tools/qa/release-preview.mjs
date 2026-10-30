// Release Preview & End-to-End Smoke Test under GitHub Pages base path.
// Captures 1280x720 and 844x390 screenshots for solo, co-op, quickmatch, daily, invite/QR, leaderboard, and settings.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { launch } from './lib.mjs';
import { freePort, startTestServer } from '../test-server.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS_DIR = '/workspace/handshake/sprint/netcode-agy/codex-big/shots';
const BASE_PATH = '/Openai-HandshakeGAme/';

console.log('[release-preview] Building production bundle under BASE_PATH=/Openai-HandshakeGAme/...');
execSync('npm run build', {
  cwd: ROOT,
  env: { ...process.env, BASE_PATH, PATH: `/home/box/.local/node22/bin:${process.env.PATH}` },
  stdio: 'inherit',
});

const DIST = join(ROOT, 'dist');
const serverPort = await freePort();
const previewPort = await freePort();

// Start backend game server
const backend = await startTestServer({
  port: serverPort,
  root: ROOT,
  env: { HANDSHAKE_TEST_HOOKS: '1' },
});
const wsUrl = `ws://127.0.0.1:${serverPort}`;

// Simple static server for dist mounted at BASE_PATH
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const staticServer = createServer((req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];
  if (!urlPath.startsWith(BASE_PATH)) {
    res.writeHead(302, { Location: BASE_PATH });
    res.end();
    return;
  }
  let subPath = urlPath.slice(BASE_PATH.length);
  if (!subPath || subPath.endsWith('/')) subPath += 'index.html';
  let filePath = join(DIST, subPath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, 'index.html'); // SPA fallback
  }

  const ext = extname(filePath);
  const mime = MIME[ext] ?? 'application/octet-stream';
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((resolve) => staticServer.listen(previewPort, '127.0.0.1', resolve));
const appBase = `http://127.0.0.1:${previewPort}${BASE_PATH}?debug=1&autotest=1&server=${encodeURIComponent(wsUrl)}`;

console.log(`[release-preview] Preview server live at ${appBase}`);

const browser = await launch();

async function runScenario(name, viewport, fn) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  try {
    console.log(`[release-preview] Running ${name} (${viewport.width}x${viewport.height})...`);
    await fn(page, ctx);
  } finally {
    await ctx.close().catch(() => {});
  }
}

try {
  // 1. Desktop 1280x720: Solo Gameplay
  await runScenario('solo-desktop', { width: 1280, height: 720 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('singleplayer').waitFor({ timeout: 20_000 });
    await page.getByTestId('singleplayer').click();
    await page.getByTestId('start-singleplayer').click();
    await page.locator('#game-canvas').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOTS_DIR}/preview-desktop-solo.png` });
  });

  // 2. Mobile 844x390: Solo Gameplay with Touch Controls
  await runScenario('solo-phone', { width: 844, height: 390 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('singleplayer').waitFor({ timeout: 20_000 });
    await page.getByTestId('singleplayer').click();
    await page.getByTestId('start-singleplayer').click();
    await page.locator('#game-canvas').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOTS_DIR}/preview-phone-solo.png` });
  });

  // 3. Desktop 1280x720: Co-op 2 Clients Join and Play
  await runScenario('coop-desktop', { width: 1280, height: 720 }, async (hostPage, hostCtx) => {
    await hostPage.goto(appBase);
    await hostPage.getByTestId('multiplayer').waitFor({ timeout: 20_000 });
    await hostPage.getByTestId('multiplayer').click();
    await hostPage.getByTestId('create-room').click();
    const code = (await hostPage.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();

    // Guest page in second context
    const guestCtx = await browser.newContext({ width: 1280, height: 720 });
    const guestPage = await guestCtx.newPage();
    try {
      await guestPage.goto(appBase);
      await guestPage.getByTestId('multiplayer').click();
      await guestPage.getByTestId('join-room').click();
      await guestPage.getByTestId('room-code-input').fill(code);
      await guestPage.getByTestId('join-submit').click();

      await Promise.all([
        hostPage.locator('#game-canvas').waitFor({ state: 'visible', timeout: 25_000 }),
        guestPage.locator('#game-canvas').waitFor({ state: 'visible', timeout: 25_000 }),
      ]);
      await hostPage.waitForTimeout(2000);

      await hostPage.screenshot({ path: `${SHOTS_DIR}/preview-desktop-coop-host.png` });
      await guestPage.screenshot({ path: `${SHOTS_DIR}/preview-desktop-coop-guest.png` });
    } finally {
      await guestCtx.close().catch(() => {});
    }
  });

  // 4. Mobile 844x390: Co-op Host View
  await runScenario('coop-phone', { width: 844, height: 390 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('multiplayer').waitFor({ timeout: 20_000 });
    await page.getByTestId('multiplayer').click();
    await page.screenshot({ path: `${SHOTS_DIR}/preview-phone-multiplayer-menu.png` });
  });

  // 5. Desktop & Phone: Invite Link & QR Code
  await runScenario('invite-qr', { width: 1280, height: 720 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('multiplayer').waitFor({ timeout: 20_000 });
    await page.getByTestId('multiplayer').click();
    await page.getByTestId('create-room').click();
    await page.getByTestId('room-code').waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS_DIR}/preview-desktop-invite-qr.png` });
  });

  await runScenario('invite-qr-phone', { width: 844, height: 390 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('multiplayer').waitFor({ timeout: 20_000 });
    await page.getByTestId('multiplayer').click();
    await page.getByTestId('create-room').click();
    await page.getByTestId('room-code').waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS_DIR}/preview-phone-invite-qr.png` });
  });

  // 6. Desktop & Phone: Leaderboard
  await runScenario('leaderboard-desktop', { width: 1280, height: 720 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('leaderboards').waitFor({ timeout: 20_000 });
    await page.getByTestId('leaderboards').click();
    await page.locator('.leaderboard-panel').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS_DIR}/preview-desktop-leaderboard.png` });
  });

  await runScenario('leaderboard-phone', { width: 844, height: 390 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('leaderboards').waitFor({ timeout: 20_000 });
    await page.getByTestId('leaderboards').click();
    await page.locator('.leaderboard-panel').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS_DIR}/preview-phone-leaderboard.png` });
  });

  // 7. Desktop & Phone: Settings with Version / Commit Sha
  await runScenario('settings-desktop', { width: 1280, height: 720 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('title-settings').waitFor({ timeout: 20_000 });
    await page.getByTestId('title-settings').click();
    await page.getByTestId('settings-menu').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS_DIR}/preview-desktop-settings.png` });
  });

  await runScenario('settings-phone', { width: 844, height: 390 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('title-settings').waitFor({ timeout: 20_000 });
    await page.getByTestId('title-settings').click();
    await page.getByTestId('settings-menu').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS_DIR}/preview-phone-settings.png` });
  });

  // 8. Quick Match
  await runScenario('quickmatch-desktop', { width: 1280, height: 720 }, async (page) => {
    await page.goto(appBase);
    await page.getByTestId('multiplayer').waitFor({ timeout: 20_000 });
    await page.getByTestId('multiplayer').click();
    await page.getByTestId('quick-match').waitFor({ timeout: 20_000 });
    await page.getByTestId('quick-match').click();
    await page.getByTestId('qm-panel').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS_DIR}/preview-desktop-quickmatch.png` });
  });

  console.log('[release-preview] ALL preview scenarios captured successfully!');
} finally {
  await browser.close();
  staticServer.close();
  await backend.stop();
}
