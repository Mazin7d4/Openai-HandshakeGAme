import { runTest, url, assert, collectErrors, waitForGame, openPage, closePage, BASE_URL } from './lib.mjs';

await runTest('no-cdn', async (browser, notes) => {
  const { ctx, page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  const base = new URL(BASE_URL);
  const allowedHosts = new Set(['127.0.0.1', 'localhost']);
  if (process.env.QA_BASE_URL) allowedHosts.add(base.hostname);
  const requests = [];
  const external = [];
  const requestedAssets = [];
  const statuses = { droneGlb: [], meshoptDecoder: [] };

  await ctx.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    requests.push(requestUrl);
    const parsed = new URL(requestUrl);
    const lowerPath = parsed.pathname.toLowerCase();
    if (lowerPath.endsWith('.glb') || lowerPath.endsWith('meshopt_decoder.js')
      || lowerPath.endsWith('.wasm') || lowerPath.endsWith('.woff2')
      || /draco|ktx2|basis/i.test(requestUrl)) {
      requestedAssets.push(requestUrl);
    }
    if (!allowedHosts.has(parsed.hostname)) {
      external.push(requestUrl);
      await route.abort();
      return;
    }
    await route.continue();
  });

  page.on('response', (response) => {
    const responseUrl = new URL(response.url());
    if (responseUrl.pathname.toLowerCase().endsWith('/drone.glb')) {
      statuses.droneGlb.push({ url: response.url(), status: response.status() });
    }
    if (responseUrl.pathname.toLowerCase().endsWith('/vendor/meshopt_decoder.js')) {
      statuses.meshoptDecoder.push({ url: response.url(), status: response.status() });
    }
  });

  const errors = collectErrors(page, 'no-cdn', []);
  await page.goto(url({ play: 'solo' }));
  await waitForGame(page);
  await page.waitForFunction(
    () => {
      const meshes = window.__autotest?.droneMeshes?.();
      return Array.isArray(meshes) && meshes.length >= 2 && meshes.every((count) => count > 0);
    },
    null,
    { timeout: 30_000 },
  );

  const droneMeshes = await page.evaluate(() => window.__autotest?.droneMeshes?.() ?? null);
  notes.external = external;
  notes.requestedAssets = requestedAssets;
  notes.droneMeshes = droneMeshes;
  notes.statuses = statuses;
  notes.errors = errors;

  assert(external.length === 0, `external requests:
${external.join('\n')}`);
  assert(requestedAssets.some((requestUrl) => /\/drone\.glb(?:[?#]|$)/i.test(requestUrl)), 'drone.glb was not requested');
  assert(statuses.droneGlb.some(({ status }) => status === 200), `drone.glb did not return 200: ${JSON.stringify(statuses.droneGlb)}`);
  assert(statuses.meshoptDecoder.some(({ url: decoderUrl, status }) => {
    return status === 200 && new URL(decoderUrl).origin === base.origin
      && new URL(decoderUrl).pathname.endsWith('/vendor/meshopt_decoder.js');
  }), `meshopt decoder did not load from our origin with status 200: ${JSON.stringify(statuses.meshoptDecoder)}`);
  assert(!requests.some((requestUrl) => /babylonjs\.com/i.test(requestUrl)), `Babylon CDN request found:
${requests.filter((requestUrl) => /babylonjs\.com/i.test(requestUrl)).join('\n')}`);

  const blockedHosts = new Set(external.map((requestUrl) => new URL(requestUrl).hostname));
  const serious = errors.filter((error) => !(/WebSocket|ERR_FAILED|net::/.test(error)
    && [...blockedHosts].some((hostname) => error.includes(hostname))));
  assert(serious.length === 0, `console errors:
${serious.join('\n')}`);
  await closePage(page);
});
