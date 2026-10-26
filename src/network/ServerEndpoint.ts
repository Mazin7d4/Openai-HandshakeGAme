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
