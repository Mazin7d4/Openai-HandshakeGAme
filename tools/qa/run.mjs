// Runs the QA suite sequentially (one browser at a time). Usage: npm run qa [-- smoke coop ...]
import { spawnSync } from 'node:child_process';
const all = ['smoke', 'solo-boot', 'coop', 'reconnect', 'mobile', 'no-test-hooks'];
const pick = process.argv.slice(2).filter((a) => all.includes(a));
const results = [];
for (const t of pick.length ? pick : all) {
  const r = spawnSync(process.execPath, [`tools/qa/${t}.test.mjs`], { encoding: 'utf8', timeout: Number(process.env.QA_TIMEOUT_MS ?? 300_000), env: process.env });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('QA_RESULT '));
  const res = line ? JSON.parse(line.slice(10)) : { test: t, pass: false, error: r.error?.message ?? (r.stderr ?? '').slice(-500) };
  results.push(res);
  console.log(`${res.pass ? 'PASS' : 'FAIL'} ${t} (${res.seconds ?? '?'}s)${res.error ? ' - ' + res.error.split('\n')[0] : ''}`);
  if (res.notes?.dropFixme) console.log(`  fixme ${res.notes.dropFixme.name}: ${res.notes.dropFixme.status}`);
  if (res.notes?.fixme) console.log(`  fixme ${res.notes.fixme.name}: ${res.notes.fixme.status}`);
}
process.exit(results.every((r) => r.pass) ? 0 : 1);
