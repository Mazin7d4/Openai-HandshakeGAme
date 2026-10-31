import { runTest, url, assert, openPage, closePage, waitForGame, collectErrors, shot } from './lib.mjs';

await runTest('heist-presentation', async (browser, notes) => {
  const { page } = await openPage(browser, { viewport: { width: 1920, height: 1080 } });
  const errors = []; collectErrors(page, 'presentation', errors);
  await page.addInitScript(() => {
    localStorage.setItem('handshake.onboardingDone', '1');
    localStorage.setItem('handshake.controlsSeen', '1');
  });
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
  for (const material of [...before.screens, ...before.lockLights, ...before.circuits.filter(c => c.name.endsWith('-conduit'))]) {
    assert(!material.frozen, `dynamic cue frozen: ${material.name}`);
  }
  const darkCable = before.circuits.find(c => c.name === 'circuit-terminal-a-conduit');
  assert(darkCable.color[2] > 0 && darkCable.color[2] < 0.4, 'unpowered cable color was not initialized');
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
  await page.waitForTimeout(2500);
  await shot(page, 'presentation-console-locked');
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
  const liveCable = oneKey.circuits.find(c => c.name === 'circuit-terminal-a-conduit');
  assert(liveCable.color[2] > darkCable.color[2] * 3, 'completed console did not brighten its cable');
  assert(oneKey.screens.find(s => s.name.startsWith('terminal-a')).color[1] > 0.5, 'completed screen did not change color');
  await shot(page, 'presentation-console-powered');
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
  const opened = await page.evaluate(() => window.__autotest.presentationDiagnostics());
  const lock = opened.lockLights.find(l => l.name === 'office-access-shutter-lock-state');
  assert(lock && lock.color[1] > lock.color[0] * 3, 'open door lock did not turn green');
  await page.evaluate(() => {
    window.__autotest.teleport('pix', -2, 2.3, -30);
    window.__autotest.teleport('nee', 0, 2.3, -30);
  });
  await page.waitForTimeout(1500);
  await shot(page, 'presentation-door-open');
  await page.evaluate(() => window.__autotest.debugStage('steal-prototype'));
  await page.waitForFunction(() => window.__autotest.presentationDiagnostics().lintels.some(l => l.name.endsWith('G3') && l.lit));
  await page.evaluate(() => window.__autotest.debugStage('escape'));
  await page.waitForFunction(() => {
    const lights = window.__autotest.presentationDiagnostics().lintels;
    return lights.some(l => l.name.endsWith('G3') && !l.lit) && lights.some(l => l.name.endsWith('G4') && l.lit);
  });
  assert(!errors.length, errors.join('\n'));
  notes.lesson = true; notes.independentKeys = true; notes.proximity = true; notes.lockedStrips = true;
  await page.goto(url({ mode: 'nightshift', seed: '1', floor: '6', bot: '1' }));
  await waitForGame(page);
  await page.waitForFunction(() => window.__autotest?.presentationDiagnostics().circuits.filter(c => c.source).length === 3);
  const seeded = await page.evaluate(() => window.__autotest.presentationDiagnostics());
  for (const terminal of seeded.terminals) {
    const wire = seeded.circuits.find(c => c.name === `circuit-${terminal.id}-conduit`);
    assert(wire?.source && Math.hypot(wire.source.x - terminal.x, wire.source.y - terminal.y, wire.source.z - terminal.z) < 0.01,
      `seeded cable detached from ${terminal.id}: ${JSON.stringify(wire?.source)} vs ${JSON.stringify(terminal)}`);
  }
  assert(seeded.terminals.some(t => before.terminals.some(old => old.id === t.id && Math.hypot(old.x - t.x, old.z - t.z) > 1)), 'test did not relocate any console');
  notes.seededCircuits = true;
  await closePage(page);
});
