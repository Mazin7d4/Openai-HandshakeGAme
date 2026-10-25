import { runTest, url, assert, waitForGame, worldState, openPage, closePage } from './lib.mjs';

await runTest('quickmatch-bot', async (browser, notes) => {
  const open = url({ qmPool: `t${Date.now().toString(36)}`, qmTimeout: '3000' });
  const { page: a } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  await a.goto(open); await a.getByTestId('multiplayer').click(); await a.getByTestId('quick-match').click();
  await a.getByTestId('qm-play-bot').waitFor({ timeout: 10_000 }); await a.getByTestId('qm-play-bot').click(); await waitForGame(a);
  assert((await a.getByTestId('network-hud').innerText()).includes('PIX') || (await a.getByTestId('network-hud').innerText()).includes('NEE'), 'missing network HUD');
  const hudA = await a.getByTestId('network-hud').innerText();
  const roleA = hudA.includes('PIX') ? 'PIX' : 'NEE';
  const botRole = roleA === 'PIX' ? 'NEE' : 'PIX';
  // The AI partner is in A's world before any stranger arrives.
  const until = async (page, fn, timeout = 20_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(100); }
    return false;
  };
  assert(await until(a, async () => Object.keys((await worldState(a)).players).length === 2), 'AI partner did not appear in A\'s world');
  const { page: b } = await openPage(browser, { viewport: { width: 960, height: 540 } });
  await b.goto(open); await b.getByTestId('multiplayer').click(); await b.getByTestId('quick-match').click(); await waitForGame(b);
  notes.hud = { a: await a.getByTestId('network-hud').innerText(), b: await b.getByTestId('network-hud').innerText() };
  assert(notes.hud.b.includes(botRole), `stranger did not take the AI seat (${botRole}): ${JSON.stringify(notes.hud)}`);
  assert(await until(a, async () => Object.keys((await worldState(a)).players).length === 2), 'A lost its partner after the handoff');
  await closePage(a); await closePage(b);
});
