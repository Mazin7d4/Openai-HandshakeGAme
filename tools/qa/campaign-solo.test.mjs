import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';
import { CAMPAIGN_LEVELS, campaignLayout } from '../../shared/campaign/levels.mjs';
import { DOORWAYS, STATIC_BLOCKERS, pointInAabb } from '../../shared/nightshift/levelGeometry.mjs';
import { runTest, url, openPage, closePage, waitForGame } from './lib.mjs';

const shotDir = '/workspace/handshake/playtest/oct25/campaign';
mkdirSync(shotDir, { recursive: true });

await runTest('campaign-solo', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 844, height: 390 } });
  await page.goto(url(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByTestId('campaign').click();
  await page.getByTestId('level-select').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${shotDir}/level-select-phone.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: `${shotDir}/level-select.png` });
  assert.equal(await page.locator('[data-testid^="level-card-"]').count(), 5);
  assert.equal(await page.getByTestId('level-card-l1-tethered').getAttribute('data-locked'), '0');
  assert.equal(await page.getByTestId('level-card-l2-twin-levers').getAttribute('data-locked'), '1');
  const menuAudit = await page.evaluate(() => ({
    cardsBottom: Math.max(...[...document.querySelectorAll('[data-testid^="level-card-"]')].map((el) => el.getBoundingClientRect().bottom)),
    viewport: innerHeight,
    panelScroll: document.querySelector('.campaign-select-panel')?.scrollHeight ?? 0,
    panelClient: document.querySelector('.campaign-select-panel')?.clientHeight ?? 0,
  }));
  assert(menuAudit.cardsBottom <= menuAudit.viewport + 1, `desktop level cards clipped: ${JSON.stringify(menuAudit)}`);
  assert(menuAudit.panelScroll <= menuAudit.panelClient + 1, `desktop campaign panel scrolls: ${JSON.stringify(menuAudit)}`);

  // Absent and malformed progress must fall back to the safe initial state.
  await page.evaluate(() => localStorage.removeItem('pixnee.campaign.v1'));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByTestId('campaign').click();
  assert.equal(await page.getByTestId('level-card-l1-tethered').getAttribute('data-locked'), '0');
  assert.equal(await page.getByTestId('level-card-l2-twin-levers').getAttribute('data-locked'), '1');
  await page.evaluate(() => localStorage.setItem('pixnee.campaign.v1', '{broken json'));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByTestId('campaign').click();
  assert.equal(await page.getByTestId('level-card-l1-tethered').getAttribute('data-locked'), '0');
  assert.equal(await page.getByTestId('level-card-l2-twin-levers').getAttribute('data-locked'), '1');

  const completed = [];
  const levels = process.env.CAMPAIGN_LEVEL ? CAMPAIGN_LEVELS.filter((candidate) => candidate.id === process.env.CAMPAIGN_LEVEL) : CAMPAIGN_LEVELS;
  for (const level of levels) {
    const layout = campaignLayout(level.id);
    await stageShowcase(page, level, layout);
    const completion = await completeLevel(page, level, layout);
    completed.push(completion);
    if (level.index === 1) {
      await page.goto(url(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.getByTestId('campaign').click();
      assert.equal(await page.getByTestId('level-card-l1-tethered').getAttribute('data-locked'), '0');
      assert.equal(await page.getByTestId('level-card-l2-twin-levers').getAttribute('data-locked'), '0');
      assert.equal(await page.getByTestId('level-card-l1-tethered').locator('.campaign-star--earned').count() >= 1, true);
    }
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pixnee.campaign.v1') ?? 'null'));
  assert(saved?.v === 1 && Object.keys(saved.levels).length === 5, `campaign progress not saved: ${JSON.stringify(saved)}`);
  notes.levels = completed;
  notes.progress = saved;
  await closePage(page);
});

async function stageShowcase(page, level, layout) {
  await page.goto(url({ level: level.id, bot: '1' }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForGame(page);
  await page.getByTestId('floor-card').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__floorPlan?.planHash), null, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const focus = showcaseFocus(layout);
  const pair = showcasePair(layout, focus);
  await page.evaluate(({ pair, focus }) => {
    window.__autotest.teleport('pix', pair.pix.x, pair.pix.y, pair.pix.z);
    window.__autotest.teleport('nee', pair.nee.x, pair.nee.y, pair.nee.z);
    window.__autotest.photo(
      { x: focus.x + 15, y: focus.y + 10, z: focus.z - 18 },
      { x: focus.x, y: focus.y, z: focus.z },
    );
    for (const selector of ['#dev-readout', '#dev-controls', '.onboarding-coach', '.juice-toasts', '.floor-card']) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) element.style.display = 'none';
    }
  }, { pair, focus });
  await page.waitForTimeout(1500);
  const file = level.index === 5 ? `${shotDir}/level-5-staging.png` : `${shotDir}/level-${level.index}-${level.id.slice(3)}.png`;
  await page.screenshot({ path: file });
}

