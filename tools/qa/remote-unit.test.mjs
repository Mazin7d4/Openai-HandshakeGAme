// Owned presentation buffers must stay independent of mutable input snapshots.
import assert from 'node:assert/strict';
import { RemoteControlSource } from '../../src/control/RemoteControlSource.ts';
const result = { test: 'remote-unit', pass: false, notes: {} };
try {
  let now = 100;
  const remote = new RemoteControlSource(() => now);
  const state = { playerId: 'guest', role: 'nee', bot: false, connected: true,
    position: { x: 1, y: 2, z: 3 }, velocity: { x: 0, y: 0, z: 0 },
    orientation: { pitch: 0, yaw: 0, roll: 0 }, boost: 'off', movement: 'idle',
    selfPowered: false, tetherPull: 0, captured: false };
  remote.push(state);
  const first = remote.sample(1 / 60), owned = first.remoteState.position;
  state.position.x = 20; state.orientation.yaw = 1;
  assert.equal(remote.sample(1 / 60).remoteState.position.x, 1, 'caller mutated the buffered pose');
  now += 50; remote.push(state);
  assert.equal(remote.sample(1 / 60).remoteState.position.x, 20, 'reused input did not publish changed pose');
  state.selfPowered = true; state.tetherPull = 1;
  now += 50; remote.push(state);
  const frame = remote.sample(1 / 60);
  assert.equal(frame, first, 'control frame allocated again');
  assert.equal(frame.remoteState.position, owned, 'presentation vector allocated again');
  assert.equal(frame.remoteState.selfPowered, true, 'same-pose patch lost metadata');
  assert.ok(frame.remoteState.tetherPull > 0);
  state.connected = false; state.velocity.x = 10;
  now += 50; remote.push(state);
  const frozen = remote.sample(1 / 60).remoteState;
  assert.deepEqual(frozen.velocity, { x: 0, y: 0, z: 0 });
  assert.equal(state.velocity.x, 10, 'input snapshot mutated');
  remote.dispose();
  assert.equal(remote.sample(1 / 60).remoteState, undefined, 'disposed presentation retained');
  result.pass = true;
} catch (e) { result.error = String(e?.stack ?? e); }
console.log('QA_RESULT ' + JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
