// Runs the QA suite sequentially (one browser at a time). Usage: npm run qa [-- smoke coop ...]
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { request } from 'node:http';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { runQaProcess } from './process.mjs';
import { freePort, startTestServer } from '../test-server.mjs';

const all = ['qa-deadline', 'phone-ui', 'seeds', 'bundle-budget', 'cold-load', 'pass-rules', 'messages', 'interp', 'remote-unit', 'server-fuzz', 'proxy-latency', 'error-resilience', 'challenge', 'night-shift', 'smoke', 'solo-boot', 'no-cdn', 'bot-solo', 'coop', 'coop-capture', 'grab-carry', 'rematch', 'bot-server', 'migration', 'bot-hack-server', 'leaderboard-server', 'quickmatch-server', 'quickmatch', 'quickmatch-cancel', 'quickmatch-bot', 'quickmatch-private', 'nightshift-coop', 'ping-emote', 'reconnect', 'mobile', 'quality-phone', 'governor', 'governor-unit', 'mobile-layout', 'join-mobile', 'join-qr', 'rematch-mobile', 'leaderboard', 'leaderboard-solo', 'title-best-crew', 'wake', 'emote-mobile', 'gamepad', 'escape-replay', 'no-test-hooks', 'settings', 'a11y-keyboard', 'floorplan-sweep', 'objectives-unit', 'hazards-unit', 'variety-coop', 'nightshift-9floors', 'variety-solo'];
const args = process.argv.slice(2);
const ownServers = process.env.QA_OWN_SERVERS === '1' || args.includes('--own-servers');
const unknown = args.filter((a) => a !== '--own-servers' && !all.includes(a));
if (unknown.length) throw new Error(`Unknown QA tests/options: ${unknown.join(', ')}`);
const pick = args.filter((a) => a !== '--own-servers' && all.includes(a));
const tests = pick.length ? pick : all;
const root = fileURLToPath(new URL('../..', import.meta.url));
const configuredTimeout = Number(process.env.QA_TIMEOUT_MS);
if (process.env.QA_TIMEOUT_MS && (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0)) throw new Error('QA_TIMEOUT_MS must be a positive finite number');
const testTimeout = (test) => process.env.QA_TIMEOUT_MS ? configuredTimeout : test === 'mobile' ? 600_000 : 300_000;

function report(test, res) {
  if (process.env.QA_RESULTS_FILE) appendFileSync(process.env.QA_RESULTS_FILE, JSON.stringify({ ...res, recordedAt: new Date().toISOString() }) + '\n');
  console.log(`${res.pass ? 'PASS' : 'FAIL'} ${test} (${res.seconds ?? '?'}s)${res.error ? ' - ' + res.error.split('\n')[0] : ''}`);
  // Print the whole failure reason (multi-line asserts like "errors:\n..." used to show as an empty list).
  if (!res.pass && res.error) for (const line of res.error.split('\n').slice(1).filter(Boolean)) console.log(`    ${line}`);
  if (res.notes?.dropFixme) console.log(`  fixme ${res.notes.dropFixme.name}: ${res.notes.dropFixme.status}`);
  if (res.notes?.fixme) console.log(`  fixme ${res.notes.fixme.name}: ${res.notes.fixme.status}`);
}

function refused(port) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = createConnection({ host: '127.0.0.1', port: Number(port) });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED'));
  });
}

