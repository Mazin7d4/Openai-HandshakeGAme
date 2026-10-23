import { Room, Server, WebSocketTransport, matchMaker } from 'colyseus';
import { schema, t } from '@colyseus/schema';
import { createRequire } from 'node:module';
import layout from '../src/level/heist-layout.json' with { type: 'json' };
import { Security, createSecurityState, SecuritySim } from './security.mjs';
import {
  createRunState,
  advanceFloor,
  recordCapture,
  isRunMode,
  MAX_CAPTURES,
} from '../shared/run.ts';
import { applyRunLayout, generateRun } from '../shared/seed/index.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const PORT = Number.parseInt(process.env.PORT ?? '2567', 10);
// Test-only room messages. `npm run dev` (tools/dev.mjs) turns them on; deployments use `npm start`
// and must never enable them, so they are refused outright on Render.
const TEST_HOOKS = process.env.HANDSHAKE_TEST_HOOKS === '1' && !process.env.RENDER;
if (process.env.HANDSHAKE_TEST_HOOKS === '1' && process.env.RENDER) {
  console.warn('[handshake] HANDSHAKE_TEST_HOOKS ignored on Render');
}
const EMPTY_ROOM_SECONDS = Number.parseInt(process.env.EMPTY_ROOM_SECONDS ?? '60', 10);
const LONELY_ROOM_SECONDS = Number.parseInt(process.env.LONELY_ROOM_SECONDS ?? '900', 10);
// Seat hold after an unexpected drop. Tests may shorten via RECONNECT_SECONDS.
const RECONNECT_SECONDS = Number.parseInt(process.env.RECONNECT_SECONDS ?? '30', 10);

// --- CORS allow-list -----------------------------------------------------------
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const permissive = ALLOWED_ORIGINS.length === 0;

function isOriginAllowed(origin) {
  return permissive || !origin || ALLOWED_ORIGINS.includes(origin);
}

// --- Live-room tracking --------------------------------------------------------
const liveRooms = new Set();
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_WORLD_COORDINATE = 200;
const MAX_PLAYER_SPEED = 28;
const MAX_OBJECT_SPEED = 32;
const TERMINAL_RANGE = 5;
/** Mutable per-room world sinks filled by applyRunLayout (defaults match heist-layout.json). */
function createWorldSinks() {
  return {
    spawn: { x: layout.spawn.x, y: layout.spawn.y, z: layout.spawn.z },
    extraction: { x: layout.extraction.x, y: layout.extraction.y, z: layout.extraction.z },
    terminals: {
      'terminal-a': { ...layout.terminals['terminal-a'] },
      'terminal-b': { ...layout.terminals['terminal-b'] },
      'terminal-c': { ...layout.terminals['terminal-c'] },
    },
    infiltrationZ: layout.infiltrationZ,
  };
}

const Vec3 = schema(
  {
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
  },
  'Vec3',
);

const Orientation = schema(
  {
    pitch: t.float32().default(0),
    yaw: t.float32().default(0),
    roll: t.float32().default(0),
  },
  'Orientation',
);

const Player = schema(
  {
    playerId: t.string(),
    role: t.string(),
    connected: t.boolean().default(true),
    position: Vec3,
    velocity: Vec3,
    orientation: Orientation,
    boost: t.string().default('off'),
    movement: t.string().default('idle'),
    selfPowered: t.boolean().default(false),
    tetherPull: t.float32().default(0),
    /** Server-owned capture: locked input + position overridden while true. */
    captured: t.boolean().default(false),
    /** Patrol index holding this drone; -1 when free. */
    capturedBy: t.int8().default(-1),
    /** Struggle presses while captured (solo needs 3). */
    struggles: t.uint8().default(0),
    /** Seconds carried so far (rescue window is 4.5s). */
    carryFor: t.float32().default(0),
    /** 0–1 rescue progress (struggles / 3). */
    rescueProgress: t.float32().default(0),
  },
  'Player',
);

const Grabbable = schema(
  {
    id: t.string(),
    position: Vec3,
    velocity: Vec3,
    orientation: Orientation,
    heldBy: t.string().default(''),
    authority: t.string().default('pix'),
    mode: t.string().default('free'),
    revision: t.float32().default(0),
    grabRadius: t.float32().default(3.2),
  },
  'Grabbable',
);

const Hack = schema(
  {
    stationAOwner: t.string().default(''),
    stationBOwner: t.string().default(''),
    stationCOwner: t.string().default(''),
    stationAComplete: t.boolean().default(false),
    stationBComplete: t.boolean().default(false),
    stationCComplete: t.boolean().default(false),
    doorOpen: t.boolean().default(false),
  },
  'Hack',
);

const Mission = schema(
  {
    stage: t.string().default('infiltrate'),
    alarm: t.boolean().default(false),
    securityActive: t.boolean().default(false),
    prototypeHeldBy: t.string().default(''),
    extracted: t.boolean().default(false),
    elapsedSeconds: t.float32().default(0),
    timesSpotted: t.float32().default(0),
    objectsThrown: t.float32().default(0),
    tetherSaves: t.float32().default(0),
  },
  'Mission',
);

