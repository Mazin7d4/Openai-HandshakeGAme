import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CAMPAIGN_LEVELS, campaignLayout } from '../../shared/campaign/levels.mjs';
import { runTest, url, openPage, closePage, waitForGame } from './lib.mjs';

const shotDir = '/workspace/handshake/playtest/oct25/campaign';
mkdirSync(shotDir, { recursive: true });

await runTest('campaign-solo', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 844, height: 390 } });
  await page.goto(url());
  await page.getByTestId('campaign').click();
  await page.getByTestId('level-select').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${shotDir}/level-select-phone.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: `${shotDir}/level-select.png` });
  assert.equal(await page.locator('[data-testid^="level-card-"]').count(), 5);
  assert.equal(await page.getByTestId('level-card-l1-tethered').getAttribute('data-locked'), '0');
  assert.equal(await page.getByTestId('level-card-l2-twin-levers').getAttribute('data-locked'), '1');
  for (const level of CAMPAIGN_LEVELS) {
    await page.goto(url({ level: level.id, bot: '1' }));
    await waitForGame(page);
    await page.getByTestId('floor-card').waitFor({ state: 'visible', timeout: 30_000 });
    const cardText = await page.getByTestId('floor-card').innerText();
    assert(cardText.includes(level.name), `campaign card missing level name: ${cardText}`);
    const layout = campaignLayout(level.id);
    const positions = showcasePositions(layout);
    await page.waitForTimeout(2_500);
    await page.evaluate(({ pix, nee }) => {
      window.__autotest.teleport('pix', pix.x, pix.y, pix.z);
      window.__autotest.teleport('nee', nee.x, nee.y, nee.z);
      for (const selector of ['#dev-readout', '#dev-controls', '.onboarding-coach', '.juice-toasts', '.floor-card']) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement) element.style.display = 'none';
      }
    }, positions);
    await page.waitForTimeout(1_200);
    const showcase = await page.screenshot();
    writeFileSync(`${shotDir}/level-${level.index}-${level.id.slice(3)}.png`, showcase);
    if (level.index === 5) {
      writeFileSync(`${shotDir}/level-5-finale.png`, showcase);
    }
  }
  notes.levels = CAMPAIGN_LEVELS.map((level) => ({ id: level.id, kind: campaignLayout(level.id).plan.objective.kind }));
  await closePage(page);
});

function showcasePositions(layout) {
  const objective = layout.plan.objective;
  if (objective.levers) return pair(objective.levers[0], objective.levers[1], 0.55);
  if (objective.pylon && objective.safe) return pair(objective.safe, objective.anchor ?? objective.pylon, 0.5);
  if (objective.pads?.length) return pair(objective.pads[0], objective.pads[0], 0.5);
  return {
    pix: { x: layout.loot.x - 2.5, y: 2.8, z: layout.loot.z - 2 },
    nee: { x: layout.loot.x + 2.5, y: 2.8, z: layout.loot.z - 2 },
  };
}

function pair(a, b, side) {
  return {
    pix: { x: a.x - side, y: Math.max(2.8, a.y + 0.45), z: a.z + 0.9 },
    nee: { x: b.x + side, y: Math.max(2.8, b.y + 0.45), z: b.z + 0.9 },
  };
}
