import {
  canPass,
  facingYaw,
  PASS_CLOSE_RANGE,
  PASS_CONE_DEG,
  PASS_RANGE,
} from '../../src/gameplay/passRules.ts';
import {
  PASS_CLOSE_RANGE as SERVER_CLOSE_RANGE,
  PASS_CONE_DEG as SERVER_CONE_DEG,
  PASS_RANGE as SERVER_RANGE,
} from '../../server/passRules.mjs';

const started = Date.now();
const result = { test: 'pass-rules', pass: false, notes: {} };
const holder = { x: 0, y: 0, z: 0 };
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function check(partner, expected, label) {
  const actual = canPass({ holder, holderYaw: 0, partner });
  assert(actual.ok === expected.ok && actual.reason === expected.reason,
    `${label}: got ${JSON.stringify(actual)}`);
}

try {
  check({ x: 0, y: 0, z: 1.5 }, { ok: true, reason: 'ok' }, '1.5 m ahead');
  check({ x: 0, y: 0, z: 2.3 }, { ok: false, reason: 'far' }, '2.3 m ahead');
  check({ x: 0, y: 0, z: -1.5 }, { ok: false, reason: 'behind' }, '1.5 m behind');
  check({ x: 1.5 / Math.sqrt(2), y: 0, z: 1.5 / Math.sqrt(2) }, { ok: true, reason: 'ok' }, '1.5 m at 45 degrees');
  check({ x: 1.5 * Math.sin(Math.PI / 3), y: 0, z: 1.5 * Math.cos(Math.PI / 3) }, { ok: false, reason: 'behind' }, '1.5 m at 60 degrees');
  check({ x: 0, y: 0, z: -0.4 }, { ok: true, reason: 'ok' }, '0.4 m behind overlap');
  const fromVisual = canPass({ holder, holderYaw: facingYaw(0), partner: { x: 0, y: 0, z: -1.5 } });
  assert(fromVisual.ok, `visual yaw 0 faces -z: got ${JSON.stringify(fromVisual)}`);
  assert(!canPass({ holder, holderYaw: facingYaw(0), partner: { x: 0, y: 0, z: 1.5 } }).ok, 'visual yaw 0: partner toward camera accepted');
  assert(SERVER_RANGE >= PASS_RANGE, `server range ${SERVER_RANGE} < client ${PASS_RANGE}`);
  assert(SERVER_CONE_DEG >= PASS_CONE_DEG, `server cone ${SERVER_CONE_DEG} < client ${PASS_CONE_DEG}`);
  assert(SERVER_CLOSE_RANGE === PASS_CLOSE_RANGE, 'server close range differs from client');
  result.notes = { client: { range: PASS_RANGE, coneDeg: PASS_CONE_DEG, closeRange: PASS_CLOSE_RANGE }, server: { range: SERVER_RANGE, coneDeg: SERVER_CONE_DEG, closeRange: SERVER_CLOSE_RANGE } };
  result.pass = true;
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 1500);
} finally {
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log('QA_RESULT ' + JSON.stringify(result));
  process.exitCode = result.pass ? 0 : 1;
}