const Run = schema(
  {
    mode: t.string().default('standard'),
    seed: t.uint32().default(0),
    floor: t.uint16().default(1),
    captures: t.uint8().default(0),
    maxCaptures: t.uint8().default(MAX_CAPTURES),
    startedAt: t.number().default(0),
    floorTimes: t.array(t.float32),
    ended: t.boolean().default(false),
  },
  'Run',
);

const HandshakeState = schema(
  {
    started: t.boolean().default(false),
    players: t.map(Player),
    objects: t.map(Grabbable),
    hack: Hack,
    mission: Mission,
    security: Security,
    run: Run,
  },
  'HandshakeState',
);

function roomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return code;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function bounded(value, fallback, maximum, label) {
  if (!Number.isFinite(value)) {
    console.warn(`[state-safety] Rejected non-finite ${label}.`);
    return fallback;
  }
  return Math.max(-maximum, Math.min(maximum, value));
}

function copyVec3(target, source, maximum, label) {
  target.x = bounded(source?.x, target.x, maximum, `${label}.x`);
  target.y = bounded(source?.y, target.y, maximum, `${label}.y`);
  target.z = bounded(source?.z, target.z, maximum, `${label}.z`);
}

function createGrabbable(id, x, y, z, grabRadius) {
  const object = new Grabbable();
  object.id = id;
  object.position.x = x;
  object.position.y = y;
  object.position.z = z;
  object.grabRadius = grabRadius;
  return object;
}

class HandshakeRoom extends Room {
  state = new HandshakeState();
  missionStartedAt = Date.now();
  doorOpenedAt = 0;
  spotCooldownUntil = { pix: 0, nee: 0 };
  clotheslines = 0;
  createdAt = Date.now();
  disposeReason = 'disposed';
  /** Prevents double-advancing Night Shift on the same extraction. */
  nightshiftEscapedFloor = 0;
  world = createWorldSinks();
  runLayout = null;

  onCreate(options = {}) {
    liveRooms.add(this);

    // Empty-room timeout: disconnect if nobody joins within EMPTY_ROOM_SECONDS
    this._emptyTimeout = this.clock.setTimeout(() => {
      this.disposeReason = 'empty-timeout';
      this.disconnect();
    }, EMPTY_ROOM_SECONDS * 1000);

    // Lonely-room timeout: host waiting alone, never started
    this._lonelyTimeout = this.clock.setTimeout(() => {
      if (this.state.players.size < 2) {
        this.disposeReason = 'lonely-timeout';
        this.disconnect();
      }
    }, LONELY_ROOM_SECONDS * 1000);
    this.maxClients = 2;
    this.roomId = roomCode();
    this.setMetadata({ code: this.roomId });
    console.log(`[handshake] room ${this.roomId} created`);
    this.state.security = createSecurityState();
    this.securitySim = new SecuritySim(this.state.security);
    for (const [id, position] of Object.entries(layout.objects)) {
      const radius = { 'cargo-core': 3.3, 'crate-blue': 4.8, 'crate-pink': 3, prototype: 3.2 }[id] ?? 2.6; // desk props: small grab radius
      this.state.objects.set(id, createGrabbable(id, position.x, position.y, position.z, radius));
    }
    this.initRun(options);
    this.onMessage('snapshot', (client, message) => {
      this.applySnapshot(client.sessionId, message);
    });
    this.onMessage('grab-object', (client, message) => this.grabObject(client.sessionId, message));
    this.onMessage('release-object', (client, message) => this.releaseObject(client.sessionId, message));
    this.onMessage('object-snapshot', (client, message) => this.applyObjectSnapshot(client.sessionId, message));
    this.onMessage('hack-start', (client, message) => this.startHack(client.sessionId, message));
    this.onMessage('hack-complete', (client, message) => this.completeHack(client.sessionId, message));
    this.onMessage('hack-cancel', (client, message) => this.cancelHack(client.sessionId, message));
    this.onMessage('mission-tether-save', (client) => this.reportTetherSave(client.sessionId));
    this.onMessage('mission-retry', () => this.resetMission());
    this.onMessage('tether-yank', (client, message) => this.relayTetherYank(client, message));
    this.onMessage('patrol-stun', (client, message) => this.stunPatrol(client, message));
    this.onMessage('run-capture', (client) => this.handleCapture(client.sessionId));
    this.onMessage('capture-struggle', (client) => this.reportStruggle(client.sessionId));
    if (TEST_HOOKS) {
      console.log('[handshake] TEST HOOKS enabled');
      this._testPatrolFrozen = false;
      this.onMessage('debug-patrol-freeze', (_client, m) => {
        this._testPatrolFrozen = m?.frozen !== false;
      });
      this.onMessage('debug-clear-stuns', () => {
        for (const p of this.securitySim.patrol) {
          p.stunnedFor = 0;
          p.dazedFor = 0;
        }
        for (const sp of this.state.security.patrols) {
          sp.stunned = false;
        }
      });
      this.onMessage('debug-stage', (_client, m) => {
        if (m?.stage === 'escape') {
          this.state.mission.stage = 'escape';
          this.state.mission.alarm = true;
          this.state.mission.securityActive = true;
          if (m?.freezePatrols) this._testPatrolFrozen = true;
        }
      });
      this.onMessage('debug-run-escape', () => this.handleEscape());
      this.onMessage('debug-run-capture', (client) => this.handleCapture(client.sessionId));
      this.onMessage('debug-force-capture', (client, m) => {
        for (const p of this.securitySim.patrol) {
          p.stunnedFor = 0;
          p.dazedFor = 0;
        }
        for (const sp of this.state.security.patrols) {
          sp.stunned = false;
        }
        this.debugForceCapture(client, m);
      });
      this.onMessage('debug-force-release', (client, m) => this.debugForceRelease(client, m));

      // Frozen test patrols also ignore cord clotheslines, so teleporting a drone
      // across the room cannot stun-free a captive mid-check.
      const origStunPatrol = this.stunPatrol.bind(this);
      this.stunPatrol = (client, message) => {
        if (!this._testPatrolFrozen) origStunPatrol(client, message);
      };
      const origSecurityUpdate = this.securitySim.update.bind(this.securitySim);
      this.securitySim.update = (dt, ctx) => {
        const savedPositions = this._testPatrolFrozen
          ? this.state.security.patrols.map((p) => ({ x: p.x, y: p.y, z: p.z }))
          : null;

        const result = origSecurityUpdate(dt, ctx);

        if (this._testPatrolFrozen) {
          // Restore patrol positions to keep them stationary (prevents distance drift and patrol roaming)
          if (savedPositions) {
            for (let i = 0; i < savedPositions.length; i++) {
              const sp = this.state.security.patrols[i];
              if (sp && savedPositions[i]) {
                sp.x = savedPositions[i].x;
                sp.y = savedPositions[i].y;
                sp.z = savedPositions[i].z;
              }
            }
          }

          // Disarm autonomous grabs and shoves by idle patrol AI
          if (result.captures?.length) {
            for (const cap of result.captures) {
              const rt = this.securitySim.patrol[cap.index];
              if (rt && rt.carryingRole === cap.role) {
                rt.carryingRole = null;
              }
            }
            result.captures = [];
          }
          result.shoves = [];

          // Keep captive position locked to the stationary patrol
          for (const over of result.overrides ?? []) {
            const sp = this.state.security.patrols[over.index];
            if (sp) {
              over.position = { x: sp.x, y: sp.y - 0.95, z: sp.z };
            }
          }
        }

        return result;
      };
    }
    this.setSimulationInterval((deltaMs) => {
      this.updateHack();
      this.updateMission();
      this.updateSecurity(deltaMs / 1000);
    });
  }

