/**
 * QA wrapper: runs tools/verify-coop-capture.mjs against the local QA servers.
 * Requires HANDSHAKE_TEST_HOOKS (qa:servers / QA_HOOKS).
 */
import { spawnSync } from 'node:child_process';
import { BASE_URL, url } from './lib.mjs';

const target = url({ scale: '4', lowfx: '1' });
const started = Date.now();
const run = spawnSync(
  process.execPath,
  ['--experimental-strip-types', 'tools/verify-coop-capture.mjs', target],
  {
    encoding: 'utf8',
    timeout: Number(process.env.QA_TIMEOUT_MS ?? 300_000),
    env: { ...process.env, APP_URL: target, QA_BASE_URL: BASE_URL },
  },
);
const line = (run.stdout ?? '').split('\n').find((l) => l.startsWith('QA_RESULT '));
const result = line
  ? JSON.parse(line.slice(10))
  : {
      test: 'coop-capture',
      pass: false,
      error: run.error?.message ?? (run.stderr ?? run.stdout ?? '').slice(-800),
      seconds: Math.round((Date.now() - started) / 1000),
    };
if (!line) {
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log('QA_RESULT ' + JSON.stringify(result));
}
process.exitCode = result.pass ? 0 : 1;
