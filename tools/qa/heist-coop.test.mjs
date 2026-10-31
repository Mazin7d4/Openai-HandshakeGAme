import { runVerifier } from './verifier.mjs';
import { url } from './lib.mjs';

const started = Date.now();
const logPath = `${process.env.QA_SHOTS ?? '/workspace/handshake/sprint/playtest/rc/logs'}/heist-coop-${process.env.QA_SERVER_PORT ?? 'local'}-${process.pid}.log`;
const run = await runVerifier('tools/verify-multiplayer-heist.mjs', [url()], {
  timeout: Math.max(900000, Number(process.env.QA_TIMEOUT_MS ?? 0)) - 1500,
  env: { ...process.env, TRACE: '1' },
  logPath,
});
const pass = run.status === 0;
console.log('QA_RESULT ' + JSON.stringify({
  test: 'heist-coop', pass, seconds: Math.round((Date.now() - started) / 1000),
  notes: pass ? { independentHacking: true, doors: true, ownership: true, alarm: true, extraction: true, disconnect: true, logPath } : { logPath },
  error: pass ? undefined : run.error ?? (run.stderr || run.stdout || 'no verification output').slice(-1400),
}));
process.exitCode = pass ? 0 : 1;