  initRun(options = {}) {
    const mode = isRunMode(options.mode) ? options.mode : 'standard';
    const seedOpt = typeof options.seed === 'number' && Number.isFinite(options.seed)
      ? options.seed >>> 0
      : undefined;
    const initial = createRunState({ mode, seed: seedOpt });
    const run = this.state.run;
    run.mode = initial.mode;
    run.seed = initial.seed;
    run.floor = initial.floor;
    run.captures = initial.captures;
    run.maxCaptures = initial.maxCaptures;
    run.startedAt = initial.startedAt;
    run.ended = false;
    run.floorTimes.clear();
    console.log(`[handshake] room ${this.roomId} run mode=${run.mode} seed=${run.seed} floor=${run.floor}`);
    this.beginFloor();
  }

  /**
   * Floor hook: Night Shift remixed layout via applySeedFloor; other modes stay handcrafted.
   * Always emits `floor-start` so clients (and reconnect) apply the same seed/floor.
   */
  beginFloor() {
    const { seed, floor, mode } = this.state.run;
    if (mode === 'nightshift') {
      this.applySeedFloor(seed, floor);
    }
    this.broadcast('floor-start', { seed, floor, mode });
  }

  /** Night Shift: successful extraction → next floor + next seed. */
  handleEscape() {
    const run = this.state.run;
    if (run.mode !== 'nightshift' || run.ended) return;
    if (this.nightshiftEscapedFloor === run.floor) return;
    this.nightshiftEscapedFloor = run.floor;
    const next = advanceFloor(
      {
        mode: run.mode,
        seed: run.seed,
        floor: run.floor,
        captures: run.captures,
        maxCaptures: run.maxCaptures,
        startedAt: run.startedAt,
        floorTimes: Array.from(run.floorTimes, (value) => finite(value, 0)),
      },
      finite(this.state.mission.elapsedSeconds, 0),
    );
    run.floor = next.floor;
    run.seed = next.seed;
    run.floorTimes.clear();
    for (const t of next.floorTimes) run.floorTimes.push(finite(t, 0));
    this.resetMission();
    this.beginFloor();
  }

  /** Night Shift: capture → increment; end the run at maxCaptures. */
  handleCapture(sessionId) {
    if (!this.state.players.has(sessionId)) return;
    const run = this.state.run;
    if (run.mode !== 'nightshift' || run.ended) return;
    const result = recordCapture({
      mode: run.mode,
      seed: run.seed,
      floor: run.floor,
      captures: run.captures,
      maxCaptures: run.maxCaptures,
      startedAt: run.startedAt,
      floorTimes: Array.from(run.floorTimes),
    });
    run.captures = result.state.captures;
    if (result.ended) {
      run.ended = true;
      this.state.mission.securityActive = false;
      this.broadcast('run-ended', { reason: 'captures', captures: run.captures });
    }
  }

