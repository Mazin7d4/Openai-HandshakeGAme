import { strict as assert } from 'node:assert';
import { botGoal, BOT_TUNING, planarDistance } from '../../shared/bot/brain.mjs';

const exit = { x: 11, y: 2, z: 43.5 };
const self = { x: 8.9, y: 2.3, z: 40.1 };
const leader = { x: 2.6, y: 4.1, z: 35.4 };
const goal = (position) => botGoal({ self, leader: position, selfHoldingLoot: true, exit, threats: [] });
const ahead = goal(leader);
assert.equal(ahead.mode, 'carry');
assert(planarDistance(ahead.point, leader) <= BOT_TUNING.followFar + 1e-9, 'carrier target stretches the cord');
assert(planarDistance(ahead.point, exit) < planarDistance(leader, exit), 'carrier stopped leading toward extraction');
const backtrack = { ...leader, z: 30 };
assert(goal(backtrack).point.z < ahead.point.z, 'carrier ignores a player doubling back');
assert.deepEqual(goal(exit).point, exit, 'carrier cannot reach extraction with the player');
const rescue = botGoal({ self, leader, selfHoldingLoot: true, exit, leaderCaptured: true, capturedFor: BOT_TUNING.rescueDelay, threats: [] });
assert.equal(rescue.mode, 'rescue', 'carrying suppresses rescue');
console.log('QA_RESULT ' + JSON.stringify({ test: 'bot-carry-unit', pass: true, notes: { slack: true, backtrack: true, extraction: true, rescue: true } }));
