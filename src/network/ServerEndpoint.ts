export function serverEndpoint(): string {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('server');
  if (fromQuery) {
    try {
      const url = new URL(fromQuery);
      if (/^(wss?|https?):$/.test(url.protocol)) {
        const wsProto = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
        return `${wsProto}//${url.host}${url.pathname.replace(/\/$/, '')}`;
      }
    } catch { /* ignore invalid values */ }
  }

  const env = (import.meta.env.VITE_COLYSEUS_URL as string | undefined)?.trim();
  if (env) {
    return env;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:2567`;
}

export function serverHttpUrl(): string {
  const ws = serverEndpoint();
  return ws.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export async function pingServer(timeoutMs = 4000): Promise<boolean> {
  try {
    // CORS fetch so a proxy error page (e.g. 502 while a free host spins up) is not mistaken for "awake".
    const response = await fetch(`${serverHttpUrl()}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function wakeServer(opts: {
  onWaiting?: (attempt: number, elapsedMs: number) => void;
  maxWaitMs?: number;
  signal?: AbortSignal;
} = {}): Promise<boolean> {
  const { onWaiting, maxWaitMs = 90_000, signal } = opts;

  if (await pingServer(2500)) {
    return true;
  }

  const start = Date.now();
  let attempt = 0;

  while (!signal?.aborted) {
    attempt++;
    const elapsed = Date.now() - start;
    if (elapsed >= maxWaitMs) return false;

    onWaiting?.(attempt, elapsed);

    if (await pingServer(8000)) return true;
    if (signal?.aborted) return false;

    const remaining = maxWaitMs - (Date.now() - start);
    if (remaining <= 0) return false;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(2000, remaining));
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  return false;
}
