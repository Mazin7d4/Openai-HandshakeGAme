type MenuButton = (
  label: string,
  testId: string,
  action: () => void,
  variant?: 'btn--quiet',
) => HTMLButtonElement;

type WakeOverlayActions = {
  cancel: () => void;
  playSolo: () => void;
  retry: () => void;
  back: () => void;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function progressValue(elapsedMs: number, budgetMs: number): number {
  return Math.min(
    95,
    Math.round(elapsedMs <= 20_000 || budgetMs <= 20_000
      ? elapsedMs / 20_000 * 80
      : 80 + 15 * (elapsedMs - 20_000) / (budgetMs - 20_000)),
  );
}

export function createWakeOverlay(
  menuButton: MenuButton,
  budgetMs: number,
  actions: WakeOverlayActions,
): {
  overlay: HTMLDivElement;
  update: (elapsedMs: number) => void;
  markReady: () => void;
  showFailure: () => void;
} {
  const overlay = element('div', 'wake-overlay');
  overlay.dataset.testid = 'wake-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  const spinner = element('div', 'wake-spinner');
  spinner.setAttribute('aria-hidden', 'true');
  const title = element('p', 'wake-title', 'Waking the co-op server…');
  title.dataset.testid = 'wake-title';
  const detail = element('p', 'wake-detail', 'Usually under a minute. Solo starts instantly. ');
  const seconds = element('span', '', '0');
  seconds.dataset.testid = 'wake-elapsed';
  detail.append(seconds, ' s');
  const progress = element('div', 'wake-progress');
  progress.dataset.testid = 'wake-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  const progressFill = element('span');
  progress.append(progressFill);

  const update = (elapsedMs: number): void => {
    seconds.textContent = String(Math.floor(elapsedMs / 1_000));
    const value = progressValue(elapsedMs, budgetMs);
    progress.setAttribute('aria-valuenow', String(value));
    progressFill.style.width = `${value}%`;
  };
  const markReady = (): void => {
    progress.setAttribute('aria-valuenow', '100');
    progressFill.style.width = '100%';
  };
  const actionsContainer = element('div', 'wake-actions');
  const cancel = menuButton('Cancel', 'wake-cancel', actions.cancel, 'btn--quiet');
  const playSolo = menuButton('Play solo', 'wake-play-solo', actions.playSolo, 'btn--quiet');
  const retry = menuButton('Retry', 'wake-retry', actions.retry, 'btn--quiet');
  actionsContainer.append(cancel, playSolo, retry);
  overlay.append(spinner, title, detail, progress, actionsContainer);

  let slow = false;
  const showFailure = (): void => {
    if (slow) return;
    slow = true;
    title.textContent = 'Still waking the co-op server…';
    // Keep elapsed/progress live, and keep the same controls while automatic retries continue.
    detail.firstChild!.textContent = 'Taking longer than usual. Retrying automatically. ';
    actionsContainer.append(menuButton('Back', 'back', actions.back, 'btn--quiet'));
  };

  update(0);
  return { overlay, update, markReady, showFailure };
}
