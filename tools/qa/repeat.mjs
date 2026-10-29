// Reproduce load-sensitive regressions without sharing ports or touching other teams' processes.
// QA_LOG_DIR=/absolute/out node tools/qa/repeat.mjs [--load] [--count=5] [tests...]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const count = Number(args.find((a) => a.startsWith('--count='))?.slice(8) ?? 5);
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('--count must be 1..20');
const load = args.includes('--load');
const names = args.filter((a) => !a.startsWith('--'));
if (!names.length) names.push('phone-ui', 'reconnect', 'mobile', 'governor', 'gamepad');
if (!process.env.QA_LOG_DIR) throw new Error('QA_LOG_DIR must name an external evidence directory');
const out = resolve(process.env.QA_LOG_DIR);
mkdirSync(out, { recursive: true });
const busy = [];
let current;
let stopped = false;
const stopBusy = () => { for (const child of busy) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopped = true; current?.kill('SIGTERM'); stopBusy(); });
process.once('exit', stopBusy);
try {
  if (load) for (let i = 0; i < 8; i++) busy.push(spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
  writeFileSync(`${out}/busy-pids.json`, JSON.stringify({ started: new Date().toISOString(), pids: busy.map((c) => c.pid) }, null, 2));
  for (let run = 1; run <= count && !stopped; run++) {
    const path = `${out}/run-${run}.log`;
    const fd = openSync(path, 'w');
    const started = Date.now();
    let code;
    try {
      current = spawn('timeout', ['900', process.execPath, 'tools/qa/run.mjs', '--own-servers', ...names], {
        env: { ...process.env, QA_RESULTS_FILE: `${out}/results.jsonl`, QA_SHOTS: `${out}/shots-${run}` },
        stdio: ['ignore', fd, fd],
      });
      code = await new Promise((resolve, reject) => { current.once('error', reject); current.once('close', resolve); });
    } finally { closeSync(fd); current = undefined; }
    console.log(`${load ? 'LOAD8' : 'NORMAL'} run ${run}/${count}: exit=${code}, seconds=${Math.round((Date.now() - started) / 1000)}, log=${path}`);
    if (code !== 0) throw new Error(`run ${run} failed; inspect ${path}`);
  }
  if (stopped) throw new Error('repeat run interrupted');
} finally {
  stopBusy();
  await Promise.all(busy.map((child) => child.exitCode !== null || child.signalCode !== null ? undefined : new Promise((resolve) => child.once('close', resolve))));
  writeFileSync(`${out}/busy-stopped.json`, JSON.stringify({ stopped: new Date().toISOString(), pids: busy.map((c) => ({ pid: c.pid, exitCode: c.exitCode, signal: c.signalCode })) }, null, 2));
}
