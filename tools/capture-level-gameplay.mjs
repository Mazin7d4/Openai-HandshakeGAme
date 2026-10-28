// Authored rooms photographed using the unmodified gameplay rig, at phone and desktop sizes.
// Teleports are only for choosing viewpoints; verify-heist tests the physical route separately.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, collectErrors, waitForGame } from './qa/lib.mjs';
import { freePort, startTestServer } from './test-server.mjs';
import { spawn } from 'node:child_process';

const out = process.argv[2] ?? '/workspace/handshake/playtest/oct26/codexA';
let base = process.argv[3];
mkdirSync(out, { recursive: true });
const browser = await launch();
const server = await startTestServer({ port: await freePort(), root: process.cwd() });
let vite;
if (!base) {
  const port = await freePort();
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    env: { ...process.env, VITE_COLYSEUS_URL: `ws://127.0.0.1:${server.port}` }, stdio: 'ignore',
  });
  base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* server starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const beats = [
  ['00-spawn', 0, 2.3, -62],
  ['01-apron-console', 0, 2.3, -58.8],
  ['02-reception', -2, 2.3, -50.8],
  ['02b-vent', -4.5, 6.4, -46.4],
  ['03-office', -2, 4.9, -37],
  ['03b-patch-bay', 4.3, 2.3, -34],
  ['04-shutter', -1, 2.3, -29],
  ['04b-server', 0, 3, -19, 'steal-prototype'],
  ['04c-catwalk', -2, 6.9, -8],
  ['05-lab', 0, 2.3, 8],
  ['05b-vault', 0, 5.3, 15],
  ['06-alarm', 0, 4, 21, 'escape'],
  ['06b-dock', 1, 3.5, 30],
  ['06c-extraction', 9, 2.3, 39.5],
];
const evidence = [];
try {
  for (const [width, height] of [[844, 390], [1280, 720]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 844 });
    const page = await context.newPage(); const errors = [];
    collectErrors(page, `${width}x${height}`, errors);
    await page.addInitScript(() => {
      localStorage.setItem('handshake.onboardingDone', '1');
      localStorage.setItem('handshake.controlsSeen', '1');
    });
    const u = new URL(base); u.searchParams.set('autotest', '1'); u.searchParams.set('quality', process.env.QUALITY ?? (width === 844 ? 'low' : 'medium'));
    u.searchParams.set('server', `ws://127.0.0.1:${server.port}`);
    await page.goto(u.toString()); await page.getByTestId('dev-local').click(); await waitForGame(page);
    await page.waitForFunction(() => window.__autotest?.presentationDiagnostics, null, { timeout: 60000 }).catch(error => { throw new Error(`${error.message} ${errors.join('; ')}`); });
    await page.addStyleTag({ content: '#dev-readout,#dev-controls,.controls-card {display:none!important}' });
    for (const [name, x, y, z, stage] of beats) {
      await page.evaluate(({ x, y, z, stage }) => {
        const t = window.__autotest;
        if (stage) t.debugStage(stage);
        for (const [role, dx] of [['pix', -1], ['nee', 1]]) {
          t.stop(role); t.teleport(role, x + dx, y, z); t.goto(role, x + dx, y, z, 0.25, true);
        }
      }, { x, y, z, stage });
      await page.waitForTimeout(stage ? 6500 : 3200);
      if (name === '00-spawn') await page.screenshot({ path: `${out}/${width}x${height}-00-spawn-hud.png` });
      await page.addStyleTag({ content: '.mission-objective,.onboarding-coach,.active-drone-hud,.juice-toasts,.interaction-prompt {visibility:hidden!important}' });
      const path = `${out}/${width}x${height}-${name}.png`;
      await page.screenshot({ path, timeout: 120000 });
      const stats = await page.evaluate(() => ({
        ...window.__autotest.presentationDiagnostics(), ...window.__autotest.cameraDiagnostics(),
        pix: window.__autotest.position('pix'), nee: window.__autotest.position('nee'),
      }));
      evidence.push({ path, ...stats });
      console.log(`${width}x${height} ${name}: ${stats.drawCalls} draws, eye ${stats.eyeY.toFixed(1)}`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    await context.close();
  }
} finally {
  writeFileSync(`${out}/gameplay-captures.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
  await server.stop();
  vite?.kill('SIGTERM');
}
