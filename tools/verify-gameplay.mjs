import { chromium } from 'playwright';

const APP_URL = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readout(page) {
  return page.locator('#dev-readout').innerText();
}

async function playerPosition(page, id) {
  const text = await readout(page);
  const match = text.match(new RegExp(`${id}\\s+x\\s+(-?\\d+\\.\\d)\\s+y\\s+(-?\\d+\\.\\d)\\s+z\\s+(-?\\d+\\.\\d)`));
  if (!match) throw new Error(`Missing ${id} position in ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

async function playerPull(page, id) {
  const text = await readout(page);
  const line = text.split('\n').find((candidate) => candidate.startsWith(id));
  const match = line?.match(/tether-pull\s+([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

async function objectState(page, id) {
  const text = await readout(page);
  const match = text.match(new RegExp(`${id}:(pix|nee|free)@(-?\\d+\\.\\d),(-?\\d+\\.\\d),(-?\\d+\\.\\d)`));
  if (!match) throw new Error(`Missing ${id} state in ${text}`);
  return { holder: match[1], x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) };
}

async function waitForText(page, text, timeout = 10_000) {
  await page.locator('#dev-readout').filter({ hasText: text }).waitFor({ state: 'visible', timeout });
}

async function moveToward(page, playerId, target, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const position = await playerPosition(page, playerId);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (Math.abs(dx) < 1.7 && Math.abs(dz) < 1.7) return position;
    const keys = [];
    if (Math.abs(dx) >= 0.7) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dz) >= 0.7) keys.push(dz > 0 ? 'w' : 's');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(110);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(35);
  }
  throw new Error(`${playerId} did not reach ${JSON.stringify(target)}; ended at ${JSON.stringify(await playerPosition(page, playerId))}`);
}

async function chaseAndGrab(page, playerId, objectId, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const [player, object] = await Promise.all([
      playerPosition(page, playerId),
      objectState(page, objectId),
    ]);
    if (Math.hypot(player.x - object.x, player.y - object.y, player.z - object.z) < 3) {
      await page.keyboard.press('e');
      return;
    }
    const keys = [];
    if (Math.abs(object.x - player.x) >= 0.7) keys.push(object.x > player.x ? 'd' : 'a');
    if (Math.abs(object.z - player.z) >= 0.7) keys.push(object.z > player.z ? 'w' : 's');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(110);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(35);
  }
  throw new Error(`${playerId} could not catch ${objectId}.`);
}

async function solvePacketRouting(page) {
  const overlay = page.getByTestId('packet-routing');
  await overlay.waitFor({ state: 'visible', timeout: 10_000 });
  for (let index = 0; index < 16; index++) {
    for (let rotation = 0; rotation < 4; rotation++) {
      if (!(await overlay.isVisible().catch(() => false))) return;
      const node = overlay.locator(`.packet-node[data-index="${index}"]`);
      const solution = Number(await node.getAttribute('data-solution-mask'));
      if (!solution) break;
      const current = Number(await node.getAttribute('data-mask'));
      if (current === solution) break;
      await node.click();
    }
  }
  await overlay.waitFor({ state: 'detached', timeout: 10_000 });
}

const browser = await chromium.launch({ headless: true });
const hostContext = await browser.newContext();
const guestContext = await browser.newContext();
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const errors = [];

for (const [name, page] of [['host', host], ['guest', guest]]) {
  page.on('pageerror', (error) => errors.push(`${name} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name} console: ${message.text()}`);
  });
}

try {
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
    host.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 30_000 }),
    guest.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 30_000 }),
  ]);

  await host.keyboard.press('f');
  await host.waitForTimeout(300);
  assert(await host.getByTestId('packet-routing').count() === 0, 'Hack opened outside station range.');
  await Promise.all([
    host.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 }),
    guest.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 }),
  ]);

  await host.keyboard.down('w');
  await host.waitForTimeout(700);
  await host.keyboard.up('w');
  await host.waitForTimeout(250);
  await host.keyboard.press('e');
  await host.waitForTimeout(700);
  await Promise.all([waitForText(host, 'cargo-core:pix'), waitForText(guest, 'cargo-core:pix')]);

  await host.waitForTimeout(500);
  await host.keyboard.press('q');
  await Promise.all([waitForText(host, 'cargo-core:free'), waitForText(guest, 'cargo-core:free')]);
  await host.waitForTimeout(1_100);
  const thrownHost = await objectState(host, 'cargo-core');
  const thrownGuest = await objectState(guest, 'cargo-core');
  assert(Math.hypot(thrownHost.x - thrownGuest.x, thrownHost.z - thrownGuest.z) < 2, 'Thrown object diverged between clients.');

  await chaseAndGrab(guest, 'player-2', 'cargo-core');
  await Promise.all([waitForText(host, 'cargo-core:nee'), waitForText(guest, 'cargo-core:nee')]);
  await guest.keyboard.press('e');
  await Promise.all([waitForText(host, 'cargo-core:free'), waitForText(guest, 'cargo-core:free')]);

  await Promise.all([
    moveToward(host, 'player-1', { x: -2.5, z: -8.5 }, 18_000),
    moveToward(guest, 'player-2', { x: 2.5, z: -8.5 }, 18_000),
  ]);
  await Promise.all([host.keyboard.press('f'), guest.keyboard.press('f')]);
  await Promise.all([solvePacketRouting(host), solvePacketRouting(guest)]);
  await Promise.all([waitForText(host, 'door:open', 10_000), waitForText(guest, 'door:open', 10_000)]);
  assert((await readout(host)).includes('A:complete'), 'PIX routing station did not complete.');
  assert((await readout(host)).includes('B:complete'), 'NEE routing station did not complete.');

  const idleBefore = await playerPosition(guest, 'player-2');
  let maxRemotePull = 0;
  await host.keyboard.down('a');
  await host.keyboard.down('Shift');
  for (let i = 0; i < 18; i++) {
    await guest.waitForTimeout(100);
    maxRemotePull = Math.max(maxRemotePull, await playerPull(guest, 'player-2'));
  }
  await host.keyboard.up('Shift');
  await host.keyboard.up('a');
  await host.waitForTimeout(500);
  const idleAfter = await playerPosition(guest, 'player-2');
  assert(
    Math.hypot(idleAfter.x - idleBefore.x, idleAfter.z - idleBefore.z) > 0.25,
    'Idle remote drone was not dragged by tether tension.',
  );
  assert(maxRemotePull > 0.08, `Remote tether pull cause was not synchronized: ${maxRemotePull}`);

  await guestContext.close();
  await host.getByTestId('network-hud').filter({ hasText: 'Partner disconnected' }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  assert((await readout(host)).includes('door:open'), 'Interactables failed after disconnect.');
  assert(errors.length === 0, errors.join('\n'));

  console.log(JSON.stringify({
    roomCode: code,
    pixGrabSeenByNee: true,
    pixThrowSynchronized: true,
    neeRegrabSynchronized: true,
    idleRemoteTetherDragged: true,
    tetherCauseSynchronized: true,
    hackingRequiresProximity: true,
    packetRoutingCompletedByBoth: true,
    cooperativeHackCompleted: true,
    doorOpenedOnBoth: true,
    disconnectStable: true,
  }, null, 2));
} finally {
  await hostContext.close().catch(() => undefined);
  await guestContext.close().catch(() => undefined);
  await browser.close();
}
