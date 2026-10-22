import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forwardedArgs = process.argv.slice(2);
// Local dev server only: enable test-only room messages used by tools/verify-* (never set by `npm start`).
process.env.HANDSHAKE_TEST_HOOKS ??= '1';
const processes = [];
let stopping = false;

function start(label, entry, args = []) {
  // Shared run helpers live in TypeScript; strip types so the Node server can import them.
  const nodeArgs = entry.endsWith('server/index.mjs') || entry.endsWith('server\\index.mjs')
    ? ['--experimental-strip-types', entry, ...args]
    : [entry, ...args];
  const child = spawn(process.execPath, nodeArgs, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  processes.push(child);
  child.on('exit', (code, signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    for (const process of processes) {
      if (process !== child && process.exitCode === null) {
        process.kill();
      }
    }
    if (signal) {
      console.error(`${label} stopped (${signal}).`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
  child.on('error', (error) => {
    console.error(`Unable to start ${label}:`, error);
  });
}

function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const process of processes) {
    if (process.exitCode === null) {
      process.kill();
    }
  }
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

start('multiplayer server', resolve(projectRoot, 'server/index.mjs'));
start('Vite client', resolve(projectRoot, 'node_modules/vite/bin/vite.js'), forwardedArgs);
