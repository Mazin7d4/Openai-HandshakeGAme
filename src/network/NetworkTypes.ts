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
  stationCOwner: DroneRole | null;
  stationAComplete: boolean;
  stationBComplete: boolean;
  stationCComplete: boolean;
  doorOpen: boolean;
}

export type MissionStage = 'infiltrate' | 'hack-security' | 'steal-prototype' | 'escape' | 'complete';

export interface MissionNetworkState {
  stage: MissionStage;
  alarm: boolean;
  securityActive: boolean;
  prototypeHeldBy: DroneRole | null;
  extracted: boolean;
  elapsedSeconds: number;
  timesSpotted: number;
  objectsThrown: number;
  tetherSaves: number;
}

/** Server-owned security (patrol drones + camera). Clients only render/interpolate it. */
export interface PatrolNetworkState { x: number; y: number; z: number; stunned: boolean }

export interface SecurityNetworkState {
  patrols: PatrolNetworkState[];
  cameraDisabled: boolean;
  detection: Record<DroneRole, number>;
}

export interface RoomStatus {
  roomCode: string;
  started: boolean;
  localRole: DroneRole | null;
  players: ReadonlyMap<DroneRole, DroneNetworkState>;
  objects: ReadonlyMap<string, GrabbableNetworkState>;
  hack: HackNetworkState;
  mission: MissionNetworkState;
  security: SecurityNetworkState;
}
