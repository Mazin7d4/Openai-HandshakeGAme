// Phone layout contract: pause, embedded Settings, and Heist Report at 360×640.
import { runTest, url, assert, collectErrors, waitForGame } from './lib.mjs';

async function audit(page, label) {
  const result = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const visible = [...document.querySelectorAll('button')].filter((button) => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    });
    return {
      wide: [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > vw + 1 && getComputedStyle(el).display !== 'none').slice(0, 5).map((el) => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')}:${Math.round(el.getBoundingClientRect().right)}`),
      overflow: document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1,
      buttons: visible.map((button) => {
        const box = button.getBoundingClientRect();
        return { label: button.textContent?.trim() ?? '', height: box.height, left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      }),
    };
  });
  assert(!result.overflow, `${label}: horizontal overflow ${result.wide.join(' ')}`);
  for (const button of result.buttons) {
    assert(button.height >= 48, `${label}: ${button.label} is ${button.height}px tall`);
    assert(button.left >= -1 && button.top >= -1 && button.right <= 361 && button.bottom <= 641,
      `${label}: ${button.label} is outside viewport ${JSON.stringify(button)}`);
  }
  return result;
}

async function auditGameplayOverlay(page, label) {
  const result = await page.evaluate(() => {
    const overlap = (a, b) => a && b && a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
    const coach = document.querySelector('[data-testid="onboarding-coach"]');
    const prompt = document.querySelector('[data-testid="interaction-prompt"]');
    const rotate = document.querySelector('[data-testid="touch-rotate-hint"]');
    const visible = (el) => el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && Number.parseFloat(getComputedStyle(el).opacity) > 0;
    const coachBox = visible(coach) ? coach.getBoundingClientRect() : null;
    const promptBox = visible(prompt) ? prompt.getBoundingClientRect() : null;
    const rotateBox = visible(rotate) ? rotate.getBoundingClientRect() : null;
    const rotateCenter = rotateBox && document.elementFromPoint(rotateBox.left + rotateBox.width / 2, rotateBox.top + rotateBox.height / 2);
    return {
      overlap: overlap(coachBox, promptBox),
      rotateTopmost: !rotateBox || (rotateCenter && (rotateCenter === rotate || rotate.contains(rotateCenter))),
      rotateZ: rotate ? getComputedStyle(rotate).zIndex : null,
      rootZ: rotate?.parentElement ? getComputedStyle(rotate.parentElement).zIndex : null,
      coach: coachBox && { top: coachBox.top, bottom: coachBox.bottom },
      prompt: promptBox && { top: promptBox.top, bottom: promptBox.bottom },
    };
  });
  assert(!result.overlap, `${label}: tutorial and interaction prompt overlap ${JSON.stringify(result)}`);
  assert(result.rotateTopmost, `${label}: rotate overlay is not topmost ${JSON.stringify(result)}`);
}

await runTest('mobile-layout', async (browser, notes) => {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  collectErrors(page, 'mobile-layout', errors);

  await page.goto(url({ play: 'solo' }));
  await waitForGame(page);
  await auditGameplayOverlay(page, 'portrait gameplay');
  await page.getByTestId('touch-pause').tap();
  notes.pause = await audit(page, 'pause');
  await page.getByTestId('pause-settings').tap();
  notes.settings = await audit(page, 'settings');
  await page.getByTestId('settings-back').tap();
  await page.getByTestId('pause-resume').tap();
  await context.close();

  const reportContext = await browser.newContext({ viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  const report = await reportContext.newPage();
  collectErrors(report, 'report', errors);
  await report.goto(url({ report: '1' }));
  await report.getByTestId('mission-complete').waitFor({ state: 'visible' });
  notes.report = await audit(report, 'report');
  notes.errors = errors;
  assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
  await reportContext.close();
});
