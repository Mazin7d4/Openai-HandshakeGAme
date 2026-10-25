import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

type RoomMood = {
  id: 'arrival' | 'office' | 'server' | 'vault' | 'escape' | 'extraction';
  source: string;
  key: [number, number, number];
  target: [number, number, number];
  fill: [number, number, number];
  objective: [number, number, number];
  range: number;
};

// Keys are deliberately warm and broad; the small cool fills separate each room's silhouette.
// These are presentation lights only: they never enter the sun's shadow map.
const ROOMS: readonly RoomMood[] = [
  { id: 'arrival', source: 'reception window/sign', key: [-2, 11, -56], target: [-4, 2, -50], fill: [0.48, 0.61, 0.88], objective: [-5.5, 1.8, -50], range: 24 },
  { id: 'office', source: 'desk consoles', key: [1, 10, -35], target: [0, 3, -32], fill: [0.42, 0.56, 0.86], objective: [0, 3.7, -32], range: 25 },
  { id: 'server', source: 'rack status wall', key: [-2, 11, -8], target: [-4, 4, -5.8], fill: [0.38, 0.52, 0.78], objective: [-4, 7.1, -5.8], range: 24 },
  { id: 'vault', source: 'pendant can', key: [0, 13, 18], target: [0, 3, 18], fill: [0.46, 0.61, 0.86], objective: [0, 5.25, 18], range: 23 },
  { id: 'escape', source: 'security strip/beacon', key: [8, 10, 8], target: [0, 2, 8], fill: [0.42, 0.54, 0.82], objective: [-4, 2, 8], range: 25 },
  { id: 'extraction', source: 'green exit beacon', key: [-11, 9, -58], target: [-15, 2, -61], fill: [0.34, 0.68, 0.48], objective: [-15, 2, -61], range: 22 },
];

export function addHeroLighting(scene: Scene): void {
  for (const room of ROOMS) {
    const key = new SpotLight(`hero-key-${room.id}`, Vector3.FromArray(room.key), Vector3.FromArray([
      room.target[0] - room.key[0], room.target[1] - room.key[1], room.target[2] - room.key[2],
    ]), Math.PI * 0.72, 2, scene);
    key.diffuse = Color3.FromHexString(room.id === 'extraction' ? '#FFD49A' : '#FFD7A8');
    key.specular = new Color3(0.32, 0.27, 0.2);
    key.intensity = room.id === 'vault' ? 0.7 : 0.85;
    key.range = room.range;
    key.metadata = { heroSource: room.source, objective: room.objective };

    const fill = new PointLight(`hero-fill-${room.id}`, Vector3.FromArray([
      room.target[0] - 4, room.target[1] + 3, room.target[2] + 5,
    ]), scene);
    fill.diffuse = new Color3(...room.fill);
    fill.specular = Color3.Black();
    fill.intensity = 0.18;
    fill.range = room.range * 0.9;
    fill.metadata = { heroSource: `${room.id} cool bounce`, mood: room.fill };
  }
}
