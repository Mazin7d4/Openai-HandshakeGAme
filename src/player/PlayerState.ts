export type MovementState = 'idle' | 'cruising' | 'boosting';
export type BoostState = 'off' | 'active';

export interface Vec3State {
  x: number;
  y: number;
  z: number;
}

/** Plain snapshot a future Colyseus schema can copy without taking Babylon types. */
export interface PlayerSnapshot {
  id: string;
  position: Vec3State;
  velocity: Vec3State;
  movement: MovementState;
  boost: BoostState;
}

export function createPlayerSnapshot(id: string): PlayerSnapshot {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    movement: 'idle',
    boost: 'off',
  };
}
