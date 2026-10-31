// The full authored heist must remain physically traversable, including every puzzle and the dock escape.
import { runVerifier } from './verifier.mjs';
import { mkdirSync } from 'node:fs';
import { url } from './lib.mjs';

const started = Date.now();
const shots = process.env.SHOTS ?? '/workspace/handshake/playtest/oct26/codexA/route-1280x720';
mkdirSync(shots, { recursive: true });
const run = await runVerifier('tools/verify-heist.mjs', [url()], {
  timeout: Number(process.env.QA_TIMEOUT_MS ?? 300000) - 1500,
  env: { ...process.env, ANGLE: 'swiftshader', SHOTS: shots },
});
const pass = run.status === 0;
console.log('QA_RESULT ' + JSON.stringify({
  test: 'heist-main', pass, seconds: Math.round((Date.now() - started) / 1000),
  notes: pass ? { route: 'physical', allPuzzles: true, thresholdSafety: true, cameraInvariants: true, screenshots: shots } : {},
  error: pass ? undefined : run.error ?? (run.stderr || run.stdout || 'no verification output').slice(-1400),
}));
process.exitCode = pass ? 0 : 1;
