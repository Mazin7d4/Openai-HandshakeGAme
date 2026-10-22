// Solo companion soak: N fresh single-player runs through the arrival vent route.
// Each run asserts the CPU NEE never strands PIX (catches up, zipping if stuck) and
// cracks her own signal console during the paired office hack.
// Usage: RUNS=10 node tools/verify-solo-runs.mjs [url]
import { chromium } from 'playwright';
import { arrival } from './heist-route.mjs';
const RAW = process.argv[2] ?? 'http://localhost:5173/';
const URL_ = RAW + (RAW.includes('?') ? '&' : '?') + 'autotest&debug';
const RUNS = Number(process.env.RUNS ?? 10);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const results = [];
let failed = 0;
try {
  for (let run = 1; run <= RUNS; run++) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const readout = () => page.locator('#dev-readout').innerText();
    const gap = () => page.evaluate(() => {
      const a = window.__autotest.position('pix'); const b = window.__autotest.position('nee');
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    });
    let sample; const states = new Set(); let worst = 0; let farFor = 0; let longestFar = 0;
    const t0 = Date.now();
    try {
      await page.goto(URL_);
      await page.getByTestId('singleplayer').click();
      await page.getByTestId('start-singleplayer').click();
      await page.locator('#dev-readout').filter({ hasText: 'bot:' }).waitFor({ timeout: 120_000 });
      sample = setInterval(async () => {
        try {
          const g = await gap(); worst = Math.max(worst, g);
          farFor = g > 9 ? farFor + 0.25 : 0; longestFar = Math.max(longestFar, farFor);
          const m = (await readout()).match(/bot:(\w+)/); if (m) states.add(m[1]);
        } catch { /* page closing */ }
      }, 250);
      for (const p of arrival) {
        await page.evaluate((p) => window.__autotest.goto('pix', p.x, p.y ?? 2.2, p.z, p.tolerance ?? 1), p);
        await page.waitForFunction(() => window.__autotest.arrived('pix'), null, { timeout: 90_000, polling: 250 });
      }
      // PIX parks at its desk console; NEE should go crack the signal console herself.
      await page.waitForFunction(() => /cracked (her|his) console/i.test(document.querySelector('[data-testid="juice-toasts"]')?.textContent ?? ''), null, { timeout: 45_000, polling: 250 });
      clearInterval(sample);
      if (process.env.SHOTS && run === 1) await page.screenshot({ path: `${process.env.SHOTS}/solo-nee-cracked.png` });
      const zipCount = async () => +((await readout()).match(/bot:\w+\/z(\d+)/)?.[1] ?? 0);
      // Strand her on purpose: wedge NEE at the console while PIX flies back up the vent.
      const before = await zipCount();
      const at = await page.evaluate(() => window.__autotest.position('nee'));
      await page.evaluate((p) => window.__autotest.goto('nee', p.x, p.y, p.z, 0.4, true), at);
      await page.evaluate(() => window.__autotest.goto('pix', -4, 6.5, -42, 1, true));
      await page.waitForFunction((n) => +(document.querySelector('#dev-readout').textContent.match(/bot:\w+\/z(\d+)/)?.[1] ?? 0) > n, before, { timeout: 30_000, polling: 100 });
      await page.evaluate(() => window.__autotest.stop('nee'));
      if (process.env.SHOTS && run === 1) await page.screenshot({ path: `${process.env.SHOTS}/solo-zip.png` });
      let caught = false;
      for (let i = 0; i < 24 && !caught; i++) { await page.waitForTimeout(250); caught = (await gap()) < 5; }
      if (!caught) throw new Error(`zip did not bring NEE back (gap ${(await gap()).toFixed(1)})`);
      const zips = await zipCount();
      if (longestFar > 5) throw new Error(`NEE stranded ${longestFar}s (worst gap ${worst.toFixed(1)})`);
      if (errors.length) throw new Error(errors.join('\n'));
      results.push({ run, ok: true, secs: Math.round((Date.now() - t0) / 1000), worstGap: +worst.toFixed(1), longestFar, zips, states: [...states] });
    } catch (e) {
      clearInterval(sample);
      failed++;
      results.push({ run, ok: false, error: String(e.message).slice(0, 300), worstGap: +worst.toFixed(1), states: [...states] });
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/solo-fail-${run}.png` }).catch(() => {});
    }
    console.log(JSON.stringify(results[results.length - 1]));
    await page.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ runs: RUNS, failed }));
process.exit(failed ? 1 : 0);
