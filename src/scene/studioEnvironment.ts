import { Constants, RawCubeTexture, type Scene } from '@babylonjs/core';

const SIZE = 32;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Direction for a cubemap texel using the standard GL face layout.
 * Faces: +X, -X, +Y, -Y, +Z, -Z.
 */
function faceDirection(face: number, u: number, v: number): [number, number, number] {
  const a = u * 2 - 1;
  const b = v * 2 - 1;
  switch (face) {
    case 0:
      return [1, -b, -a];
    case 1:
      return [-1, -b, a];
    case 2:
      return [a, 1, b];
    case 3:
      return [a, -1, -b];
    case 4:
      return [a, -b, 1];
    default:
      return [-a, -b, -1];
  }
}

/**
 * Tiny procedural studio cubemap: bright soft sky above, warm bounce below and a
 * broad softbox toward the key light. Gives the PBR drone shell and glossy face
 * screen something to reflect without shipping an HDR. StandardMaterials in the
 * room ignore it.
 */
export function createStudioEnvironment(scene: Scene): RawCubeTexture {
  const faces: Uint8Array[] = [];
  const key = [-0.45, 0.78, -0.42];
  const keyLen = Math.hypot(key[0], key[1], key[2]);
  key[0] /= keyLen;
  key[1] /= keyLen;
  key[2] /= keyLen;

  for (let face = 0; face < 6; face++) {
    const data = new Uint8Array(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const [dx, dy, dz] = faceDirection(face, (x + 0.5) / SIZE, (y + 0.5) / SIZE);
        const len = Math.hypot(dx, dy, dz);
        const nx = dx / len;
        const ny = dy / len;
        const nz = dz / len;

        const up = clamp01(ny * 0.5 + 0.5);
        let r = lerp(0.42, 0.78, up);
        let g = lerp(0.38, 0.84, up);
        let b = lerp(0.36, 0.94, up);
        const horizon = 1 - Math.min(1, Math.abs(ny) * 2.2);
        r = lerp(r, 0.9, horizon * 0.5);
        g = lerp(g, 0.88, horizon * 0.5);
        b = lerp(b, 0.86, horizon * 0.5);

        const toKey = nx * key[0] + ny * key[1] + nz * key[2];
        const softbox = Math.pow(clamp01((toKey - 0.82) / 0.18), 1.6);
        r = lerp(r, 1, softbox);
        g = lerp(g, 1, softbox);
        b = lerp(b, 1, softbox);

        const i = (y * SIZE + x) * 4;
        data[i] = Math.round(clamp01(r) * 255);
        data[i + 1] = Math.round(clamp01(g) * 255);
        data[i + 2] = Math.round(clamp01(b) * 255);
        data[i + 3] = 255;
      }
    }
    faces.push(data);
  }

  const texture = new RawCubeTexture(
    scene,
    faces,
    SIZE,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true,
    false,
    Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
  );
  texture.name = 'studio-env';
  texture.gammaSpace = true;
  return texture;
}
