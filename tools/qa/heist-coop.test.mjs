import { spawnSync } from 'node:child_process';
import { url } from './lib.mjs';

const started = Date.now();
const run = spawnSync(process.execPath, ['tools/verify-multiplayer-heist.mjs', url()], {
  encoding: 'utf8', timeout: Number(process.env.QA_TIMEOUT_MS ?? 300000), env: process.env,
});
const pass = run.status === 0;
console.log('QA_RESULT ' + JSON.stringify({
  test: 'heist-coop', pass, seconds: Math.round((Date.now() - started) / 1000),
  notes: pass ? { independentHacking: true, doors: true, ownership: true, alarm: true, extraction: true, disconnect: true } : {},
  error: pass ? undefined : run.error?.message ?? (run.stderr || run.stdout || 'no verification output').slice(-1400),
}));
process.exitCode = pass ? 0 : 1;
