// Runs the QA suite sequentially (one browser at a time). Usage: npm run qa [-- smoke coop ...]
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { freePort, startTestServer } from '../test-server.mjs';

const all = ['seeds', 'bundle-budget', 'pass-rules', 'messages', 'interp', 'challenge', 'night-shift', 'smoke', 'solo-boot', 'no-cdn', 'bot-solo', 'coop', 'coop-capture', 'grab-carry', 'rematch', 'bot-server', 'bot-hack-server', 'leaderboard-server', 'quickmatch-server', 'quickmatch', 'quickmatch-cancel', 'quickmatch-bot', 'quickmatch-private', 'nightshift-coop', 'ping-emote', 'reconnect', 'mobile', 'quality-phone', 'governor', 'mobile-layout', 'join-mobile', 'join-qr', 'rematch-mobile', 'leaderboard', 'leaderboard-solo', 'title-best-crew', 'wake', 'emote-mobile', 'gamepad', 'escape-replay', 'no-test-hooks', 'settings', 'a11y-keyboard', 'floorplan-sweep', 'objectives-unit', 'hazards-unit', 'variety-coop', 'nightshift-9floors', 'variety-solo'];
const args = process.argv.slice(2);
const ownServers = process.env.QA_OWN_SERVERS === '1' || args.includes('--own-servers');
const pick = args.filter((a) => a !== '--own-servers' && all.includes(a));
const tests = pick.length ? pick : all;
const root = fileURLToPath(new URL('../..', import.meta.url));
const timeoutMs = Number(process.env.QA_TIMEOUT_MS ?? 300_000);

function parseResult(test, stdout, stderr, error) {
  const line = (stdout ?? '').split('\n').find((entry) => entry.startsWith('QA_RESULT '));
  if (line) {
    try {
      return JSON.parse(line.slice(10));
    } catch (parseError) {
      return { test, pass: false, error: parseError.message };
    }
  }
  return { test, pass: false, error: error ?? (stderr ?? '').slice(-500) };
}

function report(test, res) {
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
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`tools/qa/${test}.test.mjs`], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    runningTest = child;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let forceTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 1_000);
    }, timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      if (runningTest === child) runningTest = null;
      resolve(parseResult(test, stdout, stderr, error));
    };
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => finish(error.message));
    child.once('close', (code, signal) => {
      const error = timedOut
        ? `test timed out after ${timeoutMs}ms`
        : (code === 0 || signal == null ? undefined : `test exited with code ${code ?? '?'} signal ${signal}`);
      finish(error);
    });
  });
}

async function runDefault() {
  const results = [];
  let livenessWarned = false;
  for (const test of tests) {
    const result = spawnSync(process.execPath, [`tools/qa/${test}.test.mjs`], {
      cwd: root,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: process.env,
    });
    const res = parseResult(test, result.stdout, result.stderr, result.error?.message);
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
    runningTest?.kill('SIGTERM');
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
