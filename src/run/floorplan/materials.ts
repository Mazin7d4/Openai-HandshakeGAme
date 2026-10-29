import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { PieceMat } from '../../../shared/nightshift/types.d.ts';

export interface FloorMaterials {
  [key: string]: StandardMaterial;
}

const cache = new WeakMap<Scene, FloorMaterials>();

const colors: Record<string, string> = {
  desk: '#AD9B83',
  partition: '#929B8C',
  chair: '#263737',
  rack: '#394646',
  crate: '#A29582',
  pallet: '#B9AD97',
  glass: '#B6D7D0',
  glassOpaque: '#B6D7D0',
  metal: '#A7B6B5',
  duct: '#718080',
  plant: '#8A9482',
  pylon: '#AAA79B',
  cone: '#A69C8E',
  goal: '#FFD23F',
  goalDim: '#8B7424',
  goalBright: '#FFE27A',
  done: '#39E6A5',
  pix: '#39C6FF',
  nee: '#FF7A59',
  danger: '#FF4D5A',
  dangerDim: '#3E2025',
  dangerCurtain: '#FF4D5A',
  warn: '#FFB03F',
  dark: '#202C2D',
  white: '#FFFFFF',
  ice: '#BFE9FF',
  iceLight: '#E5F8FF',
  gust: '#9AD8FF',
  objectiveMint: '#39E6A5',
  vaultGold: '#A6A094',
  vaultGoldBright: '#B6B5AD',
  vaultSteel: '#17252B',
  vaultPanel: '#26343A',
  serverBlue: '#65717E',
  serverBlueBright: '#A5ADB2',
  officeWarm: '#A99B86',
  officeSage: '#939D8C',
  ventSteel: '#465B62',
  moonBlue: '#7898B8',
};

const emissiveNames = new Set([
  'goal', 'goalBright', 'done', 'pix', 'nee', 'danger', 'warn', 'white', 'iceLight', 'gust',
  'objectiveMint',
]);

export function floorMaterials(scene: Scene): FloorMaterials {
  const existing = cache.get(scene);
  if (existing) {
    return existing;
  }

  const result: FloorMaterials = {};
  for (const [name, hex] of Object.entries(colors)) {
    const material = new StandardMaterial(`floor-${name}`, scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.specularColor = Color3.Black();
    material.maxSimultaneousLights = 4;
    if (emissiveNames.has(name)) {
      material.disableLighting = true;
      material.emissiveColor = material.diffuseColor.clone();
    }
    result[name] = material;
  }

  result.glass.alpha = 0.25;
  result.glass.backFaceCulling = false;
  result.glass.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  result.glassOpaque.alpha = 1;
  result.glassOpaque.backFaceCulling = false;
  result.dangerDim.emissiveColor = new Color3(0.08, 0.015, 0.02);
  result.dangerCurtain.alpha = 0.3;
  result.dangerCurtain.backFaceCulling = false;
  result.dangerCurtain.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  result.goalDim.emissiveColor = new Color3(0.1, 0.07, 0.01);
  result.objectiveMint.emissiveColor = result.objectiveMint.diffuseColor.clone();

  result.ice.alpha = 0.78;
  result.gust.alpha = 0.78;

  cache.set(scene, result);
  return result;
}

export function pieceMaterial(scene: Scene, mat: PieceMat, low = false): StandardMaterial {
  const materials = floorMaterials(scene);
  if (mat === 'glass' && low) {
    return materials.glassOpaque;
  }
  return materials[mat] ?? materials.metal;
}
