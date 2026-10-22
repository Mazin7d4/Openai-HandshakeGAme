// Judge-style playtest harness (daily). Records video + timed screenshots; prints a JSON summary.
// Usage: node tools/qa/playtest.mjs <solo|duo|phone> <outDir> [seconds]
// solo : naive keyboard play for 90s (what a cold judge sees), then the PIX autopilot route with CPU NEE.
// duo  : host + guest, short co-op flight.   phone: 844x390 touch guest joins a desktop host.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, devices, BASE_URL, url, createAndJoin, waitForGame, worldState, collectErrors, compareWorld } from './lib.mjs';
import { arrival, toNee, servers, vault } from '../heist-route.mjs';

const [mode = 'solo', out = '/tmp/playtest', secs = '300'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const budget = Number(secs) * 1000;
const browser = await launch();
const log = { mode, url: BASE_URL, events: [], errors: [] };
const t0 = Date.now();
const ev = (what, extra = {}) => log.events.push({ t: +((Date.now() - t0) / 1000).toFixed(1), what, ...extra });
const fps = (page) => page.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; performance.now() - s < 1500 ? requestAnimationFrame(f) : res(+(n / 1.5).toFixed(1)); }; requestAnimationFrame(f); }));
const snap = async (page, name) => page.screenshot({ path: `${out}/${name}.png` }).catch(() => {});
const hold = async (page, keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };

try {
  if (mode === 'solo') {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 960, height: 540 } } });
    const page = await ctx.newPage(); collectErrors(page, 'solo', log.errors);
    await page.goto(url()); ev('menu');
    await snap(page, '00-menu');
    log.menuButtons = await page.locator('button').allInnerTexts();
    await page.getByTestId('singleplayer').click(); await page.getByTestId('start-singleplayer').click();
    await waitForGame(page); ev('first-frame'); await page.waitForTimeout(1500);
    log.fpsStart = await fps(page); await snap(page, '01-spawn');
    log.controlsCard = await page.getByTestId('controls-card').innerText().catch(() => null);
    const objective = () => page.getByTestId('mission-objective').innerText().catch(() => '');
    log.objective0 = (await objective()).replace(/\s+/g, ' ');
    // Phase 1: naive judge input for ~90s
    await page.getByTestId('game-canvas').focus();
    const naive = [[['w'], 2500], [['w', 'Shift'], 2000], [['Space'], 1200], [['a'], 1500], [['r'], 300], [['w'], 2500], [['e'], 300], [['d', 'w'], 2500], [['r'], 300], [['f'], 300], [['s'], 1500], [['Control'], 800], [['w', 'Space'], 2000]];
    let i = 0;
    while (Date.now() - t0 < 90_000) {
      const [k, ms] = naive[i++ % naive.length]; await hold(page, k, ms);
      if (i % 8 === 0) { await snap(page, `02-naive-${i}`); ev('naive', { prompt: (await page.getByTestId('interaction-prompt').innerText().catch(() => '')).slice(0, 80), toasts: (await page.getByTestId('juice-toasts').innerText().catch(() => '')).slice(0, 80) }); }
    }
    log.naiveState = (await worldState(page)).raw.split('\n').slice(0, 4).join(' | ');
    // Phase 2: autopilot along the PIX route; CPU NEE follows
    const route = [...arrival, ...toNee, ...servers, ...vault];
    let lastStage = null; let reached = 0;
    for (const p of route) {
      if (Date.now() - t0 > budget) break;
      await page.evaluate((p) => window.__autotest.goto('pix', p.x, p.y ?? 2.2, p.z, p.tolerance ?? 1), p);
      const ok = await page.waitForFunction(() => window.__autotest.arrived('pix'), null, { timeout: Math.max(1000, Math.min(40_000, budget - (Date.now() - t0))), polling: 300 }).then(() => true, () => false);
      if (!ok) { ev('stuck', { at: p }); await snap(page, `03-stuck-${reached}`); break; }
      reached++;
      // try interactions a player would: hack + grab near consoles
      await page.evaluate(() => { window.__autotest.press('pix', 'hack'); });
      const ws = await worldState(page);
      const st = ws.raw.match(/mission:(\w+)/)?.[1]; const bot = ws.raw.match(/bot:(\w+)/)?.[1];
      if (st !== lastStage) { ev('stage', { stage: st, bot }); await snap(page, `04-stage-${st}`); lastStage = st; }
      const minigame = await page.locator('[data-testid=packet-routing],[data-testid=signal-match],[data-testid=memory-trace]').first().isVisible().catch(() => false);
      if (minigame) { ev('minigame-open'); await snap(page, `05-minigame-${reached}`); await page.keyboard.press('Escape'); }
      const pl = ws.players; if (pl['player-1'] && pl['player-2']) { const d = Math.hypot(pl['player-1'].x - pl['player-2'].x, pl['player-1'].z - pl['player-2'].z); if (d > 12) ev('nee-far', { d: +d.toFixed(1), bot }); }
    }
    log.waypointsReached = `${reached}/${route.length}`;
    log.objectiveEnd = (await objective()).replace(/\s+/g, ' ');
    log.fpsEnd = await fps(page); await snap(page, '06-end');
    log.endReadout = (await worldState(page)).raw.split('\n').slice(0, 5).join(' | ');
    await page.waitForTimeout(Math.max(0, Math.min(5000, budget - (Date.now() - t0))));
    await ctx.close();
  } else {
    const phone = mode === 'phone';
    const hctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const gctx = await browser.newContext(phone
      ? { ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, recordVideo: { dir: out, size: { width: 844, height: 390 } } }
      : { viewport: { width: 960, height: 540 }, recordVideo: { dir: out, size: { width: 960, height: 540 } } });
    const host = await hctx.newPage(); const guest = await gctx.newPage();
    collectErrors(host, 'host', log.errors); collectErrors(guest, 'guest', log.errors);
    log.room = await createAndJoin(host, guest); ev('joined');
    await Promise.all([waitForGame(host), waitForGame(guest)]); ev('both-in-game');
    await snap(guest, `${mode}-00-guest`); await snap(host, `${mode}-00-host`);
    log.fpsGuest = await fps(guest);
    log.guestControls = await guest.getByTestId('controls-card').innerText().catch(() => null);
    for (let k = 0; Date.now() - t0 < budget; k++) {
      await host.getByTestId('game-canvas').focus(); await hold(host, [['w', 'a', 'd', 's'][k % 4], 'Shift'], 1200);
      if (!phone) { await guest.getByTestId('game-canvas').focus(); await hold(guest, [['w', 'd', 's', 'a'][k % 4]], 1200); await hold(guest, ['r'], 200); }
      else { await guest.touchscreen.tap(422, 300); }
      if (k % 5 === 0) { const issues = compareWorld(await worldState(host), await worldState(guest)); ev('sync', { issues }); await snap(guest, `${mode}-guest-${k}`); }
    }
    await hctx.close(); await gctx.close();
  }
} catch (e) { log.error = String(e?.message ?? e).slice(0, 800); }
await browser.close();
log.seconds = Math.round((Date.now() - t0) / 1000);
writeFileSync(`${out}/${mode}-summary.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log).slice(0, 4000));
