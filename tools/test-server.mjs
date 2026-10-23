import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

export async function startTestServer({ port, env = {}, root, timeoutMs = 20_000 }) {
  const child = spawn(process.execPath, ['--experimental-strip-types', `${root}/server/index.mjs`], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let settled = false;
  let timeout;
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  const tail = () => output.slice(-800);

  const finish = (callback) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    callback();
  };

  const ready = new Promise((resolve, reject) => {
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(`listening on port ${port}`)) {
        finish(() => resolve({ child, port, log: () => output, stop }));
      } else if (output.includes('EADDRINUSE')) {
        // The server process stays alive after a failed listen; fail now with the reason.
        child.kill('SIGTERM');
        finish(() => reject(new Error(`Test server port ${port} already in use: ${tail()}`)));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => finish(() => reject(error)));
    child.once('exit', (code, signal) => {
      resolveExit();
      finish(() => reject(new Error(`Test server exited before listening (code ${code}, signal ${signal}): ${tail()}`)));
    });
    timeout = setTimeout(() => {
      const message = new Error(`Test server did not listen on port ${port} within ${timeoutMs}ms: ${tail()}`);
      child.kill('SIGTERM');
      finish(() => reject(message));
    }, timeoutMs);
  });

  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        resolve();
      }, 3_000)),
    ]);
  }

  return ready;
}
