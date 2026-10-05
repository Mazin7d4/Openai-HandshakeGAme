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
  selfPowered: boolean;
  tetherPull: number;
}

export type GrabbableMode = 'free' | 'held';

export interface GrabbableNetworkState {
  id: string;
  position: Vec3State;
  velocity: Vec3State;
  orientation: OrientationState;
  heldBy: DroneRole | null;
  authority: DroneRole;
  mode: GrabbableMode;
  revision: number;
}

export interface HackNetworkState {
  stationAOwner: DroneRole | null;
  stationBOwner: DroneRole | null;
  stationAComplete: boolean;
  stationBComplete: boolean;
  doorOpen: boolean;
}

export interface RoomStatus {
  roomCode: string;
  started: boolean;
  localRole: DroneRole | null;
  players: ReadonlyMap<DroneRole, DroneNetworkState>;
  objects: ReadonlyMap<string, GrabbableNetworkState>;
  hack: HackNetworkState;
}
