// Hardening & Fuzz: verifies server does not crash on malformed input or rate bursts,
// and continues regular replication cleanly.
import { Client } from '@colyseus/sdk';
import { fileURLToPath } from 'node:url';
import { freePort, startTestServer } from '../test-server.mjs';
import { assert, until } from './lib.mjs';

const started = Date.now();
const result = { test: 'server-fuzz', pass: false, notes: {} };
let server;
const rooms = [];

try {
  const port = await freePort();
  server = await startTestServer({
    port,
    root: fileURLToPath(new URL('../..', import.meta.url)),
    env: { HANDSHAKE_TEST_HOOKS: '1', RECONNECT_SECONDS: '5' },
  });
  const endpoint = `ws://127.0.0.1:${port}`;

  // 1. Check /health endpoint
  const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
  assert(healthRes.ok, `health check failed: status ${healthRes.status}`);
  const health = await healthRes.json();
  assert(health.ok === true && typeof health.memory?.rssMb === 'number', 'health missing memory stats');
  assert(health.maxRooms === 100, `expected maxRooms 100, got ${health.maxRooms}`);
  result.notes.initialHealth = health;

  // 2. Connect 2 real SDK clients
  const client1 = new Client(endpoint);
  const client2 = new Client(endpoint);
  const host = await client1.create('handshake', { seed: 123 });
  const guest = await client2.joinById(host.roomId);
  rooms.push(host, guest);
  for (const r of [host, guest]) {
    r.reconnection.enabled = false;
    r.onMessage('*', () => {});
  }

  await until('players synced', () => ({
    ok: host.state.players?.size === 2 && guest.state.players?.size === 2,
    info: host.state.players?.size,
  }), 10_000);

  // 3. Test rtt-ping / rtt-pong
  let rttPongReceived = false;
  host.onMessage('rtt-pong', (msg) => {
    if (msg?.t === 12345 && typeof msg?.serverTime === 'number') {
      rttPongReceived = true;
    }
  });
  host.send('rtt-ping', { t: 12345 });
  await until('rtt-pong received', () => ({ ok: rttPongReceived }), 5_000);

  // 4. Send barrage of malformed & invalid messages
  const garbagePayloads = [
    null,
    undefined,
    '',
    12345,
    [],
    { position: null, velocity: 'fast' },
    { position: { x: NaN, y: Infinity, z: -Infinity }, boost: 'ultra' },
    { position: { x: 1e12, y: -1e12, z: 1e12 } },
    { objectId: null },
    { objectId: 99999 },
    { objectId: 'nonexistent-item', position: { x: NaN } },
    { stationId: 'nonexistent-terminal' },
    { stationId: null },
    { kind: 'super-yank', impulse: { x: Infinity, y: NaN, z: 0 } },
    { x: 'far', y: null, z: NaN },
    { id: 'illegal-emote' },
    { id: null },
  ];

  for (const p of garbagePayloads) {
    host.send('snapshot', p);
    host.send('grab-object', p);
    host.send('release-object', p);
    host.send('handoff-object', p);
    host.send('object-snapshot', p);
    host.send('hack-start', p);
    host.send('hack-complete', p);
    host.send('hack-cancel', p);
    host.send('tether-yank', p);
    host.send('ping', p);
    host.send('emote', p);
    host.send('rtt-ping', p);
  }

  // 5. Rate limit burst: send 120 messages in tight loop
  for (let i = 0; i < 120; i++) {
    host.send('snapshot', {
      position: { x: i, y: 2, z: 3 },
      velocity: { x: 0, y: 0, z: 0 },
      orientation: { pitch: 0, yaw: 0, roll: 0 },
      boost: 'off',
      movement: 'idle',
      selfPowered: true,
      tetherPull: 0,
    });
  }

  // 6. Wait for rate limit window to roll over, then send legitimate movement
  await new Promise((r) => setTimeout(r, 1100));

  host.send('snapshot', {
    position: { x: 4.5, y: 2.2, z: 1.1 },
    velocity: { x: 1.0, y: 0, z: 0 },
    orientation: { pitch: 0, yaw: 1.57, roll: 0 },
    boost: 'off',
    movement: 'cruising',
    selfPowered: true,
    tetherPull: 0,
  });

  await until('valid movement replicated after fuzzing', () => {
    const hostInGuestView = guest.state.players.get(host.sessionId);
    return {
      ok: hostInGuestView && Math.abs(hostInGuestView.position.x - 4.5) < 0.1,
      info: hostInGuestView?.position?.toJSON?.() ?? hostInGuestView?.position,
    };
  }, 10_000);

  // 7. Verify /health is still reporting healthy server
  const healthRes2 = await fetch(`http://127.0.0.1:${port}/health`);
  assert(healthRes2.ok, 'health check failed after fuzzing');
  const health2 = await healthRes2.json();
  assert(health2.ok === true && health2.rooms === 1, `unexpected health status: ${JSON.stringify(health2)}`);
  result.notes.afterHealth = health2;

  await host.leave(true);
  await guest.leave(true);
  result.pass = true;
} catch (error) {
  result.error = String(error?.stack ?? error);
  result.notes.serverLog = server?.log().slice(-2000);
} finally {
  for (const room of rooms) {
    room.reconnection.enabled = false;
    room.reconnection.maxRetries = 0;
    if (room.connection?.isOpen) await room.leave(true).catch(() => {});
  }
  await server?.stop();
}

result.seconds = Math.round((Date.now() - started) / 1000);
console.log('QA_RESULT ' + JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
