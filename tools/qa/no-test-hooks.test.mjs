// Security: a server started like production (`npm start`, HANDSHAKE_TEST_HOOKS unset) must ignore
// the client 'debug-stage' skip. Node-only Colyseus clients, no browser. Run against a server
// started WITHOUT HANDSHAKE_TEST_HOOKS (npm run qa:servers does that).
import { WebSocket as NodeWebSocket } from 'ws';
import { SERVER_URL } from './lib.mjs';
globalThis.WebSocket ??= NodeWebSocket; // Node 20 has no global WebSocket
const { Client } = await import('@colyseus/sdk');

const result = { test: 'no-test-hooks', pass: false, notes: { server: SERVER_URL } };
const started = Date.now();
const rooms = [];
try {
  const a = new Client(SERVER_URL); const b = new Client(SERVER_URL);
  const host = await a.create('handshake'); rooms.push(host);
  const guest = await b.joinById(host.roomId); rooms.push(guest);
  await new Promise((r) => setTimeout(r, 800));
  const json = () => host.state?.toJSON?.() ?? host.state;
  const stage = () => json()?.mission?.stage;
  result.notes.stageBefore = stage();
  guest.send('debug-stage', { stage: 'escape' });
  host.send('debug-stage', { stage: 'escape' });
  await new Promise((r) => setTimeout(r, 1500));
  result.notes.stageAfter = stage();
  result.notes.alarmAfter = json()?.mission?.alarm;
  if (result.notes.stageBefore == null) throw new Error('could not read mission stage from room state');
  if (result.notes.stageAfter === 'escape' || result.notes.alarmAfter) throw new Error('client skipped to escape: test hooks are enabled on this server');
  result.pass = true;
} catch (e) {
  result.error = String(e?.message ?? e).slice(0, 500);
} finally {
  for (const r of rooms) await Promise.race([r.leave(true).catch(() => {}), new Promise((res) => setTimeout(res, 500))]);
  result.seconds = Math.round((Date.now() - started) / 1000);
  process.stdout.write('QA_RESULT ' + JSON.stringify(result) + '\n', () => process.exit(result.pass ? 0 : 1));
}
