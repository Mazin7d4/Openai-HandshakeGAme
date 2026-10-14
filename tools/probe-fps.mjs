import { chromium } from 'playwright';
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p = await b.newPage({viewport:{width:1280,height:720}});
await p.goto(process.argv[2]); await p.getByTestId('dev-local').click();
await p.locator('#boot-status').waitFor({state:'detached',timeout:60000}); await p.waitForTimeout(5000);
console.log((await p.locator('#dev-readout').innerText()).split('\n')[0]); await b.close();
