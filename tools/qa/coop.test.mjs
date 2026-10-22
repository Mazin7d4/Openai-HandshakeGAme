// (b) Two-client co-op: host + guest join one room, roles PIX/NEE, both see each other move, world views agree.
import { runTest, url, assert, collectErrors, shot, waitForGame, createAndJoin, worldState, compareWorld } from './lib.mjs';

await runTest('coop', async (browser, notes) => {
  const errors = [];
  const host = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const guest = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  collectErrors(host, 'host', errors); collectErrors(guest, 'guest', errors);
  notes.room = await createAndJoin(host, guest);
  await Promise.all([waitForGame(host), waitForGame(guest)]);
  const hHud = await host.getByTestId('network-hud').innerText();
  const gHud = await guest.getByTestId('network-hud').innerText();
  notes.hud = { host: hHud, guest: gHud };
  assert(hHud.includes('PIX') && gHud.includes('NEE'), `roles wrong: host "${hHud}" guest "${gHud}"`);
  await host.waitForTimeout(1500);
  const before = await worldState(guest);
  assert(before.players['player-1'] && before.players['player-2'], `guest does not see both drones:\n${before.raw}`);
  await host.getByTestId('game-canvas').focus();
  await host.keyboard.down('w'); await host.waitForTimeout(900); await host.keyboard.up('w');
  await guest.getByTestId('game-canvas').focus();
  await guest.keyboard.down('d'); await guest.waitForTimeout(900); await guest.keyboard.up('d');
  await host.waitForTimeout(1200);
  const [h, g] = await Promise.all([worldState(host), worldState(guest)]);
  const moved = Math.hypot(g.players['player-1'].x - before.players['player-1'].x, g.players['player-1'].z - before.players['player-1'].z);
  notes.pixMovedOnGuest = +moved.toFixed(2);
  assert(moved > 0.5, `guest did not see PIX move (moved ${moved.toFixed(2)})`);
  const issues = compareWorld(h, g);
  notes.agreement = issues;
  notes.patrolsTracked = h.patrols.length;
  await shot(host, 'coop-host'); await shot(guest, 'coop-guest');
  assert(issues.length === 0, `clients disagree: ${issues.join('; ')}`);
  notes.errors = errors;
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
});
