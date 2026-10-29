// Integration/UI evidence: spawn-to-extraction through real flight inputs;
// NEE remains controlled by the shipped companion. No staged completion.
import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';
import { CAMPAIGN_LEVELS, campaignLayout } from '../../shared/campaign/levels.mjs';
import { runTest, url, openPage, closePage, waitForGame, collectErrors } from './lib.mjs';

const shotDir = process.env.QA_CAMPAIGN_SHOTS ?? '/workspace/handshake/playtest/oct26/codexB';
mkdirSync(shotDir, { recursive: true });

await runTest('campaign-solo', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const errors = collectErrors(page, 'campaign', []);
  await page.goto(url(), { waitUntil: 'domcontentloaded' });
  await page.getByTestId('campaign').click();
  await page.getByTestId('level-select').waitFor({ state: 'visible' });
  for (const [width, height] of [[844, 390], [1280, 720], [740, 360]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${shotDir}/level-select-${width}x${height}.png` });
    const audit = await page.evaluate(() => {
      const panel = document.querySelector('.campaign-select-panel');
      return { right: panel.getBoundingClientRect().right, bottom: panel.getBoundingClientRect().bottom,
        scroll: panel.scrollHeight, client: panel.clientHeight, width: innerWidth, height: innerHeight };
    });
    assert(audit.right <= audit.width + 1 && audit.bottom <= audit.height + 1, `clipped campaign menu ${JSON.stringify(audit)}`);
    assert(audit.scroll <= audit.client + 1, `campaign menu requires scrolling ${JSON.stringify(audit)}`);
  }
  assert.equal(await page.locator('[data-testid^="level-card-"]').count(), 5);
  for (const value of [null, '{broken json', '{"v":1,"levels":{"bad":null}}']) {
    await page.evaluate((value) => value === null ? localStorage.removeItem('pixnee.campaign.v1') : localStorage.setItem('pixnee.campaign.v1', value), value);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('campaign').click();
    assert.equal(await page.getByTestId('level-card-l1-tethered').getAttribute('data-locked'), '0');
    assert.equal(await page.getByTestId('level-card-l2-twin-levers').getAttribute('data-locked'), '1');
  }
  const levels = process.env.CAMPAIGN_LEVEL ? CAMPAIGN_LEVELS.filter((level) => level.id === process.env.CAMPAIGN_LEVEL) : CAMPAIGN_LEVELS;
  notes.levels = [];
  for (const level of levels) {
    const started = Date.now();
    const layout = campaignLayout(level.id);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(url({ level: level.id, bot: '1', scale: '1.01', quality: 'low' }), { waitUntil: 'domcontentloaded' });
    await waitForGame(page);
    await page.waitForFunction(() => Boolean(window.__floorPlan?.planHash));
    await page.addStyleTag({ content: '#dev-readout, #dev-controls { display: none !important; }' });
    await capture(page, level, 'arrival');
    assert.equal(await page.evaluate(() => window.__pixBot?.().enabled), true, `${level.id}: companion absent`);
    if (level.index === 1) {
      await move(page, { x: 0, y: 2.2, z: 6 });
      await page.evaluate(() => window.__autotest.press('pix', 'interact'));
      await page.waitForFunction(() => /C:complete/.test(document.querySelector('#dev-readout')?.textContent ?? ''));
      await move(page, { x: 0, y: 2.2, z: 13.5 });
    }
    const phases = layout.plan.phases ?? [layout.plan.objective];
    for (const [phase, objective] of phases.entries()) {
      if (objective.kind === 'twin-levers') {
        const a = objective.levers[0];
        // Stay just south of the physical console, within its activation radius.
        if (level.index === 2) await move(page, { x: 0, y: 2.2, z: 3.6 });
        await move(page, { ...a, z: a.z - 1 }, 0.5);
        await capture(page, level, `paired-lock-${phase}`);
        await waitPhase(page, phase);
      } else if (objective.kind === 'pylon-safe') {
        if (level.index === 5) {
          await move(page, { x: 2, y: 2.2, z: -16 });
          await move(page, { x: 2, y: 2.2, z: -2 });
        }
        await move(page, { x: 0, y: 2.2, z: 3.6 });
        await move(page, { ...objective.safe, z: objective.safe.z - 0.7 }, 0.6);
        await capture(page, level, `pylon-${phase}`);
        await waitPhase(page, phase);
      } else if (objective.kind === 'relay') {
        for (const [step, station] of objective.pads.entries()) {
          if (station.role === 'pix') await move(page, { ...station, z: station.z - 1.1 }, 0.5);
          await page.waitForFunction(({ step, phase }) => (window.__floorPlan?.objective()?.step ?? 0) > step || (window.__floorPlan?.phase ?? 0) > phase,
            { step, phase }, { timeout: 45_000 });
        }
        await capture(page, level, 'relay-powered');
        await waitPhase(page, phase);
      }
    }
    await move(page, { x: 0, y: 5.8, z: 13 });
    await move(page, { x: 0, y: 5.8, z: 16 }, 0.8);
    await capture(page, level, 'core');
    await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
    await page.waitForFunction(() => window.__autotest.heldObject?.('pix') === 'prototype', null, { timeout: 10_000 });
    if (level.index === 4) {
      await move(page, { x: 0, y: 6.5, z: 23 });
      await page.waitForFunction(() => document.querySelector('[data-testid="touch-grab"]')?.textContent?.includes('Pass'), null, { timeout: 15_000 });
      await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
      await page.waitForFunction(() => window.__autotest.heldObject?.('nee') === 'prototype', null, { timeout: 10_000 });
      await capture(page, level, 'handoff');
    }
    await move(page, { x: 0, y: 5.8, z: 25 });
    await move(page, { x: 0, y: 4.5, z: 30 });
    await capture(page, level, 'dock');
    await move(page, { x: 11.5, y: 4.5, z: 32 });
    await move(page, { x: 11.5, y: 3.8, z: 41 });
    await move(page, { ...layout.extraction, y: 2.2 }, 0.8);
    await page.getByTestId('campaign-result').waitFor({ state: 'visible', timeout: 45_000 });
    await page.screenshot({ path: `${shotDir}/${level.id}-result-phone.png` });
    const state = await page.evaluate(() => ({ objective: window.__floorPlan.objective(), zips: window.__pixBot?.().zips,
      stars: document.querySelector('[data-testid="campaign-stars"]')?.textContent }));
    assert(state.objective.done, `${level.id}: unfinished objective ${JSON.stringify(state)}`);
    assert(state.stars?.length, `${level.id}: missing stars`);
    const runEvidence = { id: level.id, realRun: true, seconds: Math.round((Date.now() - started) / 1000), ...state };
    notes.levels.push(runEvidence);
    await import('node:fs').then(({ writeFileSync }) => writeFileSync(`${shotDir}/${level.id}-run.json`, JSON.stringify(runEvidence, null, 2)));
    if (level.index === 1) {
      await page.goto(url()); await page.getByTestId('campaign').click();
      assert.equal(await page.getByTestId('level-card-l2-twin-levers').getAttribute('data-locked'), '0');
      assert(await page.getByTestId('level-card-l1-tethered').locator('.campaign-star--earned').count() >= 1);
    }
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pixnee.campaign.v1') ?? 'null'));
  assert(saved?.v === 1 && Object.keys(saved.levels).length === levels.length, `save missing: ${JSON.stringify(saved)}`);
  notes.progress = saved;
  assert.equal(errors.length, 0, errors.join('\n'));
  await closePage(page);
});

async function waitPhase(page, phase) {
  try {
    await page.waitForFunction((phase) => window.__floorPlan?.objective()?.done === true || (window.__floorPlan?.phase ?? 0) > phase, phase, { timeout: 50_000 });
  } catch (error) { throw new Error(`phase ${phase}: ${JSON.stringify(await diagnostic(page))}: ${error.message}`); }
}
async function move(page, point, tolerance = 1) {
  await page.evaluate(({ point, tolerance }) => window.__autotest.goto('pix', point.x, point.y, point.z, tolerance, true), { point, tolerance });
  try {
    await page.waitForFunction(({ point, tolerance }) => {
      const at = window.__autotest.position('pix');
      return at && Math.hypot(at.x - point.x, at.z - point.z) <= Math.max(1.3, tolerance + 0.3) && Math.abs(at.y - point.y) < 1;
    }, { point, tolerance }, { timeout: 40_000 });
  } catch (error) { throw new Error(`flight ${JSON.stringify(point)}: ${JSON.stringify(await diagnostic(page))}: ${error.message}`); }
}
async function diagnostic(page) {
  return page.evaluate(() => ({ pix: window.__autotest.position('pix'), nee: window.__autotest.position('nee'),
    objective: window.__floorPlan?.objective(), phase: window.__floorPlan?.phase, bot: window.__pixBot?.(),
    mission: window.__autotest.security?.()?.stage }));
}
async function capture(page, level, area) {
  for (const [width, height] of [[844, 390], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shotDir}/${level.id}-${area}-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 844, height: 390 });
}
