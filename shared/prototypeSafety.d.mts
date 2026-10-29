interface Point { x: number; y: number; z: number }
/** Reachable recovery pose, or null when the free loot is already in playable space. */
export function prototypeRecovery(position: Point, cradle: Point, alarm?: boolean): Point | null;
