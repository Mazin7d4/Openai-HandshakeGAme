import { Client, CloseCode, type Room } from '@colyseus/sdk';
import { reportStabilityIssue } from '../dev/StabilityDiagnostics.ts';
import {
  applyFloorStart,
  setBeatTarget,
  syncNetworkRun,
} from '../run/ClientRun.ts';
import type { FloorStartPayload, RunMode } from '../../shared/run.ts';
import { isRunMode } from '../../shared/run.ts';
import {
  clearReconnectionToken,
  loadReconnectionToken,
  RECONNECT_GRACE_SECONDS,
  storeReconnectionToken,
} from './ReconnectionToken.ts';
import { serverEndpoint } from './ServerEndpoint.ts';
import type { PlayerSnapshot } from '../player/PlayerState.ts';
import type {
  DroneNetworkState,
  DroneRole,
  GrabbableNetworkState,
  HackNetworkState,
  MissionNetworkState,
  RoomStatus,
  RunNetworkState,
  SecurityNetworkState,
} from './NetworkTypes.ts';

const SEND_INTERVAL_MS = 50;

/** Partner tether move relayed (and validated) by the server. */
export interface PatrolStunMessage { index: number; by?: string; clotheslines?: number; x: number; y: number; z: number }

/** Server-detected patrol shove (broadcast; the shoved role's own client applies the impulse). */
export interface PatrolShoveMessage { index: number; role: DroneRole; impulse: { x: number; y: number; z: number } }

export interface TetherYankMessage {
  kind: 'yank' | 'sling' | 'bump';
  rescue: boolean;
  strength: number;
  impulse: { x: number; y: number; z: number };
}

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
  captured?: boolean;
  capturedBy?: number;
  struggles?: number;
  carryFor?: number;
  rescueProgress?: number;
}

interface SchemaRun {
  mode: string;
  seed: number;
  floor: number;
  captures: number;
  maxCaptures: number;
  startedAt: number;
  floorTimes: ArrayLike<number> & Iterable<number>;
  ended: boolean;
}

interface SchemaRoomState {
  started: boolean;
  players: Map<string, SchemaPlayer>;
  objects: Map<string, SchemaObject>;
  hack: SchemaHack;
  mission: SchemaMission;
  security?: SchemaSecurity;
  run?: SchemaRun;
}

interface SchemaSecurity {
  patrols: ArrayLike<{ x: number; y: number; z: number; stunned: boolean }> & Iterable<{ x: number; y: number; z: number; stunned: boolean }>;
  cameraDisabled: boolean;
  detectionPix: number;
  detectionNee: number;
}

interface SchemaObject {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  orientation: { pitch: number; yaw: number; roll: number };
  heldBy: string;
  holderId: string;
  lastEvent: string;
  authority: DroneRole;
  mode: 'free' | 'held';
  revision: number;
}

interface SchemaHack {
  stationAOwner: string;
  stationBOwner: string;
  stationCOwner: string;
  stationAComplete: boolean;
  stationBComplete: boolean;
  stationCComplete: boolean;
  doorOpen: boolean;
}

interface SchemaMission {
  stage: MissionNetworkState['stage'];
  alarm: boolean;
  securityActive: boolean;
  prototypeHeldBy: string;
  extracted: boolean;
  elapsedSeconds: number;
  timesSpotted: number;
  objectsThrown: number;
  tetherSaves: number;
}

const EMPTY_HACK: HackNetworkState = {
  stationAOwner: null,
  stationBOwner: null,
  stationCOwner: null,
  stationAComplete: false,
  stationBComplete: false,
  stationCComplete: false,
  doorOpen: false,
};

const EMPTY_MISSION: MissionNetworkState = {
  stage: 'infiltrate', alarm: false, securityActive: false, prototypeHeldBy: null,
  extracted: false, elapsedSeconds: 0, timesSpotted: 0, objectsThrown: 0, tetherSaves: 0,
};

const EMPTY_SECURITY: SecurityNetworkState = { patrols: [], cameraDisabled: false, detection: { pix: 0, nee: 0 } };

