// Regression: an exited test's descendant can retain stdout and ignore SIGTERM.
import { readFileSync } from 'node:fs';
import { runQaProcess } from './process.mjs';

const started = Date.now();
const result = { test: 'qa-deadline', pass: false, notes: {} };
try {
  const descendant = `process.on('SIGTERM', () => {}); console.log('QA_RESULT ' + JSON.stringify({ pass: true, notes: { pid: process.pid } })); setInterval(() => {}, 1000);`;
  const parent = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' }); child.once('spawn', () => process.exit(0));`;
  const timed = await runQaProcess('hung-fixture', { root: process.cwd(), timeoutMs: 4_000, args: ['-e', parent] });
  if (timed.pass || !/timed out/.test(timed.error)) throw new Error(`hung process reported success: ${JSON.stringify(timed)}`);
  if (Date.now() - started > 15_000) throw new Error('process cleanup exceeded bounded escalation');
  const pid = timed.notes?.pid;
  if (!pid) throw new Error('descendant fixture never started');
  // A reparented zombie has exited and holds no resources; PID 1 reaps it.
  const end = Date.now() + 5_000;
  while (true) {
    let alive = false;
    try { alive = !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!alive) break;
    if (Date.now() > end) throw new Error(`owned descendant ${pid} survived deadline cleanup`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const failed = await runQaProcess('failure-fixture', {
    root: process.cwd(), timeoutMs: 10_000,
    args: ['-e', `console.log('QA_RESULT ' + JSON.stringify({ pass: false, error: 'original assertion' })); process.exitCode = 1;`],
  });
  if (failed.pass || failed.error !== 'original assertion') throw new Error('runner lost the original assertion');
  result.notes = { timeout: timed.error, descendantStopped: pid, preservesAssertion: true };
  result.pass = true;
} catch (e) { result.error = String(e?.stack ?? e); }
result.seconds = Math.round((Date.now() - started) / 1000);
console.log('QA_RESULT ' + JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
