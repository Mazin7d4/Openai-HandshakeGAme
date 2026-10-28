import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** Shared materials. Five world units = one physical metre; drone width ≈ 28 cm. */
export function createLabPalette(scene: Scene) {
  const make = (name: string, hex: string, roughness: number, metallic = 0) => {
    const m = new PBRMaterial(`lab-${name}`, scene);
    m.albedoColor = Color3.FromHexString(hex);
    m.roughness = roughness;
    m.metallic = metallic;
    m.maxSimultaneousLights = 4;
    return m;
  };
  const paint = make('porcelain', '#E5E1D5', 0.68);
  const sage = make('sage-paint', '#939B91', 0.57);
  const dark = make('graphite-rubber', '#343C3E', 0.84);
  const metal = make('brushed-aluminium', '#A7B6B5', 0.32, 0.82);
  // Clay, not coral: coral belongs to NEE (ANTI_VIBECODED palette). Kept as `coral` key for callers.
  const coral = make('clay-polymer', '#A59887', 0.42);
  const blue = make('blue-polymer', '#7F8C92', 0.36);
  const wood = make('white-oak', '#AA967A', 0.52);
  const grain = new DynamicTexture('oak-grain-512', { width: 512, height: 128 }, scene, true);
  const ctx = grain.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#b6a68e'; ctx.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 140; i++) {
    const y = (i * 17.713) % 128;
    ctx.strokeStyle = i % 3 ? '#ac9c84' : '#beaf98';
    ctx.lineWidth = 0.45 + (i % 4) * 0.2;
    ctx.beginPath(); ctx.moveTo(0, y);
    ctx.bezierCurveTo(150, y + Math.sin(i) * 3, 360, y - 2, 512, y + 1); ctx.stroke();
  }
  grain.update(); wood.albedoTexture = grain; wood.albedoColor = Color3.White();
  const floor = make('warm-resin', '#B9BBB1', 0.72);
  const glass = make('architectural-glass', '#C4CDCA', 0.12, 0.08);
  glass.alpha = 0.17; glass.backFaceCulling = false;
  glass.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  const light = make('warm-diffuser', '#FFF1D6', 0.6);
  // Fixtures are matte diffusers; interaction-only materials carry the glow.
  light.albedoColor = Color3.FromHexString('#D8D6CC');
  const escape = make('exit-diffuser', '#B0D9BB', 0.65);
  escape.emissiveColor = Color3.FromHexString('#71B38C').scale(0.4);
  return { paint, sage, dark, metal, coral, blue, wood, floor, glass, light, escape };
}
