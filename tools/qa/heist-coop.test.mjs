import { runVerifier } from './verifier.mjs';
import { url } from './lib.mjs';

const started = Date.now();
const run = await runVerifier('tools/verify-multiplayer-heist.mjs', [url()], {
  timeout: Math.max(600000, Number(process.env.QA_TIMEOUT_MS ?? 0)) - 1500,
  env: { ...process.env, TRACE: '1' },
  logPath: '/workspace/handshake/playtest/oct26/codexA/coop-verifier.log',
});
const pass = run.status === 0;
console.log('QA_RESULT ' + JSON.stringify({
  test: 'heist-coop', pass, seconds: Math.round((Date.now() - started) / 1000),
  notes: pass ? { independentHacking: true, doors: true, ownership: true, alarm: true, extraction: true, disconnect: true } : {},
  error: pass ? undefined : run.error ?? (run.stderr || run.stdout || 'no verification output').slice(-1400),
}));
process.exitCode = pass ? 0 : 1;
