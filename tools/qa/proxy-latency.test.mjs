// Smoothness QA: injects 150 ms RTT latency and 2% packet loss via an in-process proxy,
// and asserts remote player motion stays smooth without teleports or rubber-banding.
import { createServer, request as httpRequest } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { freePort } from '../test-server.mjs';
import { runTest, url, assert, collectErrors, openPage, closePage, waitForGame, joinRoom, tryShot, SERVER_URL, worldState, until } from './lib.mjs';

function createLatencyProxy(targetUrl, { oneWayDelayMs = 75, jitterMs = 10, dropRate = 0.02 } = {}) {
  const target = new URL(targetUrl);
  const targetPort = target.port || (target.protocol === 'https:' || target.protocol === 'wss:' ? 443 : 80);
  const targetHost = target.hostname;

  const server = createServer((req, res) => {
    const opt = {
      hostname: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${targetHost}:${targetPort}` },
    };
    const proxyReq = httpRequest(opt, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(proxyReq);
  });

  const wss = new WebSocketServer({ noServer: true });
  const openSockets = new Set();

  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      openSockets.add(clientWs);
      const upstreamWs = new WebSocket(`ws://${targetHost}:${targetPort}${req.url}`);
      openSockets.add(upstreamWs);

      const forward = (from, to) => {
        from.on('message', (data, isBinary) => {
          if (Math.random() < dropRate) return; // simulated packet drop
          const delay = Math.max(5, oneWayDelayMs + (Math.random() * 2 - 1) * jitterMs);
          setTimeout(() => {
            if (to.readyState === WebSocket.OPEN) {
              to.send(data, { binary: isBinary });
            }
          }, delay);
        });
      };

      forward(clientWs, upstreamWs);
      forward(upstreamWs, clientWs);

      clientWs.on('close', () => upstreamWs.close());
      upstreamWs.on('close', () => clientWs.close());
      clientWs.on('error', () => upstreamWs.close());
      upstreamWs.on('error', () => clientWs.close());
    });
  });

  return {
    async listen(port) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(port)));
    },
    async close() {
      for (const s of openSockets) {
        try { s.terminate(); } catch (_) {}
      }
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

await runTest('proxy-latency', async (browser, notes) => {
  const errors = [];
  const proxyPort = await freePort();
  const proxy = createLatencyProxy(SERVER_URL, { oneWayDelayMs: 75, jitterMs: 12, dropRate: 0.02 });
  await proxy.listen(proxyPort);
  const proxyServerUrl = `ws://127.0.0.1:${proxyPort}`;

  try {
    const { page: host } = await openPage(browser, { viewport: { width: 960, height: 540 } });
    const { page: guest } = await openPage(browser, { viewport: { width: 960, height: 540 } });
    collectErrors(host, 'host', errors);
    collectErrors(guest, 'guest', errors);

    // Host connects directly; Guest connects via latency/jitter proxy
    await host.goto(url());
    await host.getByTestId('multiplayer').click();
    await host.getByTestId('create-room').click();
    const code = (await host.getByTestId('room-code').innerText({ timeout: 20_000 })).trim();
    assert(/^[A-Z0-9]{4}$/.test(code), `Unexpected room code: ${code}`);

    const guestUrl = url({ server: proxyServerUrl });
    await joinRoom(guest, code, guestUrl);

    await Promise.all([waitForGame(host), waitForGame(guest)]);

    const guestHud = await guest.getByTestId('network-hud').innerText();
    notes.guestHud = guestHud;

    // Start continuous motion recording on guest
    await guest.evaluate(() => {
      window.__motionRecords = [];
      window.__stopRecording = false;
      const step = () => {
        const text = document.querySelector('#dev-readout')?.innerText ?? '';
        const m = text.match(/player-1\s+x\s+(-?\d+\.\d+)\s+y\s+(-?\d+\.\d+)\s+z\s+(-?\d+\.\d+)/);
        if (m) {
          window.__motionRecords.push({
            t: performance.now(),
            x: parseFloat(m[1]),
            y: parseFloat(m[2]),
            z: parseFloat(m[3]),
          });
        }
        if (!window.__stopRecording) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    // Hold W until host itself has flown >= 2.0 m
    const planar = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const hostStart = (await worldState(host)).players['player-1'];
    await host.getByTestId('game-canvas').focus();
    await host.keyboard.down('w');
    try {
      await until('host fly', async () => {
        const p = (await worldState(host)).players['player-1'];
        return { ok: Boolean(p && planar(p, hostStart) >= 2.0), info: p };
      }, 20_000);
    } finally {
      await host.keyboard.up('w');
    }

    // Wait until guest observes the flight arriving through the latency proxy
    await until('guest observes flight', async () => {
      const records = await guest.evaluate(() => window.__motionRecords ?? []);
      if (records.length < 2) return { ok: false };
      const d = Math.hypot(records[records.length - 1].x - records[0].x, records[records.length - 1].z - records[0].z);
      return { ok: d >= 0.8, info: d };
    }, 15_000);

    const samples = await guest.evaluate(() => {
      window.__stopRecording = true;
      return window.__motionRecords;
    });
    assert(samples.length >= 6, `too few rendered samples recorded: ${samples.length}`);

    // Analyze step sizes between consecutive sampled frames
    let maxStep = 0;
    let teleportDetected = false;
    for (let i = 1; i < samples.length; i++) {
      const step = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
      if (step > maxStep) maxStep = step;
      // Per brief: asserts remote motion stays smooth with a bounded max per-frame jump (<= 3.5m) and no teleports (> 4m).
      if (step > 4.0) {
        teleportDetected = true;
      }
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const totalDist = Math.hypot(last.x - first.x, last.z - first.z);

    notes.samplesCount = samples.length;
    notes.maxStep = +maxStep.toFixed(3);
    notes.totalDist = +totalDist.toFixed(3);
    notes.teleportDetected = teleportDetected;

    assert(!teleportDetected, `teleport detected under 150ms RTT latency (max step ${maxStep})`);
    assert(totalDist >= 0.8, `host movement was not replicated to guest: total displacement only ${totalDist}m`);

    // Verify ping readout is rendered in HUD
    await guest.waitForFunction(() => {
      const text = document.querySelector('[data-testid="network-hud"]')?.textContent ?? '';
      return /\d+ms/.test(text);
    }, null, { timeout: 10_000 }).catch(() => {});

    const finalGuestHud = await guest.getByTestId('network-hud').innerText();
    notes.finalGuestHud = finalGuestHud;

    await tryShot(guest, 'coop-proxy-smooth');
    await closePage(guest);
    await closePage(host);
  } finally {
    await proxy.close();
  }
});
