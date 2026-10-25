// (b) Two-client co-op: host + guest join one room, roles PIX/NEE, both see each other move, world views agree.
import { runTest, url, assert, collectErrors, shot, waitForGame, createAndJoin, worldState, compareWorld, openPage, closePage } from './lib.mjs';

await runTest('coop', async (browser, notes) => {
  const errors = [];
  const { page: host } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  const { page: guest } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  collectErrors(host, 'host', errors); collectErrors(guest, 'guest', errors);
  notes.room = await createAndJoin(host, guest);
  await Promise.all([waitForGame(host), waitForGame(guest)]);
  const hHud = await host.getByTestId('network-hud').innerText();
  const gHud = await guest.getByTestId('network-hud').innerText();
  notes.hud = { host: hHud, guest: gHud };
  assert(hHud.includes('PIX') && gHud.includes('NEE'), `roles wrong: host "${hHud}" guest "${gHud}"`);
  // Deterministic: poll state instead of fixed waits. Under load (SwiftShader, two pages, full suite)
  // frames get long and the sim clamps dt to 0.05 s, so a fixed 900 ms key hold could move PIX ~0 m.
  const planar = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const until = async (label, fn, timeout = 20_000) => {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      last = await fn();
      if (last.ok) return last;
      await host.waitForTimeout(100);
    }
    throw new Error(`${label} (timeout ${timeout} ms): ${JSON.stringify(last?.info ?? null)}`);
  };
  const { before } = await until('guest does not see both drones', async () => {
    const w = await worldState(guest);
    return { ok: Boolean(w.players['player-1'] && w.players['player-2']), before: w, info: w.raw };
  });
  // Hold W on the host until the host itself has flown 1.5 m (sim-time, not wall-time).
  const hostStart = (await worldState(host)).players['player-1'];
  await host.getByTestId('game-canvas').focus();
  await host.keyboard.down('w');
  let hostFlown;
  try {
    hostFlown = await until('host PIX did not fly on W', async () => {
      const p = (await worldState(host)).players['player-1'];
      return { ok: Boolean(p && planar(p, hostStart) >= 1.5), p, info: p };
    });
  } finally { await host.keyboard.up('w'); }
  notes.hostFlew = +planar(hostFlown.p, hostStart).toFixed(2);
  await guest.getByTestId('game-canvas').focus();
  const guestStart = (await worldState(guest)).players['player-2'];
  await guest.keyboard.down('d');
  try {
    await until('guest NEE did not strafe on D', async () => {
      const p = (await worldState(guest)).players['player-2'];
      return { ok: Boolean(p && planar(p, guestStart) >= 0.5), info: p };
    });
  } finally { await guest.keyboard.up('d'); }
  // The guest must see PIX's flight arrive through the network (interpolated remote drone).
  let moved = 0;
  try {
    await until('guest did not see PIX move', async () => {
      const p = (await worldState(guest)).players['player-1'];
      moved = p ? planar(p, before.players['player-1']) : 0;
      return { ok: moved > 0.5, info: { moved } };
    }, 15_000);
  } catch { /* asserted below with the measured value */ }
  notes.pixMovedOnGuest = +moved.toFixed(2);
  assert(moved > 0.5, `guest did not see PIX move (moved ${moved.toFixed(2)})`);
  // Both views must converge (remote drones are interpolated; a slow frame only delays that).
  let h, g, issues = [];
  try {
    await until('clients did not converge', async () => {
      [h, g] = await Promise.all([worldState(host), worldState(guest)]);
      issues = compareWorld(h, g);
      return { ok: issues.length === 0, info: issues };
    }, 10_000);
  } catch { /* asserted below with the issues */ }
  notes.securityPresent = Boolean(h.security && g.security);
  assert(notes.securityPresent, 'window.__autotest.security() missing on a client (server-owned security not wired?)');
  // With HANDSHAKE_TEST_HOOKS=1 on the server (QA_HOOKS=1), also force escape so patrols are active.
  if (process.env.QA_HOOKS === '1') {
    await host.evaluate(() => window.__autotest.debugStage('escape'));
    await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__autotest.security().securityActive, null, { timeout: 10_000 })));
    await host.waitForTimeout(1500);
    const [h2, g2] = await Promise.all([worldState(host), worldState(guest)]);
    issues.push(...compareWorld(h2, g2).map((s) => `escape: ${s}`));
    notes.escapeSecurity = h2.security;
    await shot(host, 'coop-escape-host');
  }
  notes.agreement = issues;
  notes.patrolsTracked = h.patrols.length;
  await shot(host, 'coop-host'); await shot(guest, 'coop-guest');
  assert(issues.length === 0, `clients disagree: ${issues.join('; ')}`);
  notes.errors = errors;
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
  await closePage(host); await closePage(guest);
});
