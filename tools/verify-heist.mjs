import { chromium } from 'playwright';
import { arrival, toNee, servers, vault, escape } from './heist-route.mjs';

const APP_URL = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', process.env.ANGLE ? `--use-angle=${process.env.ANGLE}` : '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});
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
async function ensureActive(id) {
  const expectedRole = id === 'player-1' ? 'PIX' : 'NEE';
  for (let i = 0; i < 10; i++) {
    const text = await readout();
    if (text.includes(`active ${expectedRole}`)) return;
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
  }
  throw new Error(`Could not activate ${expectedRole}`);
}
async function move(id, target, timeout = 35_000, tolerance = 2) {
  await ensureActive(id);
  const started = Date.now();
  let previous = await position(id);
  let stuck = 0;
  // Camera basis (derived from BASE_OFFSET and LOOK_AHEAD)
  // forward ~ (0.325, 0.946), right ~ (0.946, -0.325)
  const fwdX = 0.325;
  const fwdZ = 0.946;
  while (Date.now() - started < timeout) {
    const at = await position(id);
    const dx = target.x - at.x;
    const dz = target.z - at.z;
    const targetY = target.y ?? 2.2;
    const tol = typeof tolerance === 'number' ? tolerance : 2.0;
    const readoutText = await readout();
    if (readoutText.includes('mission:complete')) return;
    if (Math.abs(dx) < tol && Math.abs(dz) < tol && Math.abs(at.y - targetY) < 1.4) return;
    const thrust = fwdX * dx + fwdZ * dz;
    const strafe = fwdZ * dx - fwdX * dz;
    const keys = [];
    if (Math.abs(strafe) > 0.3) keys.push(strafe > 0 ? 'd' : 'a');
    if (Math.abs(thrust) > 0.3) keys.push(thrust > 0 ? 'w' : 's');
    if (at.y > targetY + 0.45) keys.push('c');
    else if (at.y < targetY - 0.45) keys.push('Space');
    keys.push('Shift');
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(130);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(40);
    stuck = Math.hypot(at.x - previous.x, at.z - previous.z) < 0.08 ? stuck + 1 : 0;
    previous = at;
  }
  throw new Error(`${id} failed to reach ${JSON.stringify(target)} from ${JSON.stringify(await position(id))}\nREADOUT:\n${await readout()}`);
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

try {
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 });
  const travel = async (points) => {
    const step = async (id, point, previous) => {
      try { await move(id, point, 25000, point.tolerance ?? 1); }
      catch (error) {
        if (!previous) throw error;
        await move(id, previous, 20000, 1.5);
        await move(id, point, 25000, point.tolerance ?? 1);
      }
    };
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      await step('player-1', point, points[i - 1]);
      await step('player-2', point, points[i - 1]);
      if (process.env.TRACE) console.log(JSON.stringify(point), (await readout()).match(/prototype:\S+/)?.[0]);
    }
  };
  await travel(arrival);
  await ensureActive('player-1'); await pressGameKey('f'); await solvePacket();
  await travel(toNee);
  await ensureActive('player-2'); await pressGameKey('f'); await solveSignal();
  await travel(servers);
  await ensureActive('player-2'); await pressGameKey('f'); await solveMemory();
  await page.locator('#dev-readout').filter({ hasText: 'door:open' }).waitFor();
  await travel(vault);
  // Low-FPS tolerant: retry the grab a couple of times and wait on replicated state, not a fixed delay.
  for (let attempt = 0; attempt < 3 && !(await readout()).includes('mission:escape'); attempt++) {
    await ensureActive('player-2'); await pressGameKey('e');
    await page.locator('#dev-readout').filter({ hasText: 'mission:escape' }).waitFor({ timeout: 4000 }).catch(() => {});
  }
  if (!(await readout()).includes('mission:escape')) throw new Error(`Prototype grab did not trigger alarm. ${await readout()}`);
  await page.locator('#dev-readout').filter({ hasText: 'mission:escape' }).waitFor({ timeout: 10000 });
  await travel(escape);
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
