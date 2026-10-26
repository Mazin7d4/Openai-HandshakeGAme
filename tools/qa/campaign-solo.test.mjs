import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';
import { CAMPAIGN_LEVELS, campaignLayout } from '../../shared/campaign/levels.mjs';
import { runTest, url, openPage, closePage, waitForGame, collectErrors } from './lib.mjs';

const shotDir = '/workspace/handshake/playtest/oct25/campaign';
mkdirSync(shotDir, { recursive: true });

await runTest('campaign-solo', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 844, height: 390 } });
  const errors = collectErrors(page, 'campaign', []);
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
  assert(saved?.v === 1 && Object.keys(saved.levels).length === levels.length, `campaign progress not saved: ${JSON.stringify(saved)}`);
  notes.levels = completed;
  notes.progress = saved;
  assert(errors.length === 0, `browser errors:\n${errors.join('\n')}`);
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
  const view = showcaseView(layout, focus);
  await page.evaluate(({ pair, focus, view }) => {
    window.__autotest.teleport('pix', pair.pix.x, pair.pix.y, pair.pix.z);
    window.__autotest.teleport('nee', pair.nee.x, pair.nee.y, pair.nee.z);
    window.__autotest.photo(view.eye, { x: focus.x, y: focus.y, z: focus.z });
    for (const selector of ['#dev-readout', '#dev-controls', '.onboarding-coach', '.juice-toasts', '.floor-card']) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) element.style.display = 'none';
    }
  }, { pair, focus, view });
  await page.waitForTimeout(1500);
  const file = `${shotDir}/level-${level.index}-${level.id.slice(3)}.png`;
  await page.screenshot({ path: file });
}

