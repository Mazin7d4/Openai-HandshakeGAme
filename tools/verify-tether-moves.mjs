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

async function pullApart(page, key, target, timeout = 25_000) {
  const started = Date.now();
  await page.keyboard.down(key);
  try {
    while (Date.now() - started < timeout) {
      if (dist(await pos(page, 'player-1'), await pos(page, 'player-2')) >= target) return;
      await page.waitForTimeout(60);
    }
  } finally { await page.keyboard.up(key); }
  throw new Error(`Could not stretch the tether to ${target}`);
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

  // YANK: PIX strains the cord upward, NEE idles; R pulls NEE toward PIX.
  await pullApart(page, 'Space', 8.2);
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

  // SLINGSHOT: let NEE settle (anchored), stretch again, R launches PIX toward NEE.
  await page.waitForTimeout(1600);
  await pullApart(page, 'Space', 8.4);
  const pixBefore = await pos(page, 'player-1');
  const neeAnchor = await pos(page, 'player-2');
  await page.keyboard.press('r');
  await page.waitForTimeout(150);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/slingshot.png` });
  await page.waitForTimeout(350);
  const pixAfter = await pos(page, 'player-1');
  const moved = dist(pixBefore, neeAnchor) - dist(pixAfter, neeAnchor);
  console.log('slingshot: PIX closed', moved.toFixed(2), 'm');
  assert(moved > 1.5, `Slingshot did not launch PIX (closed ${moved.toFixed(2)} m).`);
  assert(!errors.length, `Page errors: ${errors.join('\n')}`);
  console.log('verify-tether-moves: PASS');
} finally {
  await browser.close();
}