async function waitForHttp(url, limitMs = 60_000) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const answered = await new Promise((resolve) => {
      const req = request(url, (res) => {
        res.resume();
        res.once('end', () => resolve(true));
      });
      req.setTimeout(1_000, () => {
        req.destroy();
        resolve(false);
      });
      req.once('error', () => resolve(false));
      req.end();
    });
    if (answered) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not answer within ${limitMs}ms`);
}

function killChild(child) {
  if (child?.qaProcessGroup) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    return Promise.resolve();
  }
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    let forceTimer;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      resolve();
    };
    child.once('close', done);
    child.kill('SIGTERM');
    forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      setTimeout(done, 100);
    }, 1_000);
  });
}

function runTestAsync(test, env) {
  return runQaProcess(test, {
    root, env, timeoutMs: testTimeout(test),
    onChild: (child) => { runningTest = child; },
  }).finally(() => { runningTest = null; });
}

async function runDefault() {
  const results = [];
  let livenessWarned = false;
  for (const test of tests) {
    const res = await runTestAsync(test, process.env);
    results.push(res);
    report(test, res);
    if (!livenessWarned && !process.env.QA_BASE_URL && !process.env.QA_URL && await refused(process.env.QA_SERVER_PORT ?? '2583')) {
      livenessWarned = true;
      console.log(`  game server on :${process.env.QA_SERVER_PORT ?? '2583'} is down after ${test} (killed externally? use QA_OWN_SERVERS=1 for isolated ports)`);
    }
  }
  return results;
}

let viteProcess = null;
let runningServer = null;
let runningTest = null;
let cleaning = false;

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  const server = runningServer;
  const test = runningTest;
  runningTest = null;
  if (test) await killChild(test);
  if (server) await server.stop();
  runningServer = null;
  const vite = viteProcess;
  viteProcess = null;
  await killChild(vite);
}

async function runOwnServers() {
  const results = [];
  const firstPort = await freePort();
  const firstHooks = tests[0] === 'no-test-hooks'
    ? ''
    : (process.env.QA_HOOKS_ENV ?? (process.env.HANDSHAKE_TEST_HOOKS ?? ''));
  runningServer = await startTestServer({
    port: firstPort,
    root,
    env: { HANDSHAKE_TEST_HOOKS: firstHooks },
  });

  const vitePort = await freePort();
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(vitePort), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root,
    env: { ...process.env, VITE_COLYSEUS_URL: `ws://127.0.0.1:${firstPort}` },
    stdio: 'ignore',
  });
  await waitForHttp(`http://127.0.0.1:${vitePort}/`);

  for (const test of tests) {
    let server = runningServer;
    let res;
    try {
      if (!server) {
        const port = await freePort();
        const hooks = test === 'no-test-hooks'
          ? ''
          : (process.env.QA_HOOKS_ENV ?? (process.env.HANDSHAKE_TEST_HOOKS ?? ''));
        server = runningServer = await startTestServer({
          port,
          root,
          env: { HANDSHAKE_TEST_HOOKS: hooks },
        });
      }
      const env = { ...process.env, QA_SERVER_PORT: String(server.port), QA_CLIENT_PORT: String(vitePort), HANDSHAKE_TEST_HOOKS: test === 'no-test-hooks' ? '' : (process.env.QA_HOOKS_ENV ?? (process.env.HANDSHAKE_TEST_HOOKS ?? '')) };
      delete env.QA_SERVER_URL;
      delete env.QA_BASE_URL;
      delete env.QA_URL;
      res = await runTestAsync(test, env);
    } catch (error) {
      res = { test, pass: false, error: String(error?.message ?? error) };
    }

    const exit = server?.exitInfo();
    if (exit) {
      const reason = `server died during ${test}: code ${exit.code} signal ${exit.signal}`;
      console.log(`  ${reason}`);
      for (const line of server.log().split(/\r?\n/).filter(Boolean).slice(-15)) console.log(`    ${line}`);
      if (res.pass) res = { ...res, pass: false, error: reason };
    }
    results.push(res);
    report(test, res);
    await server?.stop();
    if (runningServer === server) runningServer = null;
  }
  return results;
}

if (ownServers) {
  process.once('SIGINT', async () => { await cleanup(); process.exit(130); });
  process.once('SIGTERM', async () => { await cleanup(); process.exit(143); });
  process.once('exit', () => {
    viteProcess?.kill('SIGTERM');
    if (runningTest?.qaProcessGroup) {
      try { process.kill(-runningTest.pid, 'SIGKILL'); } catch {}
    } else runningTest?.kill('SIGTERM');
    runningServer?.child.kill('SIGTERM');
  });
  let code = 1;
  try {
    const results = await runOwnServers();
    code = results.every((result) => result.pass) ? 0 : 1;
  } catch (error) {
    console.error(error?.stack ?? String(error));
  } finally {
    await cleanup();
  }
  process.exit(code);
}

const results = await runDefault();
process.exit(results.every((result) => result.pass) ? 0 : 1);
