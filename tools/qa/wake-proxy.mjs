import { createServer, connect } from 'node:net';

export async function startWakeProxy({ targetPort, port = 0, downMs = 5000, mode = '503' }) {
  if (mode !== '503' && mode !== 'hang') throw new Error(`Unsupported wake proxy mode: ${mode}`);

  const startedAt = Date.now();
  const stats = { requests: 0 };
  const sockets = new Set();
  const held = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    let buffer = Buffer.alloc(0);
    let forwarded = false;
    let piped = false;

    const isDown = () => downMs === Infinity || Date.now() - startedAt < downMs;
    const forward = () => {
      if (forwarded || socket.destroyed) return;
      forwarded = true;
      held.delete(forward);
      const target = connect({ host: '127.0.0.1', port: targetPort });
      target.setNoDelay(true);
      target.once('connect', () => {
        if (buffer.length) target.write(buffer);
        buffer = Buffer.alloc(0);
        piped = true;
        socket.pipe(target);
        target.pipe(socket);
      });
      target.on('error', () => socket.destroy());
      socket.once('close', () => target.destroy());
    };

    const inspectDownRequests = () => {
      while (isDown()) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const request = buffer.subarray(0, end + 4);
        if (/^[A-Z]+\s+\S+\s+HTTP\/\d(?:\.\d)?\r\n/i.test(request.toString())) stats.requests++;
        // 'hang' keeps the request buffered: it is forwarded (late) if the server comes up first.
        if (mode === 'hang') return;
        buffer = buffer.subarray(end + 4);
        socket.write('HTTP/1.1 503 Service Unavailable\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.end();
        return;
      }
      forward();
    };

    socket.on('data', (chunk) => {
      if (piped) return;
      buffer = Buffer.concat([buffer, chunk]);
      // Bytes that arrive between forward() and the target connect stay buffered for it.
      if (!forwarded) inspectDownRequests();
    });
    socket.on('error', () => {
      held.delete(socket);
    });
    socket.on('close', () => {
      sockets.delete(socket);
      held.delete(forward);
    });

    if (isDown()) held.add(forward);
    else forward();
  });

  const upTimer = downMs === Infinity ? null : setTimeout(() => {
    for (const release of [...held]) release();
  }, Math.max(0, downMs));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  async function close() {
    if (upTimer) clearTimeout(upTimer);
    held.clear();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { port: actualPort, url: `ws://127.0.0.1:${actualPort}`, close, stats };
}