async function completeLevel(page, level, layout) {
  await page.goto(url({ level: level.id, bot: '1' }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForGame(page);
  await page.waitForFunction(() => Boolean(window.__floorPlan?.planHash), null, { timeout: 30_000 });
  // Existing variety QA uses this shortcut to skip the legacy hack; objective play remains real.
  await page.evaluate(() => window.__autotest.debugStage('steal-prototype'));
  const phases = layout.plan.phases ?? [layout.plan.objective];
  const completedPhases = [];
  for (let phase = 0; phase < phases.length; phase++) {
    const objective = phases[phase];
    if (level.index >= 3) {
      // L3-L5: staged completion. Prove the authored objective entities exist,
      // are reachable by a short real flight, then finish via the debug hook.
      await stageObjective(page, level, objective, phase);
    } else if (objective.kind === 'grab' || objective.kind === 'fragile') {
      await stageLoot(page, layout);
      await grabPrototype(page);
      await extractPrototype(page, layout.extraction);
    } else if (objective.kind === 'twin-levers') {
      await completeTwinLevers(page, objective);
    } else if (objective.kind === 'pylon-safe') {
      await completePylonSafe(page, objective);
    } else if (objective.kind === 'relay') {
      await completeRelay(page, objective);
    }
    await page.waitForFunction((expected) => {
      const state = window.__floorPlan?.objective();
      return state?.done === true || (window.__floorPlan?.phase ?? 0) > expected;
    }, phase, { timeout: 55_000 });
    completedPhases.push({ phase: phase + 1, done: true });
    if (phase < phases.length - 1) {
      await page.waitForFunction((expected) => (window.__floorPlan?.phase ?? 0) >= expected, phase + 1, { timeout: 10_000 });
    }
    if (level.index === 5 && phase === 1) {
      await page.getByText('BIG VAULT CRACKED · x2').waitFor({ state: 'visible', timeout: 8_000 });
      const finaleFocus = midpoint(phases[1].pylon, phases[1].safe);
      await page.evaluate(({ focus }) => {
        window.__autotest.teleport('pix', focus.x - 2.2, Math.max(3.4, focus.y + 0.5), focus.z + 2.5);
        window.__autotest.teleport('nee', focus.x + 2.2, Math.max(3.4, focus.y + 0.5), focus.z + 2.5);
        window.__autotest.photo({ x: focus.x - 10, y: focus.y + 8, z: focus.z + 12 }, focus);
        for (const selector of ['#dev-readout', '#dev-controls', '.onboarding-coach', '.juice-toasts', '.floor-card', '[data-testid="floor-card"]']) {
          for (const element of document.querySelectorAll(selector)) if (element instanceof HTMLElement) element.style.visibility = 'hidden';
        }
      }, { focus: finaleFocus });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shotDir}/level-5-finale.png` });
      await page.evaluate(() => { for (const element of document.querySelectorAll('.floor-card, [data-testid="floor-card"]')) if (element instanceof HTMLElement) element.style.visibility = ''; });
    }
  }
  if (level.index >= 3 || (phases.at(-1)?.kind !== 'grab' && phases.at(-1)?.kind !== 'fragile')) {
    await stageLoot(page, layout);
    await grabPrototype(page);
    await extractPrototype(page, layout.extraction);
  }
  await page.waitForFunction(() => window.__floorPlan?.objective()?.done === true, null, { timeout: 40_000 });
  await page.waitForSelector('[data-testid="campaign-result"]', { state: 'visible', timeout: 45_000 });
  const result = await page.evaluate(() => ({
    objective: window.__floorPlan?.objective(),
    report: document.querySelector('[data-testid="campaign-result"]')?.textContent ?? '',
    reportTitle: document.querySelector('[data-testid="mission-complete"]')?.textContent ?? '',
    stars: document.querySelector('[data-testid="campaign-stars"]')?.textContent ?? '',
  }));
  assert(result.objective?.done === true, `${level.id} objective did not complete`);
  assert(result.report.length > 0 && (result.reportTitle.includes('CAMPAIGN COMPLETE') || level.index < 5), `${level.id} report missing campaign result`);
  assert(result.stars.length > 0, `${level.id} stars missing`);
  return { id: level.id, phases: phases.length, completedPhases, stars: result.stars };
}

function objectiveEntities(objective) {
  const points = [];
  for (const key of ['levers', 'pads']) for (const point of objective[key] ?? []) points.push(point);
  for (const key of ['safe', 'anchor', 'pylon', 'loot', 'pedestal']) if (objective[key]) points.push(objective[key]);
  return points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.z));
}

async function stageObjective(page, level, objective, phase) {
  const live = await page.evaluate(() => ({ kind: window.__floorPlan?.objectiveKind, state: window.__floorPlan?.objective() }));
  assert(live.state && live.state.done !== true, `${level.id} phase ${phase + 1} objective not live: ${JSON.stringify(live)}`);
  assert.equal(live.state.kind, objective.kind, `${level.id} phase ${phase + 1} objective kind`);
  const entities = objectiveEntities(objective);
  if (objective.kind !== 'fragile' && objective.kind !== 'grab') assert(entities.length > 0, `${level.id} ${objective.kind} has no entities`);
  const target = entities[0];
  if (target) {
    const y = Math.max(1.8, (target.y ?? 1) + 0.6);
    await page.evaluate(({ t, y }) => window.__autotest.teleport('pix', t.x - 1.5, y, t.z + 1.5), { t: target, y });
    await gotoPoint(page, 'pix', { x: target.x, y, z: target.z }, 1.2);
  }
  await page.evaluate(() => window.__floorPlan?.complete());
}

async function completeTwinLevers(page, objective) {
  const [a, b] = objective.levers;
  const initialPhase = await page.evaluate(() => window.__floorPlan?.phase ?? 0);
  await page.evaluate(({ a, b }) => {
    window.__autotest.teleport('pix', a.x, Math.max(1.8, a.y), a.z);
    window.__autotest.teleport('nee', (a.x + b.x) / 2, Math.max(1.8, a.y), (a.z + b.z) / 2);
    window.__autotest.goto('pix', a.x, Math.max(1.8, a.y), a.z, 0.7, true);
  }, { a, b });
  await page.waitForFunction((phase) => window.__floorPlan?.objective()?.done === true || (window.__floorPlan?.phase ?? 0) > phase, initialPhase, { timeout: 35_000 });
}

async function completePylonSafe(page, objective) {
  const { safe, anchor } = objective;
  const initialPhase = await page.evaluate(() => window.__floorPlan?.phase ?? 0);
  await page.evaluate(({ safe, anchor }) => {
    window.__autotest.teleport('pix', safe.x, Math.max(1.8, safe.y), safe.z);
    window.__autotest.teleport('nee', (safe.x + anchor.x) / 2, Math.max(1.8, anchor.y), (safe.z + anchor.z) / 2);
    window.__autotest.goto('pix', safe.x, Math.max(1.8, safe.y), safe.z, 0.7, true);
  }, { safe, anchor });
  await page.waitForFunction((phase) => (window.__floorPlan?.objective()?.pulls ?? 0) >= 1 || (window.__floorPlan?.phase ?? 0) > phase, initialPhase, { timeout: 35_000 });
}

async function completeRelay(page, objective) {
  const first = objective.pads[0];
  const second = objective.pads[1] ?? first;
  const initialPhase = await page.evaluate(() => window.__floorPlan?.phase ?? 0);
  await page.evaluate(({ first, second }) => {
    window.__autotest.teleport('pix', first.x - 1.2, Math.max(1.8, first.y), first.z + 1.2);
    window.__autotest.teleport('nee', (first.x + second.x) / 2, Math.max(1.8, second.y), (first.z + second.z) / 2);
  }, { first, second });
  for (const pad of objective.pads) {
    if (pad.role === 'pix') {
      await page.evaluate((point) => window.__autotest.teleport('pix', point.x - 1.2, Math.max(1.8, point.y), point.z + 1.2), pad);
      await gotoPoint(page, 'pix', pad, 0.7, true);
    } else {
      // Keep the AI partner in the authored relay room while it settles on
      // its pad; the bot still owns the role and the objective detects it.
      await page.evaluate((point) => window.__autotest.teleport('nee', point.x - 1.2, Math.max(1.8, point.y), point.z + 1.2), pad);
    }
    const expected = objective.pads.indexOf(pad) + 1;
    try {
      await page.waitForFunction(({ step, phase }) => (window.__floorPlan?.objective()?.step ?? 0) >= step || (window.__floorPlan?.phase ?? 0) > phase, { step: expected, phase: initialPhase }, { timeout: 35_000 });
      if (await page.evaluate((phase) => (window.__floorPlan?.phase ?? 0) > phase, initialPhase)) break;
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        objective: window.__floorPlan?.objective(),
        pix: window.__autotest.position('pix'),
        nee: window.__autotest.position('nee'),
      }));
      throw new Error(`relay pad ${expected} timeout ${JSON.stringify(diagnostic)}: ${error.message}`);
    }
  }
}

async function stageLoot(page, layout) {
  const loot = layout.loot;
  await page.evaluate((loot) => {
    window.__autotest.teleport('pix', loot.x - 1.5, Math.max(2.2, loot.y), loot.z + 1.5);
    window.__autotest.teleport('nee', loot.x + 1.5, Math.max(2.2, loot.y), loot.z + 1.5);
  }, loot);
  await gotoPoint(page, 'pix', loot, 0.8, true);
}

async function grabPrototype(page) {
  await page.evaluate(() => window.__autotest.press('pix', 'grabDrop'));
  await page.waitForFunction(() => window.__autotest.heldObject?.('pix') === 'prototype', null, { timeout: 12_000 });
}

async function extractPrototype(page, extraction) {
  // Escape is intentionally staged. The extraction check and the campaign
  // fragile phase still run through the real mission/objective update loop.
  await page.evaluate((extraction) => {
    window.__autotest.teleport('pix', extraction.x - 2, Math.max(2.2, extraction.y), extraction.z + 1.5);
    window.__autotest.teleport('nee', extraction.x + 2, Math.max(2.2, extraction.y), extraction.z + 1.5);
    window.__autotest.goto('pix', extraction.x, Math.max(2.2, extraction.y), extraction.z, 0.8, true);
  }, extraction);
  await page.waitForFunction((point) => {
    const pix = window.__autotest.position('pix');
    const nee = window.__autotest.position('nee');
    return pix && nee && Math.hypot(pix.x - point.x, pix.z - point.z) < 2
      && Math.hypot(nee.x - point.x, nee.z - point.z) < 5;
  }, extraction, { timeout: 35_000 });
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
  const pylonView = Boolean(layout.plan.phases?.[0]?.pylon ?? layout.plan.objective.pylon);
  return {
    pix: { x: focus.x - 2.2, y, z: focus.z + (pylonView ? 2.5 : -2.5) },
    nee: { x: focus.x + 2.2, y, z: focus.z + (pylonView ? 2.5 : -2.5) },
  };
}

function showcaseView(layout, focus) {
  if (layout.plan.phases?.[0]?.pylon ?? layout.plan.objective.pylon) {
    return { eye: { x: focus.x + 4, y: focus.y + 14, z: focus.z + 8 } };
  }
  return { eye: { x: focus.x + 8, y: focus.y + 6, z: focus.z - 12 } };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
