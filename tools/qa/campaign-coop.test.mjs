import { strict as assert } from 'node:assert';
import { campaignLayout } from '../../shared/campaign/levels.mjs';
import { createHash } from 'node:crypto';

const a = campaignLayout('l2-twin-levers');
const b = campaignLayout('l2-twin-levers');
const hash = (plan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
assert.deepEqual(a.plan, b.plan);
assert.equal(hash(a.plan), hash(b.plan));
assert.equal(a.plan.objective.kind, 'twin-levers');
console.log('QA_RESULT ' + JSON.stringify({ test: 'campaign-coop', pass: true, notes: { levelId: 'l2-twin-levers', planHash: hash(a.plan) } }));
