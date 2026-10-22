import { CloseCode, Room, Server, WebSocketTransport } from 'colyseus';
import { schema, t } from '@colyseus/schema';
import layout from '../src/level/heist-layout.json' with { type: 'json' };

const PORT = Number.parseInt(process.env.PORT ?? '2567', 10);
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_SECONDS = 15;
const MAX_WORLD_COORDINATE = 200;
const MAX_PLAYER_SPEED = 28;
const MAX_OBJECT_SPEED = 32;
const TERMINAL_RANGE = 5;
const TERMINALS = layout.terminals;
const EXTRACTION = layout.extraction;

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

const HandshakeState = schema(
  {
    started: t.boolean().default(false),
    players: t.map(Player),
    objects: t.map(Grabbable),
    hack: Hack,
    mission: Mission,
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

  onCreate() {
    this.maxClients = 2;
    this.roomId = roomCode();
    this.setMetadata({ code: this.roomId });
    for (const [id, position] of Object.entries(layout.objects)) {
      const radius = { 'cargo-core': 3.3, 'crate-blue': 4.8, 'crate-pink': 3, prototype: 3.2 }[id] ?? 2.6; // desk props: small grab radius
      this.state.objects.set(id, createGrabbable(id, position.x, position.y, position.z, radius));
    }
    this.onMessage('snapshot', (client, message) => {
      this.applySnapshot(client.sessionId, message);
    });
    this.onMessage('grab-object', (client, message) => this.grabObject(client.sessionId, message));
    this.onMessage('release-object', (client, message) => this.releaseObject(client.sessionId, message));
    this.onMessage('object-snapshot', (client, message) => this.applyObjectSnapshot(client.sessionId, message));
    this.onMessage('hack-start', (client, message) => this.startHack(client.sessionId, message));
    this.onMessage('hack-complete', (client, message) => this.completeHack(client.sessionId, message));
    this.onMessage('hack-cancel', (client, message) => this.cancelHack(client.sessionId, message));
    this.onMessage('mission-spotted', (client) => this.reportSpotted(client.sessionId));
    this.onMessage('mission-tether-save', (client) => this.reportTetherSave(client.sessionId));
    this.onMessage('mission-retry', () => this.resetMission());
    this.onMessage('tether-yank', (client, message) => this.relayTetherYank(client, message));
    this.onMessage('patrol-stun', (client, message) => this.stunPatrol(client, message));
    this.setSimulationInterval(() => {
      this.updateHack();
      this.updateMission();
    });
  }

  onJoin(client) {
    const roles = new Set(Array.from(this.state.players.values()).map((player) => player.role));
    const role = roles.has('pix') ? 'nee' : 'pix';
    const player = new Player();
    player.playerId = client.sessionId;
    player.role = role;
    player.connected = true;
    player.position.x = role === 'pix' ? -1.6 : 1.6;
    player.position.y = layout.spawn.y;
    player.position.z = layout.spawn.z;
    this.state.players.set(client.sessionId, player);
    this.state.started = this.state.players.size === 2;
  }

  async onLeave(client, code) {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    player.connected = false;
    this.releaseRole(player.role);

    try {
      if (code === CloseCode.CONSENTED) {
        throw new Error('consented leave');
      }
      await this.allowReconnection(client, RECONNECT_SECONDS);
      player.connected = true;
    } catch {
      this.state.players.delete(client.sessionId);
      this.state.started = false;
    }
  }

  applySnapshot(sessionId, message) {
    const player = this.state.players.get(sessionId);
    if (!player || !message || typeof message !== 'object') {
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
    player.boost = enumValue(message.boost, ['off', 'active'], 'off');
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
    const position = TERMINALS[stationId];
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
      distance(player.position, TERMINALS[stationId]) > TERMINAL_RANGE
    ) return;
    this.state.hack[fields.complete] = true;
    this.state.hack[fields.owner] = '';
    this.state.hack.doorOpen =
      this.state.hack.stationAComplete && this.state.hack.stationBComplete &&
      this.state.hack.stationCComplete;
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
      if (!player?.connected || distance(player.position, TERMINALS[stationId]) > TERMINAL_RANGE) {
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
    if (mission.stage === 'infiltrate' && players.some((player) => player.position.z > layout.infiltrationZ)) {
      mission.stage = 'hack-security';
    }
    if (mission.stage === 'hack-security' && this.state.hack.doorOpen) {
      mission.stage = 'steal-prototype';
    }
    const prototype = this.state.objects.get('prototype');
    mission.prototypeHeldBy = prototype?.heldBy ?? '';
    if (mission.alarm && prototype?.heldBy) {
      const carrier = players.find((player) => player.role === prototype.heldBy);
      const bothNear = players.length === 2 && players.every(
        (player) => distance(player.position, EXTRACTION) <= 5.5,
      );
      if (carrier && distance(carrier.position, EXTRACTION) <= 4.5 && bothNear) {
        mission.extracted = true;
        mission.stage = 'complete';
        mission.securityActive = false;
      }
    }
  }

  reportSpotted(sessionId) {
    if (this.state.players.has(sessionId) && this.state.mission.stage !== 'complete') {
      this.state.mission.timesSpotted += 1;
    }
  }

  /** Validate a tether move and relay the impulse to the partner, who owns its own drone. */
  relayTetherYank(client, message) {
    const sender = this.state.players.get(client.sessionId);
    if (!sender || !message || typeof message !== 'object') return;
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
    const rescue = kind === 'yank' && message.rescue === true;
    if (rescue) this.reportTetherSave(client.sessionId);
    target.send('tether-yanked', {
      kind,
      rescue,
      strength: Math.max(0, Math.min(1, finite(message.strength))),
      impulse: { x, y, z },
    });
  }

  /** Server-arbitrated clothesline: one stun per patrol, broadcast to both clients so they agree. */
  stunPatrol(client, message) {
    if (!this.state.players.has(client.sessionId) || !message || typeof message !== 'object') return;
    if (!this.state.mission.securityActive) return;
    const index = Math.round(finite(message.index, -1));
    if (index !== 0 && index !== 1) return;
    const now = Date.now();
    this.patrolStunUntil ??= [0, 0];
    if (now < this.patrolStunUntil[index]) return;
    this.patrolStunUntil[index] = now + 3400;
    this.clotheslines = (this.clotheslines ?? 0) + 1;
    this.broadcast('patrol-stunned', {
      index, by: this.state.players.get(client.sessionId).role, clotheslines: this.clotheslines,
      x: finite(message.x), y: Math.max(0.8, finite(message.y, 2)), z: finite(message.z),
    });
  }

  reportTetherSave(sessionId) {
    if (this.state.players.has(sessionId) && this.state.mission.securityActive) {
      this.state.mission.tetherSaves += 1;
    }
  }

  resetMission() {
    this.patrolStunUntil = [0, 0];
    this.clotheslines = 0;
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
      prototype.position.x = layout.objects.prototype.x;
      prototype.position.y = layout.objects.prototype.y;
      prototype.position.z = layout.objects.prototype.z;
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

const gameServer = new Server({
  transport: new WebSocketTransport(),
  greet: false,
});
gameServer.define('handshake', HandshakeRoom);
await gameServer.listen(PORT, '0.0.0.0');
console.log(`Handshake multiplayer server listening on ws://0.0.0.0:${PORT}`);
