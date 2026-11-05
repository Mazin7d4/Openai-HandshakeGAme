// Seed / run-state sync: shared helpers + two clients agree on seed, ?seed= honoured,
// dailySeed stable for a date, Night Shift floor/seed advance via HANDSHAKE_TEST_HOOKS.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { freePort, startTestServer } from './test-server.mjs';
import {
  parseSeed,
  formatSeed,
  dailySeed,
  nextFloorSeed,
  createRunState,
  advanceFloor,
  recordCapture,
  challengeUrl,
  dailyUrl,
  runOptionsFromSearch,
  MAX_CAPTURES,
} from '../shared/run.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawUrl = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/?scale=4&lowfx';
const SERVER_PORT = process.env.SEED_TEST_PORT
  ? Number(process.env.SEED_TEST_PORT)
  : await freePort();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function appUrl(serverHttp, extra = {}) {
  const url = new URL(rawUrl);
  url.searchParams.set('debug', '1');
  url.searchParams.set('autotest', '1');
  url.searchParams.set('server', serverHttp);
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) url.searchParams.delete(k);
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

// --- unit-style shared helper checks (same module client + server import) ---
const unit = {};
{
  const seed = 0xabcdef01;
  assert(formatSeed(seed) === formatSeed(seed >>> 0), 'formatSeed not stable');
  assert(parseSeed(formatSeed(seed)) === (seed >>> 0), 'parseSeed(formatSeed) round-trip failed');
  assert(parseSeed(String(seed)) === (seed >>> 0), 'parseSeed decimal failed');
  assert(parseSeed('not!valid') === null, 'parseSeed should reject junk');
  const d1 = dailySeed('2026-10-22');
  const d2 = dailySeed(new Date(Date.UTC(2026, 9, 22, 18, 0, 0)));
  assert(d1 === d2, `dailySeed not stable for UTC date: ${d1} vs ${d2}`);
  assert(dailySeed('2026-10-23') !== d1, 'dailySeed should change by day');
  const n1 = nextFloorSeed(seed, 2);
  const n2 = nextFloorSeed(seed, 2);
  assert(n1 === n2 && n1 !== (seed >>> 0), 'nextFloorSeed not deterministic or identical to seed');
  const run = createRunState({ seed, mode: 'nightshift' });
  assert(run.floor === 1 && run.captures === 0 && run.maxCaptures === MAX_CAPTURES, 'createRunState defaults');
  const advanced = advanceFloor(run, 12.5);
  assert(advanced.floor === 2 && advanced.seed === nextFloorSeed(seed, 2), 'advanceFloor seed/floor mismatch');
  assert(advanced.floorTimes.length === 1 && advanced.floorTimes[0] === 12.5, 'advanceFloor floorTimes');
  let cap = recordCapture(advanced);
  assert(cap.state.captures === 1 && !cap.ended, 'first capture should not end');
  cap = recordCapture(cap.state);
  cap = recordCapture(cap.state);
  assert(cap.ended && cap.state.captures === 3, 'third capture should end the run');
  const challenge = challengeUrl('http://example.test/game', { seed, mode: 'nightshift', beat: 90_000 });
  assert(challenge.includes(`seed=${formatSeed(seed)}`) && challenge.includes('mode=nightshift') && challenge.includes('beat=90000'), `challengeUrl bad: ${challenge}`);
  assert(dailyUrl('http://example.test/').includes('mode=daily'), 'dailyUrl missing mode');
  const opts = runOptionsFromSearch(`?seed=${formatSeed(seed)}&mode=daily&beat=500`);
  assert(opts.seed === (seed >>> 0) && opts.mode === 'daily' && opts.beat === 500, 'runOptionsFromSearch failed');
  unit.ok = true;
}

const result = { unit, pass: false };

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let server;

try {
  server = await startTestServer({
    port: SERVER_PORT,
    root,
    env: {
      HANDSHAKE_TEST_HOOKS: '1',
      EMPTY_ROOM_SECONDS: '120',
      LONELY_ROOM_SECONDS: '120',
    },
  });
  const serverHttp = `http://127.0.0.1:${SERVER_PORT}`;
  const fixedSeed = 0x00c0ffee;
  const seedCode = formatSeed(fixedSeed);

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const open = appUrl(serverHttp, { seed: seedCode, mode: 'nightshift' });
  await host.goto(open);
  await host.getByTestId('multiplayer').click();
  await host.getByTestId('create-room').click();
  const code = (await host.getByTestId('room-code').innerText()).trim();
  assert(/^[A-Z2-9]{4}$/.test(code), `Unexpected room code: ${code}`);
  result.roomCode = code;

  await guest.goto(appUrl(serverHttp));
  await guest.getByTestId('multiplayer').click();
  await guest.getByTestId('join-room').click();
  await guest.getByTestId('room-code-input').fill(code);
  await guest.getByTestId('join-submit').click();

  for (const page of [host, guest]) {
    await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 60_000 });
    await page.waitForFunction(() => window.__autotest?.runState, null, { timeout: 30_000 });
  }

  const hostRun = await host.evaluate(() => window.__autotest.runState());
  const guestRun = await guest.evaluate(() => window.__autotest.runState());
  result.hostRun = hostRun;
  result.guestRun = guestRun;
  assert(hostRun?.seed === fixedSeed, `host seed ${hostRun?.seed} !== ${fixedSeed}`);
  assert(guestRun?.seed === fixedSeed, `guest seed ${guestRun?.seed} !== ${fixedSeed}`);
  assert(hostRun.seed === guestRun.seed, 'clients disagree on seed');
  assert(hostRun.mode === 'nightshift' && guestRun.mode === 'nightshift', 'mode not nightshift');
  assert(hostRun.floor === 1 && guestRun.floor === 1, 'floor should start at 1');
  assert(hostRun.seedCode === seedCode, `seedCode ${hostRun.seedCode} !== ${seedCode}`);
  result.seedHonoured = true;
  result.clientsAgree = true;

  const expectedNext = nextFloorSeed(fixedSeed, 2);
  await host.evaluate(() => window.__autotest.debugRunEscape());
  await host.waitForFunction((next) => window.__autotest.runState()?.floor === 2 && window.__autotest.runState()?.seed === next, expectedNext, { timeout: 10_000 });
  await guest.waitForFunction((next) => window.__autotest.runState()?.floor === 2 && window.__autotest.runState()?.seed === next, expectedNext, { timeout: 10_000 });
  const afterEscape = await host.evaluate(() => window.__autotest.runState());
  const guestAfter = await guest.evaluate(() => window.__autotest.runState());
  result.afterEscape = afterEscape;
  assert(afterEscape.seed === expectedNext && guestAfter.seed === expectedNext, 'nightshift next floor seed mismatch');
  result.nightshiftAdvance = true;

  await host.evaluate(() => window.__autotest.debugRunCapture());
  await host.waitForFunction(() => window.__autotest.runState()?.captures === 1, null, { timeout: 5_000 });
  assert((await guest.evaluate(() => window.__autotest.runState()?.captures)) === 1, 'guest did not see capture');
  result.captureSync = true;

  const daily = dailySeed('2026-10-22');
  result.dailySeed = { date: '2026-10-22', seed: daily, code: formatSeed(daily) };
  result.pass = true;
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.pass = false;
  result.error = error instanceof Error ? error.message : String(error);
  result.serverLog = server?.log().slice(-2_000);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => undefined);
  await server?.stop();
}
