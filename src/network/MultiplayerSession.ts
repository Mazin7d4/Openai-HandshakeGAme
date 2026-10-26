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
import { warmupBudgetMs } from './ServerWarmup.ts';
import type {
  LeaderboardNameResult,
  LeaderboardRecordedPayload,
} from './LeaderboardApi.ts';
import type { PlayerSnapshot } from '../player/PlayerState.ts';
import type {
  DroneNetworkState,
  DroneRole,
  GrabbableNetworkState,
  HackNetworkState,
  MissionNetworkState,
  ObjectEventMessage,
  RoomStatus,
  RunNetworkState,
  SecurityNetworkState,
  EmoteId,
  EmotePlayedMessage,
  PingPlacedMessage,
  ObjectiveStateMessage,
  HazardTripMessage,
  ObjectiveEventMessage,
} from './NetworkTypes.ts';

const SEND_INTERVAL_MS = 50;
const CONNECT_RETRY_BUDGET_MS = 20_000;
const CONNECT_ATTEMPT_TIMEOUT_MS = 8_000;
const CONNECT_BACKOFFS_MS = [500, 1_000, 2_000, 3_000];
export const SERVER_STATE_EVENTS = ['bot-seat', 'drone-captured', 'drone-freed', 'rescued', 'capture-outcome'] as const;

class ConnectTimeoutError extends Error {
  constructor() {
    super('Connection timed out');
    this.name = 'ConnectTimeoutError';
  }
}

function errorNumber(error: unknown, ...keys: string[]): number {
  const value = error as Record<string, unknown> | null;
  for (const key of keys) {
    const number = Number(value?.[key]);
    if (Number.isFinite(number)) return number;
  }
  return NaN;
}

/** True only for failures that can happen while a sleeping host is coming back. */
export function isTransientConnectError(error: unknown): boolean {
  const code = errorNumber(error, 'status', 'statusCode', 'httpStatus', 'code');
  if (code === 522) return false;
  if (code >= 400 && code < 500) return false;

  const value = error as { message?: unknown; name?: unknown } | null;
  const message = String(value?.message ?? error ?? '').toLowerCase();
  if (/already full|\bfull\b|not found|does not exist|expired|disposed|invalid room|\blocked\b/.test(message)) return false;
  if ((code >= 500 && code < 600) || /\b5\d\d\b/.test(message)) return true;
  if (code === 1006 || code === 1001) return true;
  const codeText = String((error as { code?: unknown } | null)?.code ?? '').toLowerCase();
  return /failed to fetch|fetch failed|load failed|econnrefused|networkerror|network error|connection refused|enotfound|timed out|timeout|unable to connect|websocket.*(?:closed|close|connection)|(?:connection|socket).*(?:closed|reset|aborted|refused|failed)/.test(message)
    || /econnrefused|etimedout|enetwork|econnreset/.test(codeText)
    || value?.name === 'ConnectTimeoutError';
}

