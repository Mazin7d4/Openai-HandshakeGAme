import { strict as assert } from 'node:assert';
import { CAMPAIGN_LEVELS, campaignLayout } from '../../shared/campaign/levels.mjs';
import { validateFloorPlan } from '../../shared/nightshift/plan.mjs';
import { createObjectiveState, stepObjective, lootLocked, completeFragileCarry } from '../../shared/nightshift/objectives.mjs';
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
// Regression: no single drone can satisfy both consoles; leaving a console
// decays partial progress, and the pair can always try again.
const soloState = createObjectiveState(twin);
for (let i = 0; i < 16; i++) stepObjective(soloState, twin, { dt: .25,
  players: [{ role: 'pix', ...twin.levers[0], tetherPull: 0 }], yanks: [] });
assert(!soloState.done && lootLocked(soloState, twin), 'one player bypassed the paired lock');
for (let i = 0; i < 8; i++) stepObjective(soloState, twin, { dt: .25,
  players: twin.levers.map((p, i) => ({ ...p, role: i ? 'nee' : 'pix', tetherPull: 0 })), yanks: [] });
assert(soloState.done, 'paired lock cannot recover');

const wrap = campaignLayout('l3-wrap-and-drag').plan.objective;
const wrapState = createObjectiveState(wrap);
const pair = (other) => [{ role: 'pix', ...wrap.safe, tetherPull: .9 }, { role: 'nee', ...other, tetherPull: .9 }];
for (let i = 0; i < 20; i++) stepObjective(wrapState, wrap, { dt: .25, players: pair(wrap.safe), yanks: ['nee'] });
assert.equal(wrapState.pulls, 0, 'unwrapped safe was pulled');
for (let i = 0; i < 40 && !wrapState.done; i++) stepObjective(wrapState, wrap, { dt: .25, players: pair(wrap.anchor), yanks: [] });
assert(wrapState.done && wrapState.pulls === 3, 'pylon lock cannot finish by sustained pull');

const relay = campaignLayout('l4-fragile-relay').plan.phases[0];
const relayState = createObjectiveState(relay);
stepObjective(relayState, relay, { dt: .1, players: [{ role: 'pix', ...relay.pads[0] }] });
assert.equal(relayState.step, 1);
for (let i = 0; i < 40; i++) stepObjective(relayState, relay, { dt: .25, players: [] });
assert.equal(relayState.step, 0, 'expired relay never reset');
for (const pad of relay.pads) stepObjective(relayState, relay, { dt: .1, players: [pad] });
assert(relayState.done, 'relay cannot be retried');

const glass = campaignLayout('l4-fragile-relay').plan.phases[1];
const glassState = createObjectiveState(glass);
for (let i = 0; i < 12; i++) stepObjective(glassState, glass, { dt: .25, carrier: 'pix', yanks: ['pix'] });
assert.equal(glassState.shatters, 1, 'fragile damage never reset after three cracks');
assert.equal(glassState.cracks, 0);
assert(!glassState.done, 'shatter completed extraction');
assert(completeFragileCarry(glassState, glass), 'replacement core cannot be extracted');
assert(glassState.done);

// Authored layout invariants: no seeded hazards, escape moves away from the
// camera, and each successive relay station advances toward the visible core.
for (const level of CAMPAIGN_LEVELS) {
  const layout = campaignLayout(level.id);
  assert(layout.spawn.z < layout.loot.z && layout.loot.z < layout.extraction.z);
  assert.equal(layout.plan.hazards.length, 0);
  assert.equal(layout.patrolRoutes.length, 0);
  assert(layout.plan.rooms.every((room) => room.pieces.length === 0));
}
for (let i = 1; i < relay.pads.length; i++) assert(relay.pads[i].z > relay.pads[i - 1].z);
console.log('QA_RESULT ' + JSON.stringify({ test: 'campaign-unit', pass: true, notes: { levels: CAMPAIGN_LEVELS.length, recoveryCases: 5 } }));
