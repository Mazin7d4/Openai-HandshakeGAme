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
  { id: 'arrival', source: 'reception window/sign', key: [-2, 8.4, -56], target: [-4, 2, -50], fill: [0.48, 0.61, 0.88], objective: [-5.5, 1.8, -50], range: 24 },
  { id: 'office', source: 'desk consoles', key: [1, 8.4, -35], target: [0, 3, -32], fill: [0.42, 0.56, 0.86], objective: [0, 3.7, -32], range: 25 },
  { id: 'server', source: 'memory array', key: [3, 8.5, -5.5], target: [3, 4, -5.5], fill: [0.38, 0.52, 0.78], objective: [-4, 7.1, -5.8], range: 24 },
  { id: 'vault', source: 'pendant can', key: [0, 8.7, 18], target: [0, 3, 18], fill: [0.46, 0.61, 0.86], objective: [0, 5.25, 18], range: 23 },
  { id: 'escape', source: 'vault opening', key: [0, 8.6, 27], target: [0, 3, 32], fill: [0.42, 0.54, 0.82], objective: [0, 2, 34], range: 25 },
  { id: 'extraction', source: 'roller-door daylight', key: [11, 8.8, 46], target: [11, 2, 43.5], fill: [0.34, 0.68, 0.48], objective: [11, 2, 43.5], range: 22 },
];

export function addHeroLighting(scene: Scene): void {
  const lights: { key: SpotLight; fill: PointLight; target: [number, number] }[] = [];
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
    lights.push({ key, fill, target: [room.target[0], room.target[2]] });
  }

  // Keep the presentation lighting effect without compiling every room's lights into every
  // material. Besides being wasteful, the full 12-light set exceeds reliable simultaneous-light
  // limits on SwiftShader and some real mobile/integrated GPUs, which can drop opaque draw calls.
  scene.onBeforeRenderObservable.add(() => {
    const camera = scene.activeCamera;
    const highEnough = document.documentElement.dataset.quality !== 'low';
    if (!camera || !highEnough) {
      for (const light of lights) { light.key.setEnabled(false); light.fill.setEnabled(false); }
      return;
    }
    const p = camera.globalPosition;
    let nearest = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < lights.length; i++) {
      const [x, z] = lights[i].target;
      const distance = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (distance < nearestDistance) { nearest = i; nearestDistance = distance; }
    }
    for (let i = 0; i < lights.length; i++) {
      const enabled = i === nearest;
      lights[i].key.setEnabled(enabled);
      lights[i].fill.setEnabled(enabled);
    }
  });
}
