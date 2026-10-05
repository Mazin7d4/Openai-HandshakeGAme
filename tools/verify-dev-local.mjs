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
  if (!match) throw new Error(`Missing ${id} in ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

async function objectPosition(page, id) {
  const text = await readout(page);
  const match = text.match(new RegExp(`${id}:[^@]+@(-?\\d+\\.\\d),(-?\\d+\\.\\d),(-?\\d+\\.\\d)`));
  if (!match) throw new Error(`Missing ${id} in ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

async function moveToward(page, playerId, target, timeout = 18_000, tolerance = 1.6) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const position = await playerPosition(page, playerId);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (Math.abs(dx) < tolerance && Math.abs(dz) < tolerance) return;
    const keys = [];
    if (Math.abs(dx) > 0.7) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dz) > 0.7) keys.push(dz > 0 ? 'w' : 's');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(100);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(35);
  }
  throw new Error(`${playerId} did not reach ${JSON.stringify(target)}.`);
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

  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'CONTROLS' }).click();
  assert((await page.locator('.controls-list').innerText()).includes('Grab / Drop'), 'Controls page missing bindings.');
  await page.getByRole('button', { name: 'BACK' }).click();
  await page.getByRole('button', { name: 'SETTINGS' }).click();
  assert((await page.locator('.settings-row').allTextContents()).join(' ').includes('GRAPHICS QUALITY'), 'Settings page missing graphics quality.');
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu').waitFor({ state: 'hidden' });

  await moveToward(page, 'player-2', { x: 2.5, z: -8.5 });
  await page.keyboard.press('f');
  await solvePacketRouting(page);
  assert((await readout(page)).includes('B:complete'), 'NEE station did not complete in dev-local.');

  await page.keyboard.press('Tab');
  await moveToward(page, 'player-1', { x: -2.5, z: -8.5 });
  await page.keyboard.press('f');
  await solvePacketRouting(page);
  await page.locator('#dev-readout').filter({ hasText: 'door:open' }).waitFor({ state: 'visible', timeout: 10_000 });

  for (const id of ['cargo-core', 'crate-blue', 'crate-pink']) {
    await moveToward(page, 'player-1', await objectPosition(page, id), 25_000, 0.65);
    await page.keyboard.press('e');
    await page.waitForTimeout(350);
    assert((await readout(page)).includes(`${id}:pix@`), `PIX did not grab ${id}.`);
    await page.keyboard.press('q');
    await page.waitForTimeout(450);
    assert(!(await readout(page)).includes(`${id}:pix@`), `PIX did not throw ${id}.`);
  }

  assert(errors.length === 0, errors.join('\n'));
  console.log(JSON.stringify({
    tabSwitchesActiveDrone: true,
    inactiveDroneHoldsInSlack: true,
    pauseSettingsControlsUi: true,
    devLocalPacketRoutingPair: true,
    devLocalDoorOpened: true,
    genericObjectTypesGrabbedAndThrown: ['sphere', 'box', 'cylinder'],
  }, null, 2));
} finally {
  await browser.close();
}
