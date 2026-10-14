import { chromium } from 'playwright';

const rawUrl = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const urlObj = new URL(rawUrl);
urlObj.searchParams.set('debug', '1');
const APP_URL = urlObj.toString();
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
    host.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 }),
    guest.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 }),
  ]);
  await host.getByTestId('network-hud').waitFor({ state: 'visible' });
  await guest.getByTestId('network-hud').waitFor({ state: 'visible' });
  await host.waitForTimeout(1500);

  // PIX (host) drifts to the end of the slack cord, stops, then yanks.
  await host.keyboard.down('a');
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    if (distance(await position(host, 'player-1'), await position(host, 'player-2')) > 5.8) break;
    await host.waitForTimeout(60);
  }
  await host.keyboard.up('a');
  await host.waitForTimeout(900);
  const pix = await position(host, 'player-1');
  const neeBefore = await position(guest, 'player-2');
  await host.keyboard.press('r');
  await guest.waitForTimeout(900);
  const neeAfter = await position(guest, 'player-2');
  const closed = distance(neeBefore, pix) - distance(neeAfter, pix);
  console.log('remote yank: NEE (on its own client) closed', closed.toFixed(2), 'm');
  if (SCREENSHOT_PATH) await guest.screenshot({ path: SCREENSHOT_PATH });
  assert(closed > 1, `Remote yank did not reach NEE's client (closed ${closed.toFixed(2)} m).`);
  assert(!errors.length, errors.join('\n'));
  console.log('verify-multiplayer-yank: PASS');
} finally {
  await browser.close();
}
