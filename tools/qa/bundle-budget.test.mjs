/**
 * Bundle budget: production `vite build` into a temp dir (no browser, no server), then checks
 *  - the title's critical path (index.html entry + its static imports + css) stays small,
 *  - the title never statically pulls in the engine, physics, level or Colyseus chunks,
 *  - the largest lazy JS chunk and the total JS stay under budget (gzip).
 * Budgets are ~10-15% above the measured sizes so real regressions fail, noise does not.
 */
import { build } from 'vite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const BUDGET = {
  titleJsGzip: 36 * KB, // entry + static imports (Oct 25: 27 KB; was 86 KB with Colyseus in the entry)
  titleCssGzip: 13 * KB, // 10 KB
  largestChunkGzip: 240 * KB, // GameApp 201 KB (was PrototypeHeist 1,244 KB with barrel Babylon imports)
  totalJsGzip: 1150 * KB, // 999 KB (was 1,823 KB)
};
// Chunks the title must not load before the player picks a mode.
const LAZY_ONLY = /^(GameApp|PrototypeHeist|MultiplayerSession|HeistReport|HavokPhysics|scene\.pure|thinEngine)/;

const started = Date.now();
const result = { test: 'bundle-budget', pass: false, notes: {} };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const outDir = mkdtempSync(join(tmpdir(), 'pix-bundle-'));
try {
  await build({ logLevel: 'error', build: { outDir, emptyOutDir: true, reportCompressedSize: false } });
  const assets = join(outDir, 'assets');
  const gz = (file) => gzipSync(readFileSync(join(assets, file))).length;
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const fromHtml = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^.*\/assets\//, ''));
  const entry = fromHtml(/<script[^>]+type="module"[^>]+src="([^"]+)"/g);
  const preloads = fromHtml(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g);
  const css = fromHtml(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g);
  assert(entry.length === 1, `expected one entry script, got ${entry.length}`);
  // Walk static imports (dynamic import() targets are lazy by definition).
  const title = new Set();
  const visit = (file) => {
    if (title.has(file)) return;
    title.add(file);
    const src = readFileSync(join(assets, file), 'utf8');
    for (const m of src.matchAll(/(?:^|[;\s}])import\s*(?:[\w$*{},\s]+from\s*)?["']\.\/([^"']+\.js)["']/g)) visit(m[1]);
  };
  [...entry, ...preloads].forEach(visit);
  const titleFiles = [...title];
  const titleJs = titleFiles.reduce((a, f) => a + gz(f), 0);
  const titleCss = css.reduce((a, f) => a + gz(f), 0);
  const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
  const sizes = js.map((f) => [f, gz(f)]).sort((a, b) => b[1] - a[1]);
  const total = sizes.reduce((a, [, s]) => a + s, 0);
  const k = (n) => Math.round(n / KB);
  result.notes = {
    titleFiles, titleJsKB: k(titleJs), titleCssKB: k(titleCss), largest: `${sizes[0][0]} ${k(sizes[0][1])}KB`,
    totalJsKB: k(total), chunks: js.length, top: sizes.slice(0, 5).map(([f, s]) => `${f.replace(/-[\w-]{8}\.js$/, '')}=${k(s)}`),
  };
  const leaked = titleFiles.filter((f) => LAZY_ONLY.test(f));
  assert(!leaked.length, `title statically loads lazy chunks: ${leaked.join(', ')}`);
  const titleSrc = titleFiles.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
  assert(!/colyseus/i.test(titleSrc), 'Colyseus client leaked into the title chunks');
  assert(!/BABYLON\.|babylonjs/i.test(titleSrc), 'Babylon leaked into the title chunks');
  assert(titleJs <= BUDGET.titleJsGzip, `title JS ${k(titleJs)}KB gzip > ${k(BUDGET.titleJsGzip)}KB`);
  assert(titleCss <= BUDGET.titleCssGzip, `title CSS ${k(titleCss)}KB gzip > ${k(BUDGET.titleCssGzip)}KB`);
  assert(sizes[0][1] <= BUDGET.largestChunkGzip, `largest chunk ${sizes[0][0]} ${k(sizes[0][1])}KB gzip > ${k(BUDGET.largestChunkGzip)}KB`);
  assert(total <= BUDGET.totalJsGzip, `total JS ${k(total)}KB gzip > ${k(BUDGET.totalJsGzip)}KB`);
  result.pass = true;
} catch (e) {
  result.error = String(e?.message ?? e).slice(0, 1500);
} finally {
  rmSync(outDir, { recursive: true, force: true });
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log('QA_RESULT ' + JSON.stringify(result));
  process.exitCode = result.pass ? 0 : 1;
}
