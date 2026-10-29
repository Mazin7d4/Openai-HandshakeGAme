// Reproducible art evidence using the shipping follow camera and isolated browser storage.
// ART_PREFIX=before|final ART_TIERS=low,medium ART_FLOORS=2,3,... ART_RES=1280x720,844x390
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launch, waitForGame } from './qa/lib.mjs';
const out = process.env.ART_OUT ?? '/workspace/handshake/playtest/oct26/art';
const prefix = process.env.ART_PREFIX ?? 'final';
const base = process.env.ART_URL ?? 'http://127.0.0.1:5182/';
const spotFilter = process.env.ART_SPOTS?.split(',');
const tiers = (process.env.ART_TIERS ?? 'low,medium').split(',');
const sizes = (process.env.ART_RES ?? '1280x720,844x390').split(',');
const floors = (process.env.ART_FLOORS ?? '2,3,4,5,6,7,8,9,10,11,12').split(',').filter(Boolean).map(Number);
const spots = [
  ['apron', 0, 2.8, -61], ['reception', 0, 4.7, -51.7],
  ['vent', -5, 6.3, -46.5], ['office', 0, 4.8, -37.5],
  ['strip-locked', -1, 3, -30], ['server', 0, 3.4, -14],
  ['memory-array', 0, 5, -7], ['lab', 0, 4.8, 13], ['dock', 9, 3.2, 40],
];
mkdirSync(out, { recursive: true });
const browser = await launch();
const metricsPath = `${out}/${prefix}-${tiers.join('-')}-${sizes.join('-')}-metrics.json`;
const records = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, 'utf8')).filter(row => row.drawCalls != null) : [];
const done = (tier,res,spot) => records.some(row => row.tier === tier && row.res === res && row.spot === spot);
async function ready(page) {
  await waitForGame(page);
  await page.waitForFunction(() => !!window.__autotest?.teleport, null, { timeout: 120000 });
  const skip = page.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.count()) await skip.first().click().catch(() => {});
  await page.waitForTimeout(1600);
  await page.addStyleTag({ content: '#dev-readout,#dev-controls,.controls-card,[data-testid="controls-card"],[data-testid="floor-card"],[data-testid="juice-toasts"]{display:none!important}' });
}
async function capture(page, tier, res, spot, point) {
  if (point) await page.evaluate(([x,y,z]) => {
    for (const [role,dx] of [['pix',-1.35],['nee',1.35]]) {
      window.__autotest.teleport(role,x+dx,y,z);
      window.__autotest.goto(role,x+dx,y,z,0.25,true);
    }
  }, point);
  await page.waitForTimeout(1100);
  const stats = await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource');
    const storeUrl = resources.find(e => /\/engineStore-[^/]+\.js/.test(e.name))?.name
      ?? resources.find(e => /@babylonjs_core_Engines_engine__js\.js/.test(e.name))?.name;
    if (!storeUrl) throw new Error('Runtime EngineStore module not found');
    const storeModule = await import(storeUrl);
    const EngineStore = Object.values(storeModule).find(value => value?.LastCreatedScene);
    const scene = EngineStore.LastCreatedScene;
    if (!scene) throw new Error('Runtime scene not found');
    window.__artScene = scene;
    const counter = scene.getEngine()._drawCalls;
    const deltas = [];
    let previous = performance.now();
    const before = scene.onBeforeAnimationsObservable.add(() => counter.fetchNewFrame());
    const frames = [];
    await new Promise(resolve => {
      const observer = scene.onAfterRenderObservable.add(() => {
        frames.push(counter.current);
        const now = performance.now(); deltas.push(now - previous); previous = now;
        if (frames.length === 8) { scene.onAfterRenderObservable.remove(observer); resolve(); }
      });
    });
    const result = { drawCalls: Math.max(...frames), frameMs: +(deltas.slice(1).reduce((a,b)=>a+b,0)/(deltas.length-1)).toFixed(2), fps: +scene.getEngine().getFps().toFixed(1),
      floorDrawCalls: window.__floorPlan?.drawCalls ?? 0, bodies: window.__floorPlan?.bodies ?? null,
      eyeY: scene.activeCamera.position.y, tier: document.documentElement.dataset.quality,
      drones: ['pix','nee'].map(role => window.__autotest?.position(role)),
      lights: scene.lights.filter(l => l.isEnabled()).map(l=>l.name),
      renderSize: [scene.getEngine().getRenderWidth(), scene.getEngine().getRenderHeight()],
      maxMaterialLights: Math.max(...scene.materials.map(m=>m.maxSimultaneousLights ?? 0)),
      maxAffectingLights: Math.max(...scene.meshes.filter(m=>m.isVisible && m.isEnabled()).map(m=>scene.lights.filter(l=>l.isEnabled() && l.canAffectMesh(m)).length)),
      decorGlow: scene.meshes.filter(m=> /^(decor-|dressing-|Hero_|boss-vault|memory-array|morrow-disc|instrument-screen)/.test(m.name) && m.material)
        .filter(m=>{const a=m.material; return (a.emissiveIntensity ?? 1) > 0 && (a.emissiveColor?.r + a.emissiveColor?.g + a.emissiveColor?.b > 0.001 || a.emissiveTexture);}).map(m=>m.name),
      presentation: window.__autotest.presentationDiagnostics?.() };
    scene.onBeforeAnimationsObservable.remove(before); return result;
  });
  await page.evaluate(() => {
    window.__artEngine = window.__artScene.getEngine();
    window.__artRenderLoops = [...window.__artEngine.activeRenderLoops];
    window.__artEngine.stopRenderLoop();
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${prefix}-${tier}-${res}-${spot}.png`, timeout: 120000 });
  await page.evaluate(() => { for (const fn of window.__artRenderLoops ?? []) window.__artEngine.runRenderLoop(fn); });
  records.push({ tier, res, spot, ...stats });
  writeFileSync(metricsPath, JSON.stringify(records,null,2));
  console.log(JSON.stringify(records.at(-1)));
}
try {
  for (const tier of tiers) for (const res of sizes) {
    const [width,height] = res.split('x').map(Number);
    const ctx = await browser.newContext({ viewport: {width,height} });
    await ctx.addInitScript(() => { localStorage.setItem('handshake.onboardingDone','1'); localStorage.setItem('handshake.controlsSeen','1'); });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.error('PAGE ERROR', e.message));
    const url = new URL(base); url.search = new URLSearchParams({quality:tier,debug:'1',autotest:'1'}).toString();
    await page.goto(url.toString());
    await page.waitForTimeout(2500);
    await page.screenshot({path:`${out}/${prefix}-${tier}-${res}-title.png`});
    if (process.env.ART_ONLY !== 'floors') {
      await page.getByTestId('dev-local').click(); await ready(page);
      for (const [spot,...point] of spots) if ((!spotFilter || spotFilter.includes(spot)) && !done(tier,res,spot)) await capture(page,tier,res,spot,point);
      await page.evaluate(() => window.__autotest.debugStage('steal-prototype'));
      if ((!spotFilter || spotFilter.includes('strip-unlocked')) && !done(tier,res,'strip-unlocked')) await capture(page,tier,res,'strip-unlocked',[-1,3,-30]);
    }
    for (const floor of floors) {
      if (done(tier,res,`nightshift-floor${floor}`) || process.env.ART_BASELINE === '1' && res === '844x390') continue;
      url.searchParams.set('mode','nightshift'); url.searchParams.set('seed','0'); url.searchParams.set('floor',String(floor)); url.searchParams.set('bot','1');
      await page.goto(url.toString()); await ready(page);
      await page.waitForTimeout(1500);
      await capture(page,tier,res,`nightshift-floor${floor}`,[0,4.8,13]);
    }
    if (process.env.ART_ONLY === 'floors') { await ctx.close(); continue; }
    url.searchParams.set('report','1'); url.searchParams.delete('mode');
    await page.goto(url.toString());
    await page.getByTestId('mission-complete').waitFor({state:'visible',timeout:30000});
    await page.waitForTimeout(1200);
    await page.screenshot({path:`${out}/${prefix}-${tier}-${res}-report.png`});
    await ctx.close();
  }
} finally { await browser.close(); }
