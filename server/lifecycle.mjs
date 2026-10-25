let installed = false;

function oneLine(value) {
  return String(value).replace(/\s*\n\s*/g, ' | ');
}

function context({ port, roomsCount }) {
  let rooms = 0;
  try {
    rooms = roomsCount();
  } catch {
    rooms = 0;
  }
  return `pid=${process.pid} ppid=${process.ppid} port=${port} uptime=${process.uptime().toFixed(1)}s rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MB rooms=${rooms}`;
}

export function installLifecycleLogging({ port, label = 'handshake', roomsCount = () => 0 }) {
  if (installed) return;
  installed = true;

  let terminating = false;
  let exitLogged = false;
  const prefix = `[${label}]`;
  const details = () => context({ port, roomsCount });
  const logExit = (code) => {
    if (exitLogged) return;
    exitLogged = true;
    console.log(`${prefix} exit code ${code} ${details()}`);
  };

  // Colyseus registers its own graceful shutdown for these signals (rooms dispose, then exit).
  // Log who/what ended us, and only force the exit if that shutdown hangs.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      if (terminating) return;
      terminating = true;
      const signalNumber = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal];
      console.log(`${prefix} exit: received ${signal} ${details()}`);
      setTimeout(() => process.exit(128 + signalNumber), 5_000).unref();
    });
  }

  process.on('unhandledRejection', (reason) => {
    const message = reason?.stack ?? String(reason);
    console.error(`${prefix} unhandledRejection: ${oneLine(message)} ${details()}`);
  });

  process.on('uncaughtException', (error) => {
    // Colyseus also listens and runs its graceful shutdown; we only make sure the reason is logged.
    console.error(`${prefix} uncaughtException: ${oneLine(error?.stack ?? String(error))} ${details()}`);
    if (terminating) return;
    terminating = true;
    setTimeout(() => process.exit(1), 5_000).unref();
  });

  process.on('exit', (code) => {
    logExit(code);
  });
}

export function logListenError(error, port) {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[handshake] listen failed on port ${port}: EADDRINUSE (another server already owns this port)`);
    return;
  }
  console.error(`[handshake] listen failed on port ${port}: ${error?.message ?? String(error)}`);
}
