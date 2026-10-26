import { getWarmupState, onWarmupChange } from '../network/ServerWarmup.ts';

export function mountTitleBestCrew(panel: HTMLElement): () => void {
  const best = document.createElement('p');
  best.className = 'title-best-crew';
  best.dataset.testid = 'title-best-crew';
  best.hidden = true;
  best.setAttribute('aria-live', 'polite');
  best.dataset.state = 'idle';

  const subtitle = panel.querySelector('.menu-subtitle');
  const actions = panel.querySelector('.menu-actions');
  if (subtitle) subtitle.after(best);
  else if (actions) actions.before(best);
  else panel.append(best);

  const abort = new AbortController();
  let disposed = false;
  let loaded = false;

  const load = async (): Promise<void> => {
    if (disposed || loaded) return;
    loaded = true;
    best.dataset.state = 'loading';
    try {
      const { fetchLeaderboards } = await import('../network/LeaderboardApi.ts');
      const result = await fetchLeaderboards({ timeoutMs: 4000, signal: abort.signal });
      if (disposed) return;
      if (result.status !== 'ok') {
        best.hidden = true;
        best.dataset.state = 'hidden';
        return;
      }
      const entry = result.data.nightshift.entries[0];
      if (!entry) {
        const text = 'Best crew · be the first crew tonight';
        best.textContent = text;
        best.title = text;
        best.hidden = false;
        best.dataset.state = 'empty';
        return;
      }
      const floor = Number(entry.floors);
      const floorText = floor > 0 ? ` · floor ${entry.floors}` : '';
      const text = `Best crew · ${entry.display} · ${(Number(entry.score) || 0).toLocaleString('en-US')} pts${floorText} · Night Shift`;
      best.textContent = text;
      best.title = text;
      best.hidden = false;
      best.dataset.state = 'ready';
    } catch {
      if (disposed) return;
      best.hidden = true;
      best.dataset.state = 'hidden';
    }
  };

  const unsubscribe = onWarmupChange((state) => {
    if (state === 'ready') void load();
  });
  if (getWarmupState() === 'ready') void load();

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    abort.abort();
  };
}
