export interface BotVec3 { x: number; y: number; z: number; }
export interface BotPlanarForward { x: number; z: number; }
export interface BotGoalInput {
  self: BotVec3;
  leader: BotVec3;
  leaderForward: BotPlanarForward | null;
  leaderHolding: boolean;
  leaderTrail?: readonly BotVec3[];
  selfHoldingLoot: boolean;
  exit: BotVec3 | null;
  leaderCaptured: boolean;
  capturedFor: number;
  threats: BotVec3[];
}
export type BotGoalMode = 'rescue' | 'carry' | 'pass' | 'follow' | 'hold';
export interface BotGoal { mode: BotGoalMode; point: BotVec3 | null; }

export declare const BOT_TUNING: {
  readonly followNear: 2.2;
  readonly followFar: 3.2;
  readonly passDistance: 1.2;
  readonly avoidRadius: 4;
  readonly rescueDelay: 0.8;
  readonly exitArrive: 3;
  readonly hackSeconds: 3.5;
  readonly objectiveRange: 15;
};
export declare function planarDistance(a: BotVec3, b: BotVec3): number;
export declare function shouldRescue(capturedFor: number): boolean;
export declare function avoidThreats(point: BotVec3, threats: BotVec3[], radius?: number): BotVec3;
export declare function botGoal(input: BotGoalInput): BotGoal;
