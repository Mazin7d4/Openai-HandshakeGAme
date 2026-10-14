// Runs every Playwright verifier sequentially against a running `npm run dev`.
// Default URL renders at 1/4 resolution without glow so checks are reliable on software WebGL / weak GPUs.
import { spawnSync } from 'node:child_process';
const url = process.argv[2] ?? process.env.APP_URL ?? 'http://localhost:5173/?scale=4&lowfx';
const checks = ['verify-crate', 'verify-companion', 'verify-multiplayer', 'verify-dev-local', 'verify-gameplay', 'verify-heist', 'verify-multiplayer-heist', 'verify-singleplayer', 'verify-tether-moves', 'verify-multiplayer-yank'];
const results = {};
for (const check of checks) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [`tools/${check}.mjs`, url], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: Number(process.env.CHECK_TIMEOUT_MS ?? 900_000) });
  results[check] = { pass: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) };
  if (run.status !== 0) results[check].error = (run.stderr.match(/^\w*Error: [^\n]*/m) ?? [run.stderr.slice(-300)])[0].slice(0, 300);
  console.log(check, JSON.stringify(results[check]));
}
process.exit(Object.values(results).every(r => r.pass) ? 0 : 1);
