// Integration, BLOCKING: two real SDK clients; reserved-seat bot takeover and reclaim.
import { Client } from '@colyseus/sdk';
import { fileURLToPath } from 'node:url';
import { freePort, startTestServer } from '../test-server.mjs';
import { assert, until } from './lib.mjs';

const started = Date.now();
const result = { test: 'migration', pass: false, notes: { cases: [] } };
const rooms = [];
let server;
try {
  server = await startTestServer({ port: await freePort(), root: fileURLToPath(new URL('../..', import.meta.url)), env: { HANDSHAKE_TEST_HOOKS: '1', RECONNECT_SECONDS: '5' } });
  const endpoint = `ws://127.0.0.1:${server.port}`;
  const join = async (bot) => {
    const a = await new Client(endpoint).create('handshake', { bot, seed: 41 });
    const b = await new Client(endpoint).joinById(a.roomId);
    rooms.push(a, b);
    for (const room of [a, b]) {
      room.onMessage('*', () => {});
      room.reconnection.enabled = false;
      room.reconnection.maxRetries = 0;
    }
    await until('two humans synced', () => ({ ok: a.state.players?.size === 2 && b.state.players?.size === 2 && [...a.state.players.values()].every((p) => !p.bot) }), 10_000);
    a.send('debug-patrol-freeze', { frozen: true });
    a.send('debug-stage', { stage: 'steal-prototype', openDoor: true });
    await until('objective staged', () => ({ ok: b.state.mission.stage === 'steal-prototype' }));
    return [a, b];
  };
  for (const bot of [true, false]) for (const droppedIndex of [0, 1]) {
    const pair = await join(bot);
    const dropped = pair[droppedIndex], survivor = pair[1 - droppedIndex];
    const id = dropped.sessionId, role = dropped.state.players.get(id).role;
    const token = dropped.reconnectionToken;
    const beforeRun = { seed: survivor.state.run.seed, floor: survivor.state.run.floor };
    const leftMessages = [];
    survivor.onMessage('rematch-partner-left', (m) => leftMessages.push(m));
    const p = dropped.state.players.get(id).position;
    dropped.send('debug-object-place', { objectId: 'prototype', x: p.x, y: p.y, z: p.z });
    await until('loot placed', () => ({ ok: Math.hypot(dropped.state.objects.get('prototype').position.x - p.x, dropped.state.objects.get('prototype').position.z - p.z) < 0.1 }));
    dropped.send('grab-object', { objectId: 'prototype' });
    await until('loot held before drop', () => ({ ok: survivor.state.objects.get('prototype').holderId === id }));
    dropped.connection.close(4999, 'migration regression');
    await until('seat takeover or freeze', () => {
      const seat = survivor.state.players.get(id);
      return { ok: seat && (bot ? seat.bot && seat.connected : !seat.connected), info: seat?.toJSON() };
    }, 3_000);
    const elapsed = survivor.state.mission.elapsedSeconds;
    await until('clock behavior', () => ({ ok: bot ? survivor.state.mission.elapsedSeconds > elapsed + 0.25 : true }), 2_000);
    const back = await new Client(endpoint).reconnect(token);
    rooms.push(back);
    back.onMessage('*', () => {});
    await until('original seat reclaimed', () => ({ ok: survivor.state.players.get(id)?.connected && !survivor.state.players.get(id)?.bot && back.state.players?.get(id)?.connected }));
    assert(back.sessionId === id && back.state.players.get(id).role === role, 'reconnect changed seat identity');
    assert(survivor.state.players.size === 2 && !survivor.state.players.has('bot'), 'duplicate bot seat after reclaim');
    assert(survivor.state.objects.get('prototype').holderId === id, 'reconnect lost held objective');
    assert(beforeRun.seed === survivor.state.run.seed && beforeRun.floor === survivor.state.run.floor, 'migration reset run');
    assert(leftMessages.length === 0, 'temporary drop reported permanent leave');
    result.notes.cases.push({ bot, dropped: droppedIndex === 0 ? 'creator' : 'guest', reclaimed: true, heldObjective: true });
    await back.leave(true); await survivor.leave(true);
  }
  for (const bot of [true, false]) for (const consent of [true, false]) {
    const [creator, survivor] = await join(bot);
    let partnerLeft = false;
    survivor.onMessage('rematch-partner-left', () => { partnerLeft = true; });
    if (consent) await creator.leave(true);
    else creator.connection.close(4999, 'expiry regression');
    await until('permanent creator leave', () => ({ ok: !survivor.state.players.has(creator.sessionId) && (bot ? survivor.state.started && survivor.state.players.get('bot')?.connected : !survivor.state.started && partnerLeft), info: survivor.state.toJSON() }), 9_000);
    result.notes.cases.push({ bot, consent, creatorLeft: true, continued: bot, partnerLeft: !bot });
    await survivor.leave(true);
  }
  result.pass = true;
} catch (error) { result.error = String(error?.stack ?? error); result.notes.serverLog = server?.log().slice(-2000); }
finally {
  for (const room of rooms) { room.reconnection.enabled = false; room.reconnection.maxRetries = 0; if (room.connection.isOpen) await Promise.race([room.leave(true).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 250))]); }
  await server?.stop();
}
result.seconds = Math.round((Date.now() - started) / 1000);
console.log('QA_RESULT ' + JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
