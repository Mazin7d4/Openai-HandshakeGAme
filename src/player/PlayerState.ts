export type MovementState = 'idle' | 'cruising' | 'boosting';
export type BoostState = 'off' | 'active';

export interface Vec3State {
  x: number;
  y: number;
  z: number;
}

export interface OrientationState {
  pitch: number;
  yaw: number;
  roll: number;
}

/** Plain snapshot a future Colyseus schema can copy without taking Babylon types. */
export interface PlayerSnapshot {
  id: string;
  position: Vec3State;
  velocity: Vec3State;
  orientation: OrientationState;
  movement: MovementState;
  boost: BoostState;
}

export function createPlayerSnapshot(id: string): PlayerSnapshot {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    orientation: { pitch: 0, yaw: 0, roll: 0 },
    movement: 'idle',
    boost: 'off',
  };
}
