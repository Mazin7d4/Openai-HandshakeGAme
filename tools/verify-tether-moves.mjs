// Dev-local check for the tether moves: YANK pulls the idle partner toward you,
// SLINGSHOT launches you toward an anchored partner. Saves screenshots if SHOTS is set.
import { chromium } from 'playwright';

const APP_URL = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const SHOTS = process.env.SHOTS;
const assert = (c, m) => { if (!c) throw new Error(m); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function pos(page, id) {
  const text = await page.locator('#dev-readout').innerText();
  const m = text.match(new RegExp(`${id}\\s+x\\s+(-?\\d+\\.\\d)\\s+y\\s+(-?\\d+\\.\\d)\\s+z\\s+(-?\\d+\\.\\d)`));
  if (!m) throw new Error(`Missing ${id}`);
  return { x: +m[1], y: +m[2], z: +m[3] };
}

async function pullApart(page, key, target, timeout = 12_000) {
  const started = Date.now();
  await page.keyboard.down(key);
  try {
    while (Date.now() - started < timeout) {
      if (dist(await pos(page, 'player-1'), await pos(page, 'player-2')) >= target) return;
      await page.waitForTimeout(60);
    }
  } finally { await page.keyboard.up(key); }
  throw new Error(`Could not stretch the tether to ${target}: ${JSON.stringify(await pos(page, "player-1"))} ${JSON.stringify(await pos(page, "player-2"))}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP_URL);
  await page.getByTestId('dev-local').click();
  await page.locator('#dev-readout').waitFor();
  await page.waitForTimeout(2500);

  // YANK: PIX drifts to the far end of the slack cord and stops; R pulls NEE in.
  await pullApart(page, 'a', 6.4);
  await page.waitForTimeout(900);
  const neeBefore = await pos(page, 'player-2');
  const pixAt = await pos(page, 'player-1');
  await page.keyboard.press('r');
  await page.waitForTimeout(120);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/yank.png` });
  await page.waitForTimeout(500);
  const neeAfter = await pos(page, 'player-2');
  const closed = dist(neeBefore, pixAt) - dist(neeAfter, pixAt);
  console.log('yank: NEE closed', closed.toFixed(2), 'm');
  assert(closed > 1.2, `Yank did not pull NEE toward PIX (closed ${closed.toFixed(2)} m).`);

  // SLINGSHOT: PIX boosts away until the cord is nearly taut, then R (while still
  // charging) launches PIX back. Tries a few directions since walls vary.
  await page.waitForTimeout(1600);
  let slung = false;
  for (const dir of ['s', 'w', 'd', 'a', 'Space']) {
    await page.keyboard.down('Shift');
    await page.keyboard.down(dir);
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const d = dist(await pos(page, 'player-1'), await pos(page, 'player-2'));
      if (d > 6.6) break;
      await page.waitForTimeout(50);
    }
    const p1 = await pos(page, 'player-1');
    await page.waitForTimeout(60);
    const p1b = await pos(page, 'player-1');
    console.log('pre-sling dist', dist(p1, await pos(page, 'player-2')).toFixed(2), 'pix step', dist(p1, p1b).toFixed(2));
    await page.keyboard.press('r');
    await page.waitForTimeout(90);
    if (SHOTS && !slung) await page.screenshot({ path: `${SHOTS}/slingshot.png` });
    await page.keyboard.up(dir);
    await page.keyboard.up('Shift');
    const toast = await page.getByTestId('juice-toasts').innerText();
    console.log('sling attempt', dir, JSON.stringify(toast));
    if (/slingshot/i.test(toast)) { slung = true; break; }
    await page.waitForTimeout(1300);
  }
  assert(slung, 'Slingshot never triggered.');
  assert(!errors.length, `Page errors: ${errors.join('\n')}`);
  console.log('verify-tether-moves: PASS');
} finally {
  await browser.close();
}
