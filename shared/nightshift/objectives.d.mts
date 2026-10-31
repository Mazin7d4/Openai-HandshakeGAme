import type { ObjectiveEvent, ObjectiveInput, ObjectivePlan, ObjectivePlayerInput, ObjectiveState, Vec3 } from './types.d.ts';

export declare const OBJECTIVE_TUNING: Readonly<Record<string, number>>;
export declare function createObjectiveState(plan: ObjectivePlan | null | undefined): ObjectiveState;
export declare function stepObjective(state: ObjectiveState, plan: ObjectivePlan, input: ObjectiveInput): ObjectiveEvent[];
export declare function lootLocked(state: ObjectiveState, plan: ObjectivePlan | null | undefined): boolean;
export declare function completeFragileCarry(state: ObjectiveState, plan: ObjectivePlan | null | undefined): boolean;
export declare function objectiveBotTarget(state: ObjectiveState, plan: ObjectivePlan, botRole: string, players: Array<ObjectivePlayerInput & { position?: Vec3 }>): Vec3 | null;
export declare function objectiveBotAvoidYank(state: ObjectiveState, plan: ObjectivePlan, carrier: string | null): boolean;
export declare function objectiveHud(state: ObjectiveState, plan: ObjectivePlan): { label: string; detail: string; progress: number };
export declare function serializeObjectiveState(state: ObjectiveState): ObjectiveState;
export declare function applyObjectiveSnapshot(state: ObjectiveState, snap: Partial<ObjectiveState>): ObjectiveState;
