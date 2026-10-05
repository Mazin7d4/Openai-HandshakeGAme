import { Client, type Room } from '@colyseus/sdk';
import type { PlayerSnapshot } from '../player/PlayerState.ts';
import type { DroneNetworkState, DroneRole, RoomStatus } from './NetworkTypes.ts';

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
}

interface SchemaRoomState {
  started: boolean;
  players: Map<string, SchemaPlayer>;
}

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
  };
}

/** Colyseus room lifecycle and snapshot relay kept outside the gameplay classes. */
export class MultiplayerSession {
  readonly roomCode: string;

  private readonly room: Room<unknown, SchemaRoomState>;
  private readonly listeners = new Set<StatusListener>();
  private readonly players = new Map<DroneRole, DroneNetworkState>();
  private status: RoomStatus;
  private lastSendAt = 0;

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
    });
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
    let localRole: DroneRole | null = null;
    state.players.forEach((player, sessionId) => {
      const copy = copyPlayer(player);
      this.players.set(copy.role, copy);
      if (sessionId === this.room.sessionId || copy.playerId === this.room.sessionId) {
        localRole = copy.role;
      }
    });
    this.status = {
      roomCode: this.roomCode,
      started: state.started,
      localRole,
      players: this.players,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}
