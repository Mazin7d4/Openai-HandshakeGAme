// Reproducible co-op phone probe. Usage: node tools/profile-network.mjs --own-servers before|after
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freePort, startTestServer } from './test-server.mjs';
import { launch, waitForGame, until } from './qa/lib.mjs';

if (!process.argv.includes('--own-servers')) throw new Error('--own-servers is required');
const label = process.argv.find((a) => /^(before|after)(-\w+)?$/.test(a)) ?? 'before';
const output = process.env.NET_PROFILE_OUT ?? '/workspace/handshake/sprint/netcode-agy/codex-big/followup';
mkdirSync(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
let server, vite, browser;
const metrics = { label, viewport: '390x844', cpuThrottle: 4, rendering: 'SwiftShader', errors: [] };
try {
  server = await startTestServer({ root, port: await freePort(), env: { HANDSHAKE_TEST_HOOKS: '1' } });
  const port = await freePort();
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  await until('Vite ready', async () => ({ ok: await fetch(base).then((r) => r.ok).catch(() => false) }), 30_000);
  browser = await launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const host = await desktop.newPage(), guest = await phone.newPage();
  guest.on('pageerror', (e) => metrics.errors.push(e.message));
  const cdp = await phone.newCDPSession(guest);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable'); await cdp.send('Network.enable');
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  const app = `${base}/?autotest=1&debug=1&lowfx&scale=4&server=ws://127.0.0.1:${server.port}`;
  await host.goto(app); await host.getByTestId('multiplayer').click(); await host.getByTestId('create-room').click();
  const code = (await host.getByTestId('room-code').innerText()).trim();
  const start = Date.now();
  await guest.goto(app); await guest.getByTestId('multiplayer').waitFor({ timeout: 120_000 });
  metrics.coldTitleMs = Date.now() - start;
  await guest.getByTestId('multiplayer').click(); await guest.getByTestId('join-room').click();
  await guest.getByTestId('room-code-input').fill(code);
  const joinAt = Date.now(); await guest.getByTestId('join-submit').click();
  await Promise.all([waitForGame(host, 180_000), waitForGame(guest, 180_000)]);
  metrics.joinToGameMs = Date.now() - joinAt; metrics.coldBytes = bytes;
  await guest.evaluate(async () => {
    const { RemoteControlSource } = await import('/src/control/RemoteControlSource.ts');
    const { MultiplayerSession } = await import('/src/network/MultiplayerSession.ts');
    window.__netProbe = {};
    for (const [type, proto, name] of [['remoteSample', RemoteControlSource.prototype, 'sample'], ['remotePush', RemoteControlSource.prototype, 'push'], ['readState', MultiplayerSession.prototype, 'readState']]) {
      const original = proto[name]; const stat = window.__netProbe[type] = { calls: 0, ms: 0 };
      proto[name] = function (...args) { const t = performance.now(); try { return original.apply(this, args); } finally { stat.calls++; stat.ms += performance.now() - t; } };
    }
  });
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  const perf0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await host.keyboard.down('d');
  const frames = await guest.evaluate(() => new Promise((resolve) => {
    const deltas = []; let last; const until = performance.now() + 12_000;
    function frame(t) { if (last !== undefined) deltas.push(t - last); last = t; if (performance.now() < until) requestAnimationFrame(frame); else resolve(deltas); }
    requestAnimationFrame(frame);
  }));
  await host.keyboard.up('d');
  const { profile } = await cdp.send('Profiler.stop');
  const { profile: heap } = await cdp.send('HeapProfiler.stopSampling');
  const perf1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  frames.sort((a,b) => a-b);
  metrics.frames = frames.length; metrics.fps = 1000 / (frames.reduce((a,b) => a+b,0)/frames.length);
  metrics.p50FrameMs = frames[Math.floor(frames.length*.5)]; metrics.p95FrameMs = frames[Math.floor(frames.length*.95)];
  metrics.handlers = await guest.evaluate(() => window.__netProbe);
  metrics.heapUsedBefore = perf0.JSHeapUsedSize; metrics.heapUsedAfter = perf1.JSHeapUsedSize;
  metrics.scriptMs = (perf1.ScriptDuration - perf0.ScriptDuration)*1000;
  const byId = new Map(profile.nodes.map((n) => [n.id,n])); const self = new Map();
  for (let i=0;i<profile.samples.length;i++) { const f=byId.get(profile.samples[i]).callFrame; const key=`${f.functionName} ${f.url.split('/').pop()}`; self.set(key,(self.get(key)??0)+profile.timeDeltas[i]/1000); }
  metrics.cpuTop = [...self].sort((a,b) => b[1]-a[1]).slice(0,20);
  metrics.gcMs = [...self].filter(([k]) => /garbage collector/i.test(k)).reduce((s,[,v])=>s+v,0);
  const allocations=[];
  function walk(n) { if(n.selfSize) allocations.push({ name:n.callFrame.functionName,url:n.callFrame.url.split('/').pop(),bytes:n.selfSize }); for(const c of n.children??[]) walk(c); }
  walk(heap.head); metrics.allocationsTop=allocations.sort((a,b)=>b.bytes-a.bytes).slice(0,20);
  metrics.networkAllocatedBytes = allocations.filter((n)=>/RemoteControlSource|SnapshotInterpolator|MultiplayerSession/.test(n.url)).reduce((s,n)=>s+n.bytes,0);
  // Isolate interpolation cost from software rendering, using the same phone/CPU throttle.
  metrics.remoteBenchmark = await guest.evaluate(async () => {
    const { RemoteControlSource } = await import('/src/control/RemoteControlSource.ts');
    const remote = new RemoteControlSource(() => 100); const state={ playerId:'probe',role:'nee',bot:false,connected:true,position:{x:0,y:4,z:0},velocity:{x:1,y:0,z:0},orientation:{yaw:0,pitch:0,roll:0},boost:'off',movement:'cruising',selfPowered:true,tetherPull:0,captured:false };
    remote.push(state); const start=performance.now(); for(let i=0;i<100000;i++)remote.sample(1/60); const sampleMs=performance.now()-start;
    const pushAt=performance.now(); for(let i=0;i<100000;i++)remote.push(state); return {iterations:100000,sampleMs,duplicatePushMs:performance.now()-pushAt};
  });
  writeFileSync(`${output}/profile-${label}.cpuprofile`, JSON.stringify(profile));
  writeFileSync(`${output}/profile-${label}.heapprofile`, JSON.stringify(heap));
  await guest.screenshot({ path:`${output}/profile-${label}-390x844.png` });
} finally {
  writeFileSync(`${output}/profile-${label}.json`,JSON.stringify(metrics,null,2));
  await browser?.close();
  if(vite && vite.exitCode===null) { const done=new Promise((resolve)=>vite.once('exit',resolve)); vite.kill('SIGTERM'); await done; }
  await server?.stop();
}
console.log(JSON.stringify(metrics));
