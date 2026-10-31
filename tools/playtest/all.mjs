import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
const out = process.env.PLAYTEST_OUT ?? `/workspace/handshake/sprint/playtest/suite/${stamp}`;
mkdirSync(out, { recursive: true });
const modeIndex = process.argv.indexOf('--mode');
const requested = modeIndex >= 0 ? process.argv[modeIndex + 1] : null;
const phoneOnly = process.argv.includes('--phone-only');
const desktopOnly = process.argv.includes('--desktop-only');

const modes = [
  { name: 'standard-solo', tests: ['solo-boot', 'bot-solo'], desktop: true },
  { name: 'standard-coop', tests: ['coop'], desktop: true },
  { name: 'night-shift-solo', tests: ['night-shift'], desktop: true },
  { name: 'night-shift-coop', tests: ['nightshift-coop'], desktop: true },
  { name: 'daily', tests: ['daily'], desktop: true },
  { name: 'challenge-link', tests: ['challenge'], phone: true },
  { name: 'rematch', tests: ['rematch', 'rematch-mobile'], desktop: true, phone: true },
  { name: 'reconnect', tests: ['reconnect'], desktop: true },
  { name: 'escape-replay', tests: ['escape-replay'], desktop: true },
  { name: 'keyboard-only', tests: ['a11y-keyboard'], desktop: true },
  { name: 'gamepad', tests: ['gamepad'], desktop: true },
  { name: 'phone-touch-coop', tests: ['join-mobile'], phone: true },
];
const selected = modes.filter((mode) => (!requested || mode.name === requested)
  && (!phoneOnly || mode.phone) && (!desktopOnly || mode.desktop));
if (!selected.length) {
  console.error(`No matching playtest mode. Available: ${modes.map((m) => m.name).join(', ')}`);
  process.exit(2);
}

const run = (mode) => new Promise((resolve) => {
  const started = Date.now();
  const modeOut = join(out, mode.name);
  mkdirSync(modeOut, { recursive: true });
  const isDaily = mode.tests.includes('daily');
  const command = isDaily
    ? [process.execPath, ['tools/playtest/daily.mjs']]
    : [process.execPath, ['tools/qa/run.mjs', '--own-servers', ...mode.tests]];
  const env = { ...process.env, PATH: `/home/box/.local/node22/bin:${process.env.PATH ?? ''}`, QA_JSON_RESULTS: '1', QA_SHOTS: modeOut, QA_TIMEOUT_MS: process.env.QA_TIMEOUT_MS ?? '120000' };
  const child = spawn(command[0], command[1], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });
  child.on('close', (code, signal) => {
    const qa = [...stdout.matchAll(/QA_RESULT (\{.*\})/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
    const failed = qa.find((result) => !result.pass);
    const errors = qa.flatMap((result) => result.notes?.errors ?? []).filter(Boolean);
    const result = { mode: mode.name, pass: code === 0 && !failed, durationSeconds: +((Date.now() - started) / 1000).toFixed(1), errors, firstFailingStep: failed?.error?.split('\n')[0] ?? null, tests: qa, signal: signal ?? null, stderr: stderr.trim().slice(-2000), screenshots: modeOut };
    writeFileSync(join(modeOut, 'result.json'), JSON.stringify(result, null, 2));
    resolve(result);
  });
});

const results = [];
for (const mode of selected) {
  console.log(`\nPLAYTEST_START ${mode.name}`);
  results.push(await run(mode));
}
const summary = { startedAt: new Date().toISOString(), output: out, options: { requested, phoneOnly, desktopOnly }, pass: results.every((result) => result.pass), modes: results };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const lines = results.map((result) => `${result.pass ? 'PASS' : 'FAIL'} ${result.mode} ${result.durationSeconds}s errors=${result.errors.length}${result.firstFailingStep ? ` first=${result.firstFailingStep}` : ''}`);
writeFileSync(join(out, 'summary.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`PLAYTEST_OUT=${out}`);
process.exit(summary.pass ? 0 : 1);
