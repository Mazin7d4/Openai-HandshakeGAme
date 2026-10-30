// Server Soak Test: simulates multiple co-op and solo rooms, join/leave cycles,
// and monitors server memory profile over time via /health.
import { Client } from '@colyseus/sdk';
import { fileURLToPath } from 'node:url';
import { freePort, startTestServer } from '../test-server.mjs';
import { assert, until } from './lib.mjs';

const isShort = process.argv.includes('--short') || !process.env.FULL_SOAK;
const DURATION_MS = isShort ? 25_000 : 30 * 60 * 1000;
const CHECK_INTERVAL_MS = isShort ? 2_000 : 10_000;

console.log(`[soak] Starting server soak test (mode: ${isShort ? 'short 25s' : 'full 30m'})...`);

const port = await freePort();
const server = await startTestServer({
  port,
  root: fileURLToPath(new URL('../..', import.meta.url)),
  env: { HANDSHAKE_TEST_HOOKS: '1' },
});
const endpoint = `ws://127.0.0.1:${port}`;
const memoryHistory = [];

async function sampleHealth() {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  if (!res.ok) throw new Error(`Health check returned ${res.status}`);
  const data = await res.json();
  memoryHistory.push({
    time: Date.now(),
    rssMb: data.memory?.rssMb ?? 0,
    heapUsedMb: data.memory?.heapUsedMb ?? 0,
    rooms: data.rooms,
    clients: data.clients,
  });
  return data;
}

const initial = await sampleHealth();
console.log(`[soak] Initial memory: RSS ${initial.memory?.rssMb} MB, Heap ${initial.memory?.heapUsedMb} MB`);

let cycleCount = 0;
const start = Date.now();

try {
  while (Date.now() - start < DURATION_MS) {
    cycleCount++;
    const rooms = [];

    // Create 3 concurrent rooms with 2 clients each
    for (let r = 0; r < 3; r++) {
      const clientA = new Client(endpoint);
      const clientB = new Client(endpoint);
      const roomA = await clientA.create('handshake', { seed: 100 + cycleCount * 10 + r });
      const roomB = await clientB.joinById(roomA.roomId);
      rooms.push({ clientA, clientB, roomA, roomB });
    }

    // Send rapid active snapshots from all clients
    for (let f = 0; f < 15; f++) {
      for (const { roomA, roomB } of rooms) {
        roomA.send('snapshot', {
          position: { x: f * 0.2, y: 2.2, z: f * 0.1 },
          velocity: { x: 1, y: 0, z: 0 },
          orientation: { pitch: 0, yaw: 0, roll: 0 },
          boost: 'off',
          movement: 'cruising',
          selfPowered: true,
          tetherPull: 0,
        });
        roomB.send('snapshot', {
          position: { x: -f * 0.2, y: 2.2, z: f * 0.1 },
          velocity: { x: -1, y: 0, z: 0 },
          orientation: { pitch: 0, yaw: 3.14, roll: 0 },
          boost: 'off',
          movement: 'cruising',
          selfPowered: true,
          tetherPull: 0,
        });
        roomA.send('rtt-ping', { t: Date.now() });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Leave and clean up all rooms
    for (const { roomA, roomB } of rooms) {
      roomA.reconnection.enabled = false;
      roomB.reconnection.enabled = false;
      await roomA.leave(true).catch(() => {});
      await roomB.leave(true).catch(() => {});
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    const h = await sampleHealth();
    console.log(`[soak] Cycle ${cycleCount} (${Math.round((Date.now() - start)/1000)}s): RSS ${h.memory?.rssMb} MB, Heap ${h.memory?.heapUsedMb} MB, Rooms ${h.rooms}`);
  }

  const finalHealth = await sampleHealth();
  console.log(`[soak] Final memory after ${cycleCount} cycles: RSS ${finalHealth.memory?.rssMb} MB, Heap ${finalHealth.memory?.heapUsedMb} MB`);

  const maxRss = Math.max(...memoryHistory.map((m) => m.rssMb));
  const maxHeap = Math.max(...memoryHistory.map((m) => m.heapUsedMb));
  console.log(`[soak] Peak: RSS ${maxRss} MB, Heap ${maxHeap} MB`);

  // Assert memory stays well within healthy bounds (limit is 450 MB)
  assert(maxRss < 350, `Memory RSS exceeded budget: peak was ${maxRss} MB`);
  assert(maxHeap < 200, `Memory Heap exceeded budget: peak was ${maxHeap} MB`);
  assert(finalHealth.rooms === 0, `Rooms were not cleaned up: ${finalHealth.rooms} rooms remain`);

  console.log('[soak] PASS: Memory profile is healthy and flat.');
} finally {
  await server.stop();
}
