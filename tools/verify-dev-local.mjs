import { chromium } from 'playwright';
import { arrival, toNee } from './heist-route.mjs';

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
  if (!match) throw new Error(`Missing ${id} in ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

async function objectPosition(page, id) {
  const text = await readout(page);
  const match = text.match(new RegExp(`${id}:[^@]+@(-?\\d+\\.\\d),(-?\\d+\\.\\d),(-?\\d+\\.\\d)`));
  if (!match) throw new Error(`Missing ${id} in ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

async function objectHolder(page, id) {
  const text = await readout(page);
  return text.match(new RegExp(`${id}:(pix|nee|free)@`))?.[1] ?? null;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Camera-relative, 3D, closed-loop steering shared with the heist checks.
async function moveToward(page, playerId, target, timeout = 25_000, tolerance = 1.6) {
  const fwdX = 0.325, fwdZ = 0.946;
  const started = Date.now();
  const targetY = target.y ?? 2.2;
  while (Date.now() - started < timeout) {
    const position = await playerPosition(page, playerId);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (Math.abs(dx) < tolerance && Math.abs(dz) < tolerance && Math.abs(position.y - targetY) < 1.4) return;
    const thrust = fwdX * dx + fwdZ * dz;
    const strafe = fwdZ * dx - fwdX * dz;
    const keys = [];
    if (Math.abs(strafe) > 0.3) keys.push(strafe > 0 ? 'd' : 'a');
    if (Math.abs(thrust) > 0.3) keys.push(thrust > 0 ? 'w' : 's');
    if (position.y > targetY + 0.45) keys.push('c');
    else if (position.y < targetY - 0.45) keys.push('Space');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(110);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(35);
  }
  throw new Error(`${playerId} did not reach ${JSON.stringify(target)}.`);
}

async function ensureActive(page, role) {
  for (let i = 0; i < 10; i++) {
    if ((await readout(page)).includes(`active ${role}`)) return;
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
  }
  throw new Error(`Could not activate ${role}`);
}

async function solveSignalMatch(page) {
  const overlay = page.getByTestId('signal-match');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('[data-control="frequency"]').fill(await overlay.getAttribute('data-target-frequency'));
  await overlay.locator('[data-control="amplitude"]').fill(await overlay.getAttribute('data-target-amplitude'));
  await overlay.waitFor({ state: 'detached' });
}

async function chaseAndGrab(page, playerId, objectId, timeout = 25_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const target = await objectPosition(page, objectId);
    const player = await playerPosition(page, playerId);
    if (distance(player, target) < 2.7) {
      await page.keyboard.press('e');
      await page.waitForTimeout(350);
      if (await objectHolder(page, objectId) === 'pix') return;
    }
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const thrust = 0.325 * dx + 0.946 * dz;
    const strafe = 0.946 * dx - 0.325 * dz;
    const keys = [];
    if (Math.abs(strafe) > 0.4) keys.push(strafe > 0 ? 'd' : 'a');
    if (Math.abs(thrust) > 0.4) keys.push(thrust > 0 ? 'w' : 's');
    if (player.y > target.y + 1) keys.push('c'); else if (player.y < target.y - 0.6) keys.push('Space');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(110);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(40);
  }
  throw new Error(
    `PIX could not re-grab ${objectId}; player=${JSON.stringify(await playerPosition(page, playerId))} ` +
    `object=${JSON.stringify(await objectPosition(page, objectId))} holder=${await objectHolder(page, objectId)}.`,
  );
}

async function solvePacketRouting(page) {
  const overlay = page.getByTestId('packet-routing');
  await overlay.waitFor({ state: 'visible', timeout: 10_000 });
  for (let index = 0; index < 16; index++) {
    for (let turn = 0; turn < 4; turn++) {
      if (!(await overlay.isVisible().catch(() => false))) return;
      const node = overlay.locator(`.packet-node[data-index="${index}"]`);
      const solutionValue = await node.getAttribute('data-solution-mask').catch(() => null);
      if (solutionValue === null) return;
      const solution = Number(solutionValue);
      const current = await node.getAttribute('data-mask').catch(() => null);
      if (current === null || !solution || Number(current) === solution) break;
      await node.click().catch(() => undefined);
    }
  }
  await overlay.waitFor({ state: 'detached', timeout: 10_000 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await page.addInitScript(() => localStorage.setItem('handshake.onboardingDone', '1'));
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 });

  assert((await page.locator('.active-drone-hud').innerText()).includes('PIX'), 'PIX was not initially active.');
  const pixBefore = await playerPosition(page, 'player-1');
  const neeBefore = await playerPosition(page, 'player-2');
  await page.keyboard.down('w');
  await page.waitForTimeout(650);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);
  const pixMoved = await playerPosition(page, 'player-1');
  const neeHeld = await playerPosition(page, 'player-2');
  assert(distance(pixBefore, pixMoved) > 0.4, 'Active PIX did not move.');
  assert(distance(neeBefore, neeHeld) < 0.35, 'Inactive NEE did not hold position inside tether slack.');

  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  assert((await page.locator('.active-drone-hud').innerText()).includes('NEE'), 'Tab did not activate NEE.');
  const pixInactive = await playerPosition(page, 'player-1');
  const neeActive = await playerPosition(page, 'player-2');
  await page.keyboard.down('w');
  await page.waitForTimeout(650);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);
  assert(distance(neeActive, await playerPosition(page, 'player-2')) > 0.4, 'Active NEE did not move.');
  assert(distance(pixInactive, await playerPosition(page, 'player-1')) < 0.4, 'Inactive PIX failed to hold position.');

  await page.keyboard.down('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.up('Escape');
  await page.getByTestId('pause-menu').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'CONTROLS' }).click();
  assert((await page.locator('.controls-list').innerText()).includes('Grab or drop'), 'Controls page missing bindings.');
  await page.getByRole('button', { name: 'BACK' }).click();
  await page.getByRole('button', { name: 'SETTINGS' }).click();
  await page.getByTestId('settings-tab-visuals').click();
  assert((await page.locator('.settings-row').allTextContents()).join(' ').toLowerCase().includes('graphics quality'), 'Settings page missing graphics quality.');
  await page.getByRole('button', { name: 'BACK' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByTestId('pause-menu').waitFor({ state: 'hidden' });

  // Grab / drop / re-grab / throw with the delivery cargo-core beside reception (Astra layout).
  await ensureActive(page, 'PIX');
  for (const id of ['cargo-core']) {
    await moveToward(page, 'player-1', await objectPosition(page, id), 25_000, 0.65);
    for (let i = 0; i < 3 && !(await readout(page)).includes(`${id}:pix@`); i++) { await page.keyboard.press('e'); await page.waitForTimeout(700); }
    assert((await readout(page)).includes(`${id}:pix@`), `PIX did not grab ${id}.`);
    await page.keyboard.down('d');
    await page.waitForTimeout(250);
    await page.keyboard.up('d');
    await page.waitForTimeout(150);
    await page.keyboard.press('e');
    await page.waitForTimeout(700);
    assert(await objectHolder(page, id) === 'free', `PIX did not drop ${id}.`);
    if (process.env.TRACE) console.log('after drop', JSON.stringify(await objectPosition(page, id)), JSON.stringify(await playerPosition(page, 'player-1')));
    await chaseAndGrab(page, 'player-1', id);
    assert(await objectHolder(page, id) === 'pix', `PIX did not re-grab ${id}.`);
    await page.keyboard.press('q');
    await page.waitForTimeout(900);
    assert(!(await readout(page)).includes(`${id}:pix@`), `PIX did not throw ${id}.`);
  }

  // Both office keys in dev-local, switching drones with Tab: PIX desk console, NEE under-desk patch bay.
  for (const point of arrival) {
    await ensureActive(page, 'PIX'); await moveToward(page, 'player-1', point, 25_000, point.tolerance ?? 1);
    await ensureActive(page, 'NEE'); await moveToward(page, 'player-2', point, 25_000, point.tolerance ?? 1);
  }
  for (const point of toNee) await moveToward(page, 'player-2', point, 25_000, point.tolerance ?? 1);
  await page.keyboard.press('f');
  await solveSignalMatch(page);
  await page.locator('#dev-readout').filter({ hasText: 'B:complete' }).waitFor({ timeout: 10_000 });
  await ensureActive(page, 'PIX');
  await moveToward(page, 'player-1', { x: -3.3, y: 5.2, z: -33 }, 25_000, 0.55);
  await page.keyboard.press('f');
  await solvePacketRouting(page);
  await page.locator('#dev-readout').filter({ hasText: 'A:complete' }).waitFor({ timeout: 10_000 });

  assert(errors.length === 0, errors.join('\n'));
  console.log(JSON.stringify({
    tabSwitchesActiveDrone: true,
    inactiveDroneHoldsInSlack: true,
    pauseSettingsControlsUi: true,
    devLocalPacketRoutingPair: true,
    devLocalDoorOpened: true,
    genericObjectTypesGrabbedAndThrown: ['sphere', 'box', 'cylinder'],
    everyObjectDroppedAndRegrabbedBeforeThrow: true,
  }, null, 2));
} finally {
  await browser.close();
}
