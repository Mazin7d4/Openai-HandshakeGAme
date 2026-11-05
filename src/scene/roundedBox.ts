import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { Scene } from '@babylonjs/core/scene.js';

export interface RoundedBoxOptions {
  width: number;
  height: number;
  depth: number;
  radius?: number;
  segments?: number;
}

interface FaceDef {
  norm: [number, number, number];
  uDir: [number, number, number];
  vDir: [number, number, number];
  hu: number;
  hv: number;
  center: [number, number, number];
}

/**
 * Creates a box with bevelled (rounded) edges and corners.
 */
export function createRoundedBox(
  name: string,
  opts: RoundedBoxOptions,
  scene: Scene,
): Mesh {
  const width = opts.width;
  const height = opts.height;
  const depth = opts.depth;
  const minDim = Math.min(width, height, depth);
  const maxRadius = 0.45 * minDim;
  const rawRadius = opts.radius ?? 0.06;
  const radius = Math.max(0, Math.min(rawRadius, maxRadius));
  const segments = Math.max(1, Math.floor(opts.segments ?? 2));

  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;

  const clamp = (val: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, val));

  function buildAxisCoords(h: number): number[] {
    if (radius <= 0) {
      return [-h, h];
    }
    const coords: number[] = [];
    const step = radius / segments;
    // [-h .. -(h - r)] subdivided `segments` steps
    for (let i = 0; i <= segments; i++) {
      coords.push(-h + step * i);
    }
    // [h - r .. h] subdivided `segments` steps (so the flat centre is ONE quad)
    for (let j = 0; j <= segments; j++) {
      coords.push((h - radius) + step * j);
    }
    return coords;
  }

  const faces: FaceDef[] = [
    // Front (-Z)
    { norm: [0, 0, -1], uDir: [1, 0, 0], vDir: [0, 1, 0], hu: hx, hv: hy, center: [0, 0, -hz] },
    // Back (+Z)
    { norm: [0, 0, 1],  uDir: [-1, 0, 0], vDir: [0, 1, 0], hu: hx, hv: hy, center: [0, 0, hz] },
    // Right (+X)
    { norm: [1, 0, 0],  uDir: [0, 0, 1], vDir: [0, 1, 0], hu: hz, hv: hy, center: [hx, 0, 0] },
    // Left (-X)
    { norm: [-1, 0, 0], uDir: [0, 0, -1], vDir: [0, 1, 0], hu: hz, hv: hy, center: [-hx, 0, 0] },
    // Top (+Y)
    { norm: [0, 1, 0],  uDir: [1, 0, 0], vDir: [0, 0, 1], hu: hx, hv: hz, center: [0, hy, 0] },
    // Bottom (-Y)
    { norm: [0, -1, 0], uDir: [1, 0, 0], vDir: [0, 0, -1], hu: hx, hv: hz, center: [0, -hy, 0] },
  ];

  const nu = radius <= 0 ? 2 : 2 * segments + 2;
  const nv = nu;
  const vertsPerFace = nu * nv;
  const quadsPerFace = (nu - 1) * (nv - 1);
  const totalVerts = 6 * vertsPerFace;
  const totalIndices = 6 * quadsPerFace * 6;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIndices);

  const limitX = hx - radius;
  const limitY = hy - radius;
  const limitZ = hz - radius;

  let vertexOffset = 0;
  let vIdx = 0;
  let uvIdx = 0;
  let iIdx = 0;

  for (const f of faces) {
    const coordsU = buildAxisCoords(f.hu);
    const coordsV = buildAxisCoords(f.hv);

    for (let j = 0; j < nv; j++) {
      const vVal = coordsV[j];
      const v = (vVal + f.hv) / (2 * f.hv);

      for (let i = 0; i < nu; i++) {
        const uVal = coordsU[i];
        const u = (uVal + f.hu) / (2 * f.hu);

        const px = f.center[0] + uVal * f.uDir[0] + vVal * f.vDir[0];
        const py = f.center[1] + uVal * f.uDir[1] + vVal * f.vDir[1];
        const pz = f.center[2] + uVal * f.uDir[2] + vVal * f.vDir[2];

        const innerX = clamp(px, -limitX, limitX);
        const innerY = clamp(py, -limitY, limitY);
        const innerZ = clamp(pz, -limitZ, limitZ);

        const dx = px - innerX;
        const dy = py - innerY;
        const dz = pz - innerZ;
        const len = Math.hypot(dx, dy, dz);

        let nx = f.norm[0];
        let ny = f.norm[1];
        let nz = f.norm[2];

        if (len > 1e-9) {
          nx = dx / len;
          ny = dy / len;
          nz = dz / len;
        }

        const posX = innerX + nx * radius;
        const posY = innerY + ny * radius;
        const posZ = innerZ + nz * radius;

        positions[vIdx] = posX;
        positions[vIdx + 1] = posY;
        positions[vIdx + 2] = posZ;

        normals[vIdx] = nx;
        normals[vIdx + 1] = ny;
        normals[vIdx + 2] = nz;
        vIdx += 3;

        uvs[uvIdx] = u;
        uvs[uvIdx + 1] = v;
        uvIdx += 2;
      }
    }

    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const p00 = vertexOffset + j * nu + i;
        const p10 = vertexOffset + j * nu + (i + 1);
        const p01 = vertexOffset + (j + 1) * nu + i;
        const p11 = vertexOffset + (j + 1) * nu + (i + 1);

        indices[iIdx++] = p00;
        indices[iIdx++] = p10;
        indices[iIdx++] = p11;

        indices[iIdx++] = p00;
        indices[iIdx++] = p11;
        indices[iIdx++] = p01;
      }
    }

    vertexOffset += vertsPerFace;
  }

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.indices = indices;

  const mesh = new Mesh(name, scene);
  vertexData.applyToMesh(mesh);
  return mesh;
}
