import { fileURLToPath } from 'node:url';
import { runTest, url, assert, collectErrors, layoutAudit, waitForGame, devices } from './lib.mjs';
import { freePort, startTestServer } from '../test-server.mjs';
import { startWakeProxy } from './wake-proxy.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const phone = {
  ...devices['Pixel 5'], viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 },
  hasTouch: true, isMobile: true,
};

let phase = 'start';

async function body(browser, notes) {
  const resources = [];
  const errors = [];
  const proxyPorts = new Set();
  const pages = new Set();
  const track = (page, name) => collectErrors(page, name, {
    push: (...lines) => errors.push(...lines.map((line) => `[${phase}] ${line}`)),
  });
  const setup = async (mode, downMs, targetServer = null) => {
    const server = targetServer ?? await startTestServer({
      port: await freePort(), root, env: { HANDSHAKE_TEST_HOOKS: '' },
    });
    const proxy = await startWakeProxy({ targetPort: server.port, downMs, mode });
    resources.push({ proxy, server: targetServer ? null : server });
    proxyPorts.add(proxy.port);
    return { server, proxy };
  };
  const open = async (options, name, contextOptions = phone) => {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    pages.add(context);
    track(page, name);
    await page.goto(url(options));
    return { context, page };
  };
  const closeContext = async ({ context }) => {
    pages.delete(context);
    await context.close().catch(() => {});
  };

  try {
    phase = 'host-wakes';
    {
      const { proxy } = await setup('503', 5_000);
      const host = await open({ server: proxy.url, wakeTimeout: '30000' }, 'host-wakes');
      await host.page.getByTestId('multiplayer').tap();
      await host.page.getByTestId('create-room').tap();
      await host.page.getByTestId('wake-overlay').waitFor({ state: 'visible' });
      assert(await host.page.getByTestId('wake-elapsed').isVisible(), 'wake elapsed is not visible');
      const deadline = Date.now() + 30_000;
      let code = '';
      while (Date.now() < deadline) {
        const bodyText = await host.page.locator('body').innerText();
        assert(!await host.page.locator('.error').count(), 'host wake showed an error class');
        assert(!/Server didn't wake up/i.test(bodyText), 'host wake showed unreachable UI early');
        const candidate = host.page.getByTestId('room-code');
        if (await candidate.count() && await candidate.isVisible()) {
          code = (await candidate.innerText()).trim();
          break;
        }
        await host.page.waitForTimeout(100);
      }
      assert(/^[A-HJ-NP-Z2-9]{4}$/.test(code), `host room code missing: ${code}`);
      notes.hostWakes = code;
      await closeContext(host);
    }

    phase = 'join-wakes';
    {
      const directServer = await startTestServer({
        port: await freePort(), root, env: { HANDSHAKE_TEST_HOOKS: '' },
      });
      resources.push({ proxy: null, server: directServer });
      const host = await open({ server: `ws://127.0.0.1:${directServer.port}` }, 'join-host');
      await host.page.getByTestId('multiplayer').tap();
      await host.page.getByTestId('create-room').tap();
      const code = (await host.page.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
      const guestSetup = await setup('hang', 5_000, directServer);
      const invite = await open({ server: guestSetup.proxy.url, room: code, wakeTimeout: '40000' }, 'join-guest');
      await invite.page.getByTestId('wake-overlay').waitFor({ state: 'visible' });
      const watchWake = (async () => {
        while (await invite.page.getByTestId('wake-overlay').count()) {
          assert(!await invite.page.locator('.error').count(), 'join wake showed an error class while waking');
          assert(!/Server didn't wake up/i.test(await invite.page.locator('body').innerText()), 'join wake showed unreachable UI early');
          await invite.page.waitForTimeout(100);
        }
      })();
      await Promise.all([waitForGame(host.page), waitForGame(invite.page), watchWake]);
      assert(!await invite.page.locator('.error').count(), 'join wake showed an error class');
      notes.joinWakes = true;
      await closeContext(invite);
      await closeContext(host);
    }

    phase = 'cancel-keeps-code';
    {
      const { proxy } = await setup('hang', Infinity);
      const guest = await open({ server: proxy.url, wakeTimeout: '30000' }, 'cancel');
      await guest.page.getByTestId('multiplayer').tap();
      await guest.page.getByTestId('join-room').tap();
      await guest.page.getByTestId('room-code-input').fill('ABCD');
      await guest.page.getByTestId('join-submit').tap();
      await guest.page.getByTestId('wake-overlay').waitFor({ state: 'visible' });
      await guest.page.getByTestId('wake-cancel').tap();
      await guest.page.getByTestId('wake-overlay').waitFor({ state: 'hidden' });
      assert(await guest.page.getByTestId('room-code-input').inputValue() === 'ABCD', 'cancel lost the room code');
      notes.cancelKeepsCode = true;
      await closeContext(guest);
    }

    phase = 'unreachable';
    {
      const { proxy } = await setup('hang', Infinity);
      // The wake budget starts when the title screen loads (that is when the first /health ping fires).
      const loadedAt = Date.now();
      const host = await open({ server: proxy.url, wakeTimeout: '3000' }, 'unreachable');
      await host.page.getByTestId('multiplayer').tap();
      await host.page.getByTestId('create-room').tap();
      await host.page.getByTestId('wake-overlay').waitFor({ state: 'visible' });
      await host.page.getByTestId('wake-retry').waitFor({ state: 'visible', timeout: 8_000 });
      const shownAfter = Date.now() - loadedAt;
      assert(shownAfter >= 2_900, `unreachable appeared before the 3 s budget (${shownAfter} ms after load)`);
      assert(await host.page.getByText("Server didn't wake up").isVisible(), 'unreachable title missing');
      notes.unreachableAfterMs = shownAfter;
      notes.unreachable = true;
      await closeContext(host);
    }

    phase = 'reduced-motion';
    {
      const { proxy } = await setup('hang', Infinity);
      const reduced = await open({ server: proxy.url, wakeTimeout: '30000' }, 'reduced-motion', {
        ...phone, reducedMotion: 'reduce',
      });
      await reduced.page.getByTestId('multiplayer').tap();
      await reduced.page.getByTestId('create-room').tap();
      await reduced.page.getByTestId('wake-overlay').waitFor({ state: 'visible' });
      assert(await reduced.page.getByTestId('wake-title').isVisible(), 'reduced-motion wake title hidden');
      assert(await reduced.page.locator('.wake-spinner').evaluate((node) => getComputedStyle(node).display === 'none'), 'spinner visible with reduced motion');
      const audit = await layoutAudit(reduced.page);
      assert(!audit.scrollOverflow, `reduced-motion wake overflow: ${JSON.stringify(audit)}`);
      notes.reducedMotion = true;
      await closeContext(reduced);
    }

    phase = 'solo-never-waits';
    {
      const { proxy } = await setup('hang', Infinity);
      const solo = await open({ server: proxy.url }, 'solo');
      await solo.page.getByTestId('singleplayer').tap();
      await solo.page.getByTestId('start-singleplayer').tap();
      await waitForGame(solo.page, 120_000);
      notes.soloNeverWaits = true;
      await closeContext(solo);
    }
  } finally {
    for (const context of pages) await context.close().catch(() => {});
    for (const { proxy, server } of resources.reverse()) {
      if (proxy) await proxy.close().catch(() => {});
      if (server) await server.stop().catch(() => {});
    }
  }

  phase = 'console-errors';
  // Expected noise: failed requests to the wake proxies. Chrome's 503 line carries no URL, so it is
  // allowed only in host-wakes, the one phase whose proxy answers 503.
  const expected = (line) => [...proxyPorts].some((port) => line.includes(`:${port}`))
    || (line.startsWith('[host-wakes]') && /status of 503 \(Service Unavailable\)/.test(line));
  const unexpected = errors.filter((line) => !expected(line));
  assert(unexpected.length === 0, `${unexpected.length} unexpected console/page error(s):\n${unexpected.join('\n')}`);
  notes.errors = errors;
}

await runTest('wake', async (browser, notes) => {
  try {
    await body(browser, notes);
  } catch (error) {
    notes.failedPhase = phase;
    throw new Error(`[${phase}] ${error?.message ?? error}`);
  }
});
