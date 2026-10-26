import { renderSVG } from 'uqr';

export function renderInviteQr(host: HTMLElement, url: string): void {
  const figure = document.createElement('figure');
  figure.className = 'invite-qr';
  figure.dataset.testid = 'invite-qr';
  figure.innerHTML = renderSVG(url, { ecc: 'M', border: 2 });

  const svg = figure.querySelector('svg');
  if (!svg) throw new Error('uqr did not render an SVG');
  if (!svg.hasAttribute('viewBox')) throw new Error('uqr did not render an SVG viewBox');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code for the invite link');

  const caption = document.createElement('figcaption');
  caption.textContent = 'Scan to join on a phone';
  figure.append(caption);
  host.replaceChildren(figure);
}
