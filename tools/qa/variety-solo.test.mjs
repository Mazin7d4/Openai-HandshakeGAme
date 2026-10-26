import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { generateRun } from '../../shared/seed/index.mjs';
import { runTest, url, assert, collectErrors, openPage, closePage, waitForNightShiftHud } from './lib.mjs';

const shotDir = '/workspace/handshake/playtest/oct25/nightshift';
mkdirSync(shotDir, { recursive: true });
for (const file of readdirSync(shotDir)) {
  if (file.endsWith('.png')) unlinkSync(`${shotDir}/${file}`);
}

function picks() {
  // The showcase set deliberately covers the four authored cooperative objectives,
  // with a boss vault and enough room archetypes to exercise the visual builder.
  const wantedKinds = new Set(['twin-levers', 'pylon-safe', 'fragile', 'relay']);
  const selected = [];
  const kinds = new Set();
  const archetypes = new Set();
  const add = (seed, floor, plan) => {
    selected.push({ seed, floor, plan });
    kinds.add(plan.objective.kind);
    for (const room of plan.rooms) if (room.archetype !== 'classic') archetypes.add(room.archetype);
  };
  for (let seed = 0; seed < 5000 && selected.length < 4; seed++) {
    for (let floor = 2; floor <= 12 && selected.length < 4; floor++) {
      const plan = generateRun(seed, floor).plan;
      if (!wantedKinds.has(plan.objective.kind) || kinds.has(plan.objective.kind)) continue;
      if (selected.length === 0 && !plan.job.boss) continue;
      const addsKind = !kinds.has(plan.objective.kind);
      const addsRoom = plan.rooms.some((room) => room.archetype !== 'classic' && !archetypes.has(room.archetype));
      if (addsKind && (addsRoom || archetypes.size >= 4) && plan.hazards.length > 0) add(seed, floor, plan);
    }
  }
  if (!selected.find((pick) => pick.plan.job.boss)) throw new Error('could not choose a boss floor');
  if (kinds.size < 4) throw new Error(`objective variety too narrow: ${[...kinds].join(', ')}`);
  if (archetypes.size < 4) throw new Error(`room variety too narrow: ${[...archetypes].join(', ')}`);
  return selected;
}


function centroid(points) {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, y: 1, z: sum.z / points.length };
}

/** Where the floor's identity is most visible: the objective props, else the most-dressed room. */
function shotFocus(plan, seed, floor) {
  const objective = plan.objective;
  if (objective.levers) return centroid(objective.levers);
  if (objective.pylon) return centroid([objective.pylon, objective.safe]);
  if (objective.pads) return centroid(objective.pads.slice(0, 3));
  if (objective.kind === 'fragile' || objective.kind === 'grab') return generateRun(seed, floor).loot;
  const room = plan.rooms
    .filter((candidate) => candidate.archetype !== 'classic' && candidate.pieces.length)
    .sort((a, b) => b.pieces.length - a.pieces.length)[0];
  if (room) return centroid(room.pieces);
  return generateRun(seed, floor).loot;
}

const selected = picks();
const twin = (() => {
  for (let seed = 0; seed < 5000; seed++) for (let floor = 2; floor <= 9; floor++) {
    const plan = generateRun(seed, floor).plan;
    if (plan.objective.kind === 'twin-levers') return { seed, floor, plan };
  }
  return null;
})();

