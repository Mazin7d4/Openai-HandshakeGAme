import { spawnSync } from 'node:child_process';
import { url } from './lib.mjs';

const started = Date.now();
const run = spawnSync(process.execPath, ['tools/verify-audio.mjs', url()], {
  encoding: 'utf8', timeout: Number(process.env.QA_TIMEOUT_MS ?? 120000), env: process.env,
});
let audio;
try { audio = JSON.parse(run.stdout); } catch { /* execution error reported below */ }
const pass = run.status === 0 && audio?.pass === true;
console.log('QA_RESULT ' + JSON.stringify({
  test: 'heist-audio', pass, seconds: Math.round((Date.now() - started) / 1000),
  notes: audio ? { events: Object.keys(audio.events ?? {}).length, missing: audio.missingEvents, doorMotor: audio.events?.doorMotor } : {},
  error: pass ? undefined : run.error?.message ?? (run.stderr || run.stdout || 'no audio result').slice(-1400),
}));
process.exitCode = pass ? 0 : 1;
