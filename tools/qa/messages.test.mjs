import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const started = Date.now();
const result = { test: 'messages', pass: false, notes: {} };

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile() && path.endsWith('.mjs')) files.push(path);
  }
  return files;
}

function collectSentTypes(source) {
  return [...source.matchAll(/\.(?:send|broadcast)\(\s*(['"])([^'"]+)\1/g)].map((match) => match[2]);
}

function collectClientTypes(source) {
  const types = [...source.matchAll(/onMessage\(\s*(['"])([^'"]+)\1/g)].map((match) => match[2]);
  const array = source.match(/const SERVER_STATE_EVENTS\s*=\s*\[([\s\S]*?)\]/);
  if (array) types.push(...[...array[1].matchAll(/(['"])([^'"]+)\1/g)].map((match) => match[2]));
  return types;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const serverFiles = [
    ...await filesUnder(join(root, 'server')),
    ...await filesUnder(join(root, 'shared')),
  ];
  const serverTypes = unique((await Promise.all(serverFiles.map(async (path) => collectSentTypes(await readFile(path, 'utf8'))))).flat());
  const srcFiles = [];
  async function collectSourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collectSourceFiles(path);
      else if (entry.isFile() && path.endsWith('.ts')) srcFiles.push(path);
    }
  }
  await collectSourceFiles(join(root, 'src'));
  const clientTypes = unique((await Promise.all(srcFiles.map(async (path) => collectClientTypes(await readFile(path, 'utf8'))))).flat());
  const missingTypes = serverTypes.filter((type) => !clientTypes.includes(type));

  result.notes = { serverTypes, clientTypes, missingTypes };
  assert(serverTypes.length > 0, 'no server message types found');
  assert(serverTypes.includes('rematch-partner-left'), 'server messages must include rematch-partner-left');
  assert(missingTypes.length === 0, `missing client handlers: ${missingTypes.join(', ')}`);
  result.pass = true;
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 1500);
} finally {
  result.seconds = Math.round((Date.now() - started) / 1000);
  console.log('QA_RESULT ' + JSON.stringify(result));
  process.exitCode = result.pass ? 0 : 1;
}
