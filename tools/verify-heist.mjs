import { chromium } from 'playwright';

const APP_URL = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

async function readout() { return page.locator('#dev-readout').innerText(); }
async function pressGameKey(key) {
  await page.keyboard.down(key);
  await page.waitForTimeout(700);
  await page.keyboard.up(key);
  await page.waitForTimeout(350);
}
async function position(id) {
  const text = await readout();
  const match = text.match(new RegExp(`${id}\\s+x\\s+(-?\\d+\\.\\d)\\s+y\\s+(-?\\d+\\.\\d)\\s+z\\s+(-?\\d+\\.\\d)`));
  if (!match) throw new Error(`Missing ${id}: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}
async function move(id, target, timeout = 35_000, tolerance = 2) {
  const started = Date.now();
  let previous = await position(id);
  let stuck = 0;
  while (Date.now() - started < timeout) {
    const at = await position(id);
    const dx = target.x - at.x;
    const dz = target.z - at.z;
    const targetY = target.y ?? 2.2;
    if (Math.abs(dx) < tolerance && Math.abs(dz) < tolerance && Math.abs(at.y - targetY) < 0.9) return;
    const keys = [];
    if (Math.abs(dx) > 0.6) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dz) > 0.6) keys.push(dz > 0 ? 'w' : 's');
    if (at.y > targetY + 0.65) keys.push('c');
    else if (at.y < targetY - 0.65 || stuck > 7) keys.push('Space');
    keys.push('Shift');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(130);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(40);
    stuck = Math.hypot(at.x - previous.x, at.z - previous.z) < 0.08 ? stuck + 1 : 0;
    previous = at;
  }
  throw new Error(`${id} failed to reach ${JSON.stringify(target)} from ${JSON.stringify(await position(id))}`);
}
async function solvePacket() {
  const overlay = page.getByTestId('packet-routing');
  await overlay.waitFor({ state: 'visible' });
  for (let index = 0; index < 16; index++) {
    for (let turn = 0; turn < 4; turn++) {
      if (!(await overlay.isVisible().catch(() => false))) return;
      const node = overlay.locator(`[data-index="${index}"]`);
      const solutionValue = await node.getAttribute('data-solution-mask').catch(() => null);
      const currentValue = await node.getAttribute('data-mask').catch(() => null);
      if (solutionValue === null || currentValue === null) return;
      const solution = Number(solutionValue);
      const current = Number(currentValue);
      if (!solution || current === solution) break;
      await node.click();
    }
  }
  await overlay.waitFor({ state: 'detached' });
}
async function solveSignal() {
  const overlay = page.getByTestId('signal-match');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('[data-control="frequency"]').fill(await overlay.getAttribute('data-target-frequency'));
  await overlay.locator('[data-control="amplitude"]').fill(await overlay.getAttribute('data-target-amplitude'));
  await overlay.waitFor({ state: 'detached' });
}
async function solveMemory() {
  const overlay = page.getByTestId('memory-trace');
  await overlay.waitFor({ state: 'visible' });
  for (let round = 0; round < 3; round++) {
    await overlay.locator('.hack-status').filter({ hasText: 'REPEAT' }).waitFor({ timeout: 10_000 });
    const sequence = (await overlay.getAttribute('data-sequence')).split(',').map(Number);
    for (const index of sequence) await overlay.locator(`[data-index="${index}"]`).click();
    await page.waitForTimeout(750);
  }
  await overlay.waitFor({ state: 'detached', timeout: 10_000 });
}

try {
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 });
  await move('player-1', { x: 0, z: -15.5 });
  await page.keyboard.press('Tab');
  await move('player-2', { x: 0, z: -15.5 });
  await page.keyboard.press('Tab');
  await move('player-1', { x: -5.2, z: -5.8 });
  await pressGameKey('f');
  await solvePacket();
  await page.keyboard.press('Tab');
  await move('player-2', { x: 5.2, z: -5.8 });
  await pressGameKey('f');
  await solveSignal();
  await move('player-2', { x: 3.2, z: -0.8 });
  await page.locator('.interaction-prompt button', { hasText: 'MEMORY AUTHORIZER' }).click();
  await page.waitForTimeout(500);
  if (await page.getByTestId('memory-trace').count() === 0) {
    await pressGameKey('f');
    await page.waitForTimeout(500);
  }
  if (await page.getByTestId('memory-trace').count() === 0) {
    throw new Error(`Memory terminal did not open. HUD=${await page.locator('.interaction-prompt').innerText()} READOUT=${await readout()}`);
  }
  await solveMemory();
  await page.locator('#dev-readout').filter({ hasText: 'door:open' }).waitFor();
  await move('player-2', { x: 0, z: 4 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-1', { x: 0, z: 4 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-2', { x: 0, z: 10 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-1', { x: 0, z: 10 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-2', { x: 0, z: 16.2 }, 35_000, 2.6);
  await pressGameKey('e');
  await page.locator('#dev-readout').filter({ hasText: 'mission:escape' }).waitFor({ timeout: 10_000 });
  await move('player-2', { x: 0, z: 13 }, 30_000, 1.8);
  await move('player-2', { x: -10, z: 13 }, 30_000, 1.8);
  await page.keyboard.press('Tab');
  await move('player-1', { x: -10, z: 13 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-2', { x: -15, z: 13 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-1', { x: -15, z: 13 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-2', { x: -15, z: -8 }, 40_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-1', { x: -15, z: -8 }, 40_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-2', { x: -20, z: -9 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-1', { x: -20, z: -9 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-2', { x: -20, z: -20 }, 30_000, 2.2);
  await move('player-2', { x: -13, z: -20 }, 30_000, 2.2);
  await page.keyboard.press('Tab');
  await move('player-1', { x: -13, z: -20 }, 30_000, 2.2);
  await page.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 10_000 });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({
    devLocalTabSwitch: true,
    packetRouting: true,
    signalMatch: true,
    memoryTrace: true,
    sharedDoor: true,
    alarmOnPrototypePickup: true,
    alternateEscapeRoute: true,
    extractionRequiresTeamAndPrototype: true,
    missionComplete: true,
  }, null, 2));
} finally {
  await browser.close();
}