function connectRetryBudgetMs(): number {
  return Math.min(CONNECT_RETRY_BUDGET_MS, warmupBudgetMs());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withConnectTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: number | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = window.setTimeout(() => {
        // A slow attempt that still succeeds later would hold a seat (and make the retry "full"): leave it.
        operation.then((late) => { void (late as { leave?: (consented?: boolean) => unknown })?.leave?.(true); }, () => {});
        reject(new ConnectTimeoutError());
      }, timeoutMs);
      operation.then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

async function retryInitialConnect<T>(connect: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const budget = connectRetryBudgetMs();
  let retry = 0;
  while (true) {
    const remaining = budget - (Date.now() - startedAt);
    if (remaining <= 0) throw new ConnectTimeoutError();
    try {
      return await withConnectTimeout(connect(), Math.min(CONNECT_ATTEMPT_TIMEOUT_MS, remaining));
    } catch (error) {
      const left = budget - (Date.now() - startedAt);
      if (!isTransientConnectError(error) || left <= 0) throw error;
      const backoff = CONNECT_BACKOFFS_MS[Math.min(retry++, CONNECT_BACKOFFS_MS.length - 1)];
      if (left <= backoff) throw error;
      await delay(backoff);
    }
  }
}

export type JoinErrorKind = 'not-found' | 'full' | 'server' | 'malformed' | 'unknown';
export interface ClassifiedJoinError { kind: JoinErrorKind; message: string }

/** Normalize Colyseus join errors without changing session synchronization. */
export function classifyJoinError(error: unknown, code = ''): ClassifiedJoinError {
  const room = code.trim().toUpperCase();
  const value = error as { code?: unknown; message?: unknown } | null;
  const numericCode = Number(value?.code);
  const message = String(value?.message ?? error ?? '').toLowerCase();
  const server = /failed to fetch|fetch failed|load failed|econnrefused|networkerror|network error|websocket|connection refused|enotfound|timed out|timeout|unable to connect/.test(message);
  const full = /already full|no longer available|\bfull\b|\blocked\b|maximum clients|max clients/.test(message);
  const missing = /not found|does not exist|expired|disposed|invalid room/.test(message);
  if (!/^[A-HJ-NP-Z2-9]{4}$/.test(room)) return { kind: 'malformed', message: 'Enter the 4-character code.' };
  if (server) return { kind: 'server', message: import.meta.env.PROD
    ? "Can't reach the game server right now. Check your connection and try again in a moment."
    : 'Multiplayer server unavailable. Restart with npm run dev, or run npm run server beside npm run dev:client.' };
  // Colyseus 0.18 uses 522/523; older deployments used 4212 for invalid room IDs.
  if (numericCode === 4212 || numericCode === 522) {
    if (full) return { kind: 'full', message: `Room ${room} is full — two drones max.` };
    if (missing || !message) return { kind: 'not-found', message: `Room ${room} wasn't found. It may have expired — ask your friend for a new code.` };
  }
  if (full) return { kind: 'full', message: `Room ${room} is full — two drones max.` };
  if (missing) return { kind: 'not-found', message: `Room ${room} wasn't found. It may have expired — ask your friend for a new code.` };
  return { kind: 'unknown', message: String(value?.message ?? error ?? 'Unable to join room.') };
}

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
  bot?: boolean;
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
  rematchVote?: boolean;
  lootDelivered?: number;
  lootCarrySeconds?: number;
  passes?: number;
  rescues?: number;
  capturedCount?: number;
  grabs?: number;
  hacks?: number;
}

interface SchemaRun {
  mode: string;
  seed: number;
  floor: number;
  captures: number;
  maxCaptures: number;
  startedAt: number;
  floorTimes: ArrayLike<number> & Iterable<number>;
  score: number;
  streak: number;
  multiplier: number;
  lastFloorPoints: number;
  floorCleared: boolean;
  ended: boolean;
  rematches: number;
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
  score: 0,
  streak: 0,
  multiplier: 1,
  lastFloorPoints: 0,
  floorCleared: false,
  ended: false,
  rematches: 0,
};

export interface FloorClearedMessage {
  floor: number;
  seed: number;
  points: number;
  base: number;
  multiplier: number;
  streak: number;
  total: number;
  clean: boolean;
  boss?: boolean;
  job?: string;
  next: { seed: number; floor: number };
}

export interface RunEndedMessage {
  reason: 'captures' | string;
  captures: number;
  floor: number;
  seed: number;
  score: number;
  multiplier: number;
  streak: number;
}

export interface RematchStartMessage {
  seed: number;
  mode: RunMode;
  floor: number;
  rematches: number;
}

export interface CreateRoomOptions {
  seed?: number;
  mode?: RunMode;
  bot?: boolean;
  /** Challenge beat target in ms (client-only; not sent to the server). */
  beat?: number;
}

export interface QuickMatchOptions extends CreateRoomOptions {
  qmKey: string;
}