await runTest('variety-solo', async (browser, notes) => {
  notes.floors = [];
  for (const choice of process.env.VARIETY_LEVER_ONLY ? [] : selected) {
    const errors = [];
    const { page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
    collectErrors(page, `floor-${choice.floor}`, errors);
    await page.goto(url({ mode: 'nightshift', seed: String(choice.seed), floor: String(choice.floor), bot: '0' }));
    await waitForNightShiftHud(page);
    const card = page.getByTestId('floor-card');
    await card.waitFor({ state: 'visible', timeout: 10_000 });
    const cardText = await card.innerText();
    assert(cardText.includes(choice.plan.job.name), `job missing on floor ${choice.floor}: ${cardText}`);
    if (choice.plan.job.boss) {
      assert(await card.locator('[data-boss="1"].floor-card__boss').count() === 1, 'boss badge missing');
      assert(await card.getAttribute('data-boss') === '1', 'boss card marker missing');
    }
    await page.waitForFunction(() => Boolean(window.__floorPlan?.planHash), null, { timeout: 20_000 });
    const hook = await page.evaluate(() => ({ ...window.__floorPlan, objective: window.__floorPlan.objective() }));
    const expectedHash = await page.evaluate((plan) => {
      let hash = 2166136261;
      const json = JSON.stringify(plan);
      for (let i = 0; i < json.length; i++) { hash ^= json.charCodeAt(i); hash = Math.imul(hash, 16777619); }
      return (hash >>> 0).toString(16).padStart(8, '0');
    }, choice.plan);
    assert(hook.planHash === expectedHash, `plan hash mismatch on floor ${choice.floor}`);
    assert(hook.drawCalls <= 25, `draw calls over budget on floor ${choice.floor}: ${hook.drawCalls}`);
    assert(hook.bodies <= 40, `bodies over budget on floor ${choice.floor}: ${hook.bodies}`);
    const objectivePoint = choice.plan.objective.levers?.[0]
      ?? choice.plan.objective.safe
      ?? choice.plan.objective.pads?.[0]
      ?? choice.plan.rooms.find((room) => room.archetype !== 'classic')?.pieces[0]
      ?? choice.plan.loot;
    const hazard = choice.plan.hazards[0];
    const hazardPoint = hazard?.center ?? hazard?.a ?? (hazard?.rect && {
      x: (hazard.rect.x0 + hazard.rect.x1) / 2,
      y: Math.max(1.8, (hazard.rect.y0 + hazard.rect.y1) / 2),
      z: (hazard.rect.z0 + hazard.rect.z1) / 2,
    });
    // Stage a readable shot: let the floor card play, park both drones beside
    // the objective, and let the normal follow camera settle over them.
    await page.waitForTimeout(2500);
    const focus = shotFocus(choice.plan, choice.seed, choice.floor);
    await page.evaluate(({ focus, fragile }) => {
      const hoverY = fragile ? Math.max(3.8, (focus.y ?? 5.25) - 0.8) : Math.max(2.8, (focus.y ?? 1.8) + 0.4);
      const side = fragile ? 2.2 : 1.25;
      const depth = fragile ? 3.2 : 1.4;
      window.__autotest.teleport('pix', focus.x - side, hoverY, focus.z - depth);
      window.__autotest.teleport('nee', focus.x + side, hoverY, focus.z - depth);
      for (const id of ['dev-readout', 'dev-controls']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
    }, { focus, fragile: choice.plan.objective.kind === 'fragile' });
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.count()) await skip.first().click().catch(() => {});
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const toasts = document.querySelector('[data-testid="juice-toasts"]');
      if (toasts instanceof HTMLElement) toasts.style.display = 'none';
    });
    const bossSuffix = choice.plan.job.boss ? '-boss' : '';
    await page.screenshot({ path: `${shotDir}/floor-${choice.floor}-${choice.plan.objective.kind}${bossSuffix}.png` });
    assert(errors.length === 0, `browser errors on floor ${choice.floor}:\n${errors.join('\n')}`);
    notes.floors.push({ floor: choice.floor, seed: choice.seed, objective: choice.plan.objective.kind, boss: choice.plan.job.boss, drawCalls: hook.drawCalls, bodies: hook.bodies });
    await closePage(page);
  }

  assert(twin, 'could not choose a twin-lever floor for the bot check');
  const errors = [];
  const { page } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  collectErrors(page, 'bot-objective', errors);
  await page.goto(url({ mode: 'nightshift', seed: String(twin.seed), floor: String(twin.floor), bot: '1' }));
  await waitForNightShiftHud(page);
  await page.waitForFunction(() => Boolean(window.__floorPlan?.planHash), null, { timeout: 20_000 });
  await page.evaluate(() => window.__autotest.debugStage('steal-prototype'));
  const lever = twin.plan.objective.levers[0];
  // Drop the crew at the lever room (the autopilot flies straight lines, not routes);
  // PIX then holds lever A and the AI partner has to man lever B on its own.
  const other = twin.plan.objective.levers[1];
  await page.evaluate(({ a, b }) => {
    window.__autotest.teleport('pix', a.x, Math.max(1.8, a.y), a.z);
    window.__autotest.teleport('nee', (a.x + b.x) / 2, Math.max(1.8, a.y), (a.z + b.z) / 2);
  }, { a: lever, b: other });
  await page.evaluate((point) => window.__autotest.goto('pix', point.x, Math.max(1.8, point.y), point.z, 0.6, true), lever);
  try {
    await page.waitForFunction(() => window.__floorPlan?.objective()?.done === true, null, { timeout: 30_000 });
  } catch (error) {
    const diag = await page.evaluate(() => ({
      objective: window.__floorPlan?.objective(),
      pix: window.__autotest.position('pix'),
      nee: window.__autotest.position('nee'),
    }));
    throw new Error(`bot lever timeout seed=${twin.seed} floor=${twin.floor} levers=${JSON.stringify(twin.plan.objective.levers)} ${JSON.stringify(diag)}`);
  }
  assert(errors.length === 0, `bot objective errors:\n${errors.join('\n')}`);
  notes.botObjective = { seed: twin.seed, floor: twin.floor, done: true };
  await closePage(page);
});
