import { chromium } from 'playwright';

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:5178/';
const DEBUG_URL = new URL(APP_URL);
DEBUG_URL.searchParams.set('debug', '1');
const OBJECT_IDS = ['cargo-core', 'crate-blue', 'crate-pink'];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function readout(page) {
  return page.locator('#dev-readout').innerText();
}

async function player(page, id) {
  const line = (await readout(page)).split('\n').find((candidate) => candidate.startsWith(id));
  const match = line?.match(/x\s+(-?[\d.]+)\s+y\s+(-?[\d.]+)\s+z\s+(-?[\d.]+)\s+speed\s+([\d.]+)/);
  if (!match) throw new Error(`Missing ${id}.`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]), speed: Number(match[4]) };
}

async function object(page, id) {
  const match = (await readout(page)).match(new RegExp(`${id}:(pix|nee|free)@(-?[\\d.]+),(-?[\\d.]+),(-?[\\d.]+)`));
  if (!match) throw new Error(`Missing ${id}.`);
  return { holder: match[1], x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) };
}

async function tapMove(page, keys, duration = 100) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(duration);
  for (const key of keys) await page.keyboard.up(key);
  await page.waitForTimeout(35);
}

async function grabSpecific(page, playerId, objectId, role, timeout = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const [p, target] = await Promise.all([player(page, playerId), object(page, objectId)]);
    if (target.holder === role) return;
    if (target.holder !== 'free') throw new Error(`${objectId} unexpectedly held by ${target.holder}.`);
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const distance = Math.hypot(dx, target.y - p.y, dz);
    if (distance < 2.4) {
      await page.keyboard.press('e');
      await page.waitForTimeout(450);
      if ((await object(page, objectId)).holder === role) return;
      const text = await readout(page);
      if (text.includes(`:${role}@`)) {
        await page.keyboard.press('e');
        await page.waitForTimeout(250);
      }
    }
    const keys = [];
    if (Math.abs(dx) > 0.45) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dz) > 0.45) keys.push(dz > 0 ? 'w' : 's');
    await tapMove(page, keys);
  }
  throw new Error(`${role} could not grab ${objectId}.`);
}

async function waitHolder(page, objectId, holder, timeout = 8_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await object(page, objectId)).holder === holder) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`${objectId} did not become ${holder}.`);
}

async function createPair(browser, errors, warnings) {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  for (const [name, page] of [['host', host], ['guest', guest]]) {
    page.on('pageerror', (error) => errors.push(`${name}: ${error.stack ?? error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
      if (message.type() === 'warning' && !message.text().includes('GL Driver Message')) {
        warnings.push(`${name}: ${message.text()}`);
      }
    });
  }
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
    host.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 }),
    guest.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 }),
  ]);
  return { hostContext, guestContext, host, guest, code };
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const warnings = [];
const results = [];

try {
  for (const objectId of OBJECT_IDS) {
    const pair = await createPair(browser, errors, warnings);
    const { host, guest, hostContext, guestContext, code } = pair;
    try {
      for (const page of [host, guest]) {
        const text = await readout(page);
        for (const id of OBJECT_IDS) {
          assert(text.split(id).length - 1 === 1, `${id} duplicated or missing in room ${code}.`);
        }
      }

      await grabSpecific(host, 'player-1', objectId, 'pix');
      await Promise.all([waitHolder(host, objectId, 'pix'), waitHolder(guest, objectId, 'pix')]);
      await tapMove(host, ['d'], 650);
      await host.waitForTimeout(300);
      const carriedHost = await object(host, objectId);
      const carriedGuest = await object(guest, objectId);
      assert(Math.hypot(carriedHost.x - carriedGuest.x, carriedHost.z - carriedGuest.z) < 2.5, `${objectId} carry proxy diverged.`);

      await host.keyboard.press('e');
      await Promise.all([waitHolder(host, objectId, 'free'), waitHolder(guest, objectId, 'free')]);
      await grabSpecific(host, 'player-1', objectId, 'pix');
      await host.keyboard.press('q');
      await Promise.all([waitHolder(host, objectId, 'free'), waitHolder(guest, objectId, 'free')]);
      await host.waitForTimeout(1_250);
      const thrownHost = await object(host, objectId);
      const thrownGuest = await object(guest, objectId);
      assert(Math.hypot(thrownHost.x - thrownGuest.x, thrownHost.z - thrownGuest.z) < 3.5, `${objectId} throw proxy diverged: ${JSON.stringify({ thrownHost, thrownGuest })}`);

      await grabSpecific(guest, 'player-2', objectId, 'nee', 40_000);
      await Promise.all([waitHolder(host, objectId, 'nee'), waitHolder(guest, objectId, 'nee')]);
      await tapMove(guest, ['a'], 500);
      await guest.keyboard.press('e');
      await Promise.all([waitHolder(host, objectId, 'free'), waitHolder(guest, objectId, 'free')]);

      for (const page of [host, guest]) {
        const text = await readout(page);
        assert(!/NaN|Infinity/.test(text), `Invalid state in room ${code}: ${text}`);
        assert(text.includes('errors 0'), `Diagnostics fault in room ${code}: ${text}`);
      }

      await guestContext.close();
      await host.getByTestId('network-hud').filter({ hasText: 'Partner disconnected' }).waitFor({ timeout: 10_000 });
      assert((await readout(host)).includes('errors 0'), `Host faulted after guest left room ${code}.`);
      results.push({ objectId, room: code, synchronized: true, transferredToNee: true, disconnectStable: true });
    } finally {
      await guestContext.close().catch(() => undefined);
      await hostContext.close().catch(() => undefined);
    }
  }

  assert(errors.length === 0, errors.join('\n'));
  assert(warnings.length === 0, warnings.join('\n'));
  console.log(JSON.stringify({ roomsTested: results.length, objects: results }, null, 2));
} finally {
  await browser.close();
}
