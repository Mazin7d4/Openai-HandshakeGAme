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

async function waitForText(page, text, timeout = 12_000) {
  await page.locator('#dev-readout').filter({ hasText: text }).waitFor({ state: 'visible', timeout });
}

const fwdX = 0.325;
const fwdZ = 0.946;

async function moveToward(page, playerId, target, timeout = 25_000, tolerance = 2.0) {
  if (await page.getByTestId('mission-complete').isVisible().catch(() => false)) {
    return await playerPosition(page, playerId).catch(() => ({ x: target.x, y: target.y ?? 2.2, z: target.z }));
  }
  await page.bringToFront();
  await page.getByTestId('game-canvas').click({ force: true }).catch(() => undefined);
  const started = Date.now();
  const targetY = target.y ?? 2.2;
  while (Date.now() - started < timeout) {
    if (await page.getByTestId('mission-complete').isVisible().catch(() => false)) {
      return await playerPosition(page, playerId).catch(() => ({ x: target.x, y: target.y ?? 2.2, z: target.z }));
    }
    const position = await playerPosition(page, playerId);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const dy = targetY - position.y;
    const readoutText = await readout(page);
    if (readoutText.includes('mission:complete')) return position;
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
  if (await page.getByTestId('mission-complete').isVisible().catch(() => false)) {
    return await playerPosition(page, playerId).catch(() => ({ x: target.x, y: target.y ?? 2.2, z: target.z }));
  }
  const finalPos = await playerPosition(page, playerId);
  if (Math.abs(target.x - finalPos.x) <= tolerance && Math.abs(target.z - finalPos.z) <= tolerance) return finalPos;
  throw new Error(`${playerId} did not reach ${JSON.stringify(target)}; ended at ${JSON.stringify(finalPos)}`);
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
  // 1. Room create and join
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

  // Verify role assignment
  assert((await readout(host)).includes('active PIX'), 'Host is not PIX');
  assert((await readout(guest)).includes('active NEE'), 'Guest is not NEE');

  // 2. Infiltration & Stage sync
  await moveToward(host, 'player-1', { x: -1.6, z: -15.5 }, 20_000, 2.5);
  await moveToward(guest, 'player-2', { x: 1.6, z: -15.5 }, 20_000, 2.5);
  await moveToward(host, 'player-1', { x: -1.6, z: -12.0 }, 20_000, 2.5);
  await moveToward(guest, 'player-2', { x: 1.6, z: -12.0 }, 20_000, 2.5);
  await Promise.all([
    waitForText(host, 'mission:hack-security'),
    waitForText(guest, 'mission:hack-security'),
  ]);

  // 3. Independent hacking
  await moveToward(host, 'player-1', { x: -3.2, z: -6.5 }, 18_000);
  await moveToward(guest, 'player-2', { x: 3.2, z: -6.5 }, 18_000);
  await host.bringToFront();
  await host.keyboard.press('f');
  await guest.bringToFront();
  await guest.keyboard.press('f');
  await host.waitForTimeout(300);
  if (await host.getByTestId('packet-routing').count() === 0) {
    const promptButton = host.locator('.interaction-prompt button');
    if (await promptButton.count() > 0) await promptButton.click();
    else {
      await host.bringToFront();
      await host.keyboard.press('f');
    }
  }
  if (await guest.getByTestId('signal-match').count() === 0) {
    const promptButton = guest.locator('.interaction-prompt button');
    if (await promptButton.count() > 0) await promptButton.click();
    else {
      await guest.bringToFront();
      await guest.keyboard.press('f');
    }
  }
  await Promise.all([solvePacketRouting(host), solveSignalMatch(guest)]);
  await Promise.all([waitForText(host, 'A:complete'), waitForText(guest, 'A:complete')]);
  await Promise.all([waitForText(host, 'B:complete'), waitForText(guest, 'B:complete')]);

  // Terminal C (Memory Authorizer)
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

  // 4. Door opens on both clients
  await Promise.all([waitForText(host, 'door:open', 10_000), waitForText(guest, 'door:open', 10_000)]);

  // 5. Reach vault
  await moveToward(guest, 'player-2', { x: 0, z: 3 }, 25_000, 1.8);
  await moveToward(host, 'player-1', { x: 0, z: 3 }, 25_000, 1.8);
  await moveToward(guest, 'player-2', { x: 0, z: 7 }, 25_000, 1.8);
  await moveToward(host, 'player-1', { x: 0, z: 7 }, 25_000, 1.8);
  await moveToward(guest, 'player-2', { x: 0, z: 11 }, 25_000, 1.8);
  await moveToward(host, 'player-1', { x: 0, z: 11 }, 25_000, 1.8);
  await moveToward(guest, 'player-2', { x: 0, y: 1.6, z: 15.5 }, 25_000, 1.5);
  await moveToward(host, 'player-1', { x: 0, z: 13 }, 25_000, 1.8);

  // 6. Grab prototype -> Alarm & Security triggers
  await guest.bringToFront();
  for (let i = 0; i < 5; i++) {
    const text = await readout(guest);
    if (text.includes('prototype:nee')) break;
    await guest.keyboard.down('e');
    await guest.waitForTimeout(400);
    await guest.keyboard.up('e');
    await guest.waitForTimeout(300);
  }

  await Promise.all([
    waitForText(host, 'prototype:nee', 10_000),
    waitForText(guest, 'prototype:nee', 10_000),
  ]);
  await Promise.all([
    waitForText(host, 'alarm:on', 10_000),
    waitForText(guest, 'alarm:on', 10_000),
  ]);
  await Promise.all([
    waitForText(host, 'security:active', 10_000),
    waitForText(guest, 'security:active', 10_000),
  ]);
  await Promise.all([
    waitForText(host, 'mission:escape', 10_000),
    waitForText(guest, 'mission:escape', 10_000),
  ]);

  // 7. Escape through west service corridor
  await moveToward(guest, 'player-2', { x: 0, z: 13 }, 20_000, 1.8);
  await moveToward(host, 'player-1', { x: 0, z: 13 }, 20_000, 1.8);
  await moveToward(guest, 'player-2', { x: -6, z: 13 }, 20_000, 1.8);
  await moveToward(host, 'player-1', { x: -6, z: 13 }, 20_000, 1.8);
  await moveToward(guest, 'player-2', { x: -15, z: 13 }, 20_000, 2.0);
  await moveToward(host, 'player-1', { x: -15, z: 13 }, 20_000, 2.0);
  await moveToward(guest, 'player-2', { x: -15, z: 7 }, 20_000, 2.0);
  await moveToward(host, 'player-1', { x: -15, z: 7 }, 20_000, 2.0);
  await moveToward(guest, 'player-2', { x: -15, z: 1 }, 20_000, 2.0);
  await moveToward(host, 'player-1', { x: -15, z: 1 }, 20_000, 2.0);
  await moveToward(guest, 'player-2', { x: -15, z: -5 }, 20_000, 2.0);
  await moveToward(host, 'player-1', { x: -15, z: -5 }, 20_000, 2.0);
  await moveToward(guest, 'player-2', { x: -15, z: -8, y: 4.5 }, 20_000, 2.0);
  await moveToward(host, 'player-1', { x: -15, z: -8, y: 4.5 }, 20_000, 2.0);
  await moveToward(guest, 'player-2', { x: -15, z: -12, y: 4.5 }, 25_000, 2.0);
  await moveToward(host, 'player-1', { x: -15, z: -12, y: 4.5 }, 25_000, 2.0);
  await moveToward(guest, 'player-2', { x: -15, z: -16, y: 2.2 }, 20_000, 2.0);
  await moveToward(host, 'player-1', { x: -15, z: -16, y: 2.2 }, 20_000, 2.0);

  // 8. Reach extraction zone
  await moveToward(guest, 'player-2', { x: -13, z: -20, y: 2.2 }, 25_000, 2.0);
  await moveToward(host, 'player-1', { x: -13, z: -20, y: 2.2 }, 25_000, 2.0);

  // 9. Mission complete appears for both
  await Promise.all([
    host.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 15_000 }),
    guest.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 15_000 }),
  ]);

  // 10. Disconnect stability
  await guestContext.close();
  await host.getByTestId('network-hud').filter({ hasText: 'Partner disconnected' }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });

  assert(errors.length === 0, errors.join('\n'));

  console.log(JSON.stringify({
    multiplayerRoomCreateJoin: true,
    pixNeeAssigned: true,
    sharedMissionStage: true,
    independentHacking: true,
    doorsSynchronize: true,
    prototypeOwnershipSync: true,
    alarmSynchronizes: true,
    securityStateSync: true,
    extractionSynchronizes: true,
    missionCompleteForBoth: true,
    disconnectStable: true,
  }, null, 2));
} finally {
  await hostContext.close().catch(() => undefined);
  await guestContext.close().catch(() => undefined);
  await browser.close();
}
