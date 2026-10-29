import { launch } from './qa/lib.mjs';
import { arrival, toNee, servers, vault, clearCrate } from './heist-route.mjs';

const RAW_URL = process.argv[2] ?? 'http://localhost:5173/';
// ?autotest enables the test-only position autopilot (src/dev/Autopilot.ts): frame-rate independent.
const APP_URL = RAW_URL + (RAW_URL.includes('?') ? '&' : '?') + 'autotest';
const ROLE = { 'player-1': 'pix', 'player-2': 'nee' };
const browser = await launch();
const [width, height] = (process.env.VIEWPORT ?? '1280x720').split('x').map(Number);
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

async function readout() { return page.locator('#dev-readout').innerText(); }
async function assertCameraInvariants() {
  const diagnostics = await page.evaluate(() => window.__autotest.cameraDiagnostics());
  const badOccluders = diagnostics.cameraOccluders.filter((name) => /wall|partition|cap/i.test(name));
  if (badOccluders.length) throw new Error(`Wall/partition camera occluders remain: ${badOccluders.join(', ')}`);
  if (diagnostics.eyeY < 12.2) throw new Error(`Camera eye dropped below 12.2: ${diagnostics.eyeY}`);
}
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
async function cratePosition() {
  const text = await readout();
  const match = text.match(/crate-blue:(?:free|pix|nee)@(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!match) throw new Error(`Missing crate-blue in readout: ${text}`);
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
  const rounds = Number((await overlay.getAttribute('data-rounds')) ?? 3);
  for (let round = 0; round < rounds; round++) {
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

// SHOTS=<dir> saves the authored heist beats (vault reveal, alarm, extraction) for review.
const shot = async (name, delay = 0) => {
  if (!process.env.SHOTS) return;
  if (delay) await page.waitForTimeout(delay);
  await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
};
try {
  await page.addInitScript(() => localStorage.setItem('handshake.onboardingDone', '1'));
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 });
  await page.waitForFunction(() => window.__autotest, null, { timeout: 30_000 });
  const pilot = async (roles, point, timeout = 150_000) => {
    const tol = point.tolerance ?? 1;
    await page.evaluate(({ roles, p, tol }) => { for (const r of roles) window.__autotest.goto(r, p.x, p.y ?? 2.2, p.z, tol); }, { roles, p: point, tol });
    try {
      await page.waitForFunction((roles) => roles.every(r => window.__autotest.arrived(r)) || document.querySelector('#dev-readout')?.textContent.includes('mission:complete'), roles, { timeout, polling: 250 });
    } catch {
      const at = await page.evaluate((roles) => roles.map(r => [r, window.__autotest.position(r)]), roles);
      throw new Error(`autopilot ${roles} failed to reach ${JSON.stringify(point)} at ${JSON.stringify(at)}\nREADOUT:\n${await readout()}`);
    }
    await assertCameraInvariants();
  };
  const travel = async (points) => {
    for (const point of points) {
      await pilot(['pix'], point);
      await pilot(['nee'], point);
      if (process.env.TRACE) console.log(JSON.stringify(point), (await readout()).match(/prototype:\S+/)?.[0]);
    }
  };
  const legacyTravel = async (points) => {
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
  await ensureActive('player-1'); await page.evaluate(() => window.__autotest.press('pix', 'interact')); await solvePacket();
  await travel(toNee);
  await ensureActive('player-2'); await page.evaluate(() => window.__autotest.press('nee', 'interact')); await solveSignal();
  await travel(servers);
  await ensureActive('player-2'); await page.evaluate(() => window.__autotest.press('nee', 'interact')); await solveMemory();
  await page.locator('#dev-readout').filter({ hasText: 'door:open' }).waitFor();
  await travel(vault);
  await shot('p4-vault-reveal', 1500);
  // Low-FPS tolerant: retry the grab a couple of times and wait on replicated state, not a fixed delay.
  for (let attempt = 0; attempt < 3 && !(await readout()).includes('mission:escape'); attempt++) {
    // Both drones share the last vault waypoint, so PIX's body can shove NEE ~0.6 m back out of the
    // 3.2 m grab radius (seen as an intermittent 1-in-4 failure). Hold NEE well inside range first.
    await page.evaluate(() => window.__autotest.goto('nee', 1.6, 5.4, 18, 0.4, true));
    await page.waitForFunction(() => window.__autotest.arrived('nee'), null, { timeout: 30_000, polling: 250 }).catch(() => {});
    await ensureActive('player-2'); await page.evaluate(() => window.__autotest.press('nee', 'grabDrop'));
    await page.locator('#dev-readout').filter({ hasText: 'mission:escape' }).waitFor({ timeout: 4000 }).catch(() => {});
  }
  if (!(await readout()).includes('mission:escape')) throw new Error(`Prototype grab did not trigger alarm. ${await readout()}`);
  await page.evaluate(() => window.__autotest.stop('nee'));
  await page.locator('#dev-readout').filter({ hasText: 'mission:escape' }).waitFor({ timeout: 10000 });
  // A drone parked on the lab threshold must keep the sinking door's collision open
  // while the alarm closes it, rather than being trapped or squashed.
  // Bring NEE within tether rest length (7 m) of the threshold first, so the check measures the door
  // rather than the tether snapping PIX back toward a partner 17 m away at the pedestal.
  await page.evaluate(() => window.__autotest.goto('nee', 0, 3.2, 8, 0.6, true));
  await page.waitForFunction(() => window.__autotest.arrived('nee'), null, { timeout: 30_000, polling: 250 });
  await page.evaluate(() => window.__autotest.teleport('pix', 0, 2.2, 1.2));
  await page.waitForFunction(() => {
    const p = window.__autotest.position('pix');
    return p && Math.abs(p.x) < 0.2 && Math.abs(p.z - 1.2) < 0.2;
  }, null, { timeout: 5000 });
  const thresholdBefore = await page.evaluate(() => window.__autotest.position('pix'));
  await page.waitForTimeout(1200);
  const thresholdAfter = await page.evaluate(() => window.__autotest.position('pix'));
  if (!thresholdAfter || thresholdAfter.y < 1.2 || Math.hypot(thresholdAfter.x - thresholdBefore.x, thresholdAfter.z - thresholdBefore.z) > 1.2) {
    throw new Error(`Lab threshold door trapped/squashed drone: ${JSON.stringify({ thresholdBefore, thresholdAfter })}`);
  }
  await page.evaluate(() => window.__autotest.stop('nee'));
  await assertCameraInvariants();
  await shot('p4-pickup-alarm', 400);
  const initialCrate = await cratePosition();
  // Both drones advance through the dock. Holding NEE back in the lab overstretches the tether.
  // A carried prototype is already excluded from PIX's free-object grab candidates.
  await travel(clearCrate.approach);
  await ensureActive('player-1');
  for (let attempt = 0; attempt < 4 && !(await readout()).includes('crate-blue:pix'); attempt++) {
    await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
    await page.locator('#dev-readout').filter({ hasText: 'crate-blue:pix' }).waitFor({ timeout: 4000 }).catch(() => {});
    if (process.env.TRACE) console.log('CRATE GRAB', attempt, await readout());
  }
  if (!(await readout()).includes('crate-blue:pix')) throw new Error(`PIX failed to grab crate: ${await readout()}`);
  await travel(clearCrate.drag);
  await ensureActive('player-1');
  await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
  await page.locator('#dev-readout').filter({ hasText: 'crate-blue:free' }).waitFor({ timeout: 10000 });
  const finalCrate = await cratePosition();
  const crateDist = Math.hypot(finalCrate.x - initialCrate.x, finalCrate.z - initialCrate.z);
  if (crateDist <= 3) throw new Error(`Crate only moved ${crateDist.toFixed(2)} units (expected > 3)`);
  const remainingEscape = clearCrate.exit;
  await travel(remainingEscape.slice(0, Math.ceil(remainingEscape.length / 2)));
  await shot('p4-alarm-escape');
  await travel(remainingEscape.slice(Math.ceil(remainingEscape.length / 2)));
  await page.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 10_000 });
  await shot('p4-extraction', 700);
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
