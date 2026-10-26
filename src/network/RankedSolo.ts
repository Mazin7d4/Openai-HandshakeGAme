import type { MultiplayerSession } from './MultiplayerSession.ts';
import { MultiplayerSession as Session } from './MultiplayerSession.ts';
import { warmupReadyWithin } from './ServerWarmup.ts';

export async function tryRankedSolo(
  opts: { seed?: number },
  timeoutMs = 3000,
): Promise<MultiplayerSession | null> {
  const params = new URLSearchParams(location.search);
  if (params.get('bot') === '0' || params.get('ranked') === '0' || !warmupReadyWithin(60_000)) return null;
  const startedAt = Date.now();
  let session: MultiplayerSession | null = null;
  try {
    const remaining = () => Math.max(1, timeoutMs - (Date.now() - startedAt));
    session = await Session.createBotRoom({ mode: 'nightshift', seed: opts.seed }, remaining());
    let timer: number | undefined;
    try {
      await Promise.race([
        session.waitForStart(),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error('Solo room start timed out')), remaining());
        }),
      ]);
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
    return session;
  } catch {
    if (session) void session.dispose();
    return null;
  }
}
