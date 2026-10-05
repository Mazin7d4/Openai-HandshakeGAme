import type {
  BoostState,
  MovementState,
  OrientationState,
  Vec3State,
} from '../player/PlayerState.ts';

export type DroneRole = 'pix' | 'nee';

export interface DroneNetworkState {
  playerId: string;
  role: DroneRole;
  connected: boolean;
  position: Vec3State;
  velocity: Vec3State;
  orientation: OrientationState;
  boost: BoostState;
  movement: MovementState;
}

export interface RoomStatus {
  roomCode: string;
  started: boolean;
  localRole: DroneRole | null;
  players: ReadonlyMap<DroneRole, DroneNetworkState>;
}
