import type { GameAudio } from '../audio/GameAudio.ts';
import type { DroneRole } from '../network/NetworkTypes.ts';
import type { LeaderboardNameResult, LeaderboardRecordedPayload } from '../network/LeaderboardApi.ts';
import { challengeUrl as buildChallengeUrl } from '../../shared/run.ts';
import {
  awardAccent,
  formatRunTime,
  gradeFaces,
  pickAwards,
  quipFor,
  type RunStats,
} from './heistAwards.ts';
import { createFaceGlyph, drawFaceGlyph, type FaceMood } from './FaceGlyph.ts';
import { MenuNavigator } from './MenuNavigator.ts';
import { effectiveReducedMotion, getSettings } from './Settings.ts';
import { cosmeticDefinition, recordRunUnlocks } from '../player/Cosmetics.ts';
import { renderLeaderboardRows } from './LeaderboardPanel.ts';

export interface HeistReportHandlers {
  onPlayAgain: () => void;
  onRematchVote?: (want: boolean) => void;
  onLeave?: () => void;
  /** Night Shift only: advance to the next seeded floor. */
  onNextFloor?: () => void;
  /** Night Shift: restart with a fresh random seed. */
  onNewSeed?: () => void;
  /** Re-watch the slow-mo escape replay (button shown only when footage exists). */
  onReplay?: () => void;
  onLeaderboardName?: (name: string, team: boolean) => void;
  audio?: GameAudio | null;
}

export interface CoopReportPlayer {
  role: DroneRole;
  rematchVote: boolean;
  lootDelivered: number;
  lootCarrySeconds: number;
  passes: number;
  rescues: number;
  capturedCount: number;
  grabs: number;
  hacks: number;
}

export interface CoopReportState {
  localRole: DroneRole | null;
  players: ReadonlyMap<DroneRole, CoopReportPlayer>;
  partnerLeft?: boolean;
}

export interface NightShiftSummary {
  floor: number;
  points: number;
  total: number;
  multiplier: number;
  best: { floor: number; score: number } | null;
  nextTwist?: { label: string; flavor: string };
  runEnded?: boolean;
  captures?: number;
}

/**
 * End-of-run Heist Report: oak case-file panel, face-glyph grade, funny awards,
 * Play again / challenge link / Save card. Keeps the `mission-complete` test id
 * so existing verifiers still find the overlay.
 */
