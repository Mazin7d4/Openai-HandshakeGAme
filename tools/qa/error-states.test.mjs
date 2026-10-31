// UI + integration evidence: recoverable graphics failure, server wake failure, and low-tier title.
import { runTest, url, assert, tryShot, SERVER_PORT } from './lib.mjs';
import { startWakeProxy } from './wake-proxy.mjs';

await runTest('error-states', async (browser, notes) => {
  const proxy = await startWakeProxy({ targetPort: Number(SERVER_PORT), downMs: Infinity, mode: '503' });
  try {
    const context = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      await page.goto(url({ server: proxy.url, wakeTimeout: '1000' }));
      await page.getByTestId('multiplayer').click(); await page.getByTestId('create-room').click();
      await page.getByTestId('wake-retry').waitFor({ state: 'visible' });
      await tryShot(page, 'error-server-down-740x360');
      for (const id of ['wake-retry', 'wake-play-solo', 'back']) {
        const rect = await page.getByTestId(id).boundingBox();
        assert(rect && rect.width >= 48 && rect.height >= 48 && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 740 && rect.y + rect.height <= 360, `server-down action ${id} is clipped or small: ${JSON.stringify(rect)}`);
      }
      await page.getByTestId('wake-play-solo').click(); await page.getByTestId('start-singleplayer').waitFor();
      notes.serverDown = { retry: true, solo: true, back: true };
    } finally { await context.close(); }
    const graphics = await browser.newContext({ viewport: { width: 844, height: 390 }, reducedMotion: 'reduce' });
    const graphicsPage = await graphics.newPage();
    try {
      await graphics.addInitScript(() => {
        const native = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return /webgl/i.test(kind) ? null : native.call(this, kind, ...args); };
      });
      await graphicsPage.goto(url()); await graphicsPage.getByTestId('singleplayer').click(); await graphicsPage.getByTestId('start-singleplayer').click();
      const error = graphicsPage.getByRole('alertdialog');
      try { await error.waitFor({ timeout: 10000 }); }
      finally { await tryShot(graphicsPage, 'error-graphics-844x390'); }
      assert(/graphics|WebGL|3D/i.test(await error.innerText()), 'graphics failure does not explain the problem');
      const back = error.getByRole('button', { name: /menu/i }); await back.click();
      await graphicsPage.getByTestId('singleplayer').waitFor(); notes.graphicsRecovery = true;
    } finally { await graphics.close(); }
  } finally { await proxy.close(); }
});
