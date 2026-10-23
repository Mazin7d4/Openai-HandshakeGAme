import { spawnSync } from 'node:child_process';
const started = Date.now();
const run = spawnSync(process.execPath, ['tools/verify-ping-emote.mjs'], { encoding: 'utf8', timeout: 60000, env: process.env });
const line = (run.stdout ?? '').split('\n').find((entry) => entry.startsWith('QA_RESULT '));
const result = line ? JSON.parse(line.slice(10)) : { test: 'ping-emote', pass: false, error: run.error?.message ?? (run.stderr || run.stdout || 'no QA_RESULT').slice(-800) };
console.log(`QA_RESULT ${JSON.stringify({ ...result, test: 'ping-emote', seconds: result.seconds ?? Math.round((Date.now() - started) / 1000) })}`);
process.exitCode = result.pass ? 0 : 1;
