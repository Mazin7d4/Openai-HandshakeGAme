import type { HackMinigame, HackMinigameSnapshot } from './HackMinigame.ts';

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const WIDTH = 4;
const HEIGHT = 4;

const LAYOUTS: readonly (readonly [number, number])[][] = [
  [[0, 1], [1, 1], [2, 1], [3, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]],
  [[0, 3], [0, 2], [1, 2], [2, 2], [2, 1], [3, 1]],
  [[0, 2], [1, 2], [1, 1], [1, 0], [2, 0], [3, 0]],
];

const DECOYS = [N | S, E | W, N | E, E | S, S | W, W | N, N | E | S];

function rotateMask(mask: number): number {
  return ((mask << 1) & 0b1111) | ((mask >> 3) & 1);
}

function directionMask(from: readonly [number, number], to: readonly [number, number]): number {
  if (to[0] > from[0]) return E;
  if (to[0] < from[0]) return W;
  if (to[1] > from[1]) return S;
  return N;
}

/** Config-driven, touch-friendly rotating network puzzle. */
export class PacketRoutingMinigame implements HackMinigame {
  readonly type = 'packet-routing';

  private readonly masks: number[];
  private readonly solutionMasks: number[];
  private readonly sourceRow: number;
  private readonly targetRow: number;
  private connected = new Set<number>();
  private complete = false;

  constructor(seed = Math.floor(Math.random() * 1_000_000)) {
    const layout = LAYOUTS[Math.abs(seed) % LAYOUTS.length]!;
    this.sourceRow = layout[0]![1];
    this.targetRow = layout[layout.length - 1]![1];
    this.masks = Array.from({ length: WIDTH * HEIGHT }, (_, index) =>
      DECOYS[(index * 7 + seed) % DECOYS.length]!,
    );
    this.solutionMasks = Array.from({ length: WIDTH * HEIGHT }, () => 0);

    layout.forEach((point, pathIndex) => {
      const previous = layout[pathIndex - 1];
      const next = layout[pathIndex + 1];
      let solved = previous ? directionMask(point, previous) : W;
      solved |= next ? directionMask(point, next) : E;
      let scrambled = solved;
      this.solutionMasks[point[1] * WIDTH + point[0]] = solved;
      const rotations = 1 + Math.abs(seed + pathIndex * 5) % 3;
      for (let i = 0; i < rotations; i++) scrambled = rotateMask(scrambled);
      this.masks[point[1] * WIDTH + point[0]] = scrambled;
    });
    this.recalculate();
  }

  rotate(index: number): HackMinigameSnapshot {
    if (!this.complete && index >= 0 && index < this.masks.length) {
      this.masks[index] = rotateMask(this.masks[index]!);
      this.recalculate();
    }
    return this.snapshot();
  }

  snapshot(): HackMinigameSnapshot {
    return {
      width: WIDTH,
      height: HEIGHT,
      sourceRow: this.sourceRow,
      targetRow: this.targetRow,
      masks: this.masks,
      solutionMasks: this.solutionMasks,
      connected: this.connected,
      completed: this.complete,
    };
  }

  private recalculate(): void {
    const connected = new Set<number>();
    const start = this.sourceRow * WIDTH;
    if ((this.masks[start]! & W) === 0) {
      this.connected = connected;
      this.complete = false;
      return;
    }
    const queue = [start];
    connected.add(start);
    const directions = [
      { bit: N, opposite: S, dx: 0, dy: -1 },
      { bit: E, opposite: W, dx: 1, dy: 0 },
      { bit: S, opposite: N, dx: 0, dy: 1 },
      { bit: W, opposite: E, dx: -1, dy: 0 },
    ];
    while (queue.length) {
      const index = queue.shift()!;
      const x = index % WIDTH;
      const y = Math.floor(index / WIDTH);
      for (const direction of directions) {
        if ((this.masks[index]! & direction.bit) === 0) continue;
        const nx = x + direction.dx;
        const ny = y + direction.dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
        const neighbour = ny * WIDTH + nx;
        if ((this.masks[neighbour]! & direction.opposite) === 0 || connected.has(neighbour)) continue;
        connected.add(neighbour);
        queue.push(neighbour);
      }
    }
    const target = this.targetRow * WIDTH + WIDTH - 1;
    this.connected = connected;
    this.complete = connected.has(target) && (this.masks[target]! & E) !== 0;
  }
}
