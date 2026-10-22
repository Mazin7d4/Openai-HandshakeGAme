/**
 * Short tap feedback for touch buttons. Android supports navigator.vibrate;
 * iOS Safari does not — feature-detect and no-op there.
 */
export function hapticTap(ms = 12): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // iOS reports no vibrate API; some WebViews lie — skip iPhone/iPad UAs.
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return;
    navigator.vibrate(ms);
  } catch {
    // Unsupported or blocked
  }
}
