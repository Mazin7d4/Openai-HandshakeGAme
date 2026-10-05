import { Client, type Room } from '@colyseus/sdk';
import type { PlayerSnapshot } from '../player/PlayerState.ts';
import type {
  DroneNetworkState,
  DroneRole,
  GrabbableNetworkState,
  HackNetworkState,
  RoomStatus,
} from './NetworkTypes.ts';

const SEND_INTERVAL_MS = 50;

type StatusListener = (status: RoomStatus) => void;

interface SchemaPlayer {
  playerId: string;
  role: DroneRole;
  connected: boolean;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  orientation: { pitch: number; yaw: number; roll: number };
  boost: 'off' | 'active';
  movement: 'idle' | 'cruising' | 'boosting';
  selfPowered: boolean;
  tetherPull: number;
}

interface SchemaRoomState {
  started: boolean;
  players: Map<string, SchemaPlayer>;
  objects: Map<string, SchemaObject>;
  hack: SchemaHack;
}

interface SchemaObject {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  orientation: { pitch: number; yaw: number; roll: number };
  heldBy: string;
  authority: DroneRole;
  mode: 'free' | 'held';
  revision: number;
}

interface SchemaHack {
  stationAOwner: string;
  stationBOwner: string;
  stationAComplete: boolean;
  stationBComplete: boolean;
  doorOpen: boolean;
}

const EMPTY_HACK: HackNetworkState = {
  stationAOwner: null,
  stationBOwner: null,
  stationAComplete: false,
  stationBComplete: false,
  doorOpen: false,
};

function serverEndpoint(): string {
  const configured = import.meta.env.VITE_COLYSEUS_URL as string | undefined;
  if (configured) {
    return configured;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:2567`;
}

function copyPlayer(player: SchemaPlayer): DroneNetworkState {
  return {
    playerId: player.playerId,
    role: player.role,
    connected: player.connected,
    position: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
    },
    velocity: {
      x: player.velocity.x,
      y: player.velocity.y,
      z: player.velocity.z,
    },
    orientation: {
      pitch: player.orientation.pitch,
      yaw: player.orientation.yaw,
      roll: player.orientation.roll,
    },
    boost: player.boost,
    movement: player.movement,
    selfPowered: player.selfPowered,
    tetherPull: player.tetherPull,
  };
}

function roleOrNull(value: string): DroneRole | null {
  return value === 'pix' || value === 'nee' ? value : null;
}

function copyObject(object: SchemaObject): GrabbableNetworkState {
  return {
    id: object.id,
    position: { ...object.position },
    velocity: { ...object.velocity },
    orientation: { ...object.orientation },
    heldBy: roleOrNull(object.heldBy),
    authority: object.authority,
    mode: object.mode,
    revision: object.revision,
  };
}

/** Colyseus room lifecycle and snapshot relay kept outside the gameplay classes. */
export class MultiplayerSession {
  readonly roomCode: string;

  private readonly room: Room<unknown, SchemaRoomState>;
  private readonly listeners = new Set<StatusListener>();
  private readonly players = new Map<DroneRole, DroneNetworkState>();
  private readonly objects = new Map<string, GrabbableNetworkState>();
  private status: RoomStatus;
  private lastSendAt = 0;
  private readonly lastObjectSendAt = new Map<string, number>();

  private constructor(room: Room<unknown, SchemaRoomState>) {
    this.room = room;
    room.reconnection.minUptime = 0;
    room.reconnection.maxDelay = 2_000;
    this.roomCode = room.roomId.toUpperCase();
    this.status = {
      roomCode: this.roomCode,
      started: false,
      localRole: null,
      players: this.players,
      objects: this.objects,
      hack: EMPTY_HACK,
    };

    room.onStateChange((state) => {
      this.readState(state);
    });
    room.onReconnect(() => {
      this.readState(room.state);
    });
    room.onLeave(() => {
      this.status = { ...this.status, started: false };
      this.emit();
    });
    this.readState(room.state);
  }

  static async createRoom(): Promise<MultiplayerSession> {
    const client = new Client(serverEndpoint());
    const room = await client.create<SchemaRoomState>('handshake');
    return new MultiplayerSession(room);
  }

  static async joinRoom(code: string): Promise<MultiplayerSession> {
    const client = new Client(serverEndpoint());
    const room = await client.joinById<SchemaRoomState>(code.trim().toUpperCase());
    return new MultiplayerSession(room);
  }

  get currentStatus(): RoomStatus {
    return this.status;
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  waitForStart(): Promise<RoomStatus> {
    if (this.status.started && this.status.localRole) {
      return Promise.resolve(this.status);
    }
    return new Promise((resolve) => {
      const remove = this.onStatus((status) => {
        if (status.started && status.localRole) {
          remove();
          resolve(status);
        }
      });
    });
  }

  publish(snapshot: PlayerSnapshot): void {
    const now = performance.now();
    if (now - this.lastSendAt < SEND_INTERVAL_MS || !this.status.localRole) {
      return;
    }
    this.lastSendAt = now;
    this.room.send('snapshot', {
      position: snapshot.position,
      velocity: snapshot.velocity,
      orientation: snapshot.orientation,
      boost: snapshot.boost,
      movement: snapshot.movement,
      selfPowered: snapshot.selfPowered,
      tetherPull: snapshot.tetherPull,
    });
  }

  requestGrab(objectId: string): void {
    this.room.send('grab-object', { objectId });
  }

  releaseObject(
    objectId: string,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    thrown: boolean,
  ): void {
    this.room.send('release-object', { objectId, position, velocity, thrown });
  }

  publishObject(state: GrabbableNetworkState): void {
    const now = performance.now();
    const previous = this.lastObjectSendAt.get(state.id) ?? 0;
    if (now - previous < SEND_INTERVAL_MS) {
      return;
    }
    this.lastObjectSendAt.set(state.id, now);
    this.room.send('object-snapshot', {
      objectId: state.id,
      position: state.position,
      velocity: state.velocity,
      orientation: state.orientation,
    });
  }

  startHack(stationId: 'terminal-a' | 'terminal-b'): void {
    this.room.send('hack-start', { stationId });
  }

  completeHack(stationId: 'terminal-a' | 'terminal-b'): void {
    this.room.send('hack-complete', { stationId });
  }

  cancelHack(stationId: 'terminal-a' | 'terminal-b'): void {
    this.room.send('hack-cancel', { stationId });
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.room.removeAllListeners();
    await this.room.leave(true);
  }

  private readState(state: SchemaRoomState): void {
    if (!state?.players) {
      return;
    }
    this.players.clear();
    this.objects.clear();
    let localRole: DroneRole | null = null;
    state.players.forEach((player, sessionId) => {
      const copy = copyPlayer(player);
      this.players.set(copy.role, copy);
      if (sessionId === this.room.sessionId || copy.playerId === this.room.sessionId) {
        localRole = copy.role;
      }
    });
    state.objects?.forEach((object) => {
      const copy = copyObject(object);
      this.objects.set(copy.id, copy);
    });
    const hack: HackNetworkState = state.hack
      ? {
          stationAOwner: roleOrNull(state.hack.stationAOwner),
          stationBOwner: roleOrNull(state.hack.stationBOwner),
          stationAComplete: state.hack.stationAComplete,
          stationBComplete: state.hack.stationBComplete,
          doorOpen: state.hack.doorOpen,
        }
      : EMPTY_HACK;
    this.status = {
      roomCode: this.roomCode,
      started: state.started,
      localRole,
      players: this.players,
      objects: this.objects,
      hack,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}
