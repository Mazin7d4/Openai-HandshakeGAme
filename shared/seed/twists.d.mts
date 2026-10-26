import type { TwistId, TwistParams } from './index';
export declare const TWISTS: readonly TwistParams[];
export declare const BASE_CORD: { readonly restLength: number; readonly maxLength: number };
export declare const BASE_TIMER_SECONDS: number;
export declare function escalateFloor(floor: number, twist: TwistParams): import('./index').FloorEscalation;
export declare function cordForTwist(twist: TwistParams): { restLength: number; maxLength: number };
export type { TwistId, TwistParams };
