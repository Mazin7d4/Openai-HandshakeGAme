import type { FlightAxes } from '../input/FlightAxes.ts';
import type { InteractionActions } from '../input/InteractionActions.ts';
import { controlIcon, keycaps } from './ControlGlyphs.ts';
import { isTouchPlayDevice } from './touchDetect.ts';

const STORAGE_KEY = 'handshake.onboardingDone';
/** A hint the player has not acted on moves on by itself so the coach never sticks. */
const STEP_TIMEOUT_MS = 9000;

export type OnboardingMode = 'singleplayer' | 'dev-local' | 'multiplayer';

interface CoachStep {
  id: string;
  prompt: string;
  /** Keyboard binding shown as keycaps when not on touch. */
  keys: string;
  /** Stroke glyph name from ControlGlyphs. */
  glyph: string;
  /** Solo-only steps (Tab switch) are skipped in multiplayer. */
  soloOnly?: boolean;
  done: (axes: FlightAxes, actions: InteractionActions) => boolean;
}

const STEPS: CoachStep[] = [
  {
    id: 'move',
    prompt: 'Fly around',
    keys: 'W A S D',
    glyph: 'fly',
    done: (axes) => Math.abs(axes.thrust) > 0.25 || Math.abs(axes.strafe) > 0.25,
  },
  {
    id: 'jump',
    prompt: 'Rise or boost',
    keys: 'Space / Shift',
    glyph: 'boost',
    done: (axes) => axes.lift > 0.25 || axes.boost,
  },
  {
    id: 'switch',
    prompt: 'Switch drone',
    keys: 'Tab',
    glyph: 'switch',
    soloOnly: true,
    done: (_axes, actions) => actions.switchDrone,
  },
  {
    id: 'yank',
    prompt: 'Yank the cord',
    keys: 'R',
    glyph: 'yank',
    done: (_axes, actions) => actions.yank,
  },
  {
    id: 'grab',
    prompt: 'Grab',
    keys: 'E',
    glyph: 'grab',
    done: (_axes, actions) => actions.grabDrop,
  },
  {
    id: 'hack',
    prompt: 'Hack a terminal',
    keys: 'F',
    glyph: 'hack',
    done: (_axes, actions) => actions.interact,
  },
];

function loadDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Private mode / quota
  }
}

export function clearOnboardingDone(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode
  }
}

export function isOnboardingDone(): boolean {
  return loadDone();
}

/**
 * First-run contextual coach in the spawn room: one short prompt at a time,
 * advances when the player performs the action. ~60s for judges on laptop/phone.
 */
export class OnboardingCoach {
  private readonly root: HTMLDivElement;
  private readonly promptEl: HTMLParagraphElement;
  private readonly glyphSlot: HTMLSpanElement;
  private readonly mode: OnboardingMode;
  private readonly touch: boolean;
  private steps: CoachStep[] = [];
  private index = 0;
  private active = false;
  private finishing = false;
  private finishTimer = 0;
  /** When the current step appeared; a step the player ignores moves on after STEP_TIMEOUT_MS. */
  private stepShownAt = 0;
  private readonly onSkipClick = () => this.skip();

  constructor(parent: HTMLElement, mode: OnboardingMode) {
    this.mode = mode;
    this.touch = isTouchPlayDevice();
    this.root = document.createElement('div');
    this.root.className = 'onboarding-coach';
    this.root.dataset.testid = 'onboarding-coach';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');

    this.glyphSlot = document.createElement('span');
    this.glyphSlot.className = 'onboarding-coach__glyph';

    this.promptEl = document.createElement('p');
    this.promptEl.className = 'onboarding-coach__prompt';

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn btn--quiet onboarding-coach__skip';
    skip.textContent = 'Skip';
    skip.dataset.testid = 'onboarding-skip';
    skip.addEventListener('click', this.onSkipClick);

    this.root.append(this.glyphSlot, this.promptEl, skip);
    parent.append(this.root);

    if (!loadDone()) this.begin();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Start or restart from the first step (also used by Settings → Replay tutorial). */
  begin(): void {
    window.clearTimeout(this.finishTimer);
    this.finishing = false;
    this.steps = STEPS.filter((step) => !step.soloOnly || this.mode !== 'multiplayer');
    this.index = 0;
    this.active = this.steps.length > 0;
    this.root.classList.remove('onboarding-coach--done');
    this.root.classList.toggle('visible', this.active);
    if (this.active) this.renderStep();
  }

  skip(): void {
    if (!this.active && !this.finishing) return;
    this.complete();
  }

  /** Called each gameplay frame with the local human sample. */
  observe(axes: FlightAxes, actions: InteractionActions): void {
    if (!this.active || this.finishing) return;
    const step = this.steps[this.index];
    if (!step) {
      this.complete();
      return;
    }
    if (step.done(axes, actions) || performance.now() - this.stepShownAt > STEP_TIMEOUT_MS) this.advance();
  }

  dispose(): void {
    window.clearTimeout(this.finishTimer);
    this.root.remove();
    this.active = false;
  }

  private advance(): void {
    this.index += 1;
    if (this.index >= this.steps.length) {
      this.showDone();
      return;
    }
    this.renderStep();
  }

  private showDone(): void {
    this.finishing = true;
    this.active = false;
    this.glyphSlot.replaceChildren();
    this.promptEl.textContent = "You've got it";
    this.root.classList.add('onboarding-coach--done', 'visible');
    this.finishTimer = window.setTimeout(() => this.complete(), 1200);
  }

  private complete(): void {
    window.clearTimeout(this.finishTimer);
    this.finishing = false;
    this.active = false;
    storeDone();
    this.root.classList.remove('visible');
    this.root.classList.add('onboarding-coach--done');
  }

  private renderStep(): void {
    const step = this.steps[this.index];
    if (!step) return;
    this.stepShownAt = performance.now();
    this.promptEl.textContent = step.prompt;
    this.glyphSlot.replaceChildren();
    if (this.touch) {
      this.glyphSlot.append(controlIcon(step.glyph, 'glyph onboarding-coach__touch-glyph'));
    } else {
      this.glyphSlot.append(keycaps(step.keys), controlIcon(step.glyph));
    }
  }
}
