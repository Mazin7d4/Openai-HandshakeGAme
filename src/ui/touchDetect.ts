/** True when the device is primarily touch / coarse-pointer (phones, tablets). */
export function isTouchPlayDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
  } catch {
    // matchMedia unavailable
  }
  return (navigator.maxTouchPoints ?? 0) > 0;
}
