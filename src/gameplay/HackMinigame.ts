export interface HackMinigameSnapshot {
  readonly width: number;
  readonly height: number;
  readonly sourceRow: number;
  readonly targetRow: number;
  readonly masks: readonly number[];
  readonly solutionMasks: readonly number[];
  readonly connected: ReadonlySet<number>;
  readonly completed: boolean;
}

export interface HackMinigame {
  readonly type: string;
  rotate(index: number): HackMinigameSnapshot;
  snapshot(): HackMinigameSnapshot;
}

/** Common lifetime contract for every DOM hacking task. */
export interface HackMinigameView {
  dispose(): void;
}
