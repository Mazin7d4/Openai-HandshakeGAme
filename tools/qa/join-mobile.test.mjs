import { runTest, url, assert, collectErrors, shot, layoutAudit, waitForGame, devices, openPage, closePage } from './lib.mjs';

const phone = { ...devices['Pixel 5'], viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 }, hasTouch: true, isMobile: true };

async function installShare(page) {
  await page.addInitScript(() => {
    if (!navigator.share) Object.defineProperty(navigator, 'share', { value: async () => {}, configurable: true });
  });
}

async function openMultiplayer(page) {
  await page.goto(url());
  await page.getByTestId('multiplayer').tap();
}

await runTest('join-mobile', async (browser, notes) => {
  const errors = [];
  // The matchmaker answers bad/full joins with HTTP 522; the browser logs that as a console error.
  const expectedRejects = [];
  const hostCtx = await browser.newContext(phone); const host = await hostCtx.newPage();
  await installShare(host); collectErrors(host, 'host', errors);
  await openMultiplayer(host); await host.getByTestId('create-room').tap();
  const code = (await host.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
  assert(/^[A-HJ-NP-Z2-9]{4}$/.test(code), `Unexpected room code: ${code}`);
  assert(await host.getByTestId('copy-code').isVisible(), 'copy button hidden');
  assert(await host.getByTestId('share-invite').isVisible(), 'share button hidden');
  const invite = await host.getByTestId('invite-link').inputValue();
  assert(new URL(invite).searchParams.get('room') === code, `invite link missing room=${code}`);
  const lobbyLayout = await layoutAudit(host);
  assert(!lobbyLayout.scrollOverflow && lobbyLayout.smallTargets.length === 0, `lobby layout: ${JSON.stringify(lobbyLayout)}`);
  assert(await host.getByTestId('lobby-reconnecting').isHidden(), 'reconnecting indicator shown while just waiting for a partner');
  await shot(host, 'join-mobile-host-lobby');
  notes.host = { code, invite, lobbyLayout };

  const guestCtx = await browser.newContext(phone); const guest = await guestCtx.newPage();
  collectErrors(guest, 'guest', errors); await openMultiplayer(guest); await guest.getByTestId('join-room').tap();
  const input = guest.getByTestId('room-code-input');
  assert(await input.getAttribute('inputmode') === 'text', 'inputmode missing');
  assert(await input.getAttribute('autocapitalize') === 'characters', 'autocapitalize missing');
  assert(await input.getAttribute('maxlength') === '4', 'maxlength missing');
  await input.fill(code.toLowerCase());
  assert(await input.inputValue() === code, 'lowercase code was not uppercased');
  await guest.getByTestId('join-submit').tap();
  await Promise.all([waitForGame(host), waitForGame(guest)]);
  notes.joinedByCode = true;

  const badCtx = await browser.newContext(phone); const bad = await badCtx.newPage();
  collectErrors(bad, 'bad', expectedRejects); await openMultiplayer(bad); await bad.getByTestId('join-room').tap();
  await bad.getByTestId('room-code-input').fill('ZZZZ'); await bad.getByTestId('join-submit').tap();
  const badAlert = bad.locator('.lobby-status.error[role="alert"]');
  await badAlert.waitFor({ state: 'visible', timeout: 15_000 });
  notes.badCodeError = await badAlert.innerText();
  assert(/wasn't found/i.test(notes.badCodeError), `bad-code error missing: ${notes.badCodeError}`);
  await badCtx.close();

  const fullCtx = await browser.newContext(phone); const full = await fullCtx.newPage();
  collectErrors(full, 'full', expectedRejects); await openMultiplayer(full); await full.getByTestId('join-room').tap();
  await full.getByTestId('room-code-input').fill(code); await full.getByTestId('join-submit').tap();
  const fullAlert = full.locator('.lobby-status.error[role="alert"]');
  await fullAlert.waitFor({ state: 'visible', timeout: 15_000 });
  notes.fullRoomError = await fullAlert.innerText();
  assert(/full/i.test(notes.fullRoomError), `full-room error missing: ${notes.fullRoomError}`);
  await fullCtx.close();
  await guestCtx.close();

  const linkHostCtx = await browser.newContext(phone); const linkHost = await linkHostCtx.newPage();
  await installShare(linkHost); collectErrors(linkHost, 'link-host', errors); await openMultiplayer(linkHost); await linkHost.getByTestId('create-room').tap();
  const linkCode = (await linkHost.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
  const link = new URL(url()); link.searchParams.set('room', linkCode);
  const linkGuestCtx = await browser.newContext(phone); const linkGuest = await linkGuestCtx.newPage();
  collectErrors(linkGuest, 'link-guest', errors); await linkGuest.goto(link.toString());
  await Promise.all([waitForGame(linkHost), waitForGame(linkGuest)]);
  notes.joinedByLink = true;
  await linkGuestCtx.close(); await linkHostCtx.close();

  const pasteCtx = await browser.newContext(phone); const paste = await pasteCtx.newPage();
  collectErrors(paste, 'paste', errors); await openMultiplayer(paste); await paste.getByTestId('join-room').tap();
  const pasteInput = paste.getByTestId('room-code-input');
  await pasteInput.evaluate((el, value) => {
    const event = new ClipboardEvent('paste', { bubbles: true, clipboardData: new DataTransfer() });
    event.clipboardData.setData('text/plain', value); el.dispatchEvent(event);
  }, invite);
  assert(await pasteInput.inputValue() === code, 'invite URL paste did not extract code');
  await pasteCtx.close();
  await closePage(host);
  errors.push(...expectedRejects.filter((line) => !/status of 522/.test(line)));
  notes.errors = errors;
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
});
