import { Room, Server, WebSocketTransport, matchMaker } from 'colyseus';
import { schema, t } from '@colyseus/schema';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import layout from '../src/level/heist-layout.json' with { type: 'json' };
import { Security, createSecurityState, SecuritySim } from './security.mjs';
import { canPass, facingYaw } from './passRules.mjs';
import { prototypeRecovery } from '../shared/prototypeSafety.mjs';
import { BotPilot, createBotPlayer } from './botSeat.mjs';
import {
  createRunState,
  advanceFloor,
  recordCapture,
  isRunMode,
  MAX_CAPTURES,
} from '../shared/run.ts';
import { applyRunLayout, generateRun } from '../shared/seed/index.mjs';
import { campaignLayout } from '../shared/campaign/levels.mjs';
import { scoreFloorPure, dropFloorsFrom } from '../shared/nightShiftScore.mjs';
import { scoreCampaignLevel } from '../shared/campaign/score.mjs';
import { ObjectiveSim, shouldBroadcast as shouldBroadcastObjective } from './objectiveSim.mjs';
import { HazardTripGate, checkHazardTrips } from '../shared/nightshift/hazards.mjs';
import { isProfane, LeaderboardStore, RateLimiter, sanitizeName, validateRun } from './leaderboard.mjs';
import { installLifecycleLogging, logListenError } from './lifecycle.mjs';
import {
  acquireQuickMatchSeat,
  checkQuickMatchLimit,
  clientIp,
  releaseQuickMatchSeat,
  sanitizeQmKey,
} from './quickMatch.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const PORT = Number.parseInt(process.env.PORT ?? '2567', 10);
installLifecycleLogging({ port: PORT, roomsCount: () => liveRooms.size });
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
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE === 'off'
  ? ''
  : (process.env.LEADERBOARD_FILE ?? fileURLToPath(new URL('../data/leaderboard.json', import.meta.url)));
