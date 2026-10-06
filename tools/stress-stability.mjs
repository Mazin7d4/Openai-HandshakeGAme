import { chromium } from 'playwright';

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:5178/';
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function readout(page) {
  return page.locator('#dev-readout').innerText();
}

async function playerSample(page, id) {
  const text = await readout(page);
  const line = text.split('\n').find((candidate) => candidate.startsWith(id));
  const match = line?.match(/x\s+(-?[\d.]+)\s+y\s+(-?[\d.]+)\s+z\s+(-?[\d.]+)\s+speed\s+([\d.]+)/);
  if (!match) throw new Error(`Missing ${id}: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]), speed: Number(match[4]) };
}

async function objectSample(page, id) {
  const text = await readout(page);
  const match = text.match(new RegExp(`${id}:(pix|nee|free)@(-?[\\d.]+),(-?[\\d.]+),(-?[\\d.]+)`));
  if (!match) throw new Error(`Missing ${id}: ${text}`);
  return { holder: match[1], x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) };
}

async function move(page, keys, duration) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(duration);
  for (const key of keys) await page.keyboard.up(key);
  await page.waitForTimeout(150);
}

async function moveToward(page, playerId, target, timeout = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const position = await playerSample(page, playerId);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (Math.abs(dx) < 1.45 && Math.abs(dz) < 1.45) return;
    const keys = [];
    if (Math.abs(dx) > 0.5) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dz) > 0.5) keys.push(dz > 0 ? 'w' : 's');
    await move(page, keys, 90);
  }
  throw new Error(`${playerId} failed to reach ${JSON.stringify(target)}`);
}

async function openAndCancelHack(page, playerId, station, cycles) {
  await moveToward(page, playerId, station);
  for (let i = 0; i < cycles; i++) {
    await page.keyboard.press('f');
    const overlay = page.getByTestId('packet-routing');
    await overlay.waitFor({ state: 'visible', timeout: 5_000 });
    assert(await page.getByTestId('packet-routing').count() === 1, 'Duplicate hack overlay mounted.');
    await overlay.getByRole('button', { name: 'CANCEL' }).click();
    await overlay.waitFor({ state: 'detached', timeout: 5_000 });
  }
}

async function solveThenCancelBeforeCompletion(page) {
  await page.keyboard.press('f');
  const overlay = page.getByTestId('packet-routing');
  await overlay.waitFor({ state: 'visible', timeout: 5_000 });
  const solved = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="packet-routing"]');
    if (!(root instanceof HTMLElement)) return false;
    for (let index = 0; index < 16 && !root.classList.contains('success'); index++) {
      for (let turn = 0; turn < 4 && !root.classList.contains('success'); turn++) {
        const node = root.querySelector(`.packet-node[data-index="${index}"]`);
        if (!(node instanceof HTMLButtonElement)) break;
        if (node.dataset.mask === node.dataset.solutionMask) break;
        node.click();
      }
    }
    const success = root.classList.contains('success');
    if (success) (root.querySelector('.hack-cancel'))?.dispatchEvent(new MouseEvent('click'));
    return success;
  });
  assert(solved, 'Puzzle did not reach success state.');
  await overlay.waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(850);
  assert(!(await readout(page)).includes('B:complete'), 'Disposed puzzle timer completed the terminal after cancellation.');
  await page.keyboard.press('f');
  await page.getByTestId('packet-routing').waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByTestId('packet-routing').getByRole('button', { name: 'CANCEL' }).click();
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const warnings = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  if (message.type() === 'warning') warnings.push(message.text());
});

try {
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 });

  await move(page, ['w'], 550);
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  assert((await objectSample(page, 'cargo-core')).holder === 'pix', 'Initial grab failed.');
  await page.waitForTimeout(1_250);

  let maxIdleSpeed = 0;
  const idleStart = await playerSample(page, 'player-1');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const sample = await playerSample(page, 'player-1');
    maxIdleSpeed = Math.max(maxIdleSpeed, sample.speed);
  }
  const idleEnd = await playerSample(page, 'player-1');

  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(90);
  }
  assert((await objectSample(page, 'cargo-core')).holder === 'pix', 'Ownership went stale after 20 drop/grab cycles.');
  console.log('phase: grab/drop cycles complete');

  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  await openAndCancelHack(page, 'player-2', { x: 2.5, z: -8.5 }, 20);
  console.log('phase: hack cancel cycles complete');
  await solveThenCancelBeforeCompletion(page);
  console.log('phase: stale hack timer check complete');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);

  await move(page, ['a', 'Shift'], 1_500);
  await page.waitForTimeout(700);
  const postCarry = await playerSample(page, 'player-1');
  await page.keyboard.press('q');
  await page.waitForTimeout(500);
  assert((await objectSample(page, 'cargo-core')).holder === 'free', 'Throw did not release object.');
  console.log('phase: carry collision/tether/throw complete');

  const readoutText = await readout(page);
  assert(!/NaN|Infinity/.test(readoutText), `Invalid transform detected: ${readoutText}`);
  assert(readoutText.includes('errors 0'), `Runtime diagnostics reported a fault: ${readoutText}`);
  for (const id of ['cargo-core', 'crate-blue', 'crate-pink']) {
    assert(readoutText.split(id).length - 1 === 1, `Duplicate or missing ${id} in dev state.`);
  }
  const relevantWarnings = warnings.filter((warning) => !warning.includes('GL Driver Message'));
  assert(relevantWarnings.length === 0, relevantWarnings.join('\n'));
  assert(errors.length === 0, errors.join('\n'));
  console.log(JSON.stringify({
    maxIdleSpeedWhileHolding: maxIdleSpeed,
    idleDriftWhileHolding: Math.hypot(idleEnd.x - idleStart.x, idleEnd.y - idleStart.y, idleEnd.z - idleStart.z),
    postCarrySpeed: postCarry.speed,
    grabDropCycles: 20,
    hackCancelCycles: 20,
    staleHackCompletionPrevented: true,
    warnings: [...new Set(warnings)],
  }, null, 2));
} finally {
  await browser.close();
}
