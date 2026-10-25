// `?fps=1` corner readout (lazy chunk, never loaded otherwise). Sits under the floor chip, clear of the
// objective card, pause button and touch controls; pointer-events none so touches pass through.
import type { QualityStatus } from '../scene/Quality.ts';

export function mountFpsOverlay(getStatus: () => QualityStatus): () => void {
  const node = document.createElement('div');
  node.dataset.testid = 'fps-overlay';
  node.setAttribute('aria-hidden', 'true');
  node.style.position = 'fixed';
  node.style.top = 'calc(env(safe-area-inset-top, 0px) + 54px)';
  node.style.left = 'calc(env(safe-area-inset-left, 0px) + 12px)';
  node.style.pointerEvents = 'none';
  node.style.userSelect = 'none';
  node.style.zIndex = '40';
  node.style.font = '600 10px/1.3 ui-monospace, monospace';
  node.style.color = '#fff';
  node.style.background = 'rgba(0,0,0,.55)';
  node.style.padding = '3px 5px';
  node.style.borderRadius = '6px';
  node.style.maxWidth = '150px';
  node.style.whiteSpace = 'pre';
  node.style.overflow = 'hidden';
  node.style.textOverflow = 'ellipsis';
  document.body.appendChild(node);

  let lastText = '';
  const update = () => {
    const status = getStatus();
    const pin = status.pinned === 'all' ? 'pinned' : status.pinned === 'tier' ? 'tier-pinned' : 'auto';
    // Short action for a phone: "6s down low x1.15 probe" (full text stays in __pixQuality().changes).
    const last = status.lastAction ? status.lastAction.replace(/x[\d.]+->/, '').replace(/ \([^)]*, (\w+)\)$/, ' $1') : '-';
    const text = `${Math.round(status.avgFps)} fps ${status.frameMs.toFixed(1)} ms\n${status.tier} x${status.dynScale.toFixed(2)} ${pin}\n${last}`;
    if (text !== lastText) {
      node.textContent = text;
      lastText = text;
    }
  };
  update();
  const timer = window.setInterval(update, 250);
  return () => {
    window.clearInterval(timer);
    node.remove();
  };
}
