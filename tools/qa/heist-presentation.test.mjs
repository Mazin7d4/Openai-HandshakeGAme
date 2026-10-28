import { runTest, url, assert, openPage, closePage, waitForGame, collectErrors } from './lib.mjs';

await runTest('heist-presentation', async (browser, notes) => {
  const { page } = await openPage(browser);
  const errors = []; collectErrors(page, 'presentation', errors);
  await page.goto(url());
  await page.getByTestId('dev-local').click();
  await waitForGame(page);
  await page.waitForFunction(() => window.__autotest);
  const diagnostics = await page.evaluate(() => window.__autotest.cameraDiagnostics());
  assert(diagnostics.objectiveMarkers.length === 0, `objective markers remain: ${diagnostics.objectiveMarkers}`);
  const objective = await page.getByTestId('mission-objective').innerText();
  assert(objective.length > 5, 'objective HUD data missing');
  notes.objective = objective;
  const before = await page.evaluate(() => window.__autotest.presentationDiagnostics());
  assert(before.doors.some(door => door.name === 'arrival-delivery-door' && !door.open), 'teaching door starts open');
  const warm = id => `exit-lintel-strip-${id}`;
  assert(before.lintels.some(light => light.name === warm('G2') && !light.lit), 'office strip lit while locked');
  await page.evaluate(() => {
    window.__autotest.teleport('pix', -1, 2.3, -58.5);
    window.__autotest.teleport('nee', 1, 2.3, -58.5);
  });
  await page.waitForFunction(() => {
    const s = window.__autotest.presentationDiagnostics();
    return s.doors.some(d => d.name === 'arrival-delivery-door' && d.open && d.y < -3.9)
      && s.circuits.filter(c => c.name.startsWith('circuit-arrival-')).every(c => c.powered);
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__autotest.teleport('pix', -4, 5.4, -35.3);
    window.__autotest.teleport('nee', -2, 5.4, -35.3);
  });
  const baseBlue = before.screens.find(s => s.name.startsWith('terminal-a')).color[2];
  await page.waitForFunction(base => window.__autotest.presentationDiagnostics().screens.find(s => s.name.startsWith('terminal-a')).color[2] > base * 1.15, baseBlue);
  await page.evaluate(() => window.__autotest.debugOpenHack('packet-routing'));
  const packet = page.getByTestId('packet-routing');
  await packet.waitFor({ state: 'visible' });
  for (let i = 0; i < 16; i++) for (let turn = 0; turn < 4; turn++) {
    if (!await packet.isVisible()) break;
    const node = packet.locator(`[data-index="${i}"]`);
    const target = await node.getAttribute('data-solution-mask').catch(() => null);
    const value = await node.getAttribute('data-mask').catch(() => null);
    if (!Number(target) || value === target) break;
    await node.click();
  }
  await packet.waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__autotest.presentationDiagnostics().circuits.some(c => c.name === 'circuit-terminal-a-lamp' && c.powered));
  const oneKey = await page.evaluate(() => window.__autotest.presentationDiagnostics());
  assert(oneKey.circuits.filter(c => c.name.startsWith('circuit-terminal-b-')).every(c => !c.powered), 'one key powered the other circuit');
  assert(oneKey.doors.some(d => d.name === 'office-access-shutter' && !d.open), 'one key opened two-key shutter');
  await page.evaluate(() => window.__autotest.debugOpenHack('signal-match'));
  const signal = page.getByTestId('signal-match'); await signal.waitFor({ state: 'visible' });
  await signal.locator('[data-control="frequency"]').fill(await signal.getAttribute('data-target-frequency'));
  await signal.locator('[data-control="amplitude"]').fill(await signal.getAttribute('data-target-amplitude'));
  await signal.waitFor({ state: 'detached' });
  await page.waitForFunction(() => {
    const s = window.__autotest.presentationDiagnostics();
    return s.doors.some(d => d.name === 'office-access-shutter' && d.open && d.y < -3.9)
      && s.lintels.some(l => l.name.endsWith('G2') && l.lit)
      && s.lintels.some(l => l.name.endsWith('G3') && !l.lit);
  }, null, { timeout: 30000 });
  await page.evaluate(() => window.__autotest.debugStage('steal-prototype'));
  await page.waitForFunction(() => window.__autotest.presentationDiagnostics().lintels.some(l => l.name.endsWith('G3') && l.lit));
  await page.evaluate(() => window.__autotest.debugStage('escape'));
  await page.waitForFunction(() => {
    const lights = window.__autotest.presentationDiagnostics().lintels;
    return lights.some(l => l.name.endsWith('G3') && !l.lit) && lights.some(l => l.name.endsWith('G4') && l.lit);
  });
  assert(!errors.length, errors.join('\n'));
  notes.lesson = true; notes.independentKeys = true; notes.proximity = true; notes.lockedStrips = true;
  await closePage(page);
});
