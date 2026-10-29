// Short landscape screens must keep their frame, controls, and focused scroll content reachable.
import { mkdirSync, writeFileSync } from 'node:fs';
import { runTest, url, assert, collectErrors, waitForGame } from './lib.mjs';

const out = process.env.QA_TOUCH_SHOTS ?? '/workspace/handshake/sprint/playtest/touch';
mkdirSync(out, { recursive: true });
const sizes = [[1024, 461], [844, 390], [740, 360], [932, 430], [390, 844], [1280, 720]];

await runTest('phone-screens', async (browser, notes) => {
  const errors = [], failures = [];
  notes.screens = 0;
  for (const [width, height] of sizes) {
    const viewport = { width, height };
    const context = await browser.newContext({ viewport, screen: viewport, hasTouch: width !== 1280, isMobile: width !== 1280, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage(); collectErrors(page, `${width}x${height}`, errors);
    const check = async (name, selector = '.menu-panel') => {
      const panel = page.locator(selector).filter({ visible: true }).first();
      await panel.waitFor(); await page.evaluate(() => document.fonts.ready);
      await panel.evaluate(el => Promise.all(el.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished)));
      const problems = await panel.evaluate(root => {
        const problems = [], frame = root.getBoundingClientRect();
        const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
        if (frame.x < -1 || frame.y < -1 || frame.right > innerWidth + 1 || frame.bottom > innerHeight + 1) problems.push(`frame outside viewport ${JSON.stringify(frame.toJSON())}`);
        if (root.scrollWidth > root.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1) problems.push('horizontal overflow');
        const controls = [...root.querySelectorAll('button, input:not([type="hidden"]), select, a[href]')].filter(el => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
        const clippedRect = el => {
          const r = el.getBoundingClientRect();
          const b = { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
          for (let p = el.parentElement; p; p = p.parentElement) {
            const style = getComputedStyle(p), clip = p.getBoundingClientRect();
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { b.y = Math.max(b.y, clip.y); b.bottom = Math.min(b.bottom, clip.bottom); }
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { b.x = Math.max(b.x, clip.x); b.right = Math.min(b.right, clip.right); }
          }
          return b;
        };
        const boxes = controls.map(el => ({ el, name: el.dataset.testid || el.textContent, rect: el.getBoundingClientRect(), clipped: clippedRect(el) }));
        for (const { el, name, rect } of boxes) {
          if (rect.width < 47.9 || rect.height < 47.9) problems.push(`${name} below 48px ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`);
          // A scroll pane may contain offscreen content; focus must bring it into view.
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          if (!el.disabled) el.focus({ preventScroll: false });
          const r = el.getBoundingClientRect();
          if (r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) problems.push(`${name} unreachable on focus`);
        }
        for (let i = 0; i < boxes.length; i++) for (const b of boxes.slice(i + 1)) {
          const a = boxes[i];
          if (!a.el.contains(b.el) && !b.el.contains(a.el) && intersects(a.clipped, b.clipped)) problems.push(`overlap ${a.name}/${b.name}`);
        }
        return problems;
      });
      failures.push(...problems.map(p => `${width}x${height} ${name}: ${p}`));
      writeFileSync(`${out}/layout-findings.json`, JSON.stringify(failures, null, 2));
      await panel.evaluate(el => { el.scrollTop = 0; el.querySelectorAll('*').forEach(child => { child.scrollTop = 0; }); const shell = el.closest('.menu-shell'); if (shell) shell.scrollTop = 0; });
      await page.screenshot({ path: `${out}/after-${width}x${height}-${name}.png` }); notes.screens++;
    };
    try {
      await page.goto(url()); await page.getByTestId('singleplayer').waitFor(); await check('title');
      await page.getByTestId('singleplayer').click(); await check('play');
      await page.getByTestId('back').click(); await page.getByTestId('title-settings').click();
      for (const tab of ['audio', 'visuals', 'accessibility', 'controls', 'cosmetics']) {
        await page.getByTestId(`settings-tab-${tab}`).click(); await check(`settings-${tab}`, '.settings-panel, .settings-menu--embedded');
      }
      await page.getByTestId('settings-back').click(); await page.getByTestId('multiplayer').click(); await check('coop');
      await page.getByTestId('join-room').click(); await check('join');
      await page.getByTestId('back').click(); await page.getByTestId('quick-match').click(); await page.getByTestId('qm-status').waitFor(); await check('quickmatch');
      await page.getByTestId('qm-cancel').click(); await page.getByTestId('create-room').click();
      await page.getByTestId('room-code').waitFor(); await page.locator('.invite-qr svg').waitFor(); await check('lobby-qr');
      await page.goto(url()); await page.getByTestId('leaderboards').click(); await page.getByTestId('lb-tab-daily').waitFor(); await check('leaderboard');
      await page.route('**/leaderboard', route => route.fulfill({ json: {
        daily: { key: 'daily:qa', entries: [] },
        nightshift: { key: 'nightshift:all', entries: [{ id: 'qa', display: 'A very long crew name for a small phone', score: 12345, floors: 12 }] },
        nightshiftWeek: { key: 'nightshift:week:qa', entries: [] },
      } }));
      await page.goto(url()); await page.getByTestId('leaderboards').click();
      await page.getByTestId('lb-tab-daily').waitFor(); await page.getByTestId('lb-tab-nightshift').click();
      await page.getByTestId('lb-list').locator('li').waitFor(); await check('leaderboard-populated');
      await page.goto(url({ report: '1' })); await page.getByTestId('mission-complete').waitFor({ state: 'visible' }); await check('report', '.heist-report');
      await page.goto(url({ play: 'solo' })); await waitForGame(page);
      const rotate = page.getByRole('button', { name: 'Got it', exact: true }); if (await rotate.isVisible()) await rotate.click();
      await page.locator('#dev-readout, #dev-controls').evaluateAll(nodes => nodes.forEach(el => el.style.setProperty('opacity', '0', 'important')));
      const skip = page.getByTestId('onboarding-skip'); if (await skip.isVisible()) await skip.click();
      await page.evaluate(() => window.__autotest.toast('Pause audit toast'));
      await page.locator('.juice-toast').filter({ hasText: 'Pause audit toast' }).waitFor();
      if (width === 1280) await page.keyboard.press('Escape'); else await page.getByTestId('touch-pause').click();
      await page.getByTestId('pause-menu').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.body.classList.contains('pause-menu-open'));
      await page.getByTestId('juice-toasts').waitFor({ state: 'hidden' });
      assert(!await page.getByTestId('juice-toasts').isVisible(), `${width}x${height}: callout overlaps Pause`);
      assert(!await page.getByTestId('mission-objective').isVisible(), `${width}x${height}: objective overlaps Pause`);
      await check('pause', '.pause-panel'); await page.getByTestId('pause-settings').click(); await check('pause-settings', '.settings-panel, .settings-menu--embedded');
      await page.getByTestId('settings-back').click(); await page.getByTestId('pause-controls').click(); await check('pause-controls', '.pause-panel');
      if (width !== 1280) assert(await page.locator('.touch-controls-help').isVisible() && !/W A S D|Inspection|dev local/.test(await page.locator('.pause-panel').textContent()), 'phone help contains keyboard/developer controls');
      // Presentation fixture uses the shipped wake widget; network recovery is covered by wake.test.mjs.
      await page.goto(url());
      await page.evaluate(async () => {
        const { createWakeOverlay } = await import('/src/ui/WakeOverlay.ts');
        const panel = document.querySelector('.menu-panel'); panel.classList.remove('title-panel');
        const heading = document.createElement('h1'); heading.textContent = 'Connecting'; panel.replaceChildren(heading);
        const button = (label, id, action, variant = '') => {
          const el = document.createElement('button'); el.className = `btn menu-button ${variant}`;
          el.dataset.testid = id; el.textContent = label; el.addEventListener('click', action); return el;
        };
        const noop = () => {};
        const wake = createWakeOverlay(button, 60000, { cancel: noop, playSolo: noop, retry: noop, back: noop });
        panel.append(wake.overlay); wake.update(12000); window.wakeFixture = wake;
      });
      await check('wake'); await page.evaluate(() => window.wakeFixture.showFailure()); await check('wake-failure');
    } catch (error) {
      await page.screenshot({ path: `${out}/failure-phone-screens-${width}x${height}.png` }).catch(() => {});
      writeFileSync(`${out}/failure-phone-screens.json`, JSON.stringify({ url: page.url(), body: await page.locator('body').innerText().catch(() => ''), errors, error: String(error) }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  notes.failures = failures; notes.errors = errors;
  assert(!failures.length && !errors.length, [...failures, ...errors].join('\n'));
});
