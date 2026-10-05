import { CloseCode, Room, Server, WebSocketTransport } from 'colyseus';
import { schema, t } from '@colyseus/schema';

const PORT = Number.parseInt(process.env.PORT ?? '2567', 10);
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_SECONDS = 15;

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
  },
  'Player',
);

const HandshakeState = schema(
  {
    started: t.boolean().default(false),
    players: t.map(Player),
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

class HandshakeRoom extends Room {
  state = new HandshakeState();

  onCreate() {
    this.maxClients = 2;
    this.roomId = roomCode();
    this.setMetadata({ code: this.roomId });
    this.onMessage('snapshot', (client, message) => {
      this.applySnapshot(client.sessionId, message);
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
  }
}

const gameServer = new Server({
  transport: new WebSocketTransport(),
  greet: false,
});
gameServer.define('handshake', HandshakeRoom);
await gameServer.listen(PORT, '0.0.0.0');
console.log(`Handshake multiplayer server listening on ws://0.0.0.0:${PORT}`);
