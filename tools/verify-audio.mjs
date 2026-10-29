// Audio smoke test: the hub unlocks on a real click, every event starts a sound, music/alarm/hum run in a
// solo game, and there are no console errors. Optional: --preview <file.webm> records a listening mix.
import { launch } from './qa/lib.mjs';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const previewAt = args.indexOf('--preview');
const preview = previewAt >= 0 ? args[previewAt + 1] : null;
const RAW = args.find((a, i) => !a.startsWith('--') && !(previewAt >= 0 && i === previewAt + 1)) ?? process.env.APP_URL ?? 'http://localhost:5173/?scale=4&lowfx';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const result = {};
try {
  await page.goto(RAW);
  result.beforeGesture = await page.evaluate(() => window.__pixAudio?.debugState() ?? 'not created (expected before a gesture)');
  await page.getByTestId('singleplayer').hover();
  await page.getByTestId('singleplayer').click(); // real gesture -> unlock + uiConfirm
  await page.waitForFunction(() => window.__pixAudio?.ctx?.state === 'running', null, { timeout: 10_000 });
  result.spriteReady = await page.evaluate(() => window.__pixAudio.ready());
  await page.getByTestId('start-singleplayer').hover();
  await page.waitForTimeout(200);

  if (preview) {
    // Listening mix, real time (~75 s). Recorded from the limiter output.
    const b64 = await page.evaluate(async () => {
      const a = window.__pixAudio; const stream = a.captureStream();
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
      const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data); rec.start();
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const seq = async (events, gap = 600) => { for (const [e, o] of events) { a.play(e, o ?? {}); await wait(gap); } };
      await seq([['uiHover'], ['uiHover'], ['uiClick'], ['uiConfirm'], ['uiBack'], ['uiToggle'], ['uiError']], 450);
      for (const role of ['pix', 'nee']) await seq(['neutral', 'happy', 'proud', 'focused', 'shocked', 'strained', 'yanked', 'panic', 'dizzy', 'stunned'].map((m) => ['chirp', { role, mood: m }]), 420);
      for (const role of ['pix', 'nee']) { // thruster ramp idle -> cruise -> idle
        for (let i = 0; i <= 40; i++) { a.setDroneMotion(role, 12 * Math.sin(Math.PI * i / 40), { x: 0, y: 0, z: 0 }, true); await wait(50); }
        a.endSession(); await wait(400);
      }
      for (let i = 0; i <= 50; i++) { a.setTension(Math.min(1, i / 40)); await wait(40); } // stretch -> snap
      await wait(300); a.setTension(0.1); await wait(700); a.endSession();
      await seq([['twang', { intensity: 0.2 }], ['twang', { intensity: 0.6 }], ['twang', { intensity: 1 }], ['yank', { intensity: 0.8 }], ['yanked'], ['slingshot'], ['bump'], ['boost']], 650);
      await seq([['impact', { intensity: 0.15 }], ['impact', { intensity: 0.5 }], ['impact', { intensity: 0.95 }], ['grab'], ['drop'], ['throw']], 600);
      await seq([['hackStart'], ...[0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => ['hackTick', { progress: p }]), ['hackSuccess'], ['hackFail']], 350);
      await seq([['suspicious'], ['spotted', { role: 'pix', position: { x: -20, y: 0, z: 0 } }], ['spotted', { role: 'nee', position: { x: 20, y: 0, z: 0 } }], ['stun'], ['cameraBlind'], ['capture'], ['rescue'], ['vaultOpen']], 1100);
      a.beginSession(); await wait(9000); // calm music + room tone
      a.play('theft'); await wait(2200);
      for (const st of [1, 2, 3]) { a.setAlarmStage(st); await wait(5000); }
      a.play('extract'); await wait(4500);
      rec.stop(); await new Promise((r) => (rec.onstop = r));
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    writeFileSync(preview, Buffer.from(b64, 'base64'));
    result.preview = preview;
    await page.evaluate(() => window.__pixAudio.endSession());
  }

  // Every event must start at least one voice.
  result.events = await page.evaluate(async () => {
    const a = window.__pixAudio; const out = {};
    const names = ['uiHover', 'uiClick', 'uiConfirm', 'uiBack', 'uiToggle', 'uiError', 'twang', 'snap', 'yank', 'yanked', 'slingshot', 'bump', 'boost', 'impact', 'grab', 'drop', 'throw', 'hackStart', 'hackTick', 'hackSuccess', 'hackFail', 'suspicious', 'spotted', 'stun', 'cameraBlind', 'capture', 'rescue', 'vaultOpen', 'doorMotor', 'theft', 'extract', 'chirp'];
    for (const n of names) {
      const before = Object.values(a.stats).reduce((s, v) => s + v, 0);
      a.play(n, { intensity: 0.7, role: 'nee', mood: 'happy', position: { x: 3, y: 0, z: 0 } });
      const after = Object.values(a.stats).reduce((s, v) => s + v, 0);
      out[n] = after > before;
      await new Promise((r) => setTimeout(r, 30));
    }
    a.setAlarmStage(2); out.alarmStage = a.alarmStage === 2; a.setAlarmStage(0);
    return out;
  });
  result.missingEvents = Object.entries(result.events).filter(([, ok]) => !ok).map(([n]) => n);

  // Solo game: hum, music and room tone run from the real game loop.
  await page.getByTestId('start-singleplayer').click();
  await page.getByTestId('game-canvas').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => { const s = window.__pixAudio.debugState(); return s.musicPlaying && s.hums.length === 2; }, null, { timeout: 60_000, polling: 500 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  result.inGame = await page.evaluate(() => window.__pixAudio.debugState());
  await page.keyboard.press('KeyM');
  result.mutedAfterM = await page.evaluate(() => window.__pixAudio.isMuted);
  await page.keyboard.press('KeyM');
  result.errors = errors;
  const g = result.inGame;
  result.pass = result.spriteReady && result.missingEvents.length === 0 && g.musicPlaying && g.hums.length === 2 && g.ambience
    && result.mutedAfterM === true && errors.length === 0;
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
} finally { await browser.close(); }
