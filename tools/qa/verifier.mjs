import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Run a real verifier while forwarding cancellation to the child we started. */
export function runVerifier(script, args, { timeout = 298000, env = process.env, logPath } = {}) {
  if (logPath) { mkdirSync(dirname(logPath), { recursive: true }); writeFileSync(logPath, ''); }
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', error, forceTimer;
    const stop = () => {
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 800);
    };
    const cancel = () => { error = 'verification interrupted'; stop(); };
    process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
    const timer = setTimeout(() => { error = `verification timed out after ${timeout}ms`; stop(); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (logPath) appendFileSync(logPath, chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; if (logPath) appendFileSync(logPath, chunk); });
    const finish = status => {
      clearTimeout(timer); clearTimeout(forceTimer);
      process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
      resolve({ status, stdout, stderr, error });
    };
    child.once('error', failure => { error = failure.message; finish(null); });
    child.once('close', finish);
  });
}
