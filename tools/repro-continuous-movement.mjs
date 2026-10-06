import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5190/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const events = [];
page.on('pageerror', (error) => events.push(`pageerror ${error.stack ?? error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') events.push(`${message.type()} ${message.text()}`);
});
try {
  await page.goto(url);
  await page.getByTestId('dev-local').click();
  await page.locator('#boot-status').waitFor({ state: 'detached', timeout: 30_000 });
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  for (let second = 0; second < 25; second++) {
    await page.waitForTimeout(1_000);
    const readout = await page.locator('#dev-readout').innerText();
    const player = readout.split('\n').find((line) => line.startsWith('player-1'));
    const diagnostics = readout.split('\n')[0];
    console.log(`${second + 1}s ${diagnostics} ${player}`);
    if (!readout.includes('errors 0') || /NaN|Infinity/.test(readout)) break;
  }
  await page.keyboard.up('Shift');
  await page.keyboard.up('w');
  console.log(JSON.stringify({ events }, null, 2));
} finally {
  await browser.close();
}
