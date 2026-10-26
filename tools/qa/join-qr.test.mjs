import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
import { runTest, url, assert, collectErrors, layoutAudit, waitForGame, devices, SERVER_URL } from './lib.mjs';
import { freePort, startTestServer } from '../test-server.mjs';
import { startWakeProxy } from './wake-proxy.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const phone360 = { ...devices['Pixel 5'], viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 }, hasTouch: true, isMobile: true };
const phone390 = { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

let phase = 'start';

async function openLobby(browser, options, contextOptions, errors, name, initScript) {
  const context = await browser.newContext(contextOptions);
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  collectErrors(page, name, { push: (...lines) => errors.push(...lines.map((line) => `[${phase}] ${line}`)) });
  await page.goto(url(options));
  await page.getByTestId('multiplayer').tap();
  await page.getByTestId('create-room').tap();
  await page.getByTestId('room-code').waitFor({ state: 'visible', timeout: 20_000 });
  return { context, page };
}

async function auditLobby(page) {
  const audit = await layoutAudit(page);
  const boxes = await page.evaluate(() => {
    const width = innerWidth;
    const selectors = ['[data-testid="invite-qr"]', '[data-testid="room-code"]', '[data-testid="copy-code"]'];
    return {
      scrollWidth: document.documentElement.scrollWidth,
      width,
      height: innerHeight,
      bounds: selectors.map((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect && { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }),
    };
  });
  assert(boxes.scrollWidth <= boxes.width, `${boxes.width}px lobby has horizontal overflow: ${boxes.scrollWidth}`);
  assert(boxes.bounds.every((box) => box && box.left >= 0 && box.right <= boxes.width), `lobby bounds are horizontally offscreen: ${JSON.stringify(boxes)}`);
  return { audit, boxes };
}

async function decodeInvite(page) {
  const qr = page.getByTestId('invite-qr');
  await qr.locator('svg').waitFor({ state: 'visible' });
  const png = PNG.sync.read(await qr.screenshot());
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert(decoded?.data, 'QR screenshot did not decode');
  return decoded.data;
}

async function assertConnectedPlayers(page, name) {
  const hud = await page.getByTestId('network-hud').innerText({ timeout: 10_000 });
  assert(!hud.includes('Partner disconnected'), `${name} does not show a connected partner: ${hud}`);
}

async function body(browser, notes) {
  const errors = [];
  const contexts = new Set();
  const proxies = new Set();
  const servers = new Set();
  const trackContext = (context) => { contexts.add(context); return context; };
  const close = async (entry) => { contexts.delete(entry.context); await entry.context.close().catch(() => {}); };
  const newServer = async () => {
    const server = await startTestServer({ port: await freePort(), root, env: { HANDSHAKE_TEST_HOOKS: '' } });
    servers.add(server);
    return server;
  };

  try {
    phase = 'qr-and-copy';
    const hostUrl = url({ server: SERVER_URL });
    const origin = new URL(hostUrl).origin;
    const hostContext = trackContext(await browser.newContext(phone390));
    await hostContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const host = { context: hostContext, page: await hostContext.newPage() };
    collectErrors(host.page, 'host', { push: (...lines) => errors.push(...lines.map((line) => `[${phase}] ${line}`)) });
    await host.page.goto(hostUrl);
    await host.page.getByTestId('multiplayer').tap();
    await host.page.getByTestId('create-room').tap();
    const code = (await host.page.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
    const invite = await host.page.getByTestId('invite-link').inputValue();
    const decodedInvite = await decodeInvite(host.page);
    assert(decodedInvite === invite, `QR decoded ${decodedInvite}, invite input is ${invite}`);
    const inviteUrl = new URL(invite);
    assert(inviteUrl.searchParams.get('room') === code, 'invite URL room does not match room code');
    assert([...inviteUrl.searchParams.keys()].every((key) => key === 'room' || key === 'server'), `invite URL has unexpected params: ${inviteUrl.search}`);
    assert(inviteUrl.searchParams.has('server'), 'local invite URL omitted server override');
    await auditLobby(host.page);
    await host.page.getByTestId('copy-code').tap();
    assert(await host.page.getByTestId('copy-code').innerText() === 'Copied', 'copy button did not show Copied');
    try {
      assert(await host.page.evaluate(() => navigator.clipboard.readText()) === invite, 'clipboard text does not match invite');
    } catch (error) {
      notes.clipboardRead = `readText unavailable in headless browser: ${error.message}`;
    }
    notes.qr = { code, invite };

    phase = 'copy-fallback';
    const fallback = await openLobby(browser, { server: SERVER_URL }, phone390, errors, 'copy-fallback', () => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('clipboard denied')) },
      });
    });
    trackContext(fallback.context);
    await fallback.page.getByTestId('copy-code').tap();
    const selection = await fallback.page.getByTestId('invite-link').evaluate((input) => ({
      active: document.activeElement === input,
      start: input.selectionStart,
      end: input.selectionEnd,
      length: input.value.length,
    }));
    assert(selection.active && selection.start === 0 && selection.end === selection.length, `copy fallback did not select invite: ${JSON.stringify(selection)}`);
    await close(fallback);

    phase = 'layout-360';
    const narrow = await openLobby(browser, { server: SERVER_URL }, phone360, errors, 'layout-360');
    trackContext(narrow.context);
    await auditLobby(narrow.page);
    await close(narrow);

    phase = 'join-via-url';
    const guestContext = trackContext(await browser.newContext(phone360));
    await guestContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const guest = { context: guestContext, page: await guestContext.newPage() };
    collectErrors(guest.page, 'guest', { push: (...lines) => errors.push(...lines.map((line) => `[${phase}] ${line}`)) });
    await guest.page.goto(decodedInvite);
    await Promise.all([waitForGame(host.page), waitForGame(guest.page)]);
    await Promise.all([assertConnectedPlayers(host.page, 'host'), assertConnectedPlayers(guest.page, 'guest')]);
    notes.joinedViaUrl = true;
    await close(guest);
    await close(host);

    phase = 'cold-start-via-url';
    const coldServer = await newServer();
    const proxy = await startWakeProxy({ targetPort: coldServer.port, downMs: 6_000, mode: '503' });
    proxies.add(proxy);
    const coldHost = await openLobby(browser, { server: `ws://127.0.0.1:${coldServer.port}` }, phone390, errors, 'cold-host');
    trackContext(coldHost.context);
    const coldCode = (await coldHost.page.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
    const coldInvite = new URL(await coldHost.page.getByTestId('invite-link').inputValue());
    assert(coldInvite.searchParams.get('room') === coldCode, 'cold-start host invite room mismatch');
    coldInvite.searchParams.set('server', proxy.url);
    const coldGuestContext = trackContext(await browser.newContext(phone360));
    const coldGuest = { context: coldGuestContext, page: await coldGuestContext.newPage() };
    collectErrors(coldGuest.page, 'cold-guest', { push: (...lines) => errors.push(...lines.map((line) => `[${phase}] ${line}`)) });
    await coldGuest.page.goto(coldInvite.toString());
    await coldGuest.page.getByTestId('wake-overlay').waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([waitForGame(coldHost.page, 40_000), waitForGame(coldGuest.page, 40_000)]);
    await Promise.all([assertConnectedPlayers(coldHost.page, 'cold host'), assertConnectedPlayers(coldGuest.page, 'cold guest')]);
    notes.coldStart = true;
    await close(coldGuest);
    await close(coldHost);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    for (const proxy of proxies) await proxy.close().catch(() => {});
    for (const server of servers) await server.stop().catch(() => {});
  }

  const unexpected = errors.filter((line) => !proxiesOf(errors, proxies).has(line) && !/status of 503 \(Service Unavailable\)/.test(line));
  assert(unexpected.length === 0, `${unexpected.length} unexpected console/page error(s):\n${unexpected.join('\n')}`);
}

function proxiesOf(errors, proxies) {
  const ports = [...proxies].map((proxy) => `:${proxy.port}`);
  return new Set(errors.filter((line) => ports.some((port) => line.includes(port))));
}

await runTest('join-qr', async (browser, notes) => {
  try {
    await body(browser, notes);
  } catch (error) {
    notes.failedPhase = phase;
    throw new Error(`[${phase}] ${error?.message ?? error}`);
  }
});