const EMPTY_RUN: RunNetworkState = {
  mode: 'standard',
  seed: 0,
  floor: 1,
  captures: 0,
  maxCaptures: 3,
  startedAt: 0,
  floorTimes: [],
  ended: false,
};

export interface CreateRoomOptions {
  seed?: number;
  mode?: RunMode;
  /** Challenge beat target in ms (client-only; not sent to the server). */
  beat?: number;
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
    captured: player.captured === true,
    capturedBy: Number.isFinite(player.capturedBy) ? (player.capturedBy as number) : -1,
    struggles: Math.max(0, (player.struggles ?? 0) | 0),
    carryFor: Number.isFinite(player.carryFor) ? Number(player.carryFor) : 0,
    rescueProgress: Math.max(0, Math.min(1, Number(player.rescueProgress) || 0)),
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
    holderId: object.holderId ?? '',
    lastEvent: object.lastEvent ?? '',
    authority: object.authority,
    mode: object.mode,
    revision: object.revision,
  };
}

function configureAutoReconnect(room: Room): void {
  // Cover the server grace window with SDK retries before falling back to manual reconnect.
  room.reconnection.minUptime = 0;
  room.reconnection.maxRetries = 24;
  room.reconnection.delay = 250;
  room.reconnection.minDelay = 250;
  room.reconnection.maxDelay = 2_000;
}

/** Colyseus room lifecycle and snapshot relay kept outside the gameplay classes. */
export class MultiplayerSession {
  readonly roomCode: string;

  private room: Room<unknown, SchemaRoomState>;
  private readonly listeners = new Set<StatusListener>();
  private readonly yankListeners = new Set<(message: TetherYankMessage) => void>();
  private readonly patrolListeners = new Set<(message: PatrolStunMessage) => void>();
  private readonly shoveListeners = new Set<(message: PatrolShoveMessage) => void>();
  private readonly spottedListeners = new Set<(role: DroneRole) => void>();
  private readonly floorStartListeners = new Set<(payload: FloorStartPayload) => void>();
  private readonly players = new Map<DroneRole, DroneNetworkState>();
  private readonly objects = new Map<string, GrabbableNetworkState>();
  private status: RoomStatus;
  private lastSendAt = 0;
  private readonly lastObjectSendAt = new Map<string, number>();
  private networkState = 'connected';
  private disposed = false;
  private reconnectDeadlineMs: number | null = null;
  private manualReconnectInFlight = false;
  /** Last applied floor key so reconnect / first sync still fires the layout hook once. */
  private lastFloorKey: string | null = null;

  private constructor(room: Room<unknown, SchemaRoomState>, beat?: number) {
    this.room = room;
    this.roomCode = room.roomId.toUpperCase();
    if (beat != null) setBeatTarget(beat);
    this.status = {
      roomCode: this.roomCode,
      started: false,
      localRole: null,
      players: this.players,
      objects: this.objects,
      hack: EMPTY_HACK,
      mission: EMPTY_MISSION,
      security: EMPTY_SECURITY,
      run: EMPTY_RUN,
    };
    this.bindRoom(room);
    this.persistToken();
    this.readState(room.state);
  }

  static async createRoom(options: CreateRoomOptions = {}): Promise<MultiplayerSession> {
    const client = new Client(serverEndpoint());
    const createOptions: { seed?: number; mode?: RunMode } = {};
    if (typeof options.seed === 'number' && Number.isFinite(options.seed)) {
      createOptions.seed = options.seed >>> 0;
    }
    if (options.mode) createOptions.mode = options.mode;
    const room = await client.create<SchemaRoomState>('handshake', createOptions);
    return new MultiplayerSession(room, options.beat);
  }

  static async joinRoom(code: string, options: CreateRoomOptions = {}): Promise<MultiplayerSession> {
    const normalized = code.trim().toUpperCase();
    const existing = loadReconnectionToken(normalized);
    if (existing) {
      try {
        return await MultiplayerSession.reconnect(existing, options.beat);
      } catch {
        clearReconnectionToken(normalized);
      }
    }
    const client = new Client(serverEndpoint());
    const room = await client.joinById<SchemaRoomState>(normalized);
    return new MultiplayerSession(room, options.beat);
  }

