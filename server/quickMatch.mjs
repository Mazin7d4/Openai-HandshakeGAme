import { ServerError } from 'colyseus';

const WINDOW_MS = 60_000;
const rateByIp = new Map();
const seatsByIp = new Map();

function numberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function sanitizeQmKey(value, mode = 'standard') {
  const key = typeof value === 'string' ? value : '';
  const clean = key.toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 48);
  return clean || (typeof mode === 'string' ? mode.toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 48) : 'standard');
}

export function clientIp(context) {
  const forwarded = context?.headers?.get?.('x-forwarded-for')
    ?? context?.headers?.['x-forwarded-for'];
  return String(forwarded?.split(',')[0]?.trim() || context?.ip || context?.req?.socket?.remoteAddress || 'unknown');
}

export function checkQuickMatchLimit(ip) {
  const now = Date.now();
  // Drop idle IPs so the map can't grow without bound.
  if (rateByIp.size > 1000) for (const [key, times] of rateByIp) if (now - times[times.length - 1] >= WINDOW_MS) rateByIp.delete(key);
  const timestamps = (rateByIp.get(ip) ?? []).filter((time) => now - time < WINDOW_MS);
  if (timestamps.length >= numberEnv('QM_RATE_PER_MIN', 20)) {
    throw new ServerError(429, 'quick match limit, try again in a minute');
  }
  if ((seatsByIp.get(ip) ?? 0) >= numberEnv('QM_MAX_SEATS_PER_IP', 4)) {
    throw new ServerError(429, 'quick match limit, try again in a minute');
  }
  timestamps.push(now);
  rateByIp.set(ip, timestamps);
}

export function acquireQuickMatchSeat(ip) {
  seatsByIp.set(ip, (seatsByIp.get(ip) ?? 0) + 1);
}

export function releaseQuickMatchSeat(ip) {
  const next = (seatsByIp.get(ip) ?? 0) - 1;
  if (next > 0) seatsByIp.set(ip, next);
  else seatsByIp.delete(ip);
}