async function completeLevel(page, level, layout) {
  await page.goto(url({ level: level.id, bot: '1' }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForGame(page);
  await page.waitForFunction(() => Boolean(window.__floorPlan?.planHash), null, { timeout: 30_000 });
  // Existing variety QA uses this shortcut to skip the legacy hack; objective play remains real.
  await page.evaluate(() => window.__autotest.debugStage('steal-prototype'));
  const phases = layout.plan.phases ?? [layout.plan.objective];
  for (let phase = 0; phase < phases.length; phase++) {
    const objective = phases[phase];
    if (objective.kind === 'grab') continue;
    if (objective.kind === 'twin-levers') await completeTwinLevers(page, objective, layout.spawn);
    else if (objective.kind === 'pylon-safe') await completePylonSafe(page, objective, layout.spawn);
    else if (objective.kind === 'relay') await completeRelay(page, objective, layout.spawn);
    else if (objective.kind === 'fragile') await completeFragileCarry(page, layout);
    await page.waitForFunction((expected) => {
      const state = window.__floorPlan?.objective();
      return state?.done === true || (window.__floorPlan?.phase ?? 0) > expected;
    }, phase, { timeout: 55_000 });
    if (level.index === 5 && phase === 1) {
      await page.getByText('BIG VAULT CRACKED · x2').waitFor({ state: 'visible', timeout: 8_000 });
      await page.screenshot({ path: `${shotDir}/level-5-finale.png` });
    }
  }
  if (layout.plan.objective.kind === 'grab' || layout.plan.phases?.at(-1)?.kind !== 'fragile') {
    await carryPrototype(page, layout);
  }
  await page.waitForFunction(() => window.__floorPlan?.objective()?.done === true, null, { timeout: 40_000 });
  await page.waitForSelector('[data-testid="campaign-result"]', { state: 'visible', timeout: 45_000 });
  const result = await page.evaluate(() => ({
    objective: window.__floorPlan?.objective(),
    report: document.querySelector('[data-testid="campaign-result"]')?.textContent ?? '',
    stars: document.querySelector('[data-testid="campaign-stars"]')?.textContent ?? '',
  }));
  assert(result.objective?.done === true, `${level.id} objective did not complete`);
  assert(result.report.includes('CAMPAIGN COMPLETE') || level.index < 5, `${level.id} report missing campaign result`);
  assert(result.stars.length > 0, `${level.id} stars missing`);
  return { id: level.id, phases: phases.length, stars: result.stars };
}

async function completeTwinLevers(page, objective, spawn) {
  const [a, b] = objective.levers;
  await routeTo(page, spawn, a, { y: 8 });
  await page.evaluate(({ a, b }) => {
    window.__autotest.goto('pix', a.x, a.y, a.z, 1.2, true);
    window.__autotest.goto('nee', b.x, b.y, b.z, 1.2, true);
  }, { a, b });
  await page.waitForFunction(() => window.__floorPlan?.objective()?.done === true, null, { timeout: 35_000 });
}

async function completePylonSafe(page, objective, spawn) {
  await routeTo(page, spawn, objective.safe, { y: 7 });
  await page.evaluate((safe) => window.__autotest.goto('pix', safe.x, safe.y, safe.z, 1.2, true), objective.safe);
  await page.waitForFunction(() => (window.__floorPlan?.objective()?.pulls ?? 0) >= 1, null, { timeout: 35_000 });
}

async function completeRelay(page, objective, spawn) {
  const first = objective.pads[0];
  await routeTo(page, spawn, first, { y: 7 });
  for (const pad of objective.pads) {
    if (pad.role === 'pix') await gotoPoint(page, 'pix', pad, 1.2, true);
    await page.waitForFunction((step) => (window.__floorPlan?.objective()?.step ?? 0) >= step, objective.pads.indexOf(pad) + 1, { timeout: 35_000 });
  }
}

async function completeFragileCarry(page, layout) {
  await routeTo(page, layout.spawn, layout.loot, { y: 7 });
  await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
  await page.waitForFunction(() => window.__autotest.heldObject?.('pix') === 'prototype', null, { timeout: 12_000 });
  await carryPrototype(page, layout, true);
}

async function carryPrototype(page, layout, alreadyHolding = false) {
  if (!alreadyHolding) {
    await routeTo(page, layout.spawn, layout.loot, { y: 7 });
    await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
    await page.waitForFunction(() => window.__autotest.heldObject?.('pix') === 'prototype', null, { timeout: 12_000 });
  }
  // Let the real NEE bot settle alongside the carrier before the first narrow doorway.
  await page.waitForTimeout(4000);
  for (const waypoint of extractionRoute(layout.loot, layout.extraction)) await gotoPoint(page, 'pix', waypoint, 1.7, true);
  await gotoPoint(page, 'pix', layout.extraction, 1.4, true);
}

async function routeTo(page, from, target, options = {}) {
  const y = options.y ?? 7;
  const reception = doorwayCenter(-43, 1.2);
  const office = doorwayCenter(-26, 1.2);
  const vault = doorwayCenter(2, 1.2);
  const route = [
    { x: reception.x, y: reception.y, z: reception.z },
    { x: -3, y: 7, z: -31 },
    { x: -3, y: 5.2, z: office.z },
    { x: office.x, y: 5.2, z: office.z },
    { x: -1, y: 9, z: -20 },
    { x: 0, y: 9, z: -8 },
    { x: 0, y: 3.3, z: vault.z },
    { x: target.x, y: Math.max(2.2, target.y), z: target.z },
  ];
  assert(route.every((point) => isRoutePointClear(point)), `route point intersects authored blocker: ${JSON.stringify(route)}`);
  for (const point of route) await gotoPoint(page, 'pix', point, 0.9, true);
}

function extractionRoute(loot, extraction) {
  const vault = doorwayCenter(2, -1.2);
  const office = doorwayCenter(-26, -1.2);
  const reception = doorwayCenter(-43, -1.2);
  const candidates = [
    { x: vault.x, y: 2.2, z: vault.z },
    { x: 0, y: 2.2, z: -3 },
    { x: 0, y: 9, z: -8 },
    { x: 0, y: 9, z: -20 },
    { x: office.x, y: 5.2, z: office.z },
    { x: 5, y: 5.2, z: reception.z },
    { x: 5, y: 7, z: -46 },
    { x: reception.x, y: 7, z: reception.z },
    { x: -5, y: 7, z: -40 },
    { x: -15.5, y: 7, z: -34 },
    { x: -15.5, y: 3, z: -9 },
    { x: extraction.x, y: extraction.y + 1.2, z: extraction.z },
  ];
  assert(candidates.every((point) => isRoutePointClear(point)), `extraction route intersects authored blocker: ${JSON.stringify(candidates)}`);
  return candidates;
}

function isRoutePointClear(point) {
  return !STATIC_BLOCKERS.some((blocker) => pointInAabb(point, blocker, 0.35))
    || DOORWAYS.some((doorway) => pointInAabb(point, doorway, 0.05));
}

function doorwayCenter(z, offset = 0) {
  const doorway = DOORWAYS.find((candidate) => Math.abs((candidate.min.z + candidate.max.z) / 2 - z) < 1.5);
  if (!doorway) throw new Error(`missing shared doorway near z=${z}`);
  return { x: (doorway.min.x + doorway.max.x) / 2, y: (doorway.min.y + doorway.max.y) / 2, z: (doorway.min.z + doorway.max.z) / 2 + offset };
}

async function gotoPoint(page, role, point, tolerance = 1.5, hold = false) {
  await page.evaluate(({ role, point, tolerance, hold }) => window.__autotest.goto(role, point.x, point.y, point.z, tolerance, hold), { role, point, tolerance, hold });
  try {
    await page.waitForFunction(({ role, point, tolerance }) => {
      const current = window.__autotest.position(role);
    return current && Math.hypot(current.x - point.x, current.y - point.y, current.z - point.z) <= Math.max(1.5, tolerance + 0.3);
    }, { role, point, tolerance }, { timeout: 45_000 });
  } catch (error) {
    const diagnostic = await page.evaluate((role) => ({ position: window.__autotest.position(role), objective: window.__floorPlan?.objective(), mission: window.__autotest.security?.()?.stage }), role).catch(() => null);
    throw new Error(`goto timeout ${role} ${JSON.stringify(point)} ${JSON.stringify(diagnostic)}: ${error.message}`);
  }
}

function showcaseFocus(layout) {
  const objective = layout.plan.phases?.[0] ?? layout.plan.objective;
  if (objective.levers) return midpoint(objective.levers[0], objective.levers[1]);
  if (objective.pylon && objective.safe) return midpoint(objective.pylon, objective.safe);
  if (objective.pads?.length) return objective.pads[Math.floor(objective.pads.length / 2)];
  return layout.loot;
}

function showcasePair(layout, focus) {
  const y = Math.max(3.4, focus.y + 0.5);
  return {
    pix: { x: focus.x - 2.2, y, z: focus.z + 1.5 },
    nee: { x: focus.x + 2.2, y, z: focus.z + 1.5 },
  };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