export class HeistReport {
  readonly root: HTMLDivElement;
  private readonly panel: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly gradeEl: HTMLElement;
  private readonly awardsEl: HTMLElement;
  private readonly quipEl: HTMLElement;
  private readonly stampEl: HTMLElement;
  private readonly seedEl: HTMLElement;
  private readonly nightShiftEl: HTMLElement;
  private readonly challengeHint: HTMLElement;
  private readonly live: HTMLDivElement;
  private readonly playAgainBtn: HTMLButtonElement | null;
  private readonly rematchBtn: HTMLButtonElement | null;
  private readonly rematchStatusEl: HTMLElement | null;
  private readonly playerStatsEl: HTMLElement | null;
  private readonly leaderboardSection: HTMLElement;
  private readonly nav = new MenuNavigator();
  private stats: RunStats | null = null;
  private replayBtn: HTMLButtonElement | null = null;
  private lastShow: [RunStats, NightShiftSummary | undefined, CoopReportState | undefined] | null = null;
  private leaderboardPayload: LeaderboardRecordedPayload | null = null;
  private leaderboardSkipReason: string | undefined;
  private leaderboardName = '';
  private leaderboardTeam = false;
  private leaderboardNameStatus = '';
  private gradeTimers: number[] = [];
  private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);
  private readonly handlers: HeistReportHandlers;

  constructor(parent: HTMLElement, handlers: HeistReportHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.className = 'mission-complete-overlay heist-report-overlay';
    this.root.dataset.testid = 'mission-complete';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'heist-report-title');

    this.panel = document.createElement('section');
    this.panel.className = 'mission-complete-panel heist-report';
    this.panel.innerHTML = [
      '<p class="heist-report__brand" aria-label="PIX and NEE">',
      '<span class="heist-report__brand-pix">PIX</span>',
      '<span class="heist-report__brand-cord" aria-hidden="true"></span>',
      '<span class="heist-report__brand-nee">NEE</span>',
      '</p>',
      '<p class="panel__kicker heist-report__kicker">Case closed</p>',
      '<h1 id="heist-report-title" class="heist-report__title">Heist Report</h1>',
      '<div class="heist-report__meta">',
      '<div class="heist-report__faces" data-heist="crew"></div>',
      '<p class="heist-report__time" data-heist="time">0:00</p>',
      '<p class="heist-report__seed" data-heist="seed" hidden></p>',
      '<div class="heist-report__grade" data-heist="grade" aria-label="Heist grade"></div>',
      '</div>',
      '<ul class="heist-report__awards" data-heist="awards"></ul>',
      '<p class="heist-report__quip" data-heist="quip"></p>',
      '<p class="heist-report__challenge-hint" data-heist="challenge-hint" hidden></p>',
      '<div class="mission-complete-actions heist-report__actions"></div>',
    ].join('');

    this.stampEl = document.createElement('span');
    this.stampEl.className = 'heist-report__stamp';
    this.stampEl.textContent = 'Extracted';
    this.panel.append(this.stampEl);

    const crew = this.panel.querySelector('[data-heist="crew"]')!;
    crew.append(
      wrapFace('pix', 'happy', '#3DDBFF', 'PIX'),
      cordDivider(),
      wrapFace('nee', 'proud', '#FF6194', 'NEE'),
    );

    this.timeEl = this.panel.querySelector('[data-heist="time"]') as HTMLElement;
    this.seedEl = this.panel.querySelector('[data-heist="seed"]') as HTMLElement;
    this.nightShiftEl = document.createElement('div');
    this.nightShiftEl.className = 'heist-report__run';
    this.nightShiftEl.dataset.testid = 'report-night-shift';
    this.nightShiftEl.hidden = true;
    this.seedEl.after(this.nightShiftEl);
    this.gradeEl = this.panel.querySelector('[data-heist="grade"]') as HTMLElement;
    this.awardsEl = this.panel.querySelector('[data-heist="awards"]') as HTMLElement;
    this.quipEl = this.panel.querySelector('[data-heist="quip"]') as HTMLElement;
    this.challengeHint = this.panel.querySelector('[data-heist="challenge-hint"]') as HTMLElement;

    const actions = this.panel.querySelector('.heist-report__actions')!;
    const nightShift = Boolean(handlers.onNewSeed || handlers.onNextFloor);
    const cooperative = Boolean(handlers.onRematchVote);
    this.playAgainBtn = cooperative ? null : button(
      nightShift ? 'Play again, same seed' : 'Play again',
      'btn btn--primary heist-report__play',
      'retry-mission',
    );
    if (this.playAgainBtn) {
      this.playAgainBtn.title = nightShift ? 'Play again, same seed (R)' : 'Play again (R)';
      this.playAgainBtn.addEventListener('click', () => this.handlers.onPlayAgain());
    }
    this.rematchBtn = cooperative ? button('Rematch', 'btn btn--primary heist-report__rematch', 'rematch') : null;
    this.rematchBtn?.setAttribute('aria-pressed', 'false');
    this.rematchBtn?.addEventListener('click', () => {
      const current = this.currentCoopState?.players.get(this.currentCoopState.localRole ?? 'pix')?.rematchVote === true;
      this.handlers.onRematchVote?.(!current);
    });

    this.rematchStatusEl = cooperative ? document.createElement('p') : null;
    if (this.rematchStatusEl) {
      this.rematchStatusEl.className = 'heist-report__rematch-status';
      this.rematchStatusEl.dataset.testid = 'rematch-status';
      this.rematchStatusEl.setAttribute('aria-live', 'polite');
      this.rematchStatusEl.textContent = 'Rematch?';
      // Sticky bar: on phones the report scrolls, but the vote state + Rematch stay in view.
      const bar = document.createElement('div');
      bar.className = 'heist-report__rematch-bar';
      bar.append(this.rematchStatusEl, this.rematchBtn!);
      actions.before(bar);
    }
    this.playerStatsEl = cooperative ? document.createElement('div') : null;
    if (this.playerStatsEl) {
      this.playerStatsEl.className = 'heist-report__player-stats';
      this.playerStatsEl.dataset.testid = 'player-stats';
      this.playerStatsEl.setAttribute('role', 'region');
      this.playerStatsEl.setAttribute('aria-label', 'Player statistics');
      this.nightShiftEl.after(this.playerStatsEl);
    }

    this.leaderboardSection = document.createElement('section');
    this.leaderboardSection.className = 'heist-report__leaderboard';
    this.leaderboardSection.dataset.testid = 'report-leaderboard';
    this.leaderboardSection.hidden = true;
    actions.before(this.leaderboardSection);

    const challenge = button('Copy challenge link', 'btn', 'challenge-friend');
    challenge.addEventListener('click', () => void this.copyChallengeLink());

    const save = button('Save card', 'btn', 'save-card');
    save.addEventListener('click', () => void this.saveCard());

    if (this.playAgainBtn) actions.append(this.playAgainBtn);
    if (handlers.onReplay) {
      this.replayBtn = button('Watch replay', 'btn heist-report__replay', 'report-replay');
      this.replayBtn.hidden = true;
      this.replayBtn.addEventListener('click', () => handlers.onReplay?.());
      actions.append(this.replayBtn);
    }
    actions.append(challenge, save);
    if (handlers.onNewSeed) {
      const fresh = button('New seed', 'btn', 'new-seed');
      fresh.addEventListener('click', () => handlers.onNewSeed?.());
      actions.append(fresh);
    }
    if (handlers.onNextFloor) {
      const next = button('Next floor', 'btn', 'next-floor');
      next.addEventListener('click', () => handlers.onNextFloor?.());
      actions.append(next);
    }
    if (handlers.onLeave) {
      const leave = button('Leave game', 'btn btn--quiet', 'leave-heist');
      leave.addEventListener('click', () => handlers.onLeave?.());
      actions.append(leave);
    }

    this.live = document.createElement('div');
    this.live.className = 'a11y-live';
    this.live.dataset.testid = 'heist-report-live';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'assertive');
    this.live.setAttribute('aria-atomic', 'true');

    this.root.append(this.panel, this.live);
    parent.append(this.root);
  }

  private currentCoopState: CoopReportState | null = null;
  private statsKey = '';

  /** Show or hide the "Watch replay" button (only when the replay has footage). */
  setReplayAvailable(available: boolean): void {
    if (this.replayBtn) this.replayBtn.hidden = !available;
  }

  /** Hide for the replay; resume() brings the same report back. */
  suspend(): void {
    this.hide();
  }

  resume(): void {
    if (!this.lastShow) return;
    const [stats, nightShift, coop] = this.lastShow;
    this.show(stats, nightShift, this.currentCoopState ?? coop);
  }

  show(stats: RunStats, nightShift?: NightShiftSummary, coop?: CoopReportState): void {
    this.lastShow = [stats, nightShift, coop];
    this.stats = stats;
    if (coop) this.currentCoopState = coop;
    this.clearGradeTimers();
    this.timeEl.textContent = formatRunTime(stats.elapsedSeconds);
    this.quipEl.textContent = quipFor(stats);
    this.stampEl.textContent = stats.outcome === 'win' ? 'Extracted' : 'Busted';
    this.stampEl.classList.toggle('heist-report__stamp--fail', stats.outcome !== 'win');
    this.challengeHint.hidden = true;
    this.challengeHint.textContent = '';

    this.panel.querySelector('.heist-report__unlock-toast')?.remove();
    const unlocked = recordRunUnlocks({
      outcome: stats.outcome,
      timesSpotted: stats.timesSpotted,
      nightShiftScore: nightShift?.total,
      nightShiftFloor: nightShift?.floor,
      cooperative: Boolean(coop && coop.players.size > 1),
    });
    if (unlocked.length) {
      const toast = document.createElement('p');
      toast.className = 'heist-report__unlock-toast';
      toast.setAttribute('role', 'status');
      toast.textContent = `New unlock${unlocked.length > 1 ? 's' : ''}: ${unlocked.map((id) => cosmeticDefinition(id)?.label ?? id).join(', ')}`;
      this.panel.append(toast);
    }

    if (stats.seed != null) {
      this.seedEl.hidden = false;
      this.seedEl.dataset.testid = 'report-seed';
      this.seedEl.textContent = `Seed ${stats.seed}`;
    } else {
      this.seedEl.hidden = true;
      this.seedEl.textContent = '';
    }

    if (nightShift) {
      this.nightShiftEl.hidden = false;
      this.nightShiftEl.replaceChildren();

      const multSuffix = nightShift.multiplier > 1 ? ` · x${nightShift.multiplier.toLocaleString('en-US')}` : '';
      const clearedEl = document.createElement('p');
      clearedEl.textContent = nightShift.runEnded
        ? `Run over on floor ${nightShift.floor.toLocaleString('en-US')} · ${nightShift.captures ?? 0} captures`
        : `Floor ${nightShift.floor.toLocaleString('en-US')} cleared · +${nightShift.points.toLocaleString('en-US')}${multSuffix}`;
      this.nightShiftEl.append(clearedEl);

      const scoreEl = document.createElement('p');
      scoreEl.textContent = `Run score ${nightShift.total.toLocaleString('en-US')}`;
      this.nightShiftEl.append(scoreEl);

      if (nightShift.best) {
        const bestEl = document.createElement('p');
        bestEl.textContent = `Best: floor ${nightShift.best.floor.toLocaleString('en-US')} · ${nightShift.best.score.toLocaleString('en-US')}`;
        this.nightShiftEl.append(bestEl);
      }

      if (nightShift.nextTwist) {
        const nextEl = document.createElement('p');
        nextEl.textContent = `Next floor: ${nightShift.nextTwist.label}. ${nightShift.nextTwist.flavor}`;
        this.nightShiftEl.append(nextEl);
      }
    } else {
      this.nightShiftEl.hidden = true;
      this.nightShiftEl.replaceChildren();
    }

    this.awardsEl.replaceChildren();
    for (const award of pickAwards(stats)) {
      const li = document.createElement('li');
      li.className = `heist-report__award heist-report__award--${award.owner}`;
      li.style.setProperty('--award-accent', awardAccent(award.owner));
      const title = document.createElement('strong');
      title.textContent = award.title;
      const detail = document.createElement('span');
      detail.textContent = award.detail;
      li.append(title, detail);
      this.awardsEl.append(li);
    }

    this.renderCoop();
    this.renderLeaderboard();

    this.gradeEl.replaceChildren();
    const faces = gradeFaces(stats);
    const reduced = effectiveReducedMotion(getSettings());
    faces.forEach((face, index) => {
      const slot = document.createElement('span');
      slot.className = `heist-report__grade-slot${face.earned ? '' : ' is-missed'}`;
      slot.append(createFaceGlyph({
        mood: face.mood,
        color: face.color,
        size: 40,
        label: face.label,
      }));
      const caption = document.createElement('span');
      caption.className = 'heist-report__grade-caption';
      caption.textContent = face.caption;
      slot.append(caption);
      this.gradeEl.append(slot);
      if (reduced) {
        slot.classList.add('is-in');
      } else {
        const timer = window.setTimeout(() => {
          slot.classList.add('is-in');
          this.handlers.audio?.click(0.35 + index * 0.2);
        }, 180 + index * 220);
        this.gradeTimers.push(timer);
      }
    });

    this.root.classList.add('visible');
    window.addEventListener('keydown', this.onKey);
    const resultLine = stats.outcome === 'win'
      ? `Heist complete. Extracted in ${formatRunTime(stats.elapsedSeconds)}.`
      : `Heist failed. Busted after ${formatRunTime(stats.elapsedSeconds)}.`;
    this.live.textContent = '';
    window.requestAnimationFrame(() => {
      this.live.textContent = resultLine;
    });
    this.nav.attach(this.root, {
      onBack: this.handlers.onLeave,
      initialFocus: this.rematchBtn ?? this.playAgainBtn,
    });
  }

  updateCoopStatus(state: CoopReportState): void {
    this.currentCoopState = state;
    this.renderCoop();
    // Coop status ticks often; only rebuild the board when co-op-ness flips, so the name form stays stable.
    const isCoop = state.players.size > 1;
    if (isCoop !== this.leaderboardRenderedCoop) this.renderLeaderboard();
  }

  setLeaderboard(payload: LeaderboardRecordedPayload | null, skipReason?: string): void {
    const oldInput = this.leaderboardSection.querySelector<HTMLInputElement>('[data-testid="leaderboard-name-input"]');
    const oldTeam = this.leaderboardSection.querySelector<HTMLInputElement>('[data-testid="leaderboard-team"]');
    if (oldInput) this.leaderboardName = oldInput.value;
    if (oldTeam) this.leaderboardTeam = oldTeam.checked;
    this.leaderboardPayload = payload;
    this.leaderboardSkipReason = skipReason;
    if (!payload && !skipReason) {
      this.leaderboardNameStatus = '';
      this.leaderboardName = '';
      this.leaderboardTeam = false;
    }
    this.renderLeaderboard();
  }

  setLeaderboardNameResult(result: LeaderboardNameResult): void {
    this.leaderboardNameStatus = result.ok
      ? 'Saved'
      : result.reason === 'profanity'
        ? 'Please pick another name'
        : result.reason === 'empty'
          ? 'Name is empty'
          : 'Too many changes';
    if (result.name) this.leaderboardName = result.name;
    const input = this.leaderboardSection.querySelector<HTMLInputElement>('[data-testid="leaderboard-name-input"]');
    if (input && result.name) input.value = result.name;
    const status = this.leaderboardSection.querySelector<HTMLElement>('[data-testid="leaderboard-name-status"]');
    if (status) status.textContent = this.leaderboardNameStatus;
  }

  hide(): void {
    this.clearGradeTimers();
    this.nav.detach();
    this.root.classList.remove('visible');
    window.removeEventListener('keydown', this.onKey);
  }

  get visible(): boolean {
    return this.root.classList.contains('visible');
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }

  /** TEST / demo: expose current stats for screenshot scripts. */
  currentStats(): RunStats | null {
    return this.stats;
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.visible) return;
    if (event.key === 'r' || event.key === 'R' || event.key === 'Enter') {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (this.rematchBtn) this.rematchBtn.click();
      else this.handlers.onPlayAgain();
    }
  }

  private renderCoop(): void {
    if (!this.rematchBtn || !this.rematchStatusEl || !this.playerStatsEl) return;
    const state = this.currentCoopState;
    const local = state?.localRole ? state.players.get(state.localRole) : undefined;
    const partnerRole = state?.localRole === 'pix' ? 'nee' : 'pix';
    const partner = state?.players.get(partnerRole);
    const localVoted = local?.rematchVote === true;
    const partnerVoted = partner?.rematchVote === true;
    const partnerLeft = state?.partnerLeft === true;
    this.rematchBtn.disabled = partnerLeft;
    this.rematchBtn.textContent = localVoted ? 'Cancel rematch' : 'Rematch';
    this.rematchBtn.setAttribute('aria-label', this.rematchBtn.textContent);
    this.rematchBtn.setAttribute('aria-pressed', String(localVoted));
    const statusText = partnerLeft
      ? 'Partner left the room'
      : localVoted && partnerVoted
        ? 'Rematch?'
        : localVoted
          ? 'Waiting for partner…'
          : partnerVoted
            ? 'Partner wants a rematch!'
            : 'Rematch?';
    if (this.rematchStatusEl.textContent !== statusText) this.rematchStatusEl.textContent = statusText;

    const stats = [
      state?.players.get('pix'),
      state?.players.get('nee'),
    ];
    // Room status ticks often; only rebuild the table when a shown value changed.
    const key = JSON.stringify(stats.map((p) => p && [p.lootDelivered, Math.round(p.lootCarrySeconds * 10), p.passes, p.rescues, p.capturedCount, p.grabs, p.hacks]));
    if (key === this.statsKey) return;
    this.statsKey = key;
    this.playerStatsEl.replaceChildren();
    const scroll = document.createElement('div');
    scroll.className = 'heist-report__player-stats-scroll';
    const table = document.createElement('table');
    table.className = 'heist-report__player-stats-table';
    table.innerHTML = '<caption>Player statistics</caption><thead><tr><th scope="col">Player</th><th scope="col" title="Loot delivered">Loot</th><th scope="col" title="Time carrying the loot">Carry</th><th scope="col" title="Passes made">Pass</th><th scope="col" title="Rescues">Save</th><th scope="col" title="Times captured">Caught</th><th scope="col" title="Grabs">Grab</th><th scope="col" title="Hacks">Hack</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const [index, role] of (['pix', 'nee'] as const).entries()) {
      const player = stats[index];
      const row = document.createElement('tr');
      row.dataset.testid = `player-stats-${role}`;
      const values = [
        role.toUpperCase(),
        String(player?.lootDelivered ?? 0),
        `${(player?.lootCarrySeconds ?? 0).toFixed(1)}s`,
        String(player?.passes ?? 0),
        String(player?.rescues ?? 0),
        String(player?.capturedCount ?? 0),
        String(player?.grabs ?? 0),
        String(player?.hacks ?? 0),
      ];
      for (const [valueIndex, value] of values.entries()) {
        const cell = document.createElement(valueIndex === 0 ? 'th' : 'td');
        cell.textContent = value;
        if (valueIndex === 0) cell.setAttribute('scope', 'row');
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    scroll.append(table);
    this.playerStatsEl.append(scroll);
  }

  private leaderboardRenderedCoop: boolean | null = null;

  private renderLeaderboard(): void {
    const section = this.leaderboardSection;
    const coop = this.currentCoopState;
    const isCoop = Boolean(coop && coop.players.size > 1);
    this.leaderboardRenderedCoop = isCoop;
    if (this.leaderboardSkipReason === 'offline') {
      section.hidden = false;
      section.replaceChildren();
      const note = document.createElement('p');
      note.className = 'heist-report__leaderboard-muted';
      note.dataset.testid = 'leaderboard-unranked';
      note.textContent = 'Unranked (offline)';
      section.append(note);
      return;
    }
    if (!isCoop || (!this.leaderboardPayload && !this.leaderboardSkipReason)) {
      section.hidden = true;
      section.replaceChildren();
      return;
    }
    const existingInput = section.querySelector<HTMLInputElement>('[data-testid="leaderboard-name-input"]');
    const existingTeam = section.querySelector<HTMLInputElement>('[data-testid="leaderboard-team"]');
    if (existingInput) this.leaderboardName = existingInput.value;
    if (existingTeam) this.leaderboardTeam = existingTeam.checked;
    section.hidden = false;
    section.replaceChildren();

    if (this.leaderboardSkipReason) {
      const note = document.createElement('p');
      note.className = 'heist-report__leaderboard-muted';
      note.textContent = `This run is not on the board — ${leaderboardSkipText(this.leaderboardSkipReason)}`;
      section.append(note);
      return;
    }

    const payload = this.leaderboardPayload;
    const board = payload?.boards.find((candidate) => candidate.key.startsWith('daily:') || candidate.key.startsWith('solo:daily:') || candidate.key === 'nightshift:all' || candidate.key === 'solo:nightshift:all');
    if (!payload || !board) {
      section.hidden = true;
      return;
    }
    const heading = document.createElement('h2');
    heading.className = 'heist-report__leaderboard-title';
    const solo = board.key.startsWith('solo:');
    heading.textContent = board.key.includes('daily:')
      ? (solo ? 'Solo + AI daily board' : 'Daily board')
      : (solo ? 'Solo + AI board' : 'Night Shift board');
    section.append(heading);
    const list = renderLeaderboardRows(board.entries, board.key, payload.id);
    list.dataset.testid = 'leaderboard-list';
    section.append(list);
    const rank = document.createElement('p');
    rank.className = 'heist-report__leaderboard-rank';
    rank.dataset.testid = 'leaderboard-rank';
    rank.textContent = board.rank == null ? 'Outside the top 10' : `You placed #${board.rank}`;
    section.append(rank);

    const form = document.createElement('form');
    form.className = 'heist-report__leaderboard-form';
    form.addEventListener('submit', (event) => event.preventDefault());
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.testid = 'leaderboard-name-input';
    input.maxLength = 16;
    input.placeholder = 'Your name';
    input.autocomplete = 'off';
    input.enterKeyHint = 'done';
    input.value = this.leaderboardName;
    input.addEventListener('input', () => { this.leaderboardName = input.value; });
    const label = document.createElement('label');
    const team = document.createElement('input');
    team.type = 'checkbox';
    team.dataset.testid = 'leaderboard-team';
    team.checked = this.leaderboardTeam;
    team.addEventListener('change', () => { this.leaderboardTeam = team.checked; });
    label.append(team, document.createTextNode('Team name'));
    const save = button('Save', 'btn', 'leaderboard-name-save');
    save.addEventListener('click', () => this.handlers.onLeaderboardName?.(input.value, team.checked));
    const status = document.createElement('small');
    status.dataset.testid = 'leaderboard-name-status';
    status.setAttribute('role', 'status');
    status.textContent = this.leaderboardNameStatus;
    form.append(input, label, save, status);
    section.append(form);
  }

  /** Builds `?seed=<code>&beat=<ms>` via shared/run.ts challengeUrl. */
  challengeUrl(): string {
    const base = new URL(window.location.href);
    for (const key of ['report', 'autotest', 'debug', 'play', 'room', 'dev', 'mode']) {
      base.searchParams.delete(key);
    }
    if (this.stats?.seed == null) return base.toString();
    const ms = Math.round((this.stats.elapsedSeconds ?? 0) * 1000);
    return buildChallengeUrl(base, {
      seed: this.stats.seed >>> 0,
      beat: Math.max(0, ms),
    });
  }

  private async copyChallengeLink(): Promise<void> {
    const link = this.challengeUrl();
    this.challengeHint.hidden = false;
    try {
      await navigator.clipboard.writeText(link);
      this.challengeHint.textContent = 'Challenge link copied. Beat this time.';
      this.handlers.audio?.success();
    } catch {
      this.challengeHint.textContent = link;
      this.handlers.audio?.warning();
    }
  }

  private async saveCard(): Promise<void> {
    if (!this.stats) return;
    const blob = await renderShareCard(this.stats);
    const filename = `pix-nee-heist-${formatRunTime(this.stats.elapsedSeconds).replace(':', 'm')}s.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    const canShare = typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });
    if (canShare) {
      try {
        await navigator.share({
          files: [file],
          title: 'PIX & NEE Heist Report',
          text: `Case closed in ${formatRunTime(this.stats.elapsedSeconds)}. Can you beat it?`,
        });
        this.handlers.audio?.success();
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
    this.handlers.audio?.click(0.8);
  }

  private clearGradeTimers(): void {
    for (const id of this.gradeTimers) window.clearTimeout(id);
    this.gradeTimers = [];
  }
}

function button(label: string, className: string, testId: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.setAttribute('aria-label', label);
  btn.dataset.testid = testId;
  return btn;
}

function wrapFace(role: DroneRole, mood: FaceMood, color: string, label: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `heist-report__crew-face heist-report__crew-face--${role}`;
  wrap.append(createFaceGlyph({ mood, color, size: 52, label }));
  const caption = document.createElement('span');
  caption.className = 'heist-report__crew-name';
  caption.textContent = label;
  wrap.append(caption);
  return wrap;
}

function cordDivider(): HTMLElement {
  const cord = document.createElement('span');
  cord.className = 'heist-report__crew-cord';
  cord.setAttribute('aria-hidden', 'true');
  return cord;
}

function leaderboardSkipText(reason: string): string {
  if (reason === 'bot' || reason === 'solo') return 'bot runs and solo runs are not ranked.';
  if (reason === 'players') return 'only co-op and solo-with-AI server runs are ranked.';
  if (reason === 'tainted') return 'tainted runs are not ranked.';
  if (reason === 'too-fast' || reason === 'daily-time' || reason === 'duration') return 'runs under the minimum time are not ranked.';
  if (reason === 'rate-limit') return 'too many submissions were made.';
  return 'this run was not eligible.';
}

/** 1200×630 share PNG: wordmark, time, grade faces, awards. */
export async function renderShareCard(stats: RunStats): Promise<Blob> {
  const width = 1200;
  const height = 630;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // Oak case-file paper (flat fill — no decorative gradient).
  ctx.fillStyle = '#F4EFE6';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#BE9162';
  ctx.fillRect(0, 0, width, 18);
  ctx.strokeStyle = '#A7B6B5';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 36, width - 48, height - 60);

  ctx.fillStyle = '#0A5BC2';
  ctx.font = '800 42px Archivo, sans-serif';
  ctx.fillText('PIX', 64, 110);
  ctx.strokeStyle = '#1E2A2B';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(158, 96);
  ctx.lineTo(232, 96);
  ctx.stroke();
  ctx.fillStyle = '#C42A55';
  ctx.fillText('NEE', 248, 110);

  ctx.fillStyle = '#5C6B6A';
  ctx.font = '700 22px "Atkinson Hyperlegible Next", sans-serif';
  ctx.fillText('Case closed', 64, 158);

  ctx.fillStyle = '#1E2A2B';
  ctx.font = '800 64px Archivo, sans-serif';
  ctx.fillText('Heist Report', 64, 230);

  const time = formatRunTime(stats.elapsedSeconds);
  ctx.fillStyle = '#142022';
  roundRectPath(ctx, 64, 260, 220, 88, 12);
  ctx.fill();
  ctx.fillStyle = '#3DDBFF';
  ctx.font = '800 56px Doto, monospace';
  ctx.fillText(time, 88, 322);

  const faces = gradeFaces(stats);
  faces.forEach((face, i) => {
    const x = 320 + i * 100;
    drawFaceGlyph(ctx, x, 260, 64, face.mood, face.color);
    ctx.fillStyle = '#5C6B6A';
    ctx.font = '700 16px "Atkinson Hyperlegible Next", sans-serif';
    ctx.fillText(face.caption, x + 4, 344);
  });

  let y = 380;
  for (const award of pickAwards(stats).slice(0, 3)) {
    ctx.fillStyle = awardAccent(award.owner);
    ctx.fillRect(64, y - 18, 4, 44);
    ctx.fillStyle = '#1E2A2B';
    ctx.font = '800 22px Archivo, sans-serif';
    ctx.fillText(award.title, 80, y);
    ctx.fillStyle = '#455352';
    ctx.font = '600 20px "Atkinson Hyperlegible Next", sans-serif';
    ctx.fillText(award.detail, 80, y + 28);
    y += 64;
  }

  ctx.fillStyle = '#7A5631';
  ctx.font = '800 28px Archivo, sans-serif';
  ctx.save();
  ctx.translate(980, 520);
  ctx.rotate(-0.18);
  ctx.strokeStyle = '#7A5631';
  ctx.lineWidth = 3;
  roundRectPath(ctx, -90, -36, 180, 56, 8);
  ctx.stroke();
  // Visual stamp stays uppercase; DOM accessible name uses sentence case + CSS.
  ctx.fillText((stats.outcome === 'win' ? 'Extracted' : 'Busted').toUpperCase(), -78, 8);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Demo / screenshot stats when `?report` is set. */
export function demoRunStats(): RunStats {
  return {
    elapsedSeconds: 5 * 60 + 42,
    timesSpotted: 1,
    objectsThrown: 4,
    tetherSaves: 2,
    clotheslines: 1,
    cordTwangs: 11,
    nearMisses: 3,
    crateHaulMeters: 14.5,
    spottedBy: ['nee'],
    yankBy: ['pix', 'pix', 'nee', 'pix'],
    outcome: 'win',
    seed: 123,
  };
}
