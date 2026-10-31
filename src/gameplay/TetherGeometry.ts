interface CordPoint { readonly x: number; readonly y: number; readonly z: number }

/** Reuses vertex buffers for the cord's vertical-plane sag curve. Physics reads the centreline. */
export class TetherGeometry {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  private readonly cosines: Float64Array;
  private readonly sines: Float64Array;
  private readonly path: readonly CordPoint[];
  private readonly sides: number;

  constructor(path: readonly CordPoint[], sides: number) {
    this.path = path;
    this.sides = sides;
    this.positions = new Float32Array(path.length * (sides + 1) * 3);
    this.normals = new Float32Array(this.positions.length);
    this.cosines = new Float64Array(sides + 1);
    this.sines = new Float64Array(sides + 1);
    for (let j = 0; j <= sides; j++) {
      const angle = (j % sides) * Math.PI * 2 / sides;
      this.cosines[j] = Math.cos(angle);
      this.sines[j] = Math.sin(angle);
    }
  }

  /** Update the existing rings and smooth radial normals without allocating paths or vectors. */
  update(radius: number): void {
    const path = this.path;
    const first = path[0];
    const last = path[path.length - 1];
    // Every centreline sample lies in the same vertical plane. Its binormal is constant.
    const dx = last.x - first.x, dz = last.z - first.z;
    const horizontal = Math.hypot(dx, dz);
    const bx = horizontal > 1e-8 ? -dz / horizontal : 1;
    const bz = horizontal > 1e-8 ? dx / horizontal : 0;
    let offset = 0;
    for (let i = 0; i < path.length; i++) {
      const point = path[i];
      const before = path[Math.max(0, i - 1)];
      const after = path[Math.min(path.length - 1, i + 1)];
      let tx = after.x - before.x, ty = after.y - before.y, tz = after.z - before.z;
      const length = Math.hypot(tx, ty, tz);
      if (length > 1e-8) { tx /= length; ty /= length; tz /= length; }
      else { tx = 0; ty = 1; tz = 0; }
      // normal = binormal × tangent; tangent × normal then points along the binormal.
      const nx = -bz * ty, ny = bz * tx - bx * tz, nz = bx * ty;
      for (let j = 0; j <= this.sides; j++) {
        const c = this.cosines[j], s = this.sines[j];
        const rx = nx * c + bx * s, ry = ny * c, rz = nz * c + bz * s;
        this.positions[offset] = point.x + radius * rx;
        this.positions[offset + 1] = point.y + radius * ry;
        this.positions[offset + 2] = point.z + radius * rz;
        this.normals[offset] = rx;
        this.normals[offset + 1] = ry;
        this.normals[offset + 2] = rz;
        offset += 3;
      }
    }
  }
}
