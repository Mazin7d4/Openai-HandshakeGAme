// Two-client check that enemy authority is server-owned: both clients render the same patrol
// positions (within tolerance), and agree on camera detection, spotted counts, stuns and alarm state.
// Needs the server's test hooks (HANDSHAKE_TEST_HOOKS=1; `npm run dev` sets it) for the escape shortcut.
import { chromium } from 'playwright';

const rawUrl = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/?scale=4&lowfx';
const urlObj = new URL(rawUrl);
urlObj.searchParams.set('debug', '1');
urlObj.searchParams.set('autotest', '1');
const APP_URL = urlObj.toString();
// Replicated (server) state from the same patch must match exactly (float32 noise only).
// Rendered positions lag by interpolation + frame time, which is 2-20 FPS on headless SwiftShader.
const SERVER_TOLERANCE = Number(process.env.SERVER_TOLERANCE ?? 0.05);
const PATROL_TOLERANCE = Number(process.env.PATROL_TOLERANCE ?? 1.0);

function assert(condition, message) { if (!condition) throw new Error(message); }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sec = (page) => page.evaluate(() => window.__autotest.security());

const browser = await chromium.launch({ headless: true });
const hostContext = await browser.newContext();
const guestContext = await browser.newContext();
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const errors = [];
for (const [name, page] of [['host', host], ['guest', guest]]) {
  page.on('pageerror', (error) => errors.push(`${name} pageerror: ${error.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
}

const result = {};
try {
  await host.addInitScript(() => localStorage.setItem('handshake.onboardingDone', '1'));
  await host.goto(APP_URL);
  await host.getByTestId('multiplayer').click();
  await host.getByTestId('create-room').click();
  const code = (await host.getByTestId('room-code').innerText()).trim();
  await guest.addInitScript(() => localStorage.setItem('handshake.onboardingDone', '1'));
  await guest.goto(APP_URL);
  await guest.getByTestId('multiplayer').click();
  await guest.getByTestId('join-room').click();
  await guest.getByTestId('room-code-input').fill(code);
  await guest.getByTestId('join-submit').click();
  for (const page of [host, guest]) {
    await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 60_000 });
    await page.waitForFunction(() => window.__autotest?.security, null, { timeout: 30_000 });
  }

  // 1. Escape stage (alarm + patrols on) via the server's test hook; both clients must agree.
  await host.evaluate(() => window.__autotest.debugStage('escape'));
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__autotest.security().securityActive, null, { timeout: 10_000 })
      .catch(() => { throw new Error('securityActive never arrived (is the server running with HANDSHAKE_TEST_HOOKS=1?)'); });
  }
  const [h0, g0] = await Promise.all([sec(host), sec(guest)]);
  assert(h0.alarm && g0.alarm && h0.stage === 'escape' && g0.stage === 'escape', 'Alarm/stage disagree after escape');

  // 2. Patrol positions. Each client logs replicated patrol samples keyed by the server mission
  // clock; samples from the same server patch must match, and each client's rendered patrol
  // must track its own replicated state (interpolation lag only).
  await host.waitForTimeout(800);
  const first = await sec(host);
  let worstRender = 0; const lags = [];
  for (let i = 0; i < 12; i++) {
    for (const s of await Promise.all([sec(host), sec(guest)])) {
      for (let p = 0; p < 2; p++) { const lag = dist(s.patrols[p], s.server.patrols[p]); lags.push(lag); worstRender = Math.max(worstRender, lag); }
      if (process.env.TRACE) console.log(JSON.stringify({ r: s.patrols, srv: s.server.patrols, active: s.securityActive }));
    }
    await host.waitForTimeout(200);
  }
  const [hh, gh] = await Promise.all([sec(host), sec(guest)]);
  const guestByT = new Map(gh.history.map((sample) => [sample.t, sample.p]));
  let matched = 0; let worstServer = 0;
  for (const sample of hh.history) {
    const other = guestByT.get(sample.t);
    if (!other) continue;
    matched++;
    for (let p = 0; p < 2; p++) worstServer = Math.max(worstServer, dist(sample.p[p], other[p]));
  }
  const travelled = Math.min(dist(first.server.patrols[0], hh.server.patrols[0]), dist(first.server.patrols[1], hh.server.patrols[1]));
  assert(travelled > 1.5, `Patrols did not move on their server route (${travelled.toFixed(2)})`);
  assert(matched >= 5, `Too few same-patch samples to compare (${matched})`);
  assert(worstServer < SERVER_TOLERANCE, `Replicated patrol positions disagree by ${worstServer.toFixed(3)} on the same server patch`);
  // A single SwiftShader frame hitch can spike one sample, so gate on the median and a loose max.
  const medianRender = lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)];
  assert(medianRender < PATROL_TOLERANCE, `Rendered patrol median lag ${medianRender.toFixed(2)} (> ${PATROL_TOLERANCE})`);
  assert(worstRender < PATROL_TOLERANCE * 3, `Rendered patrol lag spike ${worstRender.toFixed(2)}`);
  Object.assign(result, { patrolTravel: +travelled.toFixed(2), samePatchSamples: matched, patrolMaxServerDelta: +worstServer.toFixed(3), patrolMedianRenderLag: +medianRender.toFixed(2), patrolMaxRenderLag: +worstRender.toFixed(2) });

  // 2b. Stun arbitration, negative case: players are back at the spawn, far from both patrols, so
  // claims (even at the patrol's exact server position, or a made-up point) must be rejected.
  const hp = (await sec(host)).server.patrols;
  await host.evaluate((p) => { window.__autotest.requestStun(0, p[0]); window.__autotest.requestStun(1, { x: p[1].x + 9, y: p[1].y, z: p[1].z + 9 }); }, hp);
  await host.waitForTimeout(600);
  const [hb, gb] = await Promise.all([sec(host), sec(guest)]);
  assert(!hb.server.patrols.some((p) => p.stunned) && !gb.server.patrols.some((p) => p.stunned) && hb.clotheslines === 0,
    'Server accepted a stun claim with no cord near the patrol');

  // 3. Camera detection: both drones fly into the security camera cone; each drone is spotted on its own
  //    cooldown, so the server reports both roles, and both clients agree on every event.
  const place = () => Promise.all([
    host.evaluate(() => window.__autotest.teleport('pix', -1.2, 3.4, 4.2)),
    guest.evaluate(() => window.__autotest.teleport('nee', 1.2, 3.4, 4.6)),
  ]);
  await place(); await host.waitForTimeout(250); await place();
  await host.waitForFunction(() => ['pix', 'nee'].every((r) => window.__autotest.security().spotted.includes(r)), null, { timeout: 15_000 })
    .catch(async () => { throw new Error(`Never spotted: ${JSON.stringify(await sec(host))}`); });
  await host.waitForTimeout(400);
  const [hs, gs] = await Promise.all([sec(host), sec(guest)]);
  assert(hs.timesSpotted === gs.timesSpotted, `timesSpotted disagree ${hs.timesSpotted} vs ${gs.timesSpotted}`);
  assert(hs.timesSpotted >= 2 && hs.spotted.length >= 2 && hs.spotted.join() === gs.spotted.join(), `spotted events disagree ${hs.spotted} vs ${gs.spotted}`);
  assert(Math.abs(hs.detection - gs.detection) < 0.1, `detection meter disagrees ${hs.detection} vs ${gs.detection}`);
  Object.assign(result, { timesSpotted: hs.timesSpotted, spottedEvents: hs.spotted, detection: [+hs.detection.toFixed(2), +gs.detection.toFixed(2)] });

  // 4. Stun arbitration, positive case: a valid claim stuns on both clients with the same count.
  let stunned = false;
  for (let attempt = 0; attempt < 6 && !stunned; attempt++) {
    // Keep the cord pair straddling patrol 0 so the server's segment check passes.
    const p0 = (await sec(host)).server.patrols[0];
    await Promise.all([
      host.evaluate((p) => window.__autotest.teleport('pix', p.x - 1.6, p.y, p.z), p0),
      guest.evaluate((p) => window.__autotest.teleport('nee', p.x + 1.6, p.y, p.z), p0),
    ]);
    await host.waitForTimeout(300);
    await host.evaluate(() => window.__autotest.requestStun(0));
    stunned = await Promise.all([host, guest].map((page) => page.waitForFunction(
      () => window.__autotest.security().server.patrols[0].stunned, null, { timeout: 1500 }).then(() => true, () => false)))
      .then((both) => both.every(Boolean));
  }
  assert(stunned, 'Valid clothesline claim did not stun patrol 0 on both clients');
  await host.waitForTimeout(300);
  const [hc, gc] = await Promise.all([sec(host), sec(guest)]);
  assert(hc.clotheslines === gc.clotheslines && hc.clotheslines >= 1, `clotheslines disagree ${hc.clotheslines} vs ${gc.clotheslines}`);
  assert(dist(hc.patrols[0], gc.patrols[0]) < PATROL_TOLERANCE, 'Stunned patrol position disagrees');
  assert(hc.stage === gc.stage && hc.alarm === gc.alarm && hc.timesSpotted === gc.timesSpotted, 'Final mission state disagrees');
  Object.assign(result, { clotheslines: hc.clotheslines, finalStage: hc.stage });

  assert(errors.length === 0, errors.join('\n'));
  console.log(JSON.stringify({ roomCode: code, ...result }, null, 2));
} finally {
  await hostContext.close();
  await guestContext.close().catch(() => undefined);
  await browser.close();
}
