// Own each QA process tree and enforce its wall-clock deadline, including Chromium.
import { spawn } from 'node:child_process';

function parseResult(test, stdout, stderr, error) {
  const line = (stdout ?? '').split('\n').find((entry) => entry.startsWith('QA_RESULT '));
  if (line) {
    try {
      return JSON.parse(line.slice(10));
    } catch (parseError) {
      return { test, pass: false, error: parseError.message };
    }
  }
  return { test, pass: false, error: error ?? (stderr ?? '').slice(-500) };
}

/** Run a test with bounded output and terminate only its owned process group. */
export function runQaProcess(test, { root, env = process.env, timeoutMs = 300_000, onChild = () => {}, args = [`tools/qa/${test}.test.mjs`] }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...env, QA_TEST_DEADLINE_MS: String(Math.max(1, timeoutMs - 5_000)) },
      // Own a process group so a wedged Chromium cannot hold the pipes open forever.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.qaProcessGroup = process.platform !== 'win32';
    onChild(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let forceTimer;
    const signalTest = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signalTest('SIGTERM');
      forceTimer = setTimeout(() => {
        signalTest('SIGKILL');
        finish(`test timed out after ${timeoutMs}ms`);
      }, 1_000);
    }, timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signalTest('SIGKILL');
      const result = parseResult(test, stdout, stderr, error);
      resolve(error ? { ...result, pass: false, error: timedOut ? error : result.error || error } : result);
    };
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-2_000_000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2_000_000); });
    child.once('error', (error) => finish(error.message));
    child.once('close', (code, signal) => {
      const error = timedOut
        ? `test timed out after ${timeoutMs}ms`
        : (code === 0 ? undefined : `test exited with code ${code ?? '?'} signal ${signal}`);
      finish(error);
    });
  });
}