  onJoin(client) {
    // Clear empty-room timeout on first join
    if (this._emptyTimeout) {
      this._emptyTimeout.clear();
      this._emptyTimeout = null;
    }
    const roles = new Set(Array.from(this.state.players.values()).map((player) => player.role));
    const role = roles.has('pix') ? 'nee' : 'pix';
    const player = new Player();
    player.playerId = client.sessionId;
    player.role = role;
    player.connected = true;
    player.position.x = this.world.spawn.x + (role === 'pix' ? -1.6 : 1.6);
    player.position.y = this.world.spawn.y;
    player.position.z = this.world.spawn.z;
    this.state.players.set(client.sessionId, player);
    this.state.started = this.state.players.size === 2;
    if (this.state.started && this._lonelyTimeout) {
      this._lonelyTimeout.clear();
      this._lonelyTimeout = null;
    }
  }

  /** Unexpected drop: hold the seat, freeze the drone, keep match state. */
  onDrop(client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    this.freezePlayer(player);
    this.releaseRole(player.role);
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = true;
    }
  }

  /** Permanent leave (consent, or grace window expired): existing partner-left path. */
  onLeave(client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    if (player.connected) {
      this.freezePlayer(player);
      this.releaseRole(player.role);
    }
    this.state.players.delete(client.sessionId);
    this.state.started = false;
  }

  freezePlayer(player) {
    player.connected = false;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.boost = 'off';
    player.movement = 'idle';
    player.tetherPull = 0;
  }

  onDispose() {
    if (this._emptyTimeout) this._emptyTimeout.clear();
    if (this._lonelyTimeout) this._lonelyTimeout.clear();
    liveRooms.delete(this);
    const s = Math.round((Date.now() - this.createdAt) / 1000);
    const n = this.state.players.size;
    const stage = this.state.mission.stage;
    const reason = this.disposeReason;
    console.log(`[handshake] room ${this.roomId} closed after ${s}s (players=${n}, stage=${stage}, reason=${reason})`);
  }

  applySnapshot(sessionId, message) {
    const player = this.state.players.get(sessionId);
    // Dropped seats stay frozen until they reconnect.
    if (!player || !player.connected || !message || typeof message !== 'object') {
      return;
    }
    const prevBoost = player.boost;
    const boost = enumValue(message.boost, ['off', 'active'], 'off');
    // Captured drones: server owns position; still accept boost for struggle presses.
    if (player.captured) {
      player.boost = boost;
      player.movement = 'idle';
      player.selfPowered = false;
      player.tetherPull = Math.max(0, Math.min(1, finite(message.tetherPull)));
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      if (boost === 'active' && prevBoost !== 'active') {
        player.struggles = Math.min(7, (player.struggles | 0) + 1);
        player.rescueProgress = Math.min(1, player.struggles / 3);
      }
      return;
    }
    const position = message.position ?? {};
    const velocity = message.velocity ?? {};
    const orientation = message.orientation ?? {};
    copyVec3(player.position, position, MAX_WORLD_COORDINATE, 'player.position');
    copyVec3(player.velocity, velocity, MAX_PLAYER_SPEED, 'player.velocity');
    player.orientation.pitch = finite(orientation.pitch);
    player.orientation.yaw = finite(orientation.yaw);
    player.orientation.roll = finite(orientation.roll);
    player.boost = boost;
    player.movement = enumValue(message.movement, ['idle', 'cruising', 'boosting'], 'idle');
    player.selfPowered = message.selfPowered === true;
    player.tetherPull = Math.max(0, Math.min(1, finite(message.tetherPull)));
  }

  roleForSession(sessionId) {
    return this.state.players.get(sessionId)?.role ?? null;
  }

  grabObject(sessionId, message) {
    const player = this.state.players.get(sessionId);
    const object = this.state.objects.get(message?.objectId);
    if (!player || !object || distance(player.position, object.position) > object.grabRadius) {
      return;
    }
    if (object.id === 'prototype' && !this.state.hack.doorOpen) return;
    if (object.heldBy && object.heldBy !== player.role) return;
    for (const other of this.state.objects.values()) {
      if (other.id !== object.id && other.heldBy === player.role) {
        return;
      }
    }
    object.heldBy = player.role;
    object.authority = player.role;
    object.mode = 'held';
    object.revision += 1;
    if (object.id === 'prototype') this.triggerAlarm(player.role);
  }

  releaseObject(sessionId, message) {
    const role = this.roleForSession(sessionId);
    const object = this.state.objects.get(message?.objectId);
    if (!role || !object || object.heldBy !== role) {
      return;
    }
    copyVec3(object.position, message.position, MAX_WORLD_COORDINATE, 'object.position');
    copyVec3(object.velocity, message.velocity, MAX_OBJECT_SPEED, 'object.velocity');
    object.heldBy = '';
    object.authority = role;
    object.mode = 'free';
    object.revision += 1;
    if (message?.thrown === true) this.state.mission.objectsThrown += 1;
  }

  applyObjectSnapshot(sessionId, message) {
    const role = this.roleForSession(sessionId);
    const object = this.state.objects.get(message?.objectId);
    if (!role || !object || object.authority !== role) {
      return;
    }
    copyVec3(object.position, message.position, MAX_WORLD_COORDINATE, 'object.position');
    copyVec3(object.velocity, message.velocity, MAX_OBJECT_SPEED, 'object.velocity');
    const orientation = message.orientation ?? {};
    object.orientation.pitch = finite(orientation.pitch, object.orientation.pitch);
    object.orientation.yaw = finite(orientation.yaw, object.orientation.yaw);
    object.orientation.roll = finite(orientation.roll, object.orientation.roll);
  }

  stationFields(stationId) {
    return stationId === 'terminal-a'
      ? { owner: 'stationAOwner', complete: 'stationAComplete', role: 'pix' }
      : stationId === 'terminal-b'
        ? { owner: 'stationBOwner', complete: 'stationBComplete', role: 'nee' }
        : stationId === 'terminal-c'
          ? { owner: 'stationCOwner', complete: 'stationCComplete', role: 'either' }
        : null;
  }

  startHack(sessionId, message) {
    const player = this.state.players.get(sessionId);
    const stationId = message?.stationId;
    const fields = this.stationFields(stationId);
    const position = this.world.terminals[stationId];
    if (
      !player ||
      !fields ||
      (fields.role !== 'either' && player.role !== fields.role) ||
      !position ||
      distance(player.position, position) > TERMINAL_RANGE ||
      this.state.hack[fields.complete]
    ) {
      return;
    }
    if (!this.state.hack[fields.owner] || this.state.hack[fields.owner] === player.role) {
      this.state.hack[fields.owner] = player.role;
    }
  }

  completeHack(sessionId, message) {
    const player = this.state.players.get(sessionId);
    const stationId = message?.stationId;
    const fields = this.stationFields(stationId);
    if (
      !player ||
      !fields ||
      this.state.hack[fields.owner] !== player.role ||
      distance(player.position, this.world.terminals[stationId]) > TERMINAL_RANGE
    ) return;
    this.state.hack[fields.complete] = true;
    this.state.hack[fields.owner] = '';
    this.state.hack.doorOpen =
      this.state.hack.stationAComplete && this.state.hack.stationBComplete &&
      this.state.hack.stationCComplete;
    if (this.state.hack.doorOpen && !this.doorOpenedAt) {
      this.doorOpenedAt = Date.now();
    }
  }

  cancelHack(sessionId, message) {
    const role = this.roleForSession(sessionId);
    const fields = this.stationFields(message?.stationId);
    if (role && fields && this.state.hack[fields.owner] === role) {
      this.state.hack[fields.owner] = '';
    }
  }

  updateHack() {
    for (const [field, stationId] of [
      ['stationAOwner', 'terminal-a'], ['stationBOwner', 'terminal-b'], ['stationCOwner', 'terminal-c'],
    ]) {
      const role = this.state.hack[field];
      if (!role) continue;
      const player = Array.from(this.state.players.values()).find((candidate) => candidate.role === role);
      if (!player?.connected || distance(player.position, this.world.terminals[stationId]) > TERMINAL_RANGE) {
        this.state.hack[field] = '';
      }
    }
  }

  triggerAlarm(role) {
    if (this.state.mission.alarm || !this.state.hack.doorOpen) return;
    this.state.mission.stage = 'escape';
    this.state.mission.alarm = true;
    this.state.mission.securityActive = true;
    this.state.mission.prototypeHeldBy = role;
  }

  updateMission() {
    const mission = this.state.mission;
    mission.elapsedSeconds = (Date.now() - this.missionStartedAt) / 1000;
    const players = Array.from(this.state.players.values());
    if (mission.stage === 'infiltrate' && players.some((player) => player.position.z > this.world.infiltrationZ)) {
      mission.stage = 'hack-security';
    }
    if (mission.stage === 'hack-security' && this.state.hack.doorOpen) {
      mission.stage = 'steal-prototype';
    }
    const prototype = this.state.objects.get('prototype');
    mission.prototypeHeldBy = prototype?.heldBy ?? '';
    if (mission.alarm && prototype?.heldBy) {
      const carrier = players.find((player) => player.role === prototype.heldBy);
      const extraction = this.world.extraction;
      const bothNear = players.length === 2 && players.every(
        (player) => distance(player.position, extraction) <= 5.5,
      );
      if (carrier && distance(carrier.position, extraction) <= 4.5 && bothNear) {
        mission.extracted = true;
        mission.stage = 'complete';
        mission.securityActive = false;
        if (this.state.run.mode === 'nightshift') {
          this.handleEscape();
        }
      }
    }
  }

  updateSecurity(dt) {
    dt = Math.max(0, Math.min(0.1, dt));
    if (this.state.mission.stage === 'complete') return;
    const now = Date.now();
    const cameraDisabled = this.doorOpenedAt > 0 && (now - this.doorOpenedAt) < 18000;
    const players = Array.from(this.state.players.values()).map((p) => ({
      role: p.role,
      connected: p.connected,
      captured: p.captured === true,
      struggles: p.struggles | 0,
      tetherPull: p.tetherPull,
      yankedRecently: false,
      position: { x: p.position.x, y: p.position.y, z: p.position.z },
    }));
    const result = this.securitySim.update(dt, {
      active: this.state.mission.securityActive,
      elapsed: this.state.mission.elapsedSeconds,
      cameraDisabled,
      players,
      objects: this.state.objects.values(),
    });
    // Each drone has its own spotted cooldown, so both can be spotted in the same window.
    for (const role of result.spotted) {
      if (!(role in this.spotCooldownUntil)) continue;
      if (this.spotCooldownUntil[role] <= now && this.state.mission.stage !== 'complete') {
        this.state.mission.timesSpotted += 1;
        this.spotCooldownUntil[role] = now + 2800;
        this.broadcast('security-spotted', { role });
      }
    }
    // A shove goes only to the client that owns the shoved drone; it applies the impulse locally.
    for (const shove of result.shoves ?? []) this.clientForRole(shove.role)?.send('patrol-shove', shove);

    for (const cap of result.captures ?? []) this.beginCapture(cap.role, cap.index);
    for (const freed of result.releases ?? []) this.finishCapture(freed.role, freed.index, freed.reason);
    for (const over of result.overrides ?? []) this.applyCaptureOverride(over);

    // Both drones caught → Night Shift capture outcome (and free them so the run can continue).
    const live = Array.from(this.state.players.values()).filter((p) => p.connected);
    if (live.length >= 2 && live.every((p) => p.captured)) {
      this.onCaptureOutcome('both');
      for (const p of live) {
        const freed = this.securitySim.releaseRole(p.role, 'timeout');
        if (freed) this.finishCapture(freed.role, freed.index, 'both');
      }
    }
  }

  beginCapture(role, index) {
    const player = Array.from(this.state.players.values()).find((p) => p.role === role);
    if (!player || player.captured) return;
    player.captured = true;
    player.capturedBy = index;
    player.struggles = 0;
    player.carryFor = 0;
    player.rescueProgress = 0;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    this.broadcast('drone-captured', { role, index });
  }

  applyCaptureOverride(over) {
    const player = Array.from(this.state.players.values()).find((p) => p.role === over.role);
    if (!player || !player.captured) return;
    player.position.x = finite(over.position?.x, player.position.x);
    player.position.y = finite(over.position?.y, player.position.y);
    player.position.z = finite(over.position?.z, player.position.z);
    player.capturedBy = over.index;
    player.carryFor = finite(over.carryFor, player.carryFor);
    player.struggles = Math.max(player.struggles | 0, over.struggles | 0);
    player.rescueProgress = Math.max(0, Math.min(1, finite(over.rescueProgress, player.rescueProgress)));
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
  }

  finishCapture(role, index, reason) {
    const player = Array.from(this.state.players.values()).find((p) => p.role === role);
    if (!player) return;
    const wasCaptured = player.captured;
    player.captured = false;
    player.capturedBy = -1;
    player.struggles = 0;
    player.carryFor = 0;
    player.rescueProgress = 0;
    if (!wasCaptured) return;
    if (reason === 'yank' || reason === 'struggle' || reason === 'strain') {
      this.broadcast('rescued', { role, index, reason });
    } else if (reason === 'timeout' || reason === 'both') {
      this.broadcast('drone-freed', { role, index, reason });
      if (reason === 'timeout') this.onCaptureOutcome('timeout');
    } else {
      this.broadcast('drone-freed', { role, index, reason });
    }
  }

  /** Night Shift: rescue window expired or both drones grabbed → recordCapture. */
  onCaptureOutcome(kind) {
    if (this.state.run.mode !== 'nightshift' || this.state.run.ended) return;
    // Pick any connected session so handleCapture's seat check passes.
    const sessionId = Array.from(this.state.players.keys())[0];
    if (!sessionId) return;
    this.handleCapture(sessionId);
    this.broadcast('capture-outcome', { kind, captures: this.state.run.captures });
  }

  reportStruggle(sessionId) {
    const player = this.state.players.get(sessionId);
    if (!player?.captured) return;
    player.struggles = Math.min(7, (player.struggles | 0) + 1);
    player.rescueProgress = Math.min(1, player.struggles / 3);
  }

  debugForceCapture(client, message) {
    if (!this.state.players.has(client.sessionId)) return;
    const role = message?.role === 'nee' ? 'nee' : message?.role === 'pix' ? 'pix' : null;
    if (!role) return;
    const index = Math.max(0, Math.round(finite(message?.index, 0)));
    this.state.mission.securityActive = true;
    const cap = this.securitySim.forceCapture(role, index);
    if (!cap) return;
    this.beginCapture(cap.role, cap.index);
    const p = this.securitySim.patrolPosition(cap.index);
    if (p) {
      this.applyCaptureOverride({
        role: cap.role,
        index: cap.index,
        position: { x: p.x, y: p.y - 0.95, z: p.z },
        carryFor: 0,
        struggles: 0,
        rescueProgress: 0,
      });
    }
  }

  debugForceRelease(client, message) {
    if (!this.state.players.has(client.sessionId)) return;
    const role = message?.role === 'nee' ? 'nee' : message?.role === 'pix' ? 'pix' : null;
    if (!role) return;
    const reason = typeof message?.reason === 'string' ? message.reason : 'yank';
    const freed = this.securitySim.releaseRole(role, reason);
    if (freed) this.finishCapture(freed.role, freed.index, reason);
  }

  clientForRole(role) {
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (player?.role === role && player.connected) return client;
    }
    return undefined;
  }

  /** Validate a tether move and relay the impulse to the partner, who owns its own drone. */
  relayTetherYank(client, message) {
    const sender = this.state.players.get(client.sessionId);
    if (!sender || !message || typeof message !== 'object') return;
    // Captured drone cannot yank; rescuer must be free.
    if (sender.captured) return;
    const now = Date.now();
    this.yankTimes ??= new Map();
    const kind = enumValue(message.kind, ['yank', 'sling', 'bump'], 'yank');
    const minGap = kind === 'bump' ? 350 : 850;
    if (now - (this.yankTimes.get(client.sessionId) ?? 0) < minGap) return;
    const partnerEntry = Array.from(this.state.players.entries()).find(([id]) => id !== client.sessionId);
    if (!partnerEntry) return;
    const [partnerId, partner] = partnerEntry;
    if (!partner.connected || distance(sender.position, partner.position) > 13.5) return;
    const target = this.clients.find((candidate) => candidate.sessionId === partnerId);
    if (!target) return;
    this.yankTimes.set(client.sessionId, now);
    const impulse = message.impulse ?? {};
    let x = finite(impulse.x), y = finite(impulse.y), z = finite(impulse.z);
    const magnitude = Math.hypot(x, y, z);
    if (magnitude > 16) { x *= 16 / magnitude; y *= 16 / magnitude; z *= 16 / magnitude; }
    // Server decides rescue: partner is captured + yank kind (solo rescue rules).
    const rescue = kind === 'yank' && partner.captured === true && distance(sender.position, partner.position) <= 11;
    if (rescue) {
      const freed = this.securitySim.releaseRole(partner.role, 'yank');
      if (freed) this.finishCapture(freed.role, freed.index, 'yank');
      this.reportTetherSave(client.sessionId);
    }
    target.send('tether-yanked', {
      kind,
      rescue,
      strength: Math.max(0, Math.min(1, finite(message.strength))),
      impulse: { x, y, z },
    });
  }

  /**
   * Night Shift only: build enemies/security from generateRun → applyRunLayout.
   * Called from beginFloor on room create and each floor advance.
   */
  applySeedFloor(seed, floor = 0) {
    const run = generateRun(seed >>> 0, Math.max(0, floor | 0));
    this.runLayout = run;
    applyRunLayout(run, {
      spawn: this.world.spawn,
      extraction: this.world.extraction,
      terminals: this.world.terminals,
      objects: this.state.objects,
      security: this.securitySim,
    });
    return run;
  }

  /** Server-arbitrated clothesline: validate claim, then let SecuritySim own the stun. */
  stunPatrol(client, message) {
    if (!this.state.players.has(client.sessionId) || !message || typeof message !== 'object') return;
    if (!this.state.mission.securityActive) return;
    const index = Math.round(finite(message.index, -1));
    if (index < 0 || index >= this.state.security.patrols.length) return;
    const p = this.securitySim.patrolPosition(index);
    if (!p) return;

    // Reported stun point must be within 3.5 of the server patrol position
    const r = { x: finite(message.x), y: finite(message.y, 2), z: finite(message.z) };
    if (distance(r, p) > 3.5) return;

    // Both players must be present and within 14 of the patrol
    const players = Array.from(this.state.players.values());
    if (players.length !== 2 || !players[0].connected || !players[1].connected) return;
    if (distance(players[0].position, p) > 14 || distance(players[1].position, p) > 14) return;

    // Distance from patrol to the segment between the two player positions must be <= 3.5
    const a = players[0].position, b = players[1].position;
    const seg = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const segLenSq = seg.x * seg.x + seg.y * seg.y + seg.z * seg.z;
    let segDist;
    if (segLenSq < 0.0001) {
      segDist = distance(p, a);
    } else {
      const ap = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
      const tParam = Math.max(0, Math.min(1, (ap.x * seg.x + ap.y * seg.y + ap.z * seg.z) / segLenSq));
      const proj = { x: a.x + seg.x * tParam, y: a.y + seg.y * tParam, z: a.z + seg.z * tParam };
      segDist = distance(p, proj);
    }
    if (segDist > 3.5) return;

    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    if (!this.securitySim.stun(index, midpoint)) return;
    this.clotheslines += 1;
    const np = this.securitySim.patrolPosition(index);
    this.broadcast('patrol-stunned', {
      index, by: this.state.players.get(client.sessionId).role, clotheslines: this.clotheslines,
      x: np.x, y: np.y, z: np.z,
    });
  }

  reportTetherSave(sessionId) {
    if (this.state.players.has(sessionId) && this.state.mission.securityActive) {
      this.state.mission.tetherSaves += 1;
    }
  }

  resetMission() {
    this.securitySim.reset();
    this.doorOpenedAt = 0;
    this.spotCooldownUntil = { pix: 0, nee: 0 };
    this.clotheslines = 0;
    for (const player of this.state.players.values()) {
      player.captured = false;
      player.capturedBy = -1;
      player.struggles = 0;
      player.carryFor = 0;
      player.rescueProgress = 0;
    }
    this.state.hack.stationAOwner = '';
    this.state.hack.stationBOwner = '';
    this.state.hack.stationCOwner = '';
    this.state.hack.stationAComplete = false;
    this.state.hack.stationBComplete = false;
    this.state.hack.stationCComplete = false;
    this.state.hack.doorOpen = false;
    const prototype = this.state.objects.get('prototype');
    if (prototype) {
      prototype.heldBy = '';
      prototype.mode = 'free';
      const loot = this.runLayout?.loot ?? layout.objects.prototype;
      prototype.position.x = loot.x;
      prototype.position.y = loot.y;
      prototype.position.z = loot.z;
      prototype.velocity.x = 0;
      prototype.velocity.y = 0;
      prototype.velocity.z = 0;
      prototype.revision += 1;
    }
    const mission = this.state.mission;
    mission.stage = 'infiltrate';
    mission.alarm = false;
    mission.securityActive = false;
    mission.prototypeHeldBy = '';
    mission.extracted = false;
    mission.elapsedSeconds = 0;
    mission.timesSpotted = 0;
    mission.objectsThrown = 0;
    mission.tetherSaves = 0;
    this.missionStartedAt = Date.now();
  }

  releaseRole(role) {
    if (this.state.hack.stationAOwner === role) this.state.hack.stationAOwner = '';
    if (this.state.hack.stationBOwner === role) this.state.hack.stationBOwner = '';
    if (this.state.hack.stationCOwner === role) this.state.hack.stationCOwner = '';
    const fallback = role === 'pix' ? 'nee' : 'pix';
    const fallbackConnected = Array.from(this.state.players.values()).some(
      (player) => player.role === fallback && player.connected,
    );
    for (const object of this.state.objects.values()) {
      if (object.heldBy === role) {
        object.heldBy = '';
        object.mode = 'free';
      }
      if (object.authority === role) {
        object.authority = fallbackConnected ? fallback : 'pix';
        object.velocity.x = 0;
        object.velocity.y = 0;
        object.velocity.z = 0;
        object.revision += 1;
      }
    }
  }
}

