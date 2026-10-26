import { Client } from '@colyseus/sdk';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTest, url, assert, collectErrors, devices } from './lib.mjs';
import { freePort, startTestServer } from '../test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const phone = {
  ...devices['Pixel 5'],
  viewport: { width: 360, height: 640 },
  screen: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function waitFor(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${message}`);
}
function assertNoUnexpectedErrors(errors, label) {
  const unexpected = errors.filter((error) => !/ERR_CONNECTION_REFUSED|Failed to load resource/i.test(error));
  assert(unexpected.length === 0, `${label} page errors: ${unexpected.join('; ')}`);
}

async function seedCoop(serverUrl) {
  const rooms = [];
  const host = await new Client(serverUrl).create('handshake', { mode: 'nightshift' });
  rooms.push(host);
  const guest = await new Client(serverUrl).joinById(host.roomId);
  rooms.push(guest);
  const recorded = [];
  const hostNames = [];
  const guestNames = [];
  host.onMessage('leaderboard-recorded', (message) => recorded.push(message));
  host.onMessage('leaderboard-name-result', (message) => hostNames.push(message));
  guest.onMessage('leaderboard-name-result', (message) => guestNames.push(message));
  try {
    await waitFor(() => host.state.started && host.state.players.size === 2, 'co-op room started');
    host.send('debug-run-clear', { elapsedSeconds: 0, timesSpotted: 0 });
    await waitFor(() => host.state.run.floorCleared, 'first floor cleared');
    host.send('run-next-floor', { floor: 1 });
    await waitFor(() => host.state.run.floor === 2, 'second floor started');
    host.send('debug-run-capture');
    host.send('debug-run-capture');
    host.send('debug-run-capture');
    await waitFor(() => recorded.length === 1, 'co-op leaderboard record');
    host.send('leaderboard-name', { name: 'PIX Crew' });
    await waitFor(() => hostNames.some((message) => message.ok === true), 'PIX name saved');
    await sleep(1_100);
    guest.send('leaderboard-name', { name: 'NEE Crew' });
    await waitFor(() => guestNames.some((message) => message.ok === true), 'NEE name saved');
  } finally {
    for (const room of rooms) {
      room.reconnection.maxRetries = 0;
      await Promise.race([room.leave(true).catch(() => {}), sleep(500)]);
    }
  }
}

await runTest('title-best-crew', async (browser, notes) => {
  const server = await startTestServer({
    port: await freePort(), root,
    env: {
      HANDSHAKE_TEST_HOOKS: '1',
      LEADERBOARD_ACCEPT_DEBUG: '1',
      LEADERBOARD_MIN_FLOOR_SECONDS: '0',
      LEADERBOARD_FILE: 'off',
      EMPTY_ROOM_SECONDS: '120',
      LONELY_ROOM_SECONDS: '120',
    },
  });
  const serverUrl = `ws://127.0.0.1:${server.port}`;
  const context = await browser.newContext(phone);
  const errors = [];
  try {
    const title = await context.newPage();
    collectErrors(title, 'title', errors);
    await title.goto(url({ server: serverUrl }));
    await title.waitForFunction(() => document.documentElement.dataset.warmup === 'ready', null, { timeout: 15_000 });
    const best = title.getByTestId('title-best-crew');
    await best.waitFor({ state: 'visible', timeout: 10_000 });
    assert((await best.innerText()) === 'Best crew · be the first crew tonight', 'empty title best crew text');
    assert(await best.getAttribute('data-state') === 'empty', 'empty title best crew state');

    await seedCoop(serverUrl);
    await title.reload();
    await title.waitForFunction(() => document.documentElement.dataset.warmup === 'ready', null, { timeout: 15_000 });
    await best.waitFor({ state: 'visible', timeout: 10_000 });
    const bestText = await best.innerText();
    assert(bestText.includes('Best crew'), `best crew label missing: ${bestText}`);
    assert(bestText.includes('PIX Crew') && bestText.includes('NEE Crew'), `crew names missing: ${bestText}`);
    assert(bestText.includes('Night Shift') && bestText.includes('floor'), `Night Shift details missing: ${bestText}`);
    const box = await best.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 360, `best crew overflows: ${JSON.stringify(box)}`);
    assert(await title.evaluate(() => document.documentElement.scrollWidth <= 360), 'title has horizontal overflow');
    notes.bestCrew = { text: bestText, box };
    await title.close();

    const offlineErrors = [];
    const offline = await context.newPage();
    collectErrors(offline, 'offline', offlineErrors);
    await offline.goto(url({ server: `ws://127.0.0.1:${await freePort()}` }));
    await offline.getByTestId('singleplayer').waitFor({ state: 'visible', timeout: 5_000 });
    const offlineBest = offline.getByTestId('title-best-crew');
    await offline.waitForTimeout(3_000);
    assert(await offlineBest.isHidden(), 'offline title best crew became visible');
    assert(await offlineBest.getAttribute('data-state') === 'idle' || await offlineBest.getAttribute('data-state') === 'hidden', 'offline title best crew state');
    assertNoUnexpectedErrors(offlineErrors, 'offline');
    await offline.close();
  } finally {
    assertNoUnexpectedErrors(errors, 'title');
    await context.close();
    await server.stop();
  }
});
