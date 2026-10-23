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

await runTest('mobile-layout', async (browser, notes) => {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  collectErrors(page, 'mobile-layout', errors);

  await page.goto(url({ play: 'solo' }));
  await waitForGame(page);
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
