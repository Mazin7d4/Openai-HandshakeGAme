export function isFullscreen(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export async function enterImmersive(): Promise<void> {
  // Automated browsers (Playwright) resize the window; fullscreen would block that.
  if (navigator.webdriver) return;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  const element = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: (options?: { navigationUI?: string }) => Promise<void> | void;
  };
  try {
    const request = element.requestFullscreen ?? element.webkitRequestFullscreen;
    if (request && !isFullscreen()) {
      try { await Promise.resolve(request.call(element, { navigationUI: 'hide' })); } catch { /* fullscreen is optional */ }
    }
  } catch { /* never block game start */ }
  try { await Promise.resolve(screen.orientation?.lock?.('landscape')).catch(() => undefined); } catch { /* optional */ }
  void doc;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) {
      const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
      await Promise.resolve((document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document)).catch(() => undefined);
    } else {
      await enterImmersive();
    }
  } catch { /* never throw from a menu convenience */ }
}