// --- CORS for matchmake preflight, /__healthcheck, and other router routes -----
// DEFAULT_CORS_HEADERS starts with ACAO '*'. When an allow-list is set, clear that
// default so disallowed origins do not keep the wildcard via the object spread.
if (!permissive) {
  matchMaker.controller.DEFAULT_CORS_HEADERS = {
    ...matchMaker.controller.DEFAULT_CORS_HEADERS,
    'Access-Control-Allow-Origin': '',
  };
  matchMaker.controller.getCorsHeaders = (headers) => {
    const origin = headers.get('origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    }
    return { 'Access-Control-Allow-Origin': '', Vary: 'Origin' };
  };
}

// --- Transport & server --------------------------------------------------------
const transportOptions = {};
if (!permissive) {
  transportOptions.verifyClient = (info, cb) => {
    const origin = info.origin;
    cb(isOriginAllowed(origin));
  };
}

const gameServer = new Server({
  transport: new WebSocketTransport(transportOptions),
  greet: false,
});
gameServer.define('handshake', HandshakeRoom);
await gameServer.listen(PORT, '0.0.0.0');

// --- /health endpoint (installed after listen so Colyseus listeners exist) -----
const httpServer = gameServer.transport.server;
const originalListeners = httpServer.listeners('request').slice();
httpServer.removeAllListeners('request');

function corsHeaders(req) {
  const origin = req.headers['origin'];
  const headers = { 'Cache-Control': 'no-store' };
  if (permissive) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  } else {
    headers['Vary'] = 'Origin';
  }
  return headers;
}

httpServer.on('request', (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/health') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    let totalClients = 0;
    for (const room of liveRooms) {
      totalClients += room.clients.length;
    }
    const body = JSON.stringify({
      ok: true,
      uptime: Math.floor(process.uptime()),
      rooms: liveRooms.size,
      clients: totalClients,
      version: pkg.version || 'dev',
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...corsHeaders(req),
    });
    res.end(body);
    return;
  }
  for (const listener of originalListeners) {
    listener.call(httpServer, req, res);
  }
});

// --- Startup log ---------------------------------------------------------------
if (permissive) {
  console.log('[handshake] CORS: permissive');
} else {
  console.log(`[handshake] CORS allow-list: ${ALLOWED_ORIGINS.join(', ')}`);
}
console.log(`[handshake] reconnect grace ${RECONNECT_SECONDS}s`);
console.log(`[handshake] listening on port ${PORT}`);
