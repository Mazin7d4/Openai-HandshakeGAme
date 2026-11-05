import { runTest, url, assert, collectErrors, waitForGame } from './lib.mjs';

await runTest('bot-solo', async (browser, notes) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, 'bot-solo', errors);
  await page.goto(url({ play: 'solo' }));
  await waitForGame(page);

  const initial = await page.evaluate(() => ({
    aiPartner: document.documentElement.dataset.aiPartner,
    bot: window.__pixBot?.(),
  }));
  assert(initial.aiPartner === 'on', `expected AI partner on, got ${initial.aiPartner}`);
  assert(initial.bot?.enabled === true, 'solo bot should be enabled');
  assert(initial.bot?.tag === true, 'solo bot tag should be visible');
  assert(typeof initial.bot?.state === 'string', 'bot state should be a string');

  await page.locator('canvas').focus();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const states = [];
  for (let i = 0; i < 20; i++) {
    const status = await page.evaluate(() => window.__pixBot?.());
    if (status) states.push(status.state);
    await page.waitForTimeout(100);
  }
  const after = await page.evaluate(() => window.__pixBot?.());
  notes.states = [...new Set(states)];
  notes.distance = after?.distance;
  assert(states.some((state) => state !== 'idle') || after?.distance < 6, `bot did not follow: ${JSON.stringify(after)}`);
  assert(!errors.length, `errors:\n${errors.join('\n')}`);
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page2 = await ctx2.newPage();
  const errors2 = [];
  collectErrors(page2, 'bot-solo-off', errors2);
  await page2.goto(url({ play: 'solo', bot: '0' }));
  await waitForGame(page2);
  const disabled = await page2.evaluate(() => ({
    aiPartner: document.documentElement.dataset.aiPartner,
    bot: window.__pixBot?.(),
  }));
  assert(disabled.aiPartner === 'off', `expected AI partner off, got ${disabled.aiPartner}`);
  assert(disabled.bot?.enabled === false, 'solo bot should be disabled');
  assert(disabled.bot?.tag === false, 'solo bot tag should be hidden');
  assert(!errors2.length, `errors:\n${errors2.join('\n')}`);
  await ctx2.close();
});
