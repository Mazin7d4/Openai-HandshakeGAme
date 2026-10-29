// Cold load metrics QA: measures cold load timings, bundle and asset sizes,
// and records performance report to codex-big.
import { runTest, url, openPage, closePage, waitForGame, assert } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

await runTest('cold-load', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });

  const requests = [];
  let totalBytes = 0;
  page.on('response', async (res) => {
    try {
      const headers = res.headers();
      const len = Number(headers['content-length'] ?? 0);
      const u = res.url();
      totalBytes += len;
      requests.push({ url: u, status: res.status(), size: len, type: res.request().resourceType() });
    } catch (_) {}
  });

  const startNav = Date.now();
  await page.goto(url(), { waitUntil: 'domcontentloaded' });
  const dclTime = Date.now() - startNav;

  await page.getByTestId('title-settings').waitFor({ timeout: 20_000 });
  const titleInteractiveTime = Date.now() - startNav;

  // Measure paint timings via browser performance API
  const paintTimings = await page.evaluate(() => {
    const entries = performance.getEntriesByType('paint');
    return entries.map((e) => ({ name: e.name, startTime: Math.round(e.startTime) }));
  });

  // Start singleplayer to measure time to first game frame
  const startSolo = Date.now();
  await page.getByTestId('singleplayer').click();
  await page.getByTestId('start-singleplayer').click();
  await waitForGame(page);
  const gameReadyTime = Date.now() - startSolo;

  const jsBytes = requests.filter((r) => r.type === 'script').reduce((a, r) => a + r.size, 0);
  const cssBytes = requests.filter((r) => r.type === 'stylesheet').reduce((a, r) => a + r.size, 0);
  const fontBytes = requests.filter((r) => r.type === 'font').reduce((a, r) => a + r.size, 0);
  const wasmBytes = requests.filter((r) => r.url.endsWith('.wasm')).reduce((a, r) => a + r.size, 0);

  const metrics = {
    measuredAt: new Date().toISOString(),
    timings: {
      domContentLoadedMs: dclTime,
      titleInteractiveMs: titleInteractiveTime,
      gameReadyMs: gameReadyTime,
      paintTimings,
    },
    transfer: {
      totalRequests: requests.length,
      totalBytesKB: Math.round(totalBytes / 1024),
      jsBytesKB: Math.round(jsBytes / 1024),
      cssBytesKB: Math.round(cssBytes / 1024),
      fontBytesKB: Math.round(fontBytes / 1024),
      wasmBytesKB: Math.round(wasmBytes / 1024),
    },
  };

  notes.metrics = metrics;

  const outDir = resolve('/workspace/handshake/sprint/netcode-agy/codex-big');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'cold-load-metrics.json'), JSON.stringify(metrics, null, 2));

  assert(dclTime < 15_000, `DOM content loaded too slow: ${dclTime}ms`);
  assert(titleInteractiveTime < 25_000, `Title interactive too slow: ${titleInteractiveTime}ms`);
  assert(gameReadyTime < 35_000, `Game ready too slow: ${gameReadyTime}ms`);

  await closePage(page);
});
