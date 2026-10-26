import {
  fetchLeaderboards,
  formatEntryScore,
  type Board,
  type Entry,
  type LeaderboardSummary,
} from '../network/LeaderboardApi.ts';

export function renderLeaderboardRows(entries: readonly Entry[], boardKey: string, ownId?: string): HTMLOListElement {
  const list = document.createElement('ol');
  list.className = 'leaderboard-list';
  entries.slice(0, 10).forEach((entry, index) => {
    const row = document.createElement('li');
    row.className = 'leaderboard-row';
    if (ownId != null && entry.id === ownId) {
      row.classList.add('is-own');
      row.dataset.testid = 'leaderboard-own';
    }
    const rank = document.createElement('span');
    rank.className = 'leaderboard-row__rank';
    rank.textContent = `#${index + 1}`;
    const name = document.createElement('span');
    name.className = 'leaderboard-row__name';
    name.textContent = entry.display;
    name.title = entry.display;
    const score = document.createElement('span');
    score.className = 'leaderboard-row__score';
    score.textContent = formatEntryScore(boardKey, entry);
    row.append(rank, name, score);
    list.append(row);
  });
  return list;
}

type Tab = 'daily' | 'nightshift' | 'week' | 'solo';

export class LeaderboardPanel {
  readonly root: HTMLElement;
  private list: HTMLOListElement;
  private readonly status: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly tabs: Record<Tab, HTMLButtonElement>;
  private activeTab: Tab = 'daily';
  private data: LeaderboardSummary | null = null;
  private active = true;
  private abort = new AbortController();
  private retryTimer: number | undefined;
  private retryResolve: (() => void) | null = null;
  private loadSerial = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'leaderboard-panel';
    this.root.setAttribute('aria-label', 'Leaderboards');
    const tabs = document.createElement('div');
    tabs.className = 'leaderboard-tabs';
    this.tabs = {
      daily: this.tab(tabs, 'Daily', 'lb-tab-daily', 'daily'),
      nightshift: this.tab(tabs, 'Night Shift', 'lb-tab-nightshift', 'nightshift'),
      week: this.tab(tabs, 'This week', 'lb-tab-week', 'week'),
      solo: this.tab(tabs, 'Solo + AI', 'lb-tab-solo', 'solo'),
    };
    this.list = document.createElement('ol');
    this.list.dataset.testid = 'lb-list';
    this.list.className = 'leaderboard-list';
    this.status = document.createElement('p');
    this.status.className = 'leaderboard-status';
    this.status.dataset.testid = 'lb-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.retry = document.createElement('button');
    this.retry.type = 'button';
    this.retry.className = 'btn btn--quiet';
    this.retry.dataset.testid = 'lb-retry';
    this.retry.textContent = 'Retry';
    this.retry.addEventListener('click', () => this.load());
    this.retry.hidden = true;
    this.root.append(tabs, this.list, this.status, this.retry);
    parent.append(this.root);
    this.load();
  }

  dispose(): void {
    this.active = false;
    this.loadSerial += 1;
    this.abort.abort();
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    this.retryResolve?.();
    this.retryResolve = null;
    this.root.remove();
  }

  private tab(parent: HTMLElement, label: string, testId: string, tab: Tab): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn leaderboard-tab';
    button.dataset.testid = testId;
    button.textContent = label;
    button.addEventListener('click', () => {
      this.activeTab = tab;
      this.render();
    });
    parent.append(button);
    return button;
  }

  private board(): Board | null {
    if (!this.data) return null;
    return this.activeTab === 'daily'
      ? this.data.daily
      : this.activeTab === 'week' ? this.data.nightshiftWeek
        : this.activeTab === 'solo' ? (this.data.solo?.nightshift ?? { key: 'solo:nightshift:all', entries: [] })
          : this.data.nightshift;
  }

  private render(): void {
    for (const [tab, button] of Object.entries(this.tabs) as [Tab, HTMLButtonElement][]) {
      button.setAttribute('aria-selected', String(tab === this.activeTab));
      button.classList.toggle('is-active', tab === this.activeTab);
    }
    const board = this.board();
    this.list.replaceChildren();
    if (!board) return;
    if (!board.entries.length) {
      this.list.hidden = true;
      this.status.textContent = 'Be the first crew tonight';
      return;
    }
    this.status.textContent = '';
    const rendered = renderLeaderboardRows(board.entries, board.key);
    rendered.dataset.testid = 'lb-list';
    this.list.replaceWith(rendered);
    this.list = rendered;
  }

  private async load(): Promise<void> {
    if (!this.active) return;
    const serial = ++this.loadSerial;
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    this.retryResolve?.();
    this.retryResolve = null;
    this.abort.abort();
    this.abort = new AbortController();
    this.data = null;
    this.list.replaceChildren();
    this.retry.hidden = true;
    this.status.textContent = 'Leaderboard waking…';
    for (let attempt = 0; attempt < 3 && this.active && serial === this.loadSerial; attempt += 1) {
      const result = await fetchLeaderboards({ timeoutMs: 6000, signal: this.abort.signal });
      if (!this.active || serial !== this.loadSerial) return;
      if (result.status === 'ok') {
        this.data = result.data;
        this.render();
        return;
      }
      this.status.textContent = 'Leaderboard waking…';
      if (attempt < 2) await new Promise<void>((resolve) => {
        this.retryResolve = resolve;
        this.retryTimer = window.setTimeout(() => {
          this.retryResolve = null;
          resolve();
        }, 2000);
      });
    }
    if (!this.active || serial !== this.loadSerial) return;
    this.status.textContent = 'Leaderboard unavailable right now';
    this.retry.hidden = false;
  }
}
