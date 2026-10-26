export declare function mulberry32(seed: number): () => number;
export declare function mixSeed(seed: number, floor: number): number;
export declare function pick<T>(rand: () => number, items: readonly T[]): T;
export declare function intRange(rand: () => number, min: number, max: number): number;