function copyPlayer(player: SchemaPlayer): DroneNetworkState {
  return {
    playerId: player.playerId,
    role: player.role,
    bot: player.bot === true,
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
    rematchVote: player.rematchVote === true,
    lootDelivered: Math.max(0, (player.lootDelivered ?? 0) | 0),
    lootCarrySeconds: Number.isFinite(player.lootCarrySeconds) ? Number(player.lootCarrySeconds) : 0,
    passes: Math.max(0, (player.passes ?? 0) | 0),
    rescues: Math.max(0, (player.rescues ?? 0) | 0),
    capturedCount: Math.max(0, (player.capturedCount ?? 0) | 0),
    grabs: Math.max(0, (player.grabs ?? 0) | 0),
    hacks: Math.max(0, (player.hacks ?? 0) | 0),
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
  private readonly floorClearedListeners = new Set<(message: FloorClearedMessage) => void>();
  private readonly runEndedListeners = new Set<(message: RunEndedMessage) => void>();
  private readonly rematchStartListeners = new Set<(message: RematchStartMessage) => void>();
  private readonly rematchPartnerLeftListeners = new Set<(message: { role: DroneRole }) => void>();
  private readonly leaderboardListeners = new Set<(message: LeaderboardRecordedPayload) => void>();
  private readonly leaderboardSkippedListeners = new Set<(message: { reason: string }) => void>();
  private readonly leaderboardNameResultListeners = new Set<(message: LeaderboardNameResult) => void>();
  private readonly pingListeners = new Set<(message: PingPlacedMessage) => void>();
  private readonly emoteListeners = new Set<(message: EmotePlayedMessage) => void>();
  private readonly objectEventListeners = new Set<(message: ObjectEventMessage) => void>();
  private readonly objectiveStateListeners = new Set<(message: ObjectiveStateMessage) => void>();
  private readonly hazardTripListeners = new Set<(message: HazardTripMessage) => void>();
  private readonly objectiveEventListeners = new Set<(message: ObjectiveEventMessage) => void>();
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
  /** Prevent a delayed floor-start for an older floor or seed from rewinding layout. */
  private lastAppliedFloor: number | null = null;
  private lastAppliedSeed: number | null = null;
  lastLeaderboard: LeaderboardRecordedPayload | null = null;

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
    const createOptions: { seed?: number; mode?: RunMode; bot?: boolean } = {};
    if (typeof options.seed === 'number' && Number.isFinite(options.seed)) {
      createOptions.seed = options.seed >>> 0;
    }
    if (options.mode) createOptions.mode = options.mode;
    if (options.bot === true) createOptions.bot = true;
    const room = await retryInitialConnect(() => client.create<SchemaRoomState>('handshake', createOptions));
    return new MultiplayerSession(room, options.beat);
  }

  static async createBotRoom(options: { mode: RunMode; seed?: number }, timeoutMs: number): Promise<MultiplayerSession> {
    const client = new Client(serverEndpoint());
    const createOptions: { seed?: number; mode: RunMode; bot: true } = { mode: options.mode, bot: true };
    if (typeof options.seed === 'number' && Number.isFinite(options.seed)) createOptions.seed = options.seed >>> 0;
    const room = await withConnectTimeout(
      client.create<SchemaRoomState>('handshake', createOptions),
      Math.max(1, timeoutMs),
    );
    return new MultiplayerSession(room);
  }

  static async quickMatch(options: QuickMatchOptions): Promise<MultiplayerSession> {
    const client = new Client(serverEndpoint());
    const joinOptions: { quickMatch: true; qmKey: string; seed?: number; mode?: RunMode } = {
      quickMatch: true,
      qmKey: options.qmKey,
    };
    if (typeof options.seed === 'number' && Number.isFinite(options.seed)) {
      joinOptions.seed = options.seed >>> 0;
    }
    if (options.mode) joinOptions.mode = options.mode;
    const room = await retryInitialConnect(() => client.joinOrCreate<SchemaRoomState>('handshake', joinOptions));
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
    const room = await retryInitialConnect(() => client.joinById<SchemaRoomState>(normalized));
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

  requestBotPartner(): void {
    this.room.send('quickmatch-bot');
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
  debugStage(stage: 'hack-security' | 'steal-prototype' | 'escape'): void {
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

  /** TEST-ONLY: set server mission stats and clear the current Night Shift floor. */
  debugRunClear(stats: { timesSpotted?: number; elapsedSeconds?: number; tetherSaves?: number } = {}): void {
    this.room.send('debug-run-clear', stats);
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

  onFloorCleared(listener: (message: FloorClearedMessage) => void): () => void {
    this.floorClearedListeners.add(listener);
    return () => this.floorClearedListeners.delete(listener);
  }

  onRunEnded(listener: (message: RunEndedMessage) => void): () => void {
    this.runEndedListeners.add(listener);
    return () => this.runEndedListeners.delete(listener);
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

  sendPing(pos: { x: number; y: number; z: number }): void { this.room.send('ping', pos); }
  sendEmote(id: EmoteId): void { this.room.send('emote', { id }); }
  onPing(listener: (message: PingPlacedMessage) => void): () => void {
    this.pingListeners.add(listener); return () => this.pingListeners.delete(listener);
  }
  onEmote(listener: (message: EmotePlayedMessage) => void): () => void {
    this.emoteListeners.add(listener); return () => this.emoteListeners.delete(listener);
  }

  onObjectEvent(listener: (message: ObjectEventMessage) => void): () => void {
    this.objectEventListeners.add(listener); return () => this.objectEventListeners.delete(listener);
  }

  onObjectiveState(listener: (message: ObjectiveStateMessage) => void): () => void {
    this.objectiveStateListeners.add(listener);
    return () => this.objectiveStateListeners.delete(listener);
  }

  onHazardTrip(listener: (message: HazardTripMessage) => void): () => void {
    this.hazardTripListeners.add(listener);
    return () => this.hazardTripListeners.delete(listener);
  }

  onObjectiveEvent(listener: (message: ObjectiveEventMessage) => void): () => void {
    this.objectiveEventListeners.add(listener);
    return () => this.objectiveEventListeners.delete(listener);
  }

  reportTetherSave(): void {
    this.room.send('mission-tether-save');
  }

  sendRunNextFloor(floor: number): void {
    this.room.send('run-next-floor', { floor });
  }

  sendRunTwang(): void {
    this.room.send('run-twang');
  }

  retryMission(): void {
    this.room.send('mission-retry');
  }

  sendRematchVote(want: boolean): void {
    this.room.send('rematch-vote', { want: want === true });
  }

  onRematchStart(listener: (message: RematchStartMessage) => void): () => void {
    this.rematchStartListeners.add(listener);
    return () => this.rematchStartListeners.delete(listener);
  }

  onRematchPartnerLeft(listener: (message: { role: DroneRole }) => void): () => void {
    this.rematchPartnerLeftListeners.add(listener);
    return () => this.rematchPartnerLeftListeners.delete(listener);
  }

  onLeaderboard(listener: (message: LeaderboardRecordedPayload) => void): () => void {
    this.leaderboardListeners.add(listener);
    return () => this.leaderboardListeners.delete(listener);
  }

  onLeaderboardSkipped(listener: (message: { reason: string }) => void): () => void {
    this.leaderboardSkippedListeners.add(listener);
    return () => this.leaderboardSkippedListeners.delete(listener);
  }

  onLeaderboardNameResult(listener: (message: LeaderboardNameResult) => void): () => void {
    this.leaderboardNameResultListeners.add(listener);
    return () => this.leaderboardNameResultListeners.delete(listener);
  }

  sendLeaderboardName(name: string, team = false): void {
    this.room.send('leaderboard-name', { name: name.slice(0, 16), team: team === true });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.networkState = 'disposed';
    this.reconnectDeadlineMs = null;
    this.listeners.clear();
    this.objectEventListeners.clear();
    this.objectiveStateListeners.clear();
    this.hazardTripListeners.clear();
    this.objectiveEventListeners.clear();
    this.rematchStartListeners.clear();
    this.rematchPartnerLeftListeners.clear();
    this.leaderboardListeners.clear();
    this.leaderboardSkippedListeners.clear();
    this.leaderboardNameResultListeners.clear();
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
    room.onMessage('ping-placed', (message: PingPlacedMessage) => {
      for (const listener of this.pingListeners) listener(message);
    });
    room.onMessage('emote-played', (message: EmotePlayedMessage) => {
      if (message?.id === 'here' || message?.id === 'wait' || message?.id === 'go' || message?.id === 'yay') {
        for (const listener of this.emoteListeners) listener(message);
      }
    });
    room.onMessage('object-event', (message: ObjectEventMessage) => {
      if (message?.objectId && message.event) {
        for (const listener of this.objectEventListeners) listener(message);
      }
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
    room.onMessage('objective-state', (message: ObjectiveStateMessage) => {
      const run = this.status.run;
      const key = Number.isFinite(message?.floor) && Number.isFinite(message?.seed)
        ? `${message.seed >>> 0}:${message.floor}:nightshift` : null;
      const runMatches = run.mode === 'nightshift' && message?.floor === run.floor && (message?.seed >>> 0) === run.seed;
      if (message?.state && key && (runMatches || this.lastFloorKey === key)) {
        for (const listener of this.objectiveStateListeners) listener(message);
      }
    });
    room.onMessage('hazard-trip', (message: HazardTripMessage) => {
      if (message?.id && (message.role === 'pix' || message.role === 'nee')) {
        for (const listener of this.hazardTripListeners) listener(message);
      }
    });
    room.onMessage('objective-event', (message: ObjectiveEventMessage) => {
      if (message?.type) for (const listener of this.objectiveEventListeners) listener(message);
    });
    room.onMessage('floor-start', (message: FloorStartPayload) => {
      this.handleFloorStart(message);
    });
    room.onMessage('floor-cleared', (message: FloorClearedMessage) => {
      const run = this.status.run;
      if (message?.next && run.mode === 'nightshift' && message.floor === run.floor && (message.seed >>> 0) === run.seed) {
        for (const listener of this.floorClearedListeners) listener(message);
      }
    });
    room.onMessage('run-ended', (message: RunEndedMessage) => {
      for (const listener of this.runEndedListeners) listener(message);
    });
    room.onMessage('leaderboard-recorded', (message: LeaderboardRecordedPayload) => {
      if (!message || typeof message.id !== 'string' || !Array.isArray(message.boards)) return;
      this.lastLeaderboard = message;
      for (const listener of this.leaderboardListeners) listener(message);
    });
    room.onMessage('leaderboard-skipped', (message: { reason?: unknown }) => {
      if (typeof message?.reason !== 'string') return;
      for (const listener of this.leaderboardSkippedListeners) listener({ reason: message.reason });
    });
    room.onMessage('leaderboard-name-result', (message: LeaderboardNameResult) => {
      if (!message || typeof message.ok !== 'boolean') return;
      for (const listener of this.leaderboardNameResultListeners) listener(message);
    });
    room.onMessage('rematch-start', (message: RematchStartMessage) => {
      if (!message || !Number.isFinite(message.seed) || !Number.isFinite(message.floor)) return;
      // A pinned Night Shift seed can reuse the same seed/floor key; rematch still needs
      // the normal floor-start layout reset to run for the new mission.
      this.lastFloorKey = null;
      this.lastAppliedFloor = null;
      this.lastAppliedSeed = null;
      this.lastLeaderboard = null;
      for (const listener of this.rematchStartListeners) listener(message);
    });
    room.onMessage('rematch-partner-left', (message: { role?: string }) => {
      const role = roleOrNull(message?.role ?? '');
      if (!role) return;
      for (const listener of this.rematchPartnerLeftListeners) listener({ role });
    });
    // The client derives these from synced state; handlers exist so the SDK does not warn about unhandled messages.
    for (const type of SERVER_STATE_EVENTS) room.onMessage(type, () => {});
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
      this.handleFloorStart({
        seed: run.seed,
        floor: run.floor,
        mode: run.mode,
        score: run.score,
        streak: run.streak,
        multiplier: run.multiplier,
        captures: run.captures,
      }, true);
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
      score: Number.isFinite(run.score) ? run.score : 0,
      streak: Number.isFinite(run.streak) ? run.streak : 0,
      multiplier: Number.isFinite(run.multiplier) ? run.multiplier : 1,
      lastFloorPoints: Number.isFinite(run.lastFloorPoints) ? run.lastFloorPoints : 0,
      floorCleared: run.floorCleared === true,
      ended: run.ended === true,
      rematches: Math.max(0, run.rematches | 0),
    };
  }

  private handleFloorStart(message: FloorStartPayload, _fromState = false): void {
    if (!message || !Number.isFinite(message.seed) || !Number.isFinite(message.floor)) return;
    const mode = message.mode ?? this.status.run?.mode ?? 'standard';
    const seed = message.seed >>> 0;
    if (mode === 'nightshift' && this.lastAppliedFloor !== null
      && (message.floor < this.lastAppliedFloor
        || (message.floor === this.lastAppliedFloor && seed !== this.lastAppliedSeed))) return;
    const key = `${seed}:${message.floor}:${mode}`;
    if (this.lastFloorKey === key) return;
    this.lastFloorKey = key;
    if (mode === 'nightshift') {
      this.lastAppliedFloor = message.floor;
      this.lastAppliedSeed = seed;
    }
    applyFloorStart({ seed, floor: message.floor, mode });
    for (const listener of this.floorStartListeners) listener({ ...message, mode });
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}
