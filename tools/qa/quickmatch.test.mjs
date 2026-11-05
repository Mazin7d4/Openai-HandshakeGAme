import { runTest, url, assert, collectErrors, waitForGame, worldState, openPage, closePage } from './lib.mjs';

await runTest('quickmatch', async (browser, notes) => {
  const open = url({ qmPool: `t${Date.now().toString(36)}` });
  const errors = [];
  const { page: a } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  const { page: b } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  collectErrors(a, 'a', errors); collectErrors(b, 'b', errors);
  await Promise.all([a.goto(open), b.goto(open)]);
  await Promise.all([a.getByTestId('multiplayer').click(), b.getByTestId('multiplayer').click()]);
  await Promise.all([a.getByTestId('quick-match').click(), b.getByTestId('quick-match').click()]);
  await Promise.all([waitForGame(a), waitForGame(b)]);
  notes.hud = { a: await a.getByTestId('network-hud').innerText(), b: await b.getByTestId('network-hud').innerText() };
  assert(notes.hud.a.includes('PIX') !== notes.hud.b.includes('PIX'), `roles did not split: ${JSON.stringify(notes.hud)}`);
  const until = async (fn, timeout = 20_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await fn(); if (value) return value; await a.waitForTimeout(100); }
    throw new Error('timed out polling game state');
  };
  const before = await until(async () => { const w = await worldState(a); return Object.keys(w.players).length === 2 ? w : null; });
  const start = before.players['player-1'];
  await a.getByTestId('game-canvas').focus(); await a.keyboard.down('w');
  try { await until(async () => { const w = await worldState(a); const p = w.players['player-1']; return p && Math.hypot(p.x - start.x, p.z - start.z) >= 1.5 ? p : null; }); }
  finally { await a.keyboard.up('w'); }
  const moved = await until(async () => { const p = (await worldState(b)).players['player-1']; return p && Math.hypot(p.x - start.x, p.z - start.z) >= 1 ? p : null; });
  notes.moved = moved;
  assert(errors.length === 0, errors.join('\n'));
  await closePage(a); await closePage(b);
});
