import { spawnSync } from 'node:child_process';

const started = Date.now();
const run = spawnSync(process.execPath, ['tools/verify-nightshift-coop.mjs'], {
  encoding: 'utf8',
  timeout: Number(process.env.QA_TIMEOUT_MS ?? 70000),
  env: process.env,
});
const line = (run.stdout ?? '').split('\n').find((entry) => entry.startsWith('QA_RESULT '));
const result = line
  ? JSON.parse(line.slice(10))
  : { test: 'nightshift-coop', pass: false, seconds: Math.round((Date.now() - started) / 1000), error: run.error?.message ?? (run.stderr || run.stdout || 'no QA_RESULT').slice(-800) };
console.log(`QA_RESULT ${JSON.stringify(result)}`);
process.exitCode = result.pass ? 0 : 1;
