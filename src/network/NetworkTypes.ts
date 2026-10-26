import type {
  BoostState,
  MovementState,
  OrientationState,
  Vec3State,
} from '../player/PlayerState.ts';
import type { RunMode } from '../../shared/run.ts';

export type DroneRole = 'pix' | 'nee';
export type EmoteId = 'here' | 'wait' | 'go' | 'yay';
export interface ObjectEventMessage { objectId: string; event: string; from: DroneRole | ''; to: DroneRole | '' }
export interface PingPlacedMessage { role: DroneRole; x: number; y: number; z: number; id: number; at: number }
export interface EmotePlayedMessage { role: DroneRole; id: EmoteId; at: number }

/** Authoritative run fields mirrored from room state (seed / Night Shift). */
export interface RunNetworkState {
  mode: RunMode;
  seed: number;
  floor: number;
  captures: number;
  maxCaptures: number;
  startedAt: number;
  floorTimes: number[];
  score: number;
  streak: number;
  multiplier: number;
  lastFloorPoints: number;
  floorCleared: boolean;
  ended: boolean;
  rematches: number;
}

export interface DroneNetworkState {
  playerId: string;
  role: DroneRole;
  bot: boolean;
  connected: boolean;
  position: Vec3State;
  velocity: Vec3State;
  orientation: OrientationState;
  boost: BoostState;
  movement: MovementState;
  selfPowered: boolean;
  tetherPull: number;
  /** Server-owned capture (co-op). */
  captured: boolean;
  /** Patrol index holding this drone; -1 when free. */
  capturedBy: number;
  struggles: number;
  carryFor: number;
  /** 0–1 rescue progress from synced struggles. */
  rescueProgress: number;
  rematchVote: boolean;
  lootDelivered: number;
  lootCarrySeconds: number;
  passes: number;
  rescues: number;
  /** Number of times this drone has been captured; `captured` remains the live state. */
  capturedCount: number;
  grabs: number;
  hacks: number;
}

export type GrabbableMode = 'free' | 'held';

export interface GrabbableNetworkState {
  id: string;
  position: Vec3State;
  velocity: Vec3State;
  orientation: OrientationState;
  heldBy: DroneRole | null;
  holderId: string;
  lastEvent: string;
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
  run: RunNetworkState;
}
