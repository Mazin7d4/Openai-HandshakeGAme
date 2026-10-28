/**
 * One drawn icon style for every control glyph: 24px grid, 2px graphite stroke,
 * round caps, no fills. Shared by the controls card, touch pad, and coach.
 */
export const CONTROL_ICONS: Record<string, string> = {
  fly: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  updown: '<path d="M8 4v16M8 4L5 7M8 4l3 3M16 20V4M16 20l-3-3M16 20l3-3"/>',
  ping: '<circle cx="12" cy="10" r="6"/><path d="M12 16v5M9 10h6M12 7v6"/>',
  happy: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9v2M16 9v2M8 14q4 4 8 0"/>',
  lift: '<path d="M7 17V7h10M7 7l10 10"/>',
  boost: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  hack: '<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3"/>',
  grab: '<path d="M12 3v5M7 8h10M7 8l-2 6 3 4M17 8l2 6-3 4"/>',
  yank: '<path d="M3 8h4M17 8h4M7 8c0 9 10 9 10 0"/><path d="M12 15v5M9 18l3 3 3-3"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  switch: '<path d="M7 7h10M17 7l-3-3M17 7l-3 3M17 17H7M7 17l3-3M7 17l3 3"/>',
  touch: '<circle cx="12" cy="10" r="3.5"/><path d="M12 13.5V20"/>',
};

export function controlIcon(name: string, className = 'glyph'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of className.split(/\s+/)) {
    if (part) svg.classList.add(part);
  }
  svg.innerHTML = CONTROL_ICONS[name] ?? '';
  return svg;
}

/** Keycaps for a binding like "W A S D" or "Space / Ctrl"; "/" becomes a quiet separator. */
export function keycaps(binding: string): HTMLElement {
  const group = document.createElement('span');
  group.className = 'keys';
  for (const part of binding.split(' ')) {
    if (part === '/') {
      group.append(Object.assign(document.createElement('span'), { className: 'keys__or', textContent: 'or' }));
      continue;
    }
    const cap = document.createElement('kbd');
    cap.className = 'keycap';
    cap.textContent = part;
    group.append(cap);
  }
  return group;
}
