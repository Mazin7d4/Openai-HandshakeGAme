/** sessionStorage key for a room's Colyseus reconnection token. */
export function reconnectionTokenKey(roomCode: string): string {
  return `handshake.reconnection.${roomCode.trim().toUpperCase()}`;
}

export function storeReconnectionToken(roomCode: string, token: string): void {
  try {
    sessionStorage.setItem(reconnectionTokenKey(roomCode), token);
  } catch {
    /* private mode / quota — reconnect-by-refresh will be unavailable */
  }
}

export function loadReconnectionToken(roomCode: string): string | null {
  try {
    return sessionStorage.getItem(reconnectionTokenKey(roomCode));
  } catch {
    return null;
  }
}

export function clearReconnectionToken(roomCode: string): void {
  try {
    sessionStorage.removeItem(reconnectionTokenKey(roomCode));
  } catch {
    /* ignore */
  }
}

/** Client-side grace countdown; keep in sync with server default (RECONNECT_SECONDS). */
export const RECONNECT_GRACE_SECONDS = 30;
