import { strict as assert } from 'node:assert';
import { CAMPAIGN_LEVELS, campaignLayout } from '../../shared/campaign/levels.mjs';
import { validateFloorPlan } from '../../shared/nightshift/plan.mjs';
import { createObjectiveState, stepObjective } from '../../shared/nightshift/objectives.mjs';
import { scoreCampaignLevel } from '../../shared/campaign/score.mjs';

for (const level of CAMPAIGN_LEVELS) {
  const a = campaignLayout(level.id);
  const b = campaignLayout(level.id);
  assert.deepEqual(a.plan, b.plan, `${level.id} is not deterministic`);
  assert.equal(validateFloorPlan(a.plan, a).ok, true, `${level.id} plan does not validate`);
}
assert.deepEqual(CAMPAIGN_LEVELS.map((level) => campaignLayout(level.id).plan.objective.kind), ['grab', 'twin-levers', 'pylon-safe', 'relay', 'twin-levers']);
const twin = campaignLayout('l2-twin-levers').plan.objective;
const state = createObjectiveState(twin);
for (let i = 0; i < 8 && !state.done; i++) stepObjective(state, twin, { dt: 0.25, players: [
  { role: 'pix', ...twin.levers[0], tetherPull: 0 },
  { role: 'nee', ...twin.levers[1], tetherPull: 0 },
], carrier: null, yanks: [] });
assert.equal(state.done, true, 'twin levers did not complete');
assert.deepEqual(scoreCampaignLevel({ seconds: 90, parSeconds: 100, lootIntact: true, noAlarm: true }), { stars: [true, true, true], count: 3 });
assert.deepEqual(scoreCampaignLevel({ seconds: 101, parSeconds: 100, lootIntact: false, timesSpotted: 1 }), { stars: [false, false, false], count: 0 });
console.log('QA_RESULT ' + JSON.stringify({ test: 'campaign-unit', pass: true, notes: { levels: CAMPAIGN_LEVELS.length } }));
