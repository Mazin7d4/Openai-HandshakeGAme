import { chromium } from 'playwright';

const APP_URL = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function position(page, playerId) {
  const text = await page.locator('#dev-readout').innerText();
  const match = text.match(
    new RegExp(`${playerId}\\s+x\\s+(-?\\d+\\.\\d)\\s+y\\s+(-?\\d+\\.\\d)\\s+z\\s+(-?\\d+\\.\\d)`),
  );
  if (!match) {
    throw new Error(`Could not read ${playerId} position from: ${text}`);
  }
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const browser = await chromium.launch({ headless: true });
const hostContext = await browser.newContext();
const guestContext = await browser.newContext();
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const errors = [];

for (const [name, page] of [
  ['host', host],
  ['guest', guest],
]) {
  page.on('pageerror', (error) => errors.push(`${name} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`${name} console: ${message.text()}`);
    }
  });
}

try {
  await host.goto(APP_URL);
  await host.getByTestId('multiplayer').click();
  await host.getByTestId('create-room').click();
  const code = (await host.getByTestId('room-code').innerText()).trim();
  assert(/^[A-Z2-9]{4}$/.test(code), `Unexpected room code: ${code}`);

  await guest.goto(APP_URL);
  await guest.getByTestId('multiplayer').click();
  await guest.getByTestId('join-room').click();
  await guest.getByTestId('room-code-input').fill(code);
  await guest.getByTestId('join-submit').click();

  await Promise.all([
    host.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 30_000 }),
    guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 30_000 }),
  ]);
  await Promise.all([
    host.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 }),
    guest.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 }),
  ]);
  await host.getByTestId('network-hud').waitFor({ state: 'visible' });
  await guest.getByTestId('network-hud').waitFor({ state: 'visible' });
  assert((await host.getByTestId('network-hud').innerText()).includes('PIX'), 'Host was not assigned PIX.');
  assert((await guest.getByTestId('network-hud').innerText()).includes('NEE'), 'Guest was not assigned NEE.');

  const pixBefore = await position(host, 'player-1');
  await host.keyboard.down('w');
  await host.waitForTimeout(850);
  await host.keyboard.up('w');
  await host.waitForTimeout(450);
  const pixHost = await position(host, 'player-1');
  const pixGuest = await position(guest, 'player-1');
  assert(distance(pixBefore, pixHost) > 0.5, 'PIX did not move under host input.');
  assert(distance(pixHost, pixGuest) < 2.5, 'PIX state did not reach the guest closely enough.');

  const neeBefore = await position(guest, 'player-2');
  await guest.keyboard.down('d');
  await guest.waitForTimeout(850);
  await guest.keyboard.up('d');
  await guest.waitForTimeout(450);
  const neeGuest = await position(guest, 'player-2');
  const neeHost = await position(host, 'player-2');
  assert(distance(neeBefore, neeGuest) > 0.5, 'NEE did not move under guest input.');
  assert(distance(neeHost, neeGuest) < 2.5, 'NEE state did not reach the host closely enough.');

  const remoteSamples = [];
  await host.keyboard.down('a');
  for (let i = 0; i < 12; i++) {
    await guest.waitForTimeout(50);
    remoteSamples.push((await position(guest, 'player-1')).x);
  }
  await host.keyboard.up('a');
  const distinctSamples = new Set(remoteSamples.map((value) => value.toFixed(1))).size;
  const maxStep = Math.max(
    ...remoteSamples.slice(1).map((value, index) => Math.abs(value - remoteSamples[index])),
  );
  assert(distinctSamples >= 4, `Remote interpolation produced too few intermediate samples: ${remoteSamples}`);
  assert(maxStep < 2.5, `Remote interpolation snapped too far in one sample: ${maxStep}`);

  if (SCREENSHOT_PATH) {
    await host.screenshot({ path: SCREENSHOT_PATH });
  }
  await guestContext.close();
  await host.getByTestId('network-hud').filter({ hasText: 'Partner disconnected' }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  assert(errors.length === 0, errors.join('\n'));

  console.log(
    JSON.stringify(
      {
        roomCode: code,
        hostRole: 'PIX',
        guestRole: 'NEE',
        pixMovement: distance(pixBefore, pixHost).toFixed(2),
        neeMovement: distance(neeBefore, neeGuest).toFixed(2),
        remoteDistinctSamples: distinctSamples,
        remoteMaxStep: maxStep.toFixed(2),
        disconnectNotice: true,
        screenshot: SCREENSHOT_PATH ?? null,
      },
      null,
      2,
    ),
  );
} finally {
  await hostContext.close();
  await guestContext.close().catch(() => undefined);
  await browser.close();
}
