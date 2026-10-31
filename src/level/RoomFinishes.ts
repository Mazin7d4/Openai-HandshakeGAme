import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import type { Scene } from '@babylonjs/core/scene.js';

interface RoomFinish { name: string; from: number; to: number; floor: string; wall: string; trim: string }
const ROOMS: readonly RoomFinish[] = [
  { name: 'apron', from: -66.6, to: -55.4, floor: '#8A969E', wall: '#B5BCBC', trim: '#777F83' },
  { name: 'reception', from: -54.6, to: -43.4, floor: '#B9B1A0', wall: '#D0C7B5', trim: '#A79A84' },
  { name: 'office', from: -42.6, to: -26.4, floor: '#949B91', wall: '#AFB7A8', trim: '#7E887C' },
  { name: 'server', from: -25.6, to: 1.6, floor: '#77818D', wall: '#98A2AA', trim: '#616C77' },
  { name: 'lab', from: 2.4, to: 26.6, floor: '#C7C4B9', wall: '#D9D5C9', trim: '#A9ADA8' },
  { name: 'dock', from: 27.4, to: 46.6, floor: '#A59D8E', wall: '#BCB3A3', trim: '#8A8276' },
];

/** One tiled finish and one painted-wall batch: six rooms without six sets of shaders or textures. */
export function dressRoomFinishes(scene: Scene): void {
  const grain = new DynamicTexture('decor-surface-grain', { width: 256, height: 256 }, scene, false);
  const ctx = grain.getContext();
  ctx.fillStyle = '#eeeDE9'; ctx.fillRect(0, 0, 256, 256);
  // Deterministic small aggregate, deliberately below the scale of an interaction marking.
  for (let i = 0; i < 2100; i++) {
    ctx.fillStyle = i % 5 === 0 ? '#D3D4CF' : '#E3E4DF';
    const x = (i * 73.371) % 256, y = (i * 29.657) % 256;
    ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  grain.update();
  const floorMat = new PBRMaterial('decor-room-floor', scene);
  floorMat.albedoColor = Color3.White(); floorMat.albedoTexture = grain;
  floorMat.roughness = 0.87; floorMat.metallic = 0; floorMat.maxSimultaneousLights = 4;
  const wallMat = new PBRMaterial('decor-room-wall', scene);
  wallMat.albedoColor = Color3.White(); wallMat.roughness = 0.79; wallMat.maxSimultaneousLights = 4;
  const floors: Mesh[] = [], walls: Mesh[] = [];
  const surface = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, hex: string, list: Mesh[]) => {
    const mesh = CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z); mesh.isPickable = false;
    const c = Color3.FromHexString(hex);
    const colors = new Float32Array(mesh.getTotalVertices() * 4);
    for (let i = 0; i < colors.length; i += 4) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; colors[i + 3] = 1; }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    if (list === floors) {
      const uv = mesh.getVerticesData(VertexBuffer.UVKind)!;
      for (let i = 0; i < uv.length; i += 2) { uv[i] *= w / 4; uv[i + 1] *= d / 4; }
      mesh.setVerticesData(VertexBuffer.UVKind, uv);
    }
    list.push(mesh);
  };
  for (const room of ROOMS) {
    const z = (room.from + room.to) / 2, depth = room.to - room.from;
    surface(`finish-${room.name}`, 0, 0.009, z, 37.3, 0.014, depth, room.floor, floors);
    for (const x of [-18.655, 18.655]) {
      surface(`wainscot-${room.name}`, x, 2, z, 0.045, 3.95, depth, room.wall, walls);
      surface(`baseboard-${room.name}`, x - Math.sign(x) * 0.035, 0.21, z, 0.08, 0.42, depth, room.trim, walls);
      surface(`chair-rail-${room.name}`, x - Math.sign(x) * 0.03, 4.05, z, 0.07, 0.12, depth, room.trim, walls);
      surface(`wall-top-inner-${room.name}`, x, 8.88, z, 0.1, 0.16, depth, room.trim, walls);
      // Vertical joints read as manufactured wall panels, never a route.
      for (let pz = room.from + 3.6; pz < room.to; pz += 3.6) {
        surface(`panel-joint-${room.name}`, x - Math.sign(x) * 0.027, 2, pz, 0.015, 3.5, 0.022, room.trim, walls);
      }
    }
  }
  for (const [parts, name, material] of [[floors, 'decor-floors', floorMat], [walls, 'decor-wall-panels', wallMat]] as const) {
    const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!mesh) continue;
    mesh.name = name; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true; mesh.freezeWorldMatrix(); mesh.doNotSyncBoundingInfo = true;
  }
  floorMat.freeze();
  wallMat.freeze();
}