const LEADERBOARD_IP_LIMIT = Number.parseInt(process.env.LEADERBOARD_IP_LIMIT ?? '12', 10);
const LEADERBOARD_MIN_DAILY_SECONDS = Number.parseFloat(process.env.LEADERBOARD_MIN_DAILY_SECONDS ?? '30');
const LEADERBOARD_MIN_FLOOR_SECONDS = Number.parseFloat(process.env.LEADERBOARD_MIN_FLOOR_SECONDS ?? '20');
const LEADERBOARD_SOLO_MIN_DAILY_SECONDS = Number.parseFloat(process.env.LEADERBOARD_SOLO_MIN_DAILY_SECONDS ?? '45');
const LEADERBOARD_SOLO_MIN_FLOOR_SECONDS = Number.parseFloat(process.env.LEADERBOARD_SOLO_MIN_FLOOR_SECONDS ?? '25');
const LEADERBOARD_ACCEPT_DEBUG = TEST_HOOKS && process.env.LEADERBOARD_ACCEPT_DEBUG === '1';
const leaderboardStore = new LeaderboardStore({ file: LEADERBOARD_FILE });
leaderboardStore.load();
const leaderboardIpLimiter = new RateLimiter({ limit: Number.isFinite(LEADERBOARD_IP_LIMIT) ? LEADERBOARD_IP_LIMIT : 12, windowMs: 60 * 60 * 1000 });
const leaderboardHttpLimiter = new RateLimiter({ limit: 120, windowMs: 60 * 1000 });
process.on('exit', () => leaderboardStore.flushSync());

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
const MAX_ROOMS = Number.parseInt(process.env.MAX_ROOMS ?? '100', 10);
const MAX_MEMORY_MB = Number.parseInt(process.env.MAX_MEMORY_MB ?? '450', 10);
let isShuttingDown = false;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_WORLD_COORDINATE = 200;
const MAX_PLAYER_SPEED = 28;
const MAX_OBJECT_SPEED = 32;
const TERMINAL_RANGE = 5;
const HOLD_OFFSET = { x: 0, y: -1.15, z: 0.35 };
const MAX_RELEASE_SPEED = Math.max(MAX_OBJECT_SPEED, MAX_PLAYER_SPEED + 10 + 1.8);
const RELEASE_RANGE = 3.5;
const HELD_SNAPSHOT_RANGE = 4;
const HANDOFF_RANGE = 2.0;
// Server range/cone are looser than the client to absorb snapshot latency.
const HANDOFF_CONE_DEG = 65;
const STEAL_RANGE = 2.0;
const STEAL_LOCK_MS = 1000;
const GRAB_COOLDOWN_MS = 250;
const PING_COOLDOWN_MS = 750;
const EMOTE_COOLDOWN_MS = 500;
const EMOTE_IDS = new Set(['here', 'wait', 'go', 'yay']);
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
    bot: t.boolean().default(false),
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
    rematchVote: t.boolean().default(false),
    lootDelivered: t.uint16().default(0),
    lootCarrySeconds: t.float32().default(0),
    passes: t.uint16().default(0),
    rescues: t.uint16().default(0),
    capturedCount: t.uint16().default(0),
    grabs: t.uint16().default(0),
    hacks: t.uint16().default(0),
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
    holderId: t.string().default(''),
    lastEvent: t.string().default(''),
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
    levelId: t.string().default(''),
    seed: t.uint32().default(0),
    floor: t.uint16().default(1),
    captures: t.uint8().default(0),
    maxCaptures: t.uint8().default(MAX_CAPTURES),
    startedAt: t.number().default(0),
    // Primitive child must be the raw type string: t.array(t.float32) registers a bogus "Number" ref type,
    // which made floorTimes.clear() throw on the second Night Shift floor advance.
    floorTimes: t.array('float32'),
    score: t.uint32().default(0),
    streak: t.uint8().default(0),
    multiplier: t.float32().default(1),
    lastFloorPoints: t.uint32().default(0),
    floorCleared: t.boolean().default(false),
    ended: t.boolean().default(false),
    rematches: t.uint16().default(0),
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
  campaignLevelId = '';
  floorPlan = null;
  objectiveSim = new ObjectiveSim();
  objectivePhase = 0;
  hazardGate = new HazardTripGate();
  objectiveBroadcastSeq = -1;
  objectiveBroadcastElapsed = 0;
  heldSinceMs = new Map();
  lastGrabMs = new Map();
  pingTimes = new Map();
  emoteTimes = new Map();
  pingId = 0;
  nsFloors = {};
  nsTwangs = new Map();
  nsEndedBroadcast = false;
  lastTickErrorAt = null;
  seedPinned;
  rematchVoteTimes = new Map();
  botEnabled = false;
  botPilot;
  reconnectingSeats = new Set();
  quickMatch = false;
  qmKey = '';
  quickMatchAllowed = true;
  runSerial = 0;
  runStartSeed = 0;
  runTainted = false;
  leaderboardRecordedSerial = 0;
  leaderboardEntry = null;
  leaderboardDecisionSerial = 0;

  clientMessageRates = new Map();

  checkRateLimit(client, isSnapshot = false) {
    if (!client?.sessionId) return false;
    const now = Date.now();
    let rate = this.clientMessageRates.get(client.sessionId);
    if (!rate || now - rate.windowStart >= 1000) {
      rate = { windowStart: now, count: 0, snapshots: 0 };
      this.clientMessageRates.set(client.sessionId, rate);
    }
    rate.count++;
    if (isSnapshot) rate.snapshots++;
    if (isSnapshot && rate.snapshots > 45) return false;
    if (rate.count > 90) return false;
    return true;
  }

  static async onAuth(token, options = {}, context) {
    if (isShuttingDown) {
      throw new Error('Server is restarting. Please reconnect shortly.');
    }
    if (liveRooms.size >= MAX_ROOMS) {
      throw new Error('Server at capacity. Please try again shortly.');
    }
    const memRssMb = process.memoryUsage().rss / (1024 * 1024);
    if (memRssMb >= MAX_MEMORY_MB) {
      throw new Error('Server memory threshold reached. Please try again shortly.');
    }
    const ip = clientIp(context);
    if (options.quickMatch === true) checkQuickMatchLimit(ip);
    return { ip };
  }

  onCreate(options = {}) {
    liveRooms.add(this);
    this.quickMatch = options.quickMatch === true;
    this.qmKey = sanitizeQmKey(options.qmKey, options.mode);
    this.botEnabled = !this.quickMatch && options.bot === true;
    this.botPilot = new BotPilot(this);
    this.seedPinned = typeof options.seed === 'number' && Number.isFinite(options.seed)
      ? options.seed >>> 0
      : undefined;
    this.campaignLevelId = typeof options.levelId === 'string' ? options.levelId : '';

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
    this.setMetadata({ code: this.roomId, bot: this.botEnabled, ...(this.quickMatch ? { quickMatch: true, qmKey: this.qmKey } : {}) });
    if (this.quickMatch) this.setPrivate(false);
    else this.setPrivate(true);
    console.log(`[handshake] room ${this.roomId} created`);
    this.state.security = createSecurityState();
    this.securitySim = new SecuritySim(this.state.security);
    // Test-only: a longer carry window so loaded qa round-trips fit inside it (never on Render).
    const testCarryMax = TEST_HOOKS ? Number(process.env.HANDSHAKE_TEST_CARRY_MAX) : NaN;
    if (Number.isFinite(testCarryMax) && testCarryMax > 0) this.securitySim.carryMax = testCarryMax;
    for (const [id, position] of Object.entries(layout.objects)) {
      const radius = { 'cargo-core': 3.3, 'crate-blue': 4.8, 'crate-pink': 3, prototype: 3.2 }[id] ?? 2.6; // desk props: small grab radius
      this.state.objects.set(id, createGrabbable(id, position.x, position.y, position.z, radius));
    }
    this.initRun(options);
    this.onMessage('snapshot', (client, message) => {
      if (!this.checkRateLimit(client, true)) return;
      try { this.applySnapshot(client.sessionId, message); } catch (_) {}
    });
    this.onMessage('mission-retry', (client) => {
      if (!this.checkRateLimit(client)) return;
      try {
        this.resetPlayerStats();
        if (['nightshift', 'campaign'].includes(this.state.run.mode)) {
          this.state.run.floorCleared = false;
          this.nightshiftEscapedFloor = 0;
          this.nsFloors = dropFloorsFrom(this.nsFloors, this.state.run.floor);
          this.nsTwangs.clear();
          this.resetMission();
        } else {
          this.resetMission();
        }
      } catch (_) {}
    });
    this.onMessage('rematch-vote', (client, message) => {
      if (!this.checkRateLimit(client)) return;
      try { this.handleRematchVote(client, message); } catch (_) {}
    });
    });
    this.onMessage('quickmatch-bot', (client) => {
      if (!this.checkRateLimit(client)) return;
      try {
        if (!this.quickMatch || !this.state.players.get(client.sessionId)?.connected || this.state.players.size !== 1 || this.state.players.get('bot')) return;
        const human = this.state.players.get(client.sessionId);
        this.botEnabled = true;
        this.setMetadata({ code: this.roomId, bot: true, quickMatch: true, qmKey: this.qmKey });
        this.addBotSeat(human.role === 'pix' ? 'nee' : 'pix', human.position);
        console.log(`[quickmatch] room ${this.roomId} key=${this.qmKey} bot`);
      } catch (_) {}
    });
    this.onMessage('leaderboard-name', (client, message) => {
      if (!this.checkRateLimit(client)) return;
      try { this.handleLeaderboardName(client, message); } catch (_) {}
    });
    // Scores are server-observed only; a client-posted score is dropped without disconnecting the sender.
    this.onMessage('leaderboard-submit', () => {});
    this.onMessage('run-next-floor', (client, message) => {
      if (!this.checkRateLimit(client)) return;
      try {
        const run = this.state.run;
        if (run.mode !== 'nightshift' || run.ended || !run.floorCleared || message?.floor !== run.floor) return;
        this.handleEscape();
      } catch (_) {}
    });
    this.onMessage('run-twang', (client) => {
      if (!this.checkRateLimit(client)) return;
      try { this.reportTwang(client.sessionId); } catch (_) {}
    });
    this.onMessage('tether-yank', (client, message) => {
      if (!this.checkRateLimit(client)) return;
      try { this.relayTetherYank(client, message); } catch (_) {}
    });
    this.onMessage('ping', (client, message) => {
      if (!this.checkRateLimit(client)) return;
      try { this.relayPing(client, message); } catch (_) {}
    });
    this.onMessage('emote', (client, message) => {
      if (!this.checkRateLimit(client)) return;
      try { this.relayEmote(client, message); } catch (_) {}
    });
    this.onMessage('patrol-stun', (client, message) => {
      if (!this.checkRateLimit(client)) return;
      try { this.stunPatrol(client, message); } catch (_) {}
    });
    // Captures are server-owned (onCaptureOutcome). Old clients may still send this: accept and ignore,
    // so one client can't count a team capture twice.
    this.onMessage('run-capture', () => {});
    this.onMessage('capture-struggle', (client) => {
      if (!this.checkRateLimit(client)) return;
      try { this.reportStruggle(client.sessionId); } catch (_) {}
    });
    this.onMessage('rtt-ping', (client, message) => {
      if (!this.checkRateLimit(client)) return;
      if (!message || typeof message !== 'object') return;
      const t = typeof message.t === 'number' && Number.isFinite(message.t) ? message.t : 0;
      client.send('rtt-pong', { t, serverTime: Date.now() });
    });
    this.onMessage('capture-struggle', (client) => this.reportStruggle(client.sessionId));
    if (TEST_HOOKS) {
      console.log('[handshake] TEST HOOKS enabled');
      this._testPatrolFrozen = false;
      this.onMessage('debug-patrol-freeze', (_client, m) => {
        this.runTainted = true;
        this._testPatrolFrozen = m?.frozen !== false;
      });
      this.onMessage('debug-clear-stuns', () => {
        this.runTainted = true;
        for (const p of this.securitySim.patrol) {
          p.stunnedFor = 0;
          p.dazedFor = 0;
        }
        for (const sp of this.state.security.patrols) {
          sp.stunned = false;
        }
      });
      this.onMessage('debug-stage', (_client, m) => {
        this.runTainted = true;
        if (m?.stage === 'hack-security' || m?.stage === 'steal-prototype') {
          this.state.mission.stage = m.stage;
          if (m?.openDoor === true) this.state.hack.doorOpen = true;
        } else if (m?.stage === 'escape') {
          this.state.mission.stage = 'escape';
          this.state.mission.alarm = true;
          this.state.mission.securityActive = true;
          if (m?.openDoor === true) this.state.hack.doorOpen = true;
          if (m?.freezePatrols) this._testPatrolFrozen = true;
        }
      });
      this.onMessage('debug-run-floor', (_client, message) => {
        const floor = Math.max(1, Math.round(finite(message?.floor, this.state.run.floor)));
        if (!['nightshift', 'campaign'].includes(this.state.run.mode) || this.state.run.ended) return;
        this.state.run.floor = floor;
        this.state.run.floorCleared = false;
        this.nightshiftEscapedFloor = 0;
        this.nsTwangs.clear();
        this.resetMission();
        this.beginFloor();
      });
      this.onMessage('debug-objective', (client) => {
        this.sendObjectiveState(client);
      });
      this.onMessage('debug-run-escape', () => {
        this.runTainted = true;
        this.clearFloor();
        this.handleEscape();
      });
      this.onMessage('debug-run-clear', (_client, message) => {
        this.runTainted = true;
        this.debugRunClear(message);
      });
      this.onMessage('debug-run-capture', (client) => {
        this.runTainted = true;
        this.handleCapture(client.sessionId);
      });
      this.onMessage('debug-force-capture', (client, m) => {
        this.runTainted = true;
        for (const p of this.securitySim.patrol) {
          p.stunnedFor = 0;
          p.dazedFor = 0;
        }
        for (const sp of this.state.security.patrols) {
          sp.stunned = false;
        }
        this.debugForceCapture(client, m);
      });
      this.onMessage('debug-force-release', (client, m) => {
        this.runTainted = true;
        this.debugForceRelease(client, m);
      });
      this.onMessage('debug-object-place', (_client, m) => {
        this.runTainted = true;
        const object = this.state.objects.get(m?.objectId);
        if (!object || object.mode !== 'free') return;
        copyVec3(object.position, m, MAX_WORLD_COORDINATE, 'object.position');
        object.velocity.x = 0; object.velocity.y = 0; object.velocity.z = 0;
        object.revision += 1;
      });
      this.onMessage('debug-bot-seat', (_client, message) => {
        this.runTainted = true;
        this.botEnabled = message?.enable === true;
        this.setMetadata({ code: this.roomId, bot: this.botEnabled });
        const human = [...this.state.players.values()].find((player) => !player.bot && player.connected);
        if (this.botEnabled && human && this.state.players.size === 1 && !this.state.players.get('bot')) {
          this.addBotSeat(human.role === 'pix' ? 'nee' : 'pix', human.position);
        } else if (!this.botEnabled && this.state.players.get('bot')) {
          this.state.players.delete('bot');
          this.state.started = this.state.players.size === 2;
          this.broadcast('bot-seat', { role: 'nee', active: false });
        }
      });

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
      try {
        this.updateHack();
        this.botPilot.tick(deltaMs / 1000);
        this.stepObjective(deltaMs / 1000);
        this.updateMission();
        this.updateHeldObjects(deltaMs / 1000);
        // Patrols share the paused mission clock (client interpolation is keyed on elapsedSeconds).
        if (!this.humanDropped()) this.updateSecurity(deltaMs / 1000);
      } catch (error) {
        const now = Date.now();
        if (this.lastTickErrorAt === null || now - this.lastTickErrorAt >= 5_000) {
          this.lastTickErrorAt = now;
          const message = error?.stack ?? String(error);
          console.error(`[handshake] room ${this.roomId} tick error: ${String(message).replace(/\s*\n\s*/g, ' | ')}`);
        }
      }
    });
  }

  initRun(options = {}, begin = true) {
    const mode = isRunMode(options.mode) ? options.mode : 'standard';
    // Daily rooms always use today's UTC daily seed (shared/run.ts), whatever the client asked for.
    const seedOpt = mode !== 'daily' && typeof options.seed === 'number' && Number.isFinite(options.seed)
      ? options.seed >>> 0
      : undefined;
    const initial = createRunState({ mode, seed: seedOpt });
    const run = this.state.run;
    run.mode = initial.mode;
    run.levelId = this.campaignLevelId;
    run.seed = initial.seed;
    run.floor = initial.floor;
    run.captures = initial.captures;
    run.maxCaptures = initial.maxCaptures;
    run.startedAt = initial.startedAt;
    run.ended = false;
    run.score = 0;
    run.streak = 0;
    run.multiplier = 1;
    run.lastFloorPoints = 0;
    run.floorCleared = false;
    run.rematches = 0;
    run.floorTimes.clear();
    this.runSerial += 1;
    this.runStartSeed = run.seed;
    this.runTainted = false;
    this.leaderboardRecordedSerial = 0;
    this.leaderboardEntry = null;
    this.leaderboardDecisionSerial = 0;
    this.nsFloors = {};
    this.nsTwangs.clear();
    this.nsEndedBroadcast = false;
    this.nightshiftEscapedFloor = 0;
    console.log(`[handshake] room ${this.roomId} run mode=${run.mode} seed=${run.seed} floor=${run.floor}`);
    if (begin) this.beginFloor();
  }

  /** Per-player report stats span the whole run (all Night Shift floors); cleared on rematch / retry. */
  resetPlayerStats() {
    for (const player of this.state.players.values()) {
      player.lootDelivered = 0;
      player.lootCarrySeconds = 0;
      player.passes = 0;
      player.rescues = 0;
      player.capturedCount = 0;
      player.grabs = 0;
      player.hacks = 0;
    }
  }

  resultsPhase() {
    const run = this.state.run;
    return this.state.mission.stage === 'complete' || run.ended || (['nightshift', 'campaign'].includes(run.mode) && run.floorCleared);
  }

  clearRematchVotes() {
    for (const player of this.state.players.values()) player.rematchVote = player.bot === true;
    this.rematchVoteTimes.clear();
  }

  handleRematchVote(client, message) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.connected || !this.resultsPhase()) return;
    const want = message?.want === true;
    const bot = this.state.players.get('bot');
    if (bot) bot.rematchVote = true;
    if (player.rematchVote === want) return;
    const now = Date.now();
    if (now - (this.rematchVoteTimes.get(client.sessionId) ?? 0) < 300) return;
    this.rematchVoteTimes.set(client.sessionId, now);
    player.rematchVote = want;
    if (want && this.state.players.size === 2 && Array.from(this.state.players.values()).every((candidate) => candidate.bot || candidate.rematchVote === true)) {
      this.rematch();
    }
  }

  rematch() {
    const run = this.state.run;
    const mode = run.mode;
    let seed = this.seedPinned != null || mode === 'daily'
      ? run.mode === 'daily' || this.seedPinned == null ? run.seed : this.seedPinned
      : createRunState({ mode }).seed;
    if (this.seedPinned == null && mode !== 'daily' && seed === run.seed) seed = (seed + 1) >>> 0;
    const rematches = Math.min(65535, (run.rematches | 0) + 1);
    this.initRun({ mode, seed }, false);
    this.resetMission();
    this.resetPlayerStats();
    this.state.run.rematches = rematches;
    this.broadcast('rematch-start', {
      seed: this.state.run.seed,
      mode: this.state.run.mode,
      floor: this.state.run.floor,
      rematches,
    });
    this.beginFloor();
  }

  /**
   * Floor hook: Night Shift remixed layout via applySeedFloor; other modes stay handcrafted.
   * Always emits `floor-start` so clients (and reconnect) apply the same seed/floor.
   */
  beginFloor() {
    const { seed, floor, mode } = this.state.run;
    if (mode === 'nightshift' || mode === 'campaign') {
      this.applySeedFloor(seed, floor);
    }
    this.broadcast('floor-start', {
      seed,
      floor,
      mode,
      ...(this.campaignLevelId ? { levelId: this.campaignLevelId } : {}),
      score: this.state.run.score,
      streak: this.state.run.streak,
      multiplier: this.state.run.multiplier,
      captures: this.state.run.captures,
    });
    this.broadcastObjectiveState(true);
  }

  /** Night Shift: advance after a server-cleared floor. */
  handleEscape() {
    const run = this.state.run;
    if (!['nightshift', 'campaign'].includes(run.mode) || run.ended) return;
    if (this.nightshiftEscapedFloor === run.floor) return;
    if (!run.floorCleared) return;
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
    run.floorCleared = false;
    this.nsTwangs.clear();
    this.resetMission();
    this.beginFloor();
  }

  clearFloor() {
    const run = this.state.run;
    if (!['nightshift', 'campaign'].includes(run.mode) || run.ended || run.floorCleared) return;
    const twangs = Math.min(10, Math.max(0, ...Array.from(this.nsTwangs.values(), (entry) => entry.floor === run.floor ? entry.count : 0)));
    const scored = scoreFloorPure({
      elapsedSeconds: Math.max(0, finite(this.state.mission.elapsedSeconds, 0)),
      timesSpotted: Math.max(0, finite(this.state.mission.timesSpotted, 0)),
      tetherSaves: Math.max(0, finite(this.state.mission.tetherSaves, 0)),
      cordTwangs: twangs,
      payoutScale: this.floorPlan?.job?.payoutScale ?? 1,
    }, run.floor, this.nsFloors);
    this.nsFloors = scored.floors;
    run.score = scored.total;
    run.streak = scored.streak;
    run.multiplier = scored.multiplier;
    run.lastFloorPoints = scored.points;
    run.floorCleared = true;
    const next = advanceFloor({
      mode: run.mode,
      seed: run.seed,
      floor: run.floor,
      captures: run.captures,
      maxCaptures: run.maxCaptures,
      startedAt: run.startedAt,
      floorTimes: Array.from(run.floorTimes, (value) => finite(value, 0)),
    }, finite(this.state.mission.elapsedSeconds, 0));
    const campaign = run.mode === 'campaign' ? this.floorPlan?.campaign : null;
    if (campaign) {
      const parSeconds = [150, 180, 210, 240, 240][campaign.index - 1] ?? 300;
      const scoredCampaign = scoreCampaignLevel({
        seconds: this.state.mission.elapsedSeconds,
        parSeconds,
        lootIntact: this.objectiveSim.state.shatters === 0,
        timesSpotted: this.state.mission.timesSpotted,
      });
      this.broadcast('campaign-complete', {
        levelId: campaign.levelId,
        seconds: this.state.mission.elapsedSeconds,
        stars: scoredCampaign.stars,
      });
      return;
    }
    this.broadcast('floor-cleared', {
      floor: run.floor,
      seed: run.seed,
      points: scored.points,
      base: scored.base,
      multiplier: scored.multiplier,
      streak: scored.streak,
      total: scored.total,
      clean: scored.floors[run.floor]?.clean === true,
      boss: this.floorPlan?.job?.boss === true,
      job: this.floorPlan?.job?.name ?? '',
      next: { seed: next.seed, floor: next.floor },
    });
  }

  /** Night Shift: capture → increment; end the run at maxCaptures. */
  handleCapture(sessionId) {
    if (!this.state.players.has(sessionId)) return;
    const run = this.state.run;
    if (!['nightshift', 'campaign'].includes(run.mode) || run.ended) return;
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
      this.clearRematchVotes();
      this.state.mission.securityActive = false;
      this.recordLeaderboard('captures');
      if (!this.nsEndedBroadcast) {
        this.nsEndedBroadcast = true;
        this.broadcast('run-ended', {
          reason: 'captures', captures: run.captures, floor: run.floor, seed: run.seed,
          score: run.score, multiplier: run.multiplier, streak: run.streak,
        });
      }
    }
  }

  reportTwang(sessionId) {
    const run = this.state.run;
    if (!['nightshift', 'campaign'].includes(run.mode) || run.ended || run.floorCleared || !this.state.players.has(sessionId)) return;
    const now = Date.now();
    const entry = this.nsTwangs.get(sessionId) ?? { floor: run.floor, count: 0, at: 0 };
    if (entry.floor !== run.floor) {
      entry.floor = run.floor;
      entry.count = 0;
      entry.at = 0;
    }
    if (now - entry.at < 250) return;
    entry.at = now;
    entry.count = Math.min(10, entry.count + 1);
    this.nsTwangs.set(sessionId, entry);
  }

  debugRunClear(message) {
    const mission = this.state.mission;
    const clamp = (value, fallback) => Math.max(0, finite(value, fallback));
    if (message && Object.prototype.hasOwnProperty.call(message, 'timesSpotted')) mission.timesSpotted = clamp(message.timesSpotted, mission.timesSpotted);
    if (message && Object.prototype.hasOwnProperty.call(message, 'elapsedSeconds')) mission.elapsedSeconds = clamp(message.elapsedSeconds, mission.elapsedSeconds);
    if (message && Object.prototype.hasOwnProperty.call(message, 'tetherSaves')) mission.tetherSaves = clamp(message.tetherSaves, mission.tetherSaves);
    mission.stage = 'complete';
    mission.extracted = true;
    mission.securityActive = false;
    this.clearRematchVotes();
    this.clearFloor();
    if (this.state.run.mode === 'daily') this.recordLeaderboard('debug-run-clear');
  }

  leaderboardBoardsPayload(boards, ranks = {}) {
    return boards.map((key) => ({ key, rank: ranks[key] ?? null, entries: leaderboardStore.top(key) }));
  }

  recordLeaderboard(reason = 'run-end') {
    const run = this.state.run;
    if (this.leaderboardRecordedSerial === this.runSerial || this.leaderboardDecisionSerial === this.runSerial) return;
    const now = Date.now();
    const players = Array.from(this.state.players.values());
    const humans = players.filter((player) => player.bot !== true);
    const validation = validateRun({
      mode: run.mode,
      seed: this.runStartSeed,
      missionStartedAt: this.missionStartedAt,
      runStartedAt: run.startedAt,
      now,
      elapsedSeconds: finite(this.state.mission.elapsedSeconds, 0),
      timesSpotted: finite(this.state.mission.timesSpotted, 0),
      lootDelivered: players.reduce((sum, player) => sum + (Number(player.lootDelivered) || 0), 0),
      floorsCleared: Object.keys(this.nsFloors).length,
      score: Number(run.score),
      captures: Number(run.captures),
      maxCaptures: Number(run.maxCaptures),
      humans: humans.length,
      bots: players.filter((player) => player.bot === true).length,
      tainted: this.runTainted,
    }, {
      minDailySeconds: LEADERBOARD_MIN_DAILY_SECONDS,
      minFloorSeconds: LEADERBOARD_MIN_FLOOR_SECONDS,
      soloMinDailySeconds: LEADERBOARD_SOLO_MIN_DAILY_SECONDS,
      soloMinFloorSeconds: LEADERBOARD_SOLO_MIN_FLOOR_SECONDS,
      acceptTainted: LEADERBOARD_ACCEPT_DEBUG,
    });
    if (!validation.ok) {
      this.leaderboardDecisionSerial = this.runSerial;
      this.broadcast('leaderboard-skipped', { reason: validation.reason });
      if (this.leaderboardDecisionSerial === this.runSerial) {
        console.log(`[handshake] room ${this.roomId} leaderboard skip ${validation.reason}`);
      }
      return;
    }
    const ips = [...new Set(humans.map((human) => {
      const client = this.clients.find((candidate) => candidate.sessionId === human.playerId);
      return client?.auth?.ip ?? 'unknown';
    }))];
    if (ips.some((ip) => !leaderboardIpLimiter.canHit(ip))) {
      this.leaderboardDecisionSerial = this.runSerial;
      this.broadcast('leaderboard-skipped', { reason: 'rate-limit' });
      console.log(`[handshake] room ${this.roomId} leaderboard skip rate-limit`);
      return;
    }
    for (const ip of ips) leaderboardIpLimiter.hit(ip);
    const entryBase = {
      names: { pix: 'PIX', nee: 'NEE' },
      team: '',
      score: Number(run.score),
      timeSeconds: finite(this.state.mission.elapsedSeconds, 0),
      floors: Object.keys(this.nsFloors).length,
      spotted: finite(this.state.mission.timesSpotted, 0),
      recordedAt: now,
      seed: this.runStartSeed,
    };
    if (validation.kind === 'solo') {
      const bot = players.find((player) => player.bot === true);
      if (bot?.role === 'pix' || bot?.role === 'nee') entryBase.names[bot.role] = 'AI';
    }
    const added = leaderboardStore.add(validation.boards, entryBase);
    this.leaderboardRecordedSerial = this.runSerial;
    this.leaderboardDecisionSerial = this.runSerial;
    this.leaderboardEntry = { id: added.id, serial: this.runSerial, boards: validation.boards, nameEdits: new Map(), lastEditAt: 0 };
    this.broadcast('leaderboard-recorded', { id: added.id, boards: this.leaderboardBoardsPayload(validation.boards, added.ranks) });
  }

  handleLeaderboardName(client, message) {
    const player = this.state.players.get(client.sessionId);
    const entry = this.leaderboardEntry;
    if (!player || player.bot === true || player.connected !== true || !entry || entry.serial !== this.runSerial) return;
    const name = sanitizeName(message?.name);
    if (!name) {
      client.send('leaderboard-name-result', { ok: false, reason: 'empty' });
      return;
    }
    if (isProfane(name)) {
      client.send('leaderboard-name-result', { ok: false, reason: 'profanity' });
      return;
    }
    const now = Date.now();
    const edits = entry.nameEdits.get(client.sessionId) ?? 0;
    if (edits >= 5 || now - entry.lastEditAt < 1000) {
      client.send('leaderboard-name-result', { ok: false, reason: 'rate-limit' });
      return;
    }
    const team = message?.team === true;
    if (!leaderboardStore.rename(entry.id, player.role, name, { team })) return;
    entry.nameEdits.set(client.sessionId, edits + 1);
    entry.lastEditAt = now;
    client.send('leaderboard-name-result', { ok: true, name });
    const ranks = Object.fromEntries(entry.boards.map((board) => [board, leaderboardStore.top(board, 50).findIndex((candidate) => candidate.id === entry.id) + 1 || null]));
    this.broadcast('leaderboard-recorded', { id: entry.id, boards: this.leaderboardBoardsPayload(entry.boards, ranks) });
  }

  addBotSeat(role, position) {
    if (!this.botEnabled || this.state.players.get('bot') || this.state.players.size >= 2) return;
    const seat = position
      ? { x: finite(position.x, this.world.spawn.x), y: finite(position.y, this.world.spawn.y), z: finite(position.z, this.world.spawn.z) }
      : { x: this.world.spawn.x + (role === 'pix' ? -1.6 : 1.6), y: this.world.spawn.y, z: this.world.spawn.z };
    const bot = createBotPlayer(Player, role, seat);
    this.state.players.set('bot', bot);
    this.state.started = this.state.players.size === 2;
    if (this.state.started && this._lonelyTimeout) {
      this._lonelyTimeout.clear();
      this._lonelyTimeout = null;
    }
    this.broadcast('bot-seat', { role, active: true });
  }

  onJoin(client) {
    // Clear empty-room timeout on first join
    if (this._emptyTimeout) {
      this._emptyTimeout.clear();
      this._emptyTimeout = null;
    }
    if (this.quickMatch) {
      const ip = client.auth?.ip ?? 'unknown';
      client.userData = { ...(client.userData ?? {}), quickMatchIp: ip, quickMatchSeat: true };
      acquireQuickMatchSeat(ip);
    }
    const bot = this.state.players.get('bot');
    if (bot) {
      const role = bot.role;
      const player = new Player();
      player.playerId = client.sessionId;
      player.role = role;
      player.connected = true;
      player.bot = false;
      player.position.x = bot.position.x;
      player.position.y = bot.position.y;
      player.position.z = bot.position.z;
      player.velocity.x = bot.velocity.x;
      player.velocity.y = bot.velocity.y;
      player.velocity.z = bot.velocity.z;
      player.orientation.pitch = bot.orientation.pitch;
      player.orientation.yaw = bot.orientation.yaw;
      player.orientation.roll = bot.orientation.roll;
      player.rematchVote = false;
      for (const object of this.state.objects.values()) {
        if (object.heldBy === role) object.holderId = client.sessionId;
      }
      if (bot.captured) {
        const freed = this.securitySim.releaseRole(role, 'handoff');
        if (freed) this.finishCapture(freed.role, freed.index, 'handoff');
      }
      this.lastGrabMs.delete('bot');
      this.state.players.delete('bot');
      this.state.players.set(client.sessionId, player);
      this.state.started = true;
      this.broadcast('bot-seat', { role, active: false, handoff: true, by: client.sessionId });
      if (this.quickMatch) console.log(`[quickmatch] room ${this.roomId} key=${this.qmKey} paired`);
      this.sendObjectiveState(client);
      return;
    }

    const roles = new Set(Array.from(this.state.players.values()).map((candidate) => candidate.role));
    const role = roles.has('pix') ? 'nee' : 'pix';
    const player = new Player();
    player.playerId = client.sessionId;
    player.role = role;
    player.connected = true;
    player.bot = false;
    player.position.x = this.world.spawn.x + (role === 'pix' ? -1.6 : 1.6);
    player.position.y = this.world.spawn.y;
    player.position.z = this.world.spawn.z;
    player.rematchVote = false;
    this.state.players.set(client.sessionId, player);
    this.state.started = this.state.players.size === 2;
    if (this.state.started && this._lonelyTimeout) {
      this._lonelyTimeout.clear();
      this._lonelyTimeout = null;
    }
    if (this.botEnabled && this.state.players.size === 1) {
      this.addBotSeat(role === 'pix' ? 'nee' : 'pix');
    }
    if (this.quickMatch) console.log(`[quickmatch] room ${this.roomId} key=${this.qmKey} ${this.state.started ? 'paired' : 'waiting'}`);
    this.sendObjectiveState(client);
  }

  /** Keep reserved human seats in place so reconnect tokens retain their identity. */
  refreshReservedPilot() {
    const hasHuman = [...this.state.players.values()].some((p) => !this.reconnectingSeats.has(p.playerId) && !p.bot && p.connected);
    let pilotId = 'bot';
    for (const id of this.reconnectingSeats) {
      const seat = this.state.players.get(id);
      if (!seat) continue;
      seat.bot = this.botEnabled && hasHuman;
      seat.connected = seat.bot;
      if (seat.bot) pilotId = id;
      else this.freezePlayer(seat);
    }
    if (this.botPilot.sessionId !== pilotId) {
      this.botPilot.reset();
      this.botPilot = new BotPilot(this);
      this.botPilot.sessionId = pilotId;
    }
  }

  /** Unexpected drop: reserve identity and let AI pilot when a human remains. */
  onDrop(client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    this.freezePlayer(player);
    if (this.quickMatch && this.state.players.size === 1 && !this.state.players.get('bot') && !this.state.started) return;
    if (this.quickMatch && ![...this.state.players.values()].some((candidate) => !candidate.bot && candidate.connected && candidate !== player)) this.lock();
    const humanRemaining = [...this.state.players.values()].some((candidate) => !candidate.bot && candidate !== player && candidate.connected);
    if (!humanRemaining) {
      const bot = this.state.players.get('bot');
      if (bot) this.freezePlayer(bot);
    }
    this.releaseRole(player.role);
    this.reconnectingSeats.add(client.sessionId);
    this.refreshReservedPilot();
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.reconnectingSeats.delete(client.sessionId);
      player.bot = false;
      player.connected = true;
      this.refreshReservedPilot();
      if (this.botEnabled && this.state.players.size === 1) this.addBotSeat(player.role === 'pix' ? 'nee' : 'pix', player.position);
      this.state.started = this.state.players.size === 2;
      const bot = this.state.players.get('bot');
      if (bot) bot.connected = true;
      if (this.quickMatch && this.quickMatchAllowed && [...this.state.players.values()].filter((candidate) => !candidate.bot && candidate.connected).length < 2) this.unlock();
      this.sendObjectiveState(client);
    }
  }

  /** Permanent leave (consent, or grace window expired): existing partner-left path. */
  onLeave(client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    this.reconnectingSeats.delete(client.sessionId);
    if (this.botPilot.sessionId === client.sessionId) {
      this.botPilot.reset();
      this.botPilot = new BotPilot(this);
    }
    if (this.quickMatch && client.userData?.quickMatchSeat) {
      releaseQuickMatchSeat(client.userData.quickMatchIp ?? 'unknown');
      client.userData.quickMatchSeat = false;
    }
    if (player.connected) this.freezePlayer(player);
    const leaverPosition = { x: player.position.x, y: player.position.y, z: player.position.z };
    // Hold expired (or consented leave): the carried item finally drops where the drone was.
    this.dropHeldForRole(player.role, 'disconnect');
    this.releaseRole(player.role);
    player.rematchVote = false;
    this.state.players.delete(client.sessionId);
    this.clearRematchVotes();
    const partner = Array.from(this.state.players.values()).find((candidate) => !candidate.bot && candidate.connected);
    if (this.botEnabled && partner) {
      this.state.started = true;
      this.addBotSeat(player.role, leaverPosition);
    } else {
      this.state.players.delete('bot');
      this.state.started = false;
      if (this.quickMatch && partner) {
        this.quickMatchAllowed = false;
        this.lock();
      }
    }
    const partnerClient = partner ? this.clientForRole(partner.role) : undefined;
    if (!this.botEnabled || !partner) partnerClient?.send('rematch-partner-left', { role: player.role });
    if (this.quickMatch && this.botEnabled && partner) this.unlock();
    this.refreshReservedPilot();
    this.pingTimes.delete(client.sessionId);
    this.emoteTimes.delete(client.sessionId);
    this.clientMessageRates.delete(client.sessionId);
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
    if (this.quickMatch) {
      for (const client of this.clients) {
        if (client.userData?.quickMatchSeat) {
          releaseQuickMatchSeat(client.userData.quickMatchIp ?? 'unknown');
          client.userData.quickMatchSeat = false;
        }
      }
    }
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
    if (!player?.connected || player.captured || !object || distance(player.position, object.position) > object.grabRadius) {
      return;
    }
    if (object.id === 'prototype' && ((this.state.run.mode !== 'campaign' && !this.state.hack.doorOpen) || this.objectiveSim.locked)) return;
    if (object.id === 'prototype' && this.floorPlan?.campaign?.index === 1 && !this.state.hack.stationCComplete) return;
    const now = Date.now();
    if (now - (this.lastGrabMs.get(sessionId) ?? 0) < GRAB_COOLDOWN_MS) return;
    this.lastGrabMs.set(sessionId, now);
    for (const other of this.state.objects.values()) {
      if (other.id !== object.id && other.holderId === sessionId) {
        return;
      }
    }
    if (object.mode === 'held') {
      if (object.heldBy === player.role) return;
      const holder = this.state.players.get(object.holderId);
      if (!holder?.connected || now - (this.heldSinceMs.get(object.id) ?? now) < STEAL_LOCK_MS) return;
      if (distance(player.position, object.position) > Math.min(STEAL_RANGE, object.grabRadius)) return;
      const from = object.heldBy;
      this.setOwnership(object, player, 'steal');
      player.grabs = Math.min(65535, player.grabs + 1);
      this.broadcast('object-event', { objectId: object.id, event: 'steal', from, to: player.role });
    } else {
      this.setOwnership(object, player, 'grab');
      player.grabs = Math.min(65535, player.grabs + 1);
    }
    if (object.id === 'prototype') this.triggerAlarm(player.role);
  }

  handoffObject(sessionId, message) {
    const player = this.state.players.get(sessionId);
    const object = this.state.objects.get(message?.objectId);
    const partner = Array.from(this.state.players.values()).find((candidate) => candidate.role !== player?.role);
    if (!player?.connected || player.captured || !object || object.holderId !== sessionId || !partner?.connected || partner.captured) return;
    const now = Date.now();
    if (now - (this.lastGrabMs.get(sessionId) ?? 0) < GRAB_COOLDOWN_MS) return;
    this.lastGrabMs.set(sessionId, now);
    if (!canPass({
      holder: player.position,
      holderYaw: facingYaw(player.orientation.yaw),
      partner: partner.position,
      range: HANDOFF_RANGE,
      coneDeg: HANDOFF_CONE_DEG,
    }).ok) return;
    if (Array.from(this.state.objects.values()).some((candidate) => candidate.id !== object.id && candidate.holderId === partner.playerId)) return;
    const from = player.role;
    this.setOwnership(object, partner, 'handoff');
    player.passes = Math.min(65535, player.passes + 1);
    this.broadcast('object-event', { objectId: object.id, event: 'handoff', from, to: partner.role });
  }

  releaseObject(sessionId, message) {
    const player = this.state.players.get(sessionId);
    const object = this.state.objects.get(message?.objectId);
    if (!player?.connected || player.captured || !object || object.holderId !== sessionId) {
      return;
    }
    const release = { x: finite(message?.position?.x, player.position.x + HOLD_OFFSET.x), y: finite(message?.position?.y, player.position.y + HOLD_OFFSET.y), z: finite(message?.position?.z, player.position.z + HOLD_OFFSET.z) };
    if (distance(player.position, release) > RELEASE_RANGE) Object.assign(release, { x: player.position.x + HOLD_OFFSET.x, y: player.position.y + HOLD_OFFSET.y, z: player.position.z + HOLD_OFFSET.z });
    copyVec3(object.position, release, MAX_WORLD_COORDINATE, 'object.position');
    copyVec3(object.velocity, message.velocity, MAX_RELEASE_SPEED, 'object.velocity');
    this.setOwnership(object, null, message?.thrown === true ? 'throw' : 'drop', player.role);
    if (message?.thrown === true) this.state.mission.objectsThrown += 1;
  }

  applyObjectSnapshot(sessionId, message) {
    const player = this.state.players.get(sessionId);
    const object = this.state.objects.get(message?.objectId);
    if (!player?.connected || !object || (object.mode === 'held' ? object.holderId !== sessionId : object.authority !== player.role)) {
      return;
    }
    if (object.mode === 'held' && distance(player.position, message.position ?? {}) > HELD_SNAPSHOT_RANGE) {
      copyVec3(object.position, { x: player.position.x + HOLD_OFFSET.x, y: player.position.y + HOLD_OFFSET.y, z: player.position.z + HOLD_OFFSET.z }, MAX_WORLD_COORDINATE, 'object.position');
    } else {
      copyVec3(object.position, message.position, MAX_WORLD_COORDINATE, 'object.position');
    }
    copyVec3(object.velocity, message.velocity, MAX_OBJECT_SPEED, 'object.velocity');
    const orientation = message.orientation ?? {};
    object.orientation.pitch = finite(orientation.pitch, object.orientation.pitch);
    object.orientation.yaw = finite(orientation.yaw, object.orientation.yaw);
    object.orientation.roll = finite(orientation.roll, object.orientation.roll);
    if (object.id === 'prototype' && object.mode !== 'held') {
      const recover = prototypeRecovery(object.position, this.runLayout?.loot ?? layout.objects.prototype, this.state.mission.alarm);
      if (recover) {
        Object.assign(object.position, recover);
        Object.assign(object.velocity, { x: 0, y: 0, z: 0 });
        object.revision += 1;
        object.lastEvent = 'reset';
      }
    }
  }

  setOwnership(object, holder, event, freeAuthority = holder?.role ?? object.authority) {
    object.heldBy = holder?.role ?? '';
    object.holderId = holder?.playerId ?? '';
    object.mode = holder ? 'held' : 'free';
    object.authority = freeAuthority;
    object.lastEvent = event;
    object.revision += 1;
    if (holder) this.heldSinceMs.set(object.id, Date.now());
    else this.heldSinceMs.delete(object.id);
  }

  heldPosition(player) {
    return { x: player.position.x + HOLD_OFFSET.x, y: player.position.y + HOLD_OFFSET.y, z: player.position.z + HOLD_OFFSET.z };
  }

  updateHeldObjects(deltaSeconds = 0) {
    for (const object of this.state.objects.values()) {
      if (object.mode !== 'held') continue;
      const holder = this.state.players.get(object.holderId);
      if (object.id === 'prototype' && holder) {
        holder.lootCarrySeconds = Math.min(65535, holder.lootCarrySeconds + Math.max(0, finite(deltaSeconds)));
      }
      if (!holder?.connected) {
        const p = holder ? this.heldPosition(holder) : object.position;
        object.position.x = p.x; object.position.y = p.y; object.position.z = p.z;
        object.velocity.x = 0; object.velocity.y = 0; object.velocity.z = 0;
      }
    }
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

  get terminalRange() {
    return TERMINAL_RANGE;
  }

  botHackStation(role) {
    for (const stationId of ['terminal-a', 'terminal-b', 'terminal-c']) {
      const fields = this.stationFields(stationId);
      if (fields?.role === role && !this.state.hack[fields.complete]) {
        return { stationId, position: this.world.terminals[stationId] };
      }
    }
    return null;
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
    if (this.state.run.mode === 'campaign' && this.floorPlan?.campaign?.index === 1 && stationId === 'terminal-c') {
      this.state.hack[fields.owner] = player.role;
      this.completeHackForRole(player, stationId);
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
    this.completeHackForRole(player, stationId);
  }

  completeHackForRole(player, stationId) {
    const fields = this.stationFields(stationId);
    if (!player || !fields || this.state.hack[fields.complete] || this.state.hack[fields.owner] !== player.role) return false;
    this.state.hack[fields.complete] = true;
    player.hacks = Math.min(65535, player.hacks + 1);
    this.state.hack[fields.owner] = '';
    this.state.hack.doorOpen =
      this.state.hack.stationAComplete && this.state.hack.stationBComplete &&
      this.state.hack.stationCComplete;
    if (this.state.hack.doorOpen && !this.doorOpenedAt) this.doorOpenedAt = Date.now();
    return true;
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
    if (this.state.mission.alarm || (this.state.run.mode !== 'campaign' && !this.state.hack.doorOpen)) return;
    this.state.mission.stage = 'escape';
    this.state.mission.alarm = true;
    this.state.mission.securityActive = true;
    this.state.mission.prototypeHeldBy = role;
  }

  humanDropped() {
    return [...this.state.players.values()].some((player) => player.bot !== true && player.connected === false);
  }

  updateMission() {
    const mission = this.state.mission;
    const now = Date.now();
    // A human seat in the reconnect window pauses the mission clock (hazards and objectives key off it).
    if (this.humanDropped() && this.missionClockAt && mission.stage !== 'complete') this.missionStartedAt += now - this.missionClockAt;
    this.missionClockAt = now;
    mission.elapsedSeconds = (now - this.missionStartedAt) / 1000;
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
        carrier.lootDelivered = Math.min(65535, carrier.lootDelivered + 1);
        this.clearRematchVotes();
        mission.extracted = true;
        mission.stage = 'complete';
        mission.securityActive = false;
        if (this.state.run.mode === 'nightshift' || this.state.run.mode === 'campaign') {
          this.objectiveSim.completeAtExtraction();
          this.broadcastObjectiveState(true);
          this.clearFloor();
        } else if (this.state.run.mode === 'daily') {
          this.recordLeaderboard('mission-complete');
        }
      }
    }
  }

  stepObjective(dt) {
    if (!this.floorPlan?.objective || this.state.mission.stage === 'complete') return;
    if (this.humanDropped()) return;
    const activePlan = this.floorPlan.phases?.[this.objectivePhase] ?? this.floorPlan.objective;
    const events = this.objectiveSim.step(
      Math.max(0, Math.min(0.25, dt)),
      Array.from(this.state.players.values()),
      this.state.objects.get('prototype')?.heldBy ?? '',
    );
    for (const event of events) {
      if (event.type === 'shatter') this.handlePrototypeShatter(event.role);
      else this.broadcast('objective-event', event);
    }
    if (this.floorPlan.phases?.length && this.objectiveSim.state.done && this.objectivePhase < this.floorPlan.phases.length - 1) {
      this.objectivePhase += 1;
      this.objectiveSim.reset(this.floorPlan.phases[this.objectivePhase]);
      this.broadcast('objective-event', { type: 'phase', phase: this.objectivePhase + 1 });
    }
    const elapsed = finite(this.state.mission.elapsedSeconds, 0);
    if (shouldBroadcastObjective(this.objectiveBroadcastSeq, this.objectiveSim, elapsed - this.objectiveBroadcastElapsed)) {
      this.broadcastObjectiveState();
    }
  }

  objectivePayload() {
    return {
      floor: this.state.run.floor,
      seed: this.state.run.seed,
      state: this.objectiveSim.snapshot(),
      phase: this.objectivePhase + 1,
    };
  }

  sendObjectiveState(client) {
    if (!['nightshift', 'campaign'].includes(this.state.run.mode)) return;
    client?.send('objective-state', this.objectivePayload());
  }

  broadcastObjectiveState(force = false) {
    if (!['nightshift', 'campaign'].includes(this.state.run.mode) || !this.floorPlan) return;
    const elapsed = finite(this.state.mission.elapsedSeconds, 0);
    this.broadcast('objective-state', this.objectivePayload());
    this.objectiveBroadcastSeq = this.objectiveSim.state.seq;
    this.objectiveBroadcastElapsed = elapsed;
  }

  handlePrototypeShatter(role = 'pix') {
    const prototype = this.state.objects.get('prototype');
    if (!prototype) return;
    const loot = this.runLayout?.loot ?? layout.objects.prototype;
    this.setOwnership(prototype, null, 'shatter', role === 'nee' ? 'nee' : 'pix');
    prototype.position.x = loot.x;
    prototype.position.y = loot.y;
    prototype.position.z = loot.z;
    prototype.velocity.x = 0;
    prototype.velocity.y = 0;
    prototype.velocity.z = 0;
    prototype.revision += 1;
    const spottedRole = role === 'nee' ? 'nee' : 'pix';
    this.markSpotted(spottedRole, true);
    this.broadcast('objective-event', { type: 'shatter', role: spottedRole });
    this.broadcastObjectiveState(true);
  }

  updateSecurity(dt) {
    dt = Math.max(0, Math.min(0.1, dt));
    if (this.state.mission.stage === 'complete') return;
    const now = Date.now();
    const quietCampaign = this.state.run.mode === 'campaign' && this.runLayout?.cameras.length === 0;
    const cameraDisabled = quietCampaign || (this.doorOpenedAt > 0 && (now - this.doorOpenedAt) < 18000);
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
      active: this.state.mission.securityActive && !(quietCampaign && this.runLayout?.patrolRoutes.length === 0),
      elapsed: this.state.mission.elapsedSeconds,
      cameraDisabled,
      players,
      objects: this.state.objects.values(),
    });
    // Each drone has its own spotted cooldown, so both can be spotted in the same window.
    for (const role of result.spotted) {
      this.markSpotted(role);
    }
    if (this.floorPlan?.hazards && this.state.mission.stage !== 'complete') {
      const hazardPlayers = players.filter((player) => player.connected).map((player) => ({
        role: player.role,
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        captured: player.captured,
      }));
      const ordered = hazardPlayers.slice().sort((a, b) => a.role.localeCompare(b.role));
      const cordPoints = ordered.map((player) => ({ x: player.x, y: player.y, z: player.z }));
      const trips = this.hazardGate.filter(
        checkHazardTrips(this.floorPlan.hazards, this.state.mission.elapsedSeconds, hazardPlayers, cordPoints),
        this.state.mission.elapsedSeconds,
      );
      for (const trip of trips) {
        this.markSpotted(trip.role);
        this.broadcast('hazard-trip', { id: trip.id, role: trip.role, via: trip.via });
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

  markSpotted(role, force = false) {
    if (!(role in this.spotCooldownUntil) || this.state.mission.stage === 'complete') return false;
    const now = Date.now();
    if (!force && this.spotCooldownUntil[role] > now) return false;
    this.state.mission.timesSpotted += 1;
    this.spotCooldownUntil[role] = now + 2800;
    this.broadcast('security-spotted', { role });
    return true;
  }

  beginCapture(role, index) {
    const player = Array.from(this.state.players.values()).find((p) => p.role === role);
    if (!player || player.captured) return;
    player.captured = true;
    player.capturedCount = Math.min(65535, player.capturedCount + 1);
    player.capturedBy = index;
    player.struggles = 0;
    player.carryFor = 0;
    player.rescueProgress = 0;
    for (const object of this.state.objects.values()) {
      if (object.holderId !== player.playerId) continue;
      const partner = Array.from(this.state.players.values()).find((candidate) => candidate.role !== role && candidate.connected && !candidate.captured);
      const from = object.heldBy;
      const p = this.heldPosition(player);
      object.position.x = p.x; object.position.y = p.y; object.position.z = p.z;
      object.velocity.x = 0; object.velocity.y = 0; object.velocity.z = 0;
      this.setOwnership(object, null, 'captured', partner?.role ?? role);
      this.broadcast('object-event', { objectId: object.id, event: 'captured', from, to: partner?.role ?? '' });
    }
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
    if (!['nightshift', 'campaign'].includes(this.state.run.mode) || this.state.run.ended) return;
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
    this.objectiveSim.noteYank(sender.role);
    const target = this.clients.find((candidate) => candidate.sessionId === partnerId);
    this.yankTimes.set(client.sessionId, now);
    const impulse = message.impulse ?? {};
    let x = finite(impulse.x), y = finite(impulse.y), z = finite(impulse.z);
    const magnitude = Math.hypot(x, y, z);
    if (magnitude > 16) { x *= 16 / magnitude; y *= 16 / magnitude; z *= 16 / magnitude; }
    // Server decides rescue: partner is captured + yank kind (solo rescue rules).
    const rescue = kind === 'yank' && partner.captured === true && distance(sender.position, partner.position) <= 11;
    if (rescue) {
      const freed = this.securitySim.releaseRole(partner.role, 'yank');
      if (freed) {
        this.finishCapture(freed.role, freed.index, 'yank');
        sender.rescues = Math.min(65535, sender.rescues + 1);
        this.reportTetherSave(client.sessionId);
      }
    }
    target?.send('tether-yanked', {
      kind,
      rescue,
      strength: Math.max(0, Math.min(1, finite(message.strength))),
      impulse: { x, y, z },
    });
  }

  botYank() {
    const sender = this.state.players.get(this.botPilot.sessionId);
    const partner = [...this.state.players.values()].find((player) => !player.bot && player.connected);
    if (!sender?.connected || sender.captured || !partner || !partner.captured || distance(sender.position, partner.position) > 11) return false;
    this.objectiveSim.noteYank(sender.role);
    const freed = this.securitySim.releaseRole(partner.role, 'yank');
    if (!freed) return false;
    this.finishCapture(freed.role, freed.index, 'yank');
    sender.rescues = Math.min(65535, sender.rescues + 1);
    this.reportTetherSave(sender.playerId);
    const target = this.clientForRole(partner.role);
    const dx = sender.position.x - partner.position.x;
    const dy = sender.position.y - partner.position.y;
    const dz = sender.position.z - partner.position.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    target?.send('tether-yanked', {
      kind: 'yank',
      rescue: true,
      strength: 1,
      impulse: { x: dx / length * 6, y: dy / length * 6, z: dz / length * 6 },
    });
    return true;
  }

  relayPing(client, message) {
    const sender = this.state.players.get(client.sessionId);
    if (!sender || !sender.connected || !message || typeof message !== 'object') return;
    const now = Date.now();
    if (now - (this.pingTimes.get(client.sessionId) ?? 0) < PING_COOLDOWN_MS) return;
    const raw = { x: message.x, y: message.y, z: message.z };
    if (![raw.x, raw.y, raw.z].every((value) => Number.isFinite(value))) return;
    const point = {
      x: Math.max(-MAX_WORLD_COORDINATE, Math.min(MAX_WORLD_COORDINATE, raw.x)),
      y: Math.max(-20, Math.min(80, raw.y)),
      z: Math.max(-MAX_WORLD_COORDINATE, Math.min(MAX_WORLD_COORDINATE, raw.z)),
    };
    const dx = point.x - sender.position.x;
    const dy = point.y - sender.position.y;
    const dz = point.z - sender.position.z;
    const length = Math.hypot(dx, dy, dz);
    if (length > 120) {
      point.x = sender.position.x + dx * 120 / length;
      point.y = sender.position.y + dy * 120 / length;
      point.z = sender.position.z + dz * 120 / length;
      point.x = Math.max(-MAX_WORLD_COORDINATE, Math.min(MAX_WORLD_COORDINATE, point.x));
      point.y = Math.max(-20, Math.min(80, point.y));
      point.z = Math.max(-MAX_WORLD_COORDINATE, Math.min(MAX_WORLD_COORDINATE, point.z));
    }
    this.pingTimes.set(client.sessionId, now);
    this.broadcast('ping-placed', { role: sender.role, ...point, id: ++this.pingId, at: now });
  }

  relayEmote(client, message) {
    const sender = this.state.players.get(client.sessionId);
    if (!sender || !sender.connected || !message || typeof message !== 'object') return;
    if (!EMOTE_IDS.has(message.id)) return;
    const now = Date.now();
    if (now - (this.emoteTimes.get(client.sessionId) ?? 0) < EMOTE_COOLDOWN_MS) return;
    this.emoteTimes.set(client.sessionId, now);
    this.broadcast('emote-played', { role: sender.role, id: message.id, at: now });
  }

  /**
   * Night Shift only: build enemies/security from generateRun → applyRunLayout.
   * Called from beginFloor on room create and each floor advance.
   */
  applySeedFloor(seed, floor = 0) {
    const run = this.state.run.mode === 'campaign' && this.campaignLevelId
      ? campaignLayout(this.campaignLevelId)
      : generateRun(seed >>> 0, Math.max(0, floor | 0));
    this.runLayout = run;
    this.floorPlan = run.plan ?? null;
    this.objectivePhase = 0;
    this.objectiveSim.reset(this.floorPlan?.phases?.[0] ?? this.floorPlan?.objective ?? null);
    this.hazardGate = new HazardTripGate();
    this.objectiveBroadcastSeq = -1;
    this.objectiveBroadcastElapsed = 0;
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
    this.clearRematchVotes();
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
    this.botPilot.reset();
    const prototype = this.state.objects.get('prototype');
    if (prototype) {
      this.setOwnership(prototype, null, 'reset', 'pix');
      const loot = this.runLayout?.loot ?? layout.objects.prototype;
      prototype.position.x = loot.x;
      prototype.position.y = loot.y;
      prototype.position.z = loot.z;
      prototype.velocity.x = 0;
      prototype.velocity.y = 0;
      prototype.velocity.z = 0;
      prototype.revision += 1;
    }
    for (const player of this.state.players.values()) {
      for (const object of this.state.objects.values()) {
        if (object.holderId !== player.playerId || object.id === 'prototype') continue;
        const p = this.heldPosition(player);
        object.position.x = p.x; object.position.y = p.y; object.position.z = p.z;
        object.velocity.x = 0; object.velocity.y = 0; object.velocity.z = 0;
        this.setOwnership(object, null, 'reset', player.role);
      }
    }
    const mission = this.state.mission;
    mission.stage = this.state.run.mode === 'campaign' ? 'steal-prototype' : 'infiltrate';
    mission.alarm = false;
    mission.securityActive = false;
    mission.prototypeHeldBy = '';
    mission.extracted = false;
    mission.elapsedSeconds = 0;
    mission.timesSpotted = 0;
    mission.objectsThrown = 0;
    mission.tetherSaves = 0;
    this.missionStartedAt = Date.now();
    this.objectiveSim.reset(this.floorPlan?.phases?.[0] ?? this.floorPlan?.objective ?? null);
    this.hazardGate = new HazardTripGate();
    this.objectiveBroadcastSeq = -1;
    this.objectiveBroadcastElapsed = 0;
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
      if (object.mode === 'free' && object.authority === role) {
        object.authority = fallbackConnected ? fallback : 'pix';
        object.velocity.x = 0;
        object.velocity.y = 0;
        object.velocity.z = 0;
        object.revision += 1;
      }
    }
  }

  dropHeldForRole(role, event) {
    const player = Array.from(this.state.players.values()).find((candidate) => candidate.role === role);
    if (!player) return;
    const partner = Array.from(this.state.players.values()).find((candidate) => candidate.role !== role && candidate.connected && !candidate.captured);
    for (const object of this.state.objects.values()) {
      if (object.holderId !== player.playerId) continue;
      const from = object.heldBy;
      const p = this.heldPosition(player);
      object.position.x = p.x; object.position.y = p.y; object.position.z = p.z;
      object.velocity.x = 0; object.velocity.y = 0; object.velocity.z = 0;
      this.setOwnership(object, null, event, partner?.role ?? role);
      this.broadcast('object-event', { objectId: object.id, event, from, to: partner?.role ?? '' });
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
gameServer.define('handshake', HandshakeRoom).filterBy(['qmKey']);
// A failed bind is only emitted on the http server (listen() never rejects), which used to leave
// a zombie process that looked alive to `pgrep` but owned no port. Fail loudly instead.
const onListenError = (error) => {
  logListenError(error, PORT);
  process.exit(1);
};
gameServer.transport.server?.once('error', onListenError);
try {
  await gameServer.listen(PORT, '0.0.0.0');
  gameServer.transport.server?.off('error', onListenError);
} catch (error) {
  logListenError(error, PORT);
  process.exit(1);
}

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
    const mem = process.memoryUsage();
    const body = JSON.stringify({
      ok: true,
      uptime: Math.floor(process.uptime()),
      rooms: liveRooms.size,
      maxRooms: MAX_ROOMS,
      clients: totalClients,
      memory: {
        rssMb: Math.round(mem.rss / (1024 * 1024)),
        heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
      },
      quickMatchWaiting: [...liveRooms].filter((room) => room.quickMatch && !room.locked &&
        [...room.state.players.values()].filter((player) => !player.bot && player.connected).length === 1).length,
      version: pkg.version || 'dev',
      leaderboard: true,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...corsHeaders(req),
    });
    res.end(body);
    return;
  }
  if (path === '/leaderboard') {
    const headers = { ...corsHeaders(req), 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { ...headers, Allow: 'GET, OPTIONS' });
      res.end();
      return;
    }
    const ip = clientIp({ headers: req.headers, req });
    if (!leaderboardHttpLimiter.hit(ip)) {
      res.writeHead(429, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate-limit' }));
      return;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const board = url.searchParams.get('board');
    if (board !== null && !/^(daily:\d{4}-\d{2}-\d{2}|solo:daily:\d{4}-\d{2}-\d{2}|nightshift:all|solo:nightshift:all|nightshift:week:\d{4}-W\d{2}|solo:nightshift:week:\d{4}-W\d{2})$/.test(board)) {
      res.writeHead(400, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid-board' }));
      return;
    }
    const body = board === null
      ? leaderboardStore.boardsSummary()
      : { key: board, entries: leaderboardStore.top(board) };
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
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
console.log(`[handshake] leaderboard file: ${LEADERBOARD_FILE || 'memory'}`);
console.log(`[handshake] listening on port ${PORT}`);

// --- Graceful shutdown on Render redeploys (SIGTERM / SIGINT) ------------------
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[handshake] received ${signal}, initiating graceful shutdown...`);
  for (const room of liveRooms) {
    try {
      room.broadcast('server-shutdown', { reason: 'redeploy', reconnectInMs: 2500 });
      for (const client of room.clients) {
        client.leave(4001, 'server-restart');
      }
    } catch (_) {}
  }
  httpServer.close(() => {
    console.log('[handshake] HTTP server closed gracefully.');
    try { leaderboardStore.flushSync(); } catch (_) {}
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('[handshake] graceful shutdown timed out, exiting');
    try { leaderboardStore.flushSync(); } catch (_) {}
    process.exit(0);
  }, 4000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
