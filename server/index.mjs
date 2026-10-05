import { CloseCode, Room, Server, WebSocketTransport } from 'colyseus';
import { schema, t } from '@colyseus/schema';

const PORT = Number.parseInt(process.env.PORT ?? '2567', 10);
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_SECONDS = 15;
const TERMINAL_RANGE = 5;
const TERMINALS = {
  'terminal-a': { x: -2.5, y: 1.25, z: -8.5 },
  'terminal-b': { x: 2.5, y: 1.25, z: -8.5 },
};

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
    stationAComplete: t.boolean().default(false),
    stationBComplete: t.boolean().default(false),
    doorOpen: t.boolean().default(false),
  },
  'Hack',
);

const HandshakeState = schema(
  {
    started: t.boolean().default(false),
    players: t.map(Player),
    objects: t.map(Grabbable),
    hack: Hack,
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

function copyVec3(target, source) {
  target.x = finite(source?.x, target.x);
  target.y = finite(source?.y, target.y);
  target.z = finite(source?.z, target.z);
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

  onCreate() {
    this.maxClients = 2;
    this.roomId = roomCode();
    this.setMetadata({ code: this.roomId });
    this.state.objects.set('cargo-core', createGrabbable('cargo-core', -1.6, 0.65, -11.7, 3.3));
    this.state.objects.set('crate-blue', createGrabbable('crate-blue', 1.1, 0.65, -10.7, 3.1));
    this.state.objects.set('crate-pink', createGrabbable('crate-pink', 3.2, 0.65, -12, 3));
    this.onMessage('snapshot', (client, message) => {
      this.applySnapshot(client.sessionId, message);
    });
    this.onMessage('grab-object', (client, message) => this.grabObject(client.sessionId, message));
    this.onMessage('release-object', (client, message) => this.releaseObject(client.sessionId, message));
    this.onMessage('object-snapshot', (client, message) => this.applyObjectSnapshot(client.sessionId, message));
    this.onMessage('hack-start', (client, message) => this.startHack(client.sessionId, message));
    this.onMessage('hack-complete', (client, message) => this.completeHack(client.sessionId, message));
    this.onMessage('hack-cancel', (client, message) => this.cancelHack(client.sessionId, message));
    this.setSimulationInterval(() => this.updateHack());
  }

  onJoin(client) {
    const roles = new Set(Array.from(this.state.players.values()).map((player) => player.role));
    const role = roles.has('pix') ? 'nee' : 'pix';
    const player = new Player();
    player.playerId = client.sessionId;
    player.role = role;
    player.connected = true;
    player.position.x = role === 'pix' ? -1.6 : 1.6;
    player.position.y = 2.15;
    player.position.z = -15;
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
    player.position.x = finite(position.x, player.position.x);
    player.position.y = finite(position.y, player.position.y);
    player.position.z = finite(position.z, player.position.z);
    player.velocity.x = finite(velocity.x);
    player.velocity.y = finite(velocity.y);
    player.velocity.z = finite(velocity.z);
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
    for (const other of this.state.objects.values()) {
      if (other.id !== object.id && other.heldBy === player.role) {
        return;
      }
    }
    object.heldBy = player.role;
    object.authority = player.role;
    object.mode = 'held';
    object.revision += 1;
  }

  releaseObject(sessionId, message) {
    const role = this.roleForSession(sessionId);
    const object = this.state.objects.get(message?.objectId);
    if (!role || !object || object.heldBy !== role) {
      return;
    }
    copyVec3(object.position, message.position);
    copyVec3(object.velocity, message.velocity);
    object.heldBy = '';
    object.authority = role;
    object.mode = 'free';
    object.revision += 1;
  }

  applyObjectSnapshot(sessionId, message) {
    const role = this.roleForSession(sessionId);
    const object = this.state.objects.get(message?.objectId);
    if (!role || !object || object.authority !== role) {
      return;
    }
    copyVec3(object.position, message.position);
    copyVec3(object.velocity, message.velocity);
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
      player.role !== fields.role ||
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
      this.state.hack.stationAComplete && this.state.hack.stationBComplete;
  }

  cancelHack(sessionId, message) {
    const role = this.roleForSession(sessionId);
    const fields = this.stationFields(message?.stationId);
    if (role && fields && this.state.hack[fields.owner] === role) {
      this.state.hack[fields.owner] = '';
    }
  }

  updateHack() {
    for (const [field, stationId] of [['stationAOwner', 'terminal-a'], ['stationBOwner', 'terminal-b']]) {
      const role = this.state.hack[field];
      if (!role) continue;
      const player = Array.from(this.state.players.values()).find((candidate) => candidate.role === role);
      if (!player?.connected || distance(player.position, TERMINALS[stationId]) > TERMINAL_RANGE) {
        this.state.hack[field] = '';
      }
    }
  }

  releaseRole(role) {
    if (this.state.hack.stationAOwner === role) this.state.hack.stationAOwner = '';
    if (this.state.hack.stationBOwner === role) this.state.hack.stationBOwner = '';
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
