import { chromium } from 'playwright';

const APP_URL = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const DEBUG_URL = new URL(APP_URL);
DEBUG_URL.searchParams.set('debug', '1');

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

const fwdX = 0.325;
const fwdZ = 0.946;

async function moveToward(page, playerId, target, timeout = 18_000, tolerance = 2.0) {
  await page.bringToFront();
  await page.getByTestId('game-canvas').click();
  const started = Date.now();
  const targetY = target.y ?? 2.2;
  while (Date.now() - started < timeout) {
    const position = await playerPosition(page, playerId);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const dy = targetY - position.y;
    if (Math.abs(dx) <= tolerance && Math.abs(dz) <= tolerance && Math.abs(dy) <= 1.4) return position;
    const thrust = fwdX * dx + fwdZ * dz;
    const strafe = fwdZ * dx - fwdX * dz;
    const keys = [];
    if (Math.abs(strafe) > 0.3) keys.push(strafe > 0 ? 'd' : 'a');
    if (Math.abs(thrust) > 0.3) keys.push(thrust > 0 ? 'w' : 's');
    if (position.y > targetY + 0.45) keys.push('c');
    else if (position.y < targetY - 0.45) keys.push('Space');
    keys.push('Shift');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(110);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(35);
  }
  const finalPos = await playerPosition(page, playerId);
  if (Math.abs(target.x - finalPos.x) <= tolerance && Math.abs(target.z - finalPos.z) <= tolerance) return finalPos;
  throw new Error(`${playerId} did not reach ${JSON.stringify(target)}; ended at ${JSON.stringify(finalPos)}`);
}

async function chaseAndGrab(page, playerId, objectId, timeout = 25_000) {
  await page.bringToFront();
  await page.getByTestId('game-canvas').click();
  const started = Date.now();
  let lastDist = 0;
  const targetRole = playerId.replace('player-1', 'pix').replace('player-2', 'nee');
  while (Date.now() - started < timeout) {
    const [player, object] = await Promise.all([
      playerPosition(page, playerId),
      objectState(page, objectId),
    ]);
    const dist3D = Math.hypot(player.x - object.x, player.y - object.y, player.z - object.z);
    lastDist = dist3D;
    if (dist3D < 3.0) {
      await page.keyboard.down('e');
      await page.waitForTimeout(400);
      await page.keyboard.up('e');
      await page.waitForTimeout(400);
      const state = await objectState(page, objectId);
      if (state.holder === targetRole) return;
    }
    const dx = object.x - player.x;
    const dz = object.z - player.z;
    const thrust = fwdX * dx + fwdZ * dz;
    const strafe = fwdZ * dx - fwdX * dz;
    const keys = [];
    if (Math.abs(strafe) > 0.3) keys.push(strafe > 0 ? 'd' : 'a');
    if (Math.abs(thrust) > 0.3) keys.push(thrust > 0 ? 'w' : 's');
    if (player.y > object.y + 0.45) keys.push('c');
    else if (player.y < object.y - 0.45) keys.push('Space');
    keys.push('Shift');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(130);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(40);
  }
  const [player, object] = await Promise.all([playerPosition(page, playerId), objectState(page, objectId)]);
  throw new Error(`${playerId} could not catch ${objectId}; distance was ${lastDist}, player=${JSON.stringify(player)}, object=${JSON.stringify(object)}`);
}

async function solvePacketRouting(page) {
  const overlay = page.getByTestId('packet-routing');
  await overlay.waitFor({ state: 'visible', timeout: 10_000 });
  for (let index = 0; index < 16; index++) {
    for (let rotation = 0; rotation < 4; rotation++) {
      if (!(await overlay.isVisible().catch(() => false))) return;
      const node = overlay.locator(`.packet-node[data-index="${index}"]`);
      const solutionValue = await node.getAttribute('data-solution-mask').catch(() => null);
      if (solutionValue === null) return;
      const solution = Number(solutionValue);
      const currentValue = await node.getAttribute('data-mask').catch(() => null);
      if (currentValue === null || !solution || Number(currentValue) === solution) break;
      await node.click().catch(() => undefined);
    }
  }
  await overlay.waitFor({ state: 'detached', timeout: 10_000 });
}

async function solveSignalMatch(page) {
  const overlay = page.getByTestId('signal-match');
  await overlay.waitFor({ state: 'visible', timeout: 10_000 });
  await overlay.locator('[data-control="frequency"]').fill(await overlay.getAttribute('data-target-frequency'));
  await overlay.locator('[data-control="amplitude"]').fill(await overlay.getAttribute('data-target-amplitude'));
  await overlay.waitFor({ state: 'detached', timeout: 10_000 });
}