  /** Resume a seat with a stored Colyseus reconnection token (page refresh / rejoin link). */
  static async reconnect(token: string, beat?: number): Promise<MultiplayerSession> {
    const client = new Client(serverEndpoint());
    const room = await client.reconnect<SchemaRoomState>(token);
    return new MultiplayerSession(room, beat);
  }

  /** Try sessionStorage token for a room code; returns null if missing or expired. */
  static async resumeRoom(code: string, beat?: number): Promise<MultiplayerSession | null> {
    const token = loadReconnectionToken(code);
    if (!token) return null;
    try {
      return await MultiplayerSession.reconnect(token, beat);
    } catch {
      clearReconnectionToken(code);
      return null;
    }
  }

  get currentStatus(): RoomStatus {
    return this.status;
  }

  get connectionState(): string {
    return this.networkState;
  }

  /** Seconds left in the local reconnect attempt window, or null when not reconnecting. */
  get reconnectSecondsLeft(): number | null {
    if (this.reconnectDeadlineMs == null) return null;
    return Math.max(0, Math.ceil((this.reconnectDeadlineMs - Date.now()) / 1000));
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
    if (this.networkState !== 'connected') {
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

  requestHandoff(objectId: string): void {
    this.room.send('handoff-object', { objectId });
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

  startHack(stationId: 'terminal-a' | 'terminal-b' | 'terminal-c'): void {
    this.room.send('hack-start', { stationId });
  }

  completeHack(stationId: 'terminal-a' | 'terminal-b' | 'terminal-c'): void {
    this.room.send('hack-complete', { stationId });
  }

  cancelHack(stationId: 'terminal-a' | 'terminal-b' | 'terminal-c'): void {
    this.room.send('hack-cancel', { stationId });
  }

  /** The server detected a drone in the security camera (it already counted it). */
  onSecuritySpotted(listener: (role: DroneRole) => void): () => void {
    this.spottedListeners.add(listener);
    return () => this.spottedListeners.delete(listener);
  }

  /** The server's patrol shoved a drone; its owner applies the impulse (movement stays client-owned). */
  onPatrolShove(listener: (message: PatrolShoveMessage) => void): () => void {
    this.shoveListeners.add(listener);
    return () => this.shoveListeners.delete(listener);
  }

  /** TEST-ONLY: honoured by the server only when it runs with HANDSHAKE_TEST_HOOKS=1. */
  debugStage(stage: 'escape'): void {
    this.room.send('debug-stage', { stage });
  }

  /** TEST-ONLY: Night Shift escape → advance floor/seed (HANDSHAKE_TEST_HOOKS=1). */
  debugRunEscape(): void {
    this.room.send('debug-run-escape');
  }

  /** TEST-ONLY: Night Shift capture (HANDSHAKE_TEST_HOOKS=1). */
  debugRunCapture(): void {
    this.room.send('debug-run-capture');
  }

  /** TEST-ONLY: force a patrol to grab a role (HANDSHAKE_TEST_HOOKS=1). */
  debugForceCapture(role: DroneRole, index = 0): void {
    this.room.send('debug-force-capture', { role, index });
  }

  /** TEST-ONLY: force-free a captured role (HANDSHAKE_TEST_HOOKS=1). */
  debugForceRelease(role: DroneRole, reason = 'yank'): void {
    this.room.send('debug-force-release', { role, reason });
  }

  /** TEST-ONLY: freeze autonomous patrol AI grabs/shoves (HANDSHAKE_TEST_HOOKS=1). */
  debugPatrolFreeze(frozen = true): void {
    this.room.send('debug-patrol-freeze', { frozen });
  }

  /** TEST-ONLY: clear patrol stuns (HANDSHAKE_TEST_HOOKS=1). */
  debugClearStuns(): void {
    this.room.send('debug-clear-stuns');
  }

  /** Boost-struggle while captured (also inferred from snapshot boost edges). */
  reportStruggle(): void {
    this.room.send('capture-struggle');
  }

  onFloorStart(listener: (payload: FloorStartPayload) => void): () => void {
    this.floorStartListeners.add(listener);
    return () => {
      this.floorStartListeners.delete(listener);
    };
  }

  /** Ask the server to stun a patrol; it arbitrates and broadcasts 'patrol-stunned' to both clients. */
  requestPatrolStun(message: PatrolStunMessage): void {
    this.room.send('patrol-stun', message);
  }

  onPatrolStunned(listener: (message: PatrolStunMessage) => void): () => void {
    this.patrolListeners.add(listener);
    return () => this.patrolListeners.delete(listener);
  }

  sendTetherYank(message: TetherYankMessage): void {
    this.room.send('tether-yank', message);
  }

  onTetherYanked(listener: (message: TetherYankMessage) => void): () => void {
    this.yankListeners.add(listener);
    return () => this.yankListeners.delete(listener);
  }

  reportTetherSave(): void {
    this.room.send('mission-tether-save');
  }

  retryMission(): void {
    this.room.send('mission-retry');
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.networkState = 'disposed';
    this.reconnectDeadlineMs = null;
    this.listeners.clear();
    clearReconnectionToken(this.roomCode);
    this.room.removeAllListeners();
    await this.room.leave(true);
  }

  /** TEST-ONLY (?autotest): force an unexpected socket close so reconnect can be exercised. */
  dropConnectionForTest(): void {
    this.reconnectDeadlineMs ??= Date.now() + RECONNECT_GRACE_SECONDS * 1000;
    this.networkState = 'reconnecting';
    this.emit();
    // 4010 MAY_TRY_RECONNECT is an allowed browser close code that the SDK retries on,
    // and the server treats as an unexpected drop (seat held via allowReconnection).
    this.room.connection.close(CloseCode.MAY_TRY_RECONNECT, 'autotest-drop');
  }

  private bindRoom(room: Room<unknown, SchemaRoomState>): void {
    configureAutoReconnect(room);
    room.onStateChange((state) => {
      try {
        this.readState(state);
      } catch (error) {
        reportStabilityIssue('network', 'Failed to apply a Colyseus state update.', error);
      }
    });
    room.onMessage('tether-yanked', (message: TetherYankMessage) => {
      for (const listener of this.yankListeners) listener(message);
    });
    room.onMessage('patrol-stunned', (message: PatrolStunMessage) => {
      for (const listener of this.patrolListeners) listener(message);
    });
    room.onMessage('patrol-shove', (message: PatrolShoveMessage) => {
      for (const listener of this.shoveListeners) listener(message);
    });
    room.onMessage('security-spotted', (message: { role?: string }) => {
      const role = roleOrNull(message?.role ?? '');
      if (role) for (const listener of this.spottedListeners) listener(role);
    });
    room.onMessage('floor-start', (message: FloorStartPayload) => {
      this.handleFloorStart(message);
    });
    room.onReconnect(() => {
      this.networkState = 'connected';
      this.reconnectDeadlineMs = null;
      this.persistToken();
      this.readState(room.state);
      this.emit();
    });
    room.onDrop(() => {
      if (this.disposed) return;
      this.networkState = 'reconnecting';
      this.reconnectDeadlineMs ??= Date.now() + RECONNECT_GRACE_SECONDS * 1000;
      this.emit();
    });
    room.onError((code, message) => {
      this.networkState = 'error';
      reportStabilityIssue('network', `Colyseus error ${code}: ${message ?? 'unknown error'}`);
      this.emit();
    });
    room.onLeave((code) => {
      void this.handleLeave(code);
    });
  }

  private persistToken(): void {
    if (this.room.reconnectionToken) {
      storeReconnectionToken(this.roomCode, this.room.reconnectionToken);
    }
  }

  private async handleLeave(code: number): Promise<void> {
    if (this.disposed) return;

    // SDK auto-retries only a few codes (1001/1005/1006/4010) via onDrop.
    // Other unexpected closes (e.g. QA's socket.close(4999), or FAILED_TO_RECONNECT
    // after the SDK exhausts retries) land here as onLeave — still reclaim the seat
    // while the server grace window is open. Only consented / shutdown closes skip.
    const intentional =
      code === CloseCode.CONSENTED
      || code === CloseCode.NORMAL_CLOSURE
      || code === CloseCode.SERVER_SHUTDOWN;

    if (!intentional && !this.manualReconnectInFlight) {
      const recovered = await this.tryManualReconnect();
      if (recovered) return;
    }

    this.networkState = 'disconnected';
    this.reconnectDeadlineMs = null;
    clearReconnectionToken(this.roomCode);
    this.status = { ...this.status, started: false };
    this.emit();
  }

  private async tryManualReconnect(): Promise<boolean> {
    const deadline = this.reconnectDeadlineMs ?? (Date.now() + RECONNECT_GRACE_SECONDS * 1000);
    this.reconnectDeadlineMs = deadline;
    this.networkState = 'reconnecting';
    this.manualReconnectInFlight = true;
    this.emit();

    const token = loadReconnectionToken(this.roomCode) ?? this.room.reconnectionToken;
    if (!token) {
      this.manualReconnectInFlight = false;
      return false;
    }

    const client = new Client(serverEndpoint());
    while (!this.disposed && Date.now() < deadline) {
      try {
        const next = await client.reconnect<SchemaRoomState>(token);
        this.room.removeAllListeners();
        this.room = next;
        this.bindRoom(next);
        this.networkState = 'connected';
        this.reconnectDeadlineMs = null;
        this.persistToken();
        this.readState(next.state);
        this.manualReconnectInFlight = false;
        this.emit();
        return true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }

    this.manualReconnectInFlight = false;
    return false;
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
          stationCOwner: roleOrNull(state.hack.stationCOwner),
          stationAComplete: state.hack.stationAComplete,
          stationBComplete: state.hack.stationBComplete,
          stationCComplete: state.hack.stationCComplete,
          doorOpen: state.hack.doorOpen,
        }
      : EMPTY_HACK;
    const mission: MissionNetworkState = state.mission
      ? {
          stage: state.mission.stage,
          alarm: state.mission.alarm,
          securityActive: state.mission.securityActive,
          prototypeHeldBy: roleOrNull(state.mission.prototypeHeldBy),
          extracted: state.mission.extracted,
          elapsedSeconds: state.mission.elapsedSeconds,
          timesSpotted: state.mission.timesSpotted,
          objectsThrown: state.mission.objectsThrown,
          tetherSaves: state.mission.tetherSaves,
        }
      : EMPTY_MISSION;
    const security: SecurityNetworkState = state.security
      ? {
          patrols: Array.from(state.security.patrols ?? [], (p) => ({ x: p.x, y: p.y, z: p.z, stunned: p.stunned })),
          cameraDisabled: state.security.cameraDisabled,
          detection: { pix: state.security.detectionPix, nee: state.security.detectionNee },
        }
      : EMPTY_SECURITY;
    const run = this.copyRun(state.run);
    syncNetworkRun(run);
    // Reconnect / first join: apply layout hook from room state (deduped by seed:floor:mode).
    if (state.run) {
      this.handleFloorStart({ seed: run.seed, floor: run.floor, mode: run.mode }, true);
    }
    this.status = {
      roomCode: this.roomCode,
      started: state.started,
      localRole,
      players: this.players,
      objects: this.objects,
      hack,
      mission,
      security,
      run,
    };
    this.emit();
  }

  private copyRun(run: SchemaRun | undefined): RunNetworkState {
    if (!run) return EMPTY_RUN;
    const mode: RunMode = isRunMode(run.mode) ? run.mode : 'standard';
    return {
      mode,
      seed: (run.seed >>> 0),
      floor: run.floor,
      captures: run.captures,
      maxCaptures: run.maxCaptures || 3,
      startedAt: run.startedAt,
      floorTimes: Array.from(run.floorTimes ?? [], (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
      }),
      ended: run.ended === true,
    };
  }

  private handleFloorStart(message: FloorStartPayload, _fromState = false): void {
    if (!message || !Number.isFinite(message.seed) || !Number.isFinite(message.floor)) return;
    const mode = message.mode ?? this.status.run?.mode ?? 'standard';
    const key = `${message.seed >>> 0}:${message.floor}:${mode}`;
    if (this.lastFloorKey === key) return;
    this.lastFloorKey = key;
    applyFloorStart({ seed: message.seed >>> 0, floor: message.floor, mode });
    for (const listener of this.floorStartListeners) listener({ ...message, mode });
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}
