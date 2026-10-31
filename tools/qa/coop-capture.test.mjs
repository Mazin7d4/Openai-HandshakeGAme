/**
 * QA wrapper: runs tools/verify-coop-capture.mjs against the local QA client.
 * Spawns its own hooked Colyseus server (HANDSHAKE_TEST_HOOKS=1).
 */
import { spawnSync } from 'node:child_process';
import { BASE_URL, url } from './lib.mjs';

const target = url({ scale: '4', lowfx: '1' });
const started = Date.now();
// Match lib.launch(): a stale shared Xvfb display can prevent ANGLE from
// creating WebGL before the debug hooks are installed.
const { DISPLAY: _display, WAYLAND_DISPLAY: _waylandDisplay, ...headlessEnv } = process.env;
const run = spawnSync(
  process.execPath,
  ['--experimental-strip-types', 'tools/verify-coop-capture.mjs', target],
  {
    encoding: 'utf8',
    timeout: Number(process.env.QA_TIMEOUT_MS ?? 300_000),
    env: { ...headlessEnv, APP_URL: target, QA_BASE_URL: BASE_URL },
  },
);
const line = (run.stdout ?? '').split('\n').find((l) => l.startsWith('QA_RESULT '));
const result = line
  ? JSON.parse(line.slice(10))
  : {
      test: 'coop-capture',
      pass: false,
      error: (run.error?.message ?? (run.stderr || run.stdout || 'no QA_RESULT')).slice(-800),
      seconds: Math.round((Date.now() - started) / 1000),
    };
if (!('seconds' in result) || result.seconds == null) {
  result.seconds = Math.round((Date.now() - started) / 1000);
}
console.log('QA_RESULT ' + JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