async function solveMemoryTrace(page) {
  const overlay = page.getByTestId('memory-trace');
  await overlay.waitFor({ state: 'visible', timeout: 10_000 });
  for (let round = 0; round < 3; round++) {
    await overlay.locator('.hack-status').filter({ hasText: 'REPEAT' }).waitFor({ timeout: 15_000 });
    const sequence = (await overlay.getAttribute('data-sequence')).split(',').map(Number);
    for (const index of sequence) {
      await overlay.locator(`[data-index="${index}"]`).click();
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(750);
  }
  await overlay.waitFor({ state: 'detached', timeout: 15_000 });
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});
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
  await host.goto(DEBUG_URL.href);
  await host.getByTestId('multiplayer').click();
  await host.getByTestId('create-room').click();
  const code = (await host.getByTestId('room-code').innerText()).trim();
  await guest.goto(DEBUG_URL.href);
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

  await host.keyboard.press('f');
  await host.waitForTimeout(300);
  assert(await host.getByTestId('packet-routing').count() === 0, 'Hack opened outside station range.');

  await moveToward(host, 'player-1', { x: -1.6, z: -15.5 }, 20_000, 2.5);
  await moveToward(guest, 'player-2', { x: 1.6, z: -15.5 }, 20_000, 2.5);
  await moveToward(host, 'player-1', { x: -1.6, z: -12.0 }, 20_000, 2.5);
  await moveToward(guest, 'player-2', { x: 1.6, z: -12.0 }, 20_000, 2.5);
  await moveToward(guest, 'player-2', { x: -2.0, z: -11.5 }, 20_000, 2.5);
  await moveToward(host, 'player-1', { x: -4.5, y: 1.4, z: -11.0 }, 20_000, 2.5);

  await chaseAndGrab(host, 'player-1', 'cargo-core');
  await Promise.all([waitForText(host, 'cargo-core:pix'), waitForText(guest, 'cargo-core:pix')]);

  await host.waitForTimeout(500);
  await host.keyboard.press('q');
  await Promise.all([waitForText(host, 'cargo-core:free'), waitForText(guest, 'cargo-core:free')]);
  await host.waitForTimeout(1_100);
  const thrownHost = await objectState(host, 'cargo-core');
  const thrownGuest = await objectState(guest, 'cargo-core');
  assert(
    Math.hypot(thrownHost.x - thrownGuest.x, thrownHost.z - thrownGuest.z) < 2,
    `Thrown object diverged between clients: host=${JSON.stringify(thrownHost)} guest=${JSON.stringify(thrownGuest)}`,
  );

  await chaseAndGrab(guest, 'player-2', 'cargo-core');
  await Promise.all([waitForText(host, 'cargo-core:nee'), waitForText(guest, 'cargo-core:nee')]);
  await guest.keyboard.press('e');
  await Promise.all([waitForText(host, 'cargo-core:free'), waitForText(guest, 'cargo-core:free')]);

  await Promise.all([
    moveToward(host, 'player-1', { x: -3.2, z: -6.5 }, 18_000),
    moveToward(guest, 'player-2', { x: 3.2, z: -6.5 }, 18_000),
  ]);
  await Promise.all([host.keyboard.press('f'), guest.keyboard.press('f')]);
  await Promise.all([solvePacketRouting(host), solveSignalMatch(guest)]);
  await Promise.all([waitForText(host, 'A:complete', 10_000), waitForText(guest, 'A:complete', 10_000)]);
  await Promise.all([waitForText(host, 'B:complete', 10_000), waitForText(guest, 'B:complete', 10_000)]);

  // Terminal C (Memory Authorizer at { x: 3.2, z: -0.8 })
  await moveToward(host, 'player-1', { x: 0, z: -3.5 }, 18_000);
  await moveToward(guest, 'player-2', { x: 1.5, z: -4.5 }, 18_000, 0.8);
  await moveToward(guest, 'player-2', { x: 1.5, z: -1.5 }, 18_000, 1.0);
  await guest.keyboard.press('f');
  await guest.waitForTimeout(300);
  if (await guest.getByTestId('memory-trace').count() === 0) {
    const promptButton = guest.locator('.interaction-prompt button', { hasText: 'MEMORY AUTHORIZER' });
    if (await promptButton.count() > 0) await promptButton.click();
    else await guest.keyboard.press('f');
  }
  await solveMemoryTrace(guest);
  await Promise.all([waitForText(host, 'door:open', 10_000), waitForText(guest, 'door:open', 10_000)]);
  assert((await readout(host)).includes('A:complete'), 'PIX routing station did not complete.');
  assert((await readout(host)).includes('B:complete'), 'NEE routing station did not complete.');
  assert((await readout(host)).includes('C:complete'), 'Memory trace station did not complete.');

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
