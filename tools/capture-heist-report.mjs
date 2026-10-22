/**
 * Headless screenshots of the Heist Report at desktop, phone portrait (390×844)
 * and phone landscape (844×390). Uses `?report` (no Havok boot).
 *
 * Usage: node tools/capture-heist-report.mjs [baseUrl]
 * Writes PNGs under /opt/cursor/artifacts/heist-report/ (and ./artifacts/ if present).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RAW = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const url = new URL(RAW);
url.searchParams.set('report', '1');
const TARGET = url.toString();

const OUT_DIRS = ['/opt/cursor/artifacts/heist-report', '/workspace/artifacts/heist-report'];
for (const dir of OUT_DIRS) {
  try { mkdirSync(dir, { recursive: true }); } catch { /* optional */ }
}
const outDir = OUT_DIRS.find((dir) => {
  try { mkdirSync(dir, { recursive: true }); return true; } catch { return false; }
}) ?? OUT_DIRS[0];

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone-portrait-390x844', width: 390, height: 844 },
  { name: 'phone-landscape-844x390', width: 844, height: 390 },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});

const paths = [];
try {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.getByTestId('mission-complete').waitFor({ state: 'visible', timeout: 15_000 });
    // Let grade faces land (3 × 220ms + buffer).
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="mission-complete"]');
      if (overlay instanceof HTMLElement) overlay.scrollTop = 0;
      const panel = overlay?.querySelector('.heist-report');
      if (panel instanceof HTMLElement) panel.scrollTop = 0;
    });
    const file = join(outDir, `heist-report-${vp.name}.png`);
    await page.locator('.heist-report').screenshot({ path: file });
    paths.push(file);
    console.log('wrote', file);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ ok: true, paths, target: TARGET }));
