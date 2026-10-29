// DOM contracts complement retained judge screenshots; they do not certify canvas accessibility.
import { runTest, url, assert, collectErrors, tryShot, waitForGame } from './lib.mjs';

const sizes = [[1280, 720], [1920, 1080], [390, 844], [360, 640], [844, 390]];

async function audit(page, label) {
  await page.evaluate(() => document.fonts.ready);
  const failures = await page.evaluate(() => {
    const root = document.querySelector('.settings-overlay.visible .settings-panel, .settings-menu--embedded')
      ?? document.querySelector('.heist-report-overlay.visible .heist-report, .pause-overlay.visible .pause-panel')
      ?? document.querySelector('.menu-panel');
    if (!root) return ['no active menu'];
    const problems = [];
    const visible = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !el.closest('[hidden], [aria-hidden="true"], .a11y-live');
    const rgba = (value) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const over = (fg, bg) => { const a = fg[3] ?? 1; return fg.slice(0, 3).map((c, i) => c * a + bg[i] * (1 - a)).concat(1); };
    const background = (el) => {
      const chain = []; for (let p = el; p; p = p.parentElement) chain.unshift(p);
      return chain.reduce((bg, p) => over(rgba(getComputedStyle(p).backgroundColor), bg), [229, 225, 213, 1]);
    };
    const luminance = (c) => c.slice(0, 3).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
    const name = (el) => el.dataset.testid || el.textContent?.trim().slice(0, 45) || el.tagName;
    const panel = root.getBoundingClientRect();
    if (panel.left < -1 || panel.right > innerWidth + 1) problems.push('panel outside horizontal viewport');
    if (document.documentElement.scrollWidth > innerWidth + 1 || root.scrollWidth > root.clientWidth + 1) problems.push('horizontal overflow');
    const controls = [...root.querySelectorAll('button, input, select, a[href]')].filter(visible);
    // Scrollable content can share coordinates with controls outside its clip.
    const clippedRect = (el) => {
      const r = el.getBoundingClientRect();
      const box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p), clip = p.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) { box.top = Math.max(box.top, clip.top); box.bottom = Math.min(box.bottom, clip.bottom); }
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { box.left = Math.max(box.left, clip.left); box.right = Math.min(box.right, clip.right); }
      }
      return box;
    };
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width < 47.9 || r.height < 47.9) problems.push(`${name(el)} target ${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
      if (r.left < panel.left - 1 || r.right > panel.right + 1) problems.push(`${name(el)} outside panel`);
    }
    for (let i = 0; i < controls.length; i++) for (const b of controls.slice(i + 1)) {
      const a = controls[i]; if (a.contains(b) || b.contains(a)) continue;
      const x = clippedRect(a), y = clippedRect(b);
      if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 2 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 2) problems.push(`controls overlap: ${name(a)} / ${name(b)}`);
    }
    for (const el of [root, ...root.querySelectorAll('*')].filter(visible)) {
      if (el.closest('svg') || ![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
      const s = getComputedStyle(el);
      if (parseFloat(s.fontSize) < 15.9) problems.push(`${name(el)} font ${s.fontSize}`);
      if (el.matches(':disabled')) continue;
      const bg = background(el), fg = over(rgba(s.color), bg), l1 = luminance(fg), l2 = luminance(bg);
      const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
      if (ratio < 4.48) problems.push(`${name(el)} contrast ${ratio.toFixed(2)}`);
    }
    return problems;
  });
  assert(!failures.length, `${label}:\n${failures.join('\n')}`);
}

await runTest('ui-audit', async (browser, notes) => {
  const errors = [];
  notes.screens = 0;
  for (const [width, height] of sizes) {
    const touch = width < 1000;
    const context = await browser.newContext({ viewport: { width, height }, screen: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    const page = await context.newPage();
    collectErrors(page, `${width}x${height}`, errors);
    const check = async (label) => { await audit(page, `${width}x${height} ${label}`); notes.screens++; };
    try {
      await page.goto(url());
      await page.getByTestId('singleplayer').waitFor();
      await check('title');
      // A complete Tab cycle must keep focus visible, including scrollable menus.
      const count = await page.locator('.menu-panel button:visible').count();
      const visited = new Set();
      for (let i = 0; i < count; i++) {
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const el = document.activeElement, r = el.getBoundingClientRect(), s = getComputedStyle(el);
          return { id: el.dataset.testid, ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
        });
        assert(focus.ring && focus.inView, `focus invisible ${width}x${height}: ${JSON.stringify(focus)}`);
        visited.add(focus.id);
      }
      assert(visited.size === count, `Tab missed controls ${width}x${height}: ${[...visited]}`);
      await page.getByTestId('singleplayer').click(); await check('play');
      await page.getByTestId('back').click(); await page.getByTestId('title-settings').click();
      for (const tab of ['audio', 'visuals', 'accessibility', 'controls', 'cosmetics']) {
        await page.getByTestId(`settings-tab-${tab}`).click(); await check(`settings ${tab}`);
        const motion = await page.getByTestId('settings-menu').evaluate(root => [...root.querySelectorAll('*')].some(el => {
          const s = getComputedStyle(el);
          return [...s.animationDuration.split(','), ...s.transitionDuration.split(',')].some(v => parseFloat(v) > 0);
        }));
        assert(!motion, `reduced motion still animates ${width}x${height} ${tab}`);
      }
      // Enlarged menu copy must actually grow; 150% is also the hardest overflow case.
      await page.getByTestId('settings-tab-visuals').click();
      const before = await page.getByTestId('settings-shake').locator('..').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      await page.getByTestId('settings-ui-scale').selectOption('150');
      const after = await page.getByTestId('settings-shake').locator('..').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert(after >= before * 1.45, `text size setting did not scale menu copy: ${before} → ${after}`);
      await check('settings 150%');
      await page.getByTestId('settings-ui-scale').selectOption('100');
      await page.getByTestId('settings-back').click();
      await page.getByTestId('multiplayer').click(); await check('co-op');
      await page.getByTestId('join-room').click(); await check('join');
      await page.getByTestId('back').click(); await page.getByTestId('quick-match').click();
      await page.getByTestId('qm-status').waitFor(); await check('quick match');
      await page.getByTestId('qm-cancel').click(); await page.getByTestId('create-room').click();
      await page.getByTestId('room-code').waitFor(); await page.locator('.invite-qr svg').waitFor(); await check('lobby');
      await page.goto(url()); await page.getByTestId('leaderboards').click();
      await page.getByTestId('lb-tab-daily').waitFor(); await check('leaderboard empty/loading');
      // Deterministic populated board; network behavior has its own integration tests.
      await page.route('**/leaderboard', route => route.fulfill({ json: {
        daily: { key: 'daily:qa', entries: [] },
        nightshift: { key: 'nightshift:all', entries: [{ id: 'qa', display: 'A very long crew name for a small phone', score: 12345, floors: 12 }] },
        nightshiftWeek: { key: 'nightshift:week:qa', entries: [] },
      } }));
      await page.reload(); await page.getByTestId('leaderboards').click();
      await page.getByTestId('lb-tab-nightshift').click();
      await page.getByTestId('lb-list').locator('li').waitFor(); await check('leaderboard populated');
      await page.goto(url({ report: '1' }));
      await page.getByTestId('mission-complete').waitFor({ state: 'visible' }); await check('report');
      await tryShot(page, `ui-audit-report-${width}x${height}`);
      // Enter must activate the focused secondary button, not the global replay shortcut.
      await page.getByTestId('leave-heist').focus(); await page.keyboard.press('Enter');
      await page.getByTestId('singleplayer').waitFor({ state: 'visible' });
      await page.goto(url({ play: 'solo' })); await waitForGame(page);
      if (touch) await page.getByTestId('touch-pause').click();
      else {
        const skip = page.getByTestId('onboarding-skip'); if (await skip.isVisible()) await skip.click();
        await page.keyboard.press('Escape');
      }
      await page.getByTestId('pause-menu').waitFor({ state: 'visible' }); await check('pause');
      await page.getByTestId('pause-controls').click(); await check('pause controls');
      await page.getByTestId('pause-controls-back').click(); await page.getByTestId('pause-settings').click();
      await check('pause settings');
    } finally { await context.close(); }
  }
  notes.errors = errors;
  assert(!errors.length, `console/page errors:\n${errors.join('\n')}`);
});
