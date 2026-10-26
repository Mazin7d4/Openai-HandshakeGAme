import type { RunSeed } from './index';
export declare function getRunSeed(override?: { seed?: number; floor?: number } | null): RunSeed;
export declare function nextFloorSeed(current: RunSeed): RunSeed;
export declare function stashRunSeed(value: RunSeed): void;
export declare function setRunSeedGetter(getter: (() => RunSeed | null | undefined) | null): void;
