import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Scalar } from '@babylonjs/core/Maths/math.scalar.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Scene } from '@babylonjs/core/scene.js';
import '../assets/registerGltf.ts';
import '../assets/meshopt.ts';
import { addStaticBody } from '../physics/staticBody.ts';
import { Door } from '../gameplay/Door.ts';
import { mergeStaticByMaterial, isDynamicOrInteractive } from '../scene/mergeStatic.ts';
import { createLabPalette } from './LabPalette.ts';
import { dressMissionAreas, mergeDecorative } from './AreaDressing.ts';
import { loadPropKit } from './PropKit.ts';
import layout from './heist-layout.json';
import { mergeRigidChildren } from '../scene/mergeChildren.ts';
import { createRoundedBox } from '../scene/roundedBox.ts';
import { addHeroLighting } from './HeroLighting.ts';

const SECURITY_AMBER = Color3.FromHexString('#FFB84D');
const SCREEN_IDLE = new Color3(0.35, 0.35, 0.35);
const STATUS_IDLE = Color3.FromHexString('#D8CBB2');

export interface HeistPresentation {
  alarm: boolean; complete: boolean; officeOpen: boolean; vaultOpen?: boolean;
  /** Optional presentation-only hints for objective beacons. */
  stage?: string; hacked?: Record<string, boolean>; prototypeHeld?: boolean;
}
const levels = new WeakMap<Scene, { update(dt: number, state: HeistPresentation): void }>();
export function updateHeistPresentation(scene: Scene, dt: number, state: HeistPresentation): void {
  levels.get(scene)?.update(dt, state);
}

/** Hand-authored first mission. Geometry owns no mission or network state. */
export async function createPrototypeHeist(scene: Scene): Promise<Vector3> {
  const p = createLabPalette(scene);
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number,
    material: Material = p.paint, solid = true, occluder = false) => {
    const mesh = CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z); mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true;
    if (occluder) mesh.metadata = { cameraOccluder: true };
    if (solid) addStaticBody(mesh, scene);
    return mesh;
  };
  const wallCap = (name: string, x: number, z: number, w: number, d: number, material: Material = p.dark) =>
    box(`${name}-cap`, x, 9.35, z, w, 0.7, d, material, true);
  const partitionTrim = (name: string, z: number, segments: [number, number][]) => {
    for (const [x, width] of segments) {
      box(`${name}-frosted-band`, x, 7.85, z, width, 0.3, 0.2, p.glass, false);
      for (let mx = x - width / 2 + 2; mx < x + width / 2; mx += 4) {
        box(`${name}-mullion`, mx, 6.85, z, 0.08, 4.3, 0.24, p.metal, false);
      }
    }
  };
  const signGlow = new StandardMaterial('sign-lip-glow', scene);
  signGlow.diffuseColor = new Color3(1, 0.86, 0.62); signGlow.emissiveColor = new Color3(1, 0.8, 0.52);
  signGlow.specularColor = Color3.Black();
  const lintelDark = new StandardMaterial('exit-lintel-dark', scene);
  lintelDark.diffuseColor = Color3.FromHexString('#443D36'); lintelDark.emissiveColor = Color3.FromHexString('#221F1C');
  lintelDark.specularColor = Color3.Black();
  const lintelWarm = new StandardMaterial('exit-lintel-warm', scene);
  lintelWarm.diffuseColor = Color3.FromHexString('#FFF1D6'); lintelWarm.emissiveColor = Color3.FromHexString('#FFF1D6');
  lintelWarm.specularColor = Color3.Black(); lintelWarm.disableLighting = true;
  const exitStrips = new Map<string, Mesh>();
  const exitStrip = (id: string, x: number, z: number, width: number, lit: boolean) => {
    const strip = box(`exit-lintel-strip-${id}`, x, 8.72, z, width, 0.16, 0.16, lit ? lintelWarm : lintelDark, false);
    exitStrips.set(id, strip); return strip;
  };
  const sign = (name: string, title: string, sub: string, x: number, y: number, z: number, width = 7) => {
    const t = new DynamicTexture(`${name}-type`, { width: 1024, height: 256 }, scene, true);
    const c = t.getContext(); c.fillStyle = '#203c39'; c.fillRect(0, 0, 1024, 256);
    c.fillStyle = '#f3eee0'; c.font = '600 70px sans-serif'; c.fillText(title, 45, 110);
    c.fillStyle = '#afd0ba'; c.font = '32px sans-serif'; c.fillText(sub, 48, 185); t.update();
    const m = new StandardMaterial(`${name}-ink`, scene); m.diffuseTexture = t;
    m.emissiveColor = new Color3(0.2, 0.2, 0.2); m.specularColor = Color3.Black();
    const mesh = CreatePlane(name, { width, height: width / 4 }, scene);
    mesh.position.set(x, y, z); mesh.material = m; mesh.isPickable = false;
    // Contextual mounting instead of a floating card: aluminium frame, ceiling hangers, warm lip light.
    const h = width / 4;
    const frame = CreateBox(`${name}-frame`, { width: width + 0.28, height: h + 0.28, depth: 0.12 }, scene);
    frame.parent = mesh; frame.position.z = 0.08; frame.material = p.metal; frame.isPickable = false;
    const lip = CreateBox(`${name}-lip`, { width: width * 0.92, height: 0.07, depth: 0.16 }, scene);
    lip.parent = mesh; lip.position.set(0, h / 2 + 0.1, -0.06); lip.material = signGlow; lip.isPickable = false;
    return mesh;
  };
  const desk = (name: string, x: number, z: number, width = 9) => {
    box(`${name}-oak`, x, 3.75, z, width, 0.32, 4.3, p.wood);
    for (const dx of [-width / 2 + 0.4, width / 2 - 0.4]) {
      box(`${name}-leg`, x + dx, 1.8, z, 0.28, 3.6, 3.8, p.paint);
    }
    box(`${name}-screen`, x + 1.5, 5.3, z + 0.8, 3.1, 2, 0.18, p.dark);
    box(`${name}-foot`, x + 1.5, 4.05, z + 0.8, 1.4, 0.16, 0.8, p.metal, false);
    box(`${name}-screen-stem`, x + 1.5, 4.4, z + 0.8, 0.2, 1.3, 0.2, p.metal, false);
  };
  // Entire building: 8 x 18 m at the established drone scale. Roof is a collision-only cutaway.
  box('foundation', 0, -0.4, -10, 40, 0.8, 114, p.floor);
  box('east-wall', 19, 4.5, -10, 0.6, 9, 114, p.paint);
  box('west-wall', -19, 4.5, -10, 0.6, 9, 114, p.sage);
  box('north-wall', 0, 4.5, 47, 38, 9, 0.6, p.paint);
  box('south-boundary', 0, 4.5, -67, 38, 9, 0.6, p.sage);
  wallCap('east-wall', 19, -10, 0.8, 114); wallCap('west-wall', -19, -10, 0.8, 114);
  wallCap('north-wall', 0, 47, 38, 0.8); wallCap('south-boundary', 0, -67, 38, 0.8);
  const rollerLeaf = box('loading-roller-door', 11, 4.5, 46.62, 10, 8, 0.18, p.dark);
  wallCap('loading-roller-door', 11, 46.62, 10.5, 0.8);
  const daylight = new StandardMaterial('roller-door-daylight', scene);
  daylight.diffuseColor = Color3.FromHexString('#E7F1F5'); daylight.emissiveColor = Color3.FromHexString('#BFDCE8'); daylight.disableLighting = true;
  const rollerFrame = box('loading-roller-door-frame', 6, 4.5, 46.58, 0.35, 9, 0.9, daylight, false);
  const rollerFrameEast = box('loading-roller-door-frame', 16, 4.5, 46.58, 0.35, 9, 0.9, daylight, false);
  wallCap('loading-roller-door-frame', 6, 46.58, 0.8, 1.0, p.metal);
  wallCap('loading-roller-door-frame', 16, 46.58, 0.8, 1.0, p.metal);
  rollerLeaf.isPickable = false;
  rollerFrame.isPickable = false;
  rollerFrameEast.isPickable = false;
  // Loading dock: a low conveyor leaves a clear underpass, with the high route visible over it.
  box('dock-conveyor-belt', -5, 2.4, 34, 22, 0.35, 1.6, p.wood, true);
  for (let x = -15; x <= 5; x += 4) {
    box('dock-conveyor-leg', x, 1.1, 33.35, 0.28, 2.2, 0.28, p.metal);
    box('dock-conveyor-leg', x, 1.1, 34.65, 0.28, 2.2, 0.28, p.metal);
  }
  const cage = (name: string, x: number, z: number) => {
    const cageMat = new StandardMaterial(`${name}-wire`, scene); cageMat.diffuseColor = Color3.FromHexString('#A88D6E'); cageMat.emissiveColor = Color3.FromHexString('#1E1915');
    for (const [dx, dz] of [[-2, -1.5], [2, -1.5], [-2, 1.5], [2, 1.5]] as const) box(`${name}-post`, x + dx, 2.2, z + dz, 0.12, 4.4, 0.12, cageMat, false);
    for (const y of [0.2, 4.2]) {
      box(`${name}-rail`, x, y, z - 1.5, 4, 0.08, 0.08, cageMat, false); box(`${name}-rail`, x, y, z + 1.5, 4, 0.08, 0.08, cageMat, false);
      box(`${name}-rail`, x - 2, y, z, 0.08, 0.08, 3, cageMat, false); box(`${name}-rail`, x + 2, y, z, 0.08, 0.08, 3, cageMat, false);
    }
  };
  cage('dock-parcel-cage-west', -10, 41); cage('dock-parcel-cage-east', 2, 40);
  const padMat = new StandardMaterial('extraction-pad-green', scene); padMat.diffuseColor = Color3.FromHexString('#71B38C'); padMat.emissiveColor = Color3.FromHexString('#315C49'); padMat.disableLighting = true;
  const extractionPad = CreateCylinder('extraction-pad', { diameter: 6.5, height: 0.12, tessellation: 48 }, scene);
  extractionPad.scaling.z = 5 / 6.5; extractionPad.position.set(layout.extraction.x, 0.06, layout.extraction.z); extractionPad.material = padMat; extractionPad.isPickable = false;
  const roof = box('cutaway-roof-collider', 0, 9.2, -10, 38, 0.5, 114); roof.isVisible = false;
  // Arrival: delivery apron, human reception and a visible high service vent.
  box('entry-wall-left', -12.5, 2.35, -55, 13, 4.7, 0.5, p.paint); wallCap('entry-wall-left', -12.5, -55, 13, 0.8);
  box('entry-wall-right', 11, 2.35, -55, 16, 4.7, 0.5, p.paint); wallCap('entry-wall-right', 11, -55, 16, 0.8);
  box('entry-glass-left', -12.5, 6.85, -55, 13, 4.3, 0.16, p.glass); wallCap('entry-glass-left', -12.5, -55, 13, 0.3, p.metal);
  box('entry-glass-right', 11, 6.85, -55, 16, 4.3, 0.16, p.glass); wallCap('entry-glass-right', 11, -55, 16, 0.3, p.metal);
  box('entry-header', -1.5, 8.5, -55, 9, 1, 0.6, p.wood); wallCap('entry-header', -1.5, -55, 9, 0.8, p.wood);
  partitionTrim('entry-partition', -55, [[-12.5, 13], [11, 16]]);
  desk('reception', -4.5, -49, 11);
  sign('reception-sign', '02 RECEPTION', '', 2, 2.6, -54.6, 6);
  sign('apron-sign', '01 APRON', '', -14, 2.6, -66.6, 5);
  exitStrip('G0', -1.5, -55.35, 9, true);
  // A crawl route under furniture leads to a mandatory ascent, with a broad alternate opening.
  box('office-divider-low-west', -13.25, 2.35, -43, 11.5, 4.7, 0.6, p.sage); wallCap('office-divider-low-west', -13.25, -43, 11.5, 0.9);
  box('office-divider-low-east', 8.25, 2.35, -43, 21.5, 4.7, 0.6, p.sage); wallCap('office-divider-low-east', 8.25, -43, 21.5, 0.9);
  box('office-divider-glass-west', -13.25, 6.85, -43, 11.5, 4.3, 0.16, p.glass);
  box('office-divider-glass-east', 8.25, 6.85, -43, 21.5, 4.3, 0.16, p.glass);
  box('vent-glass-top', -5, 8.55, -43, 5, 0.9, 0.16, p.glass);
  wallCap('office-divider-glass-west', -13.25, -43, 11.5, 0.3, p.metal); wallCap('office-divider-glass-east', 8.25, -43, 21.5, 0.3, p.metal);
  partitionTrim('vent-partition', -43, [[-13.25, 11.5], [8.25, 21.5]]);
  box('vent-sill', -5, 4.8, -43, 5, 0.22, 5, p.metal);
  box('vent-left', -7.6, 6.4, -43, 0.2, 3.4, 5, p.metal, true, true);
  box('vent-right', -2.4, 6.4, -43, 0.2, 3.4, 5, p.metal, true, true);
  // Office cooperative pocket: PIX on the desktop; NEE at the under-desk patch bay.
  desk('office-pix', -5, -33, 9);
  desk('office-nee', 7, -31, 8);
  box('office-rug', 1, 0.025, -35, 20, 0.04, 12, p.blue, false);
  box('office-glass', 13, 7, -35, 0.14, 14, 15, p.glass, true);
  sign('office-sign', '03 OFFICE', '', 1, 2.6, -27.4, 5.5);
  box('office-wall-west', -11.5, 2.35, -26, 15, 4.7, 0.6, p.paint); wallCap('office-wall-west', -11.5, -26, 15, 0.9);
  box('office-wall-east', 10.5, 2.35, -26, 17, 4.7, 0.6, p.paint); wallCap('office-wall-east', 10.5, -26, 17, 0.9);
  box('office-glass-west', -11.5, 6.85, -26, 15, 4.3, 0.16, p.glass); box('office-glass-east', 10.5, 6.85, -26, 17, 4.3, 0.16, p.glass);
  wallCap('office-glass-west', -11.5, -26, 15, 0.3, p.metal); wallCap('office-glass-east', 10.5, -26, 17, 0.3, p.metal);
  partitionTrim('office-partition', -26, [[-11.5, 15], [10.5, 17]]);
  box('office-door-header', -1, 7.5, -26, 6, 3, 0.6, p.wood); wallCap('office-door-header', -1, -26, 6, 0.8, p.wood);
  exitStrip('G2', -1, -26.35, 5.6, false);
  // Server gallery: alternating aisle ends and a high maintenance shelf. All flight gaps ≥ 2.4 units.
  for (const x of [-8.5, 8.5] as const) {
    box(`rack-row-${x}`, x, 3, -16, 3, 6, 14, p.dark, true, true);
    for (let z = -22.5; z <= -9.5; z += 2.4) {
      box('rack-upright', x - 1.3, 3, z, 0.08, 5.5, 0.08, p.metal, false);
      for (let y = 1; y < 7; y += 1.3) {
        if (y < 5.5) box('rack-tray', x, y, z, 2.5, 0.42, 0.06, p.metal, false);
        box('rack-status', x - 1.25, Math.min(y, 5.5), z, 0.08, 0.08, 0.04, p.escape, false);
      }
    }
  }
  box('server-maintenance-catwalk', -5, 5.7, -5.8, 10, 0.25, 5, p.metal);
  // Three ramp steps climb north from the cold aisle onto the catwalk's south edge (z -8.3).
  for (let i = 0; i < 3; i++) box('catwalk-ramp-step', -3, 4.6 - i * 1.2, -8.9 - i * 1.0, 3, 0.3, 1.0, p.metal);
  sign('server-sign', '04 SERVERS', '', -3, 2.6, -4.8, 5.5);
  const memoryGlass = new StandardMaterial('memory-array-indigo', scene);
  memoryGlass.diffuseColor = Color3.FromHexString('#293B82'); memoryGlass.emissiveColor = Color3.FromHexString('#4E57D8');
  memoryGlass.alpha = 0.72; memoryGlass.specularColor = Color3.FromHexString('#9EA8FF');
  const memoryArray = CreateCylinder('memory-array', { diameter: 3.2, height: 8.5, tessellation: 32 }, scene);
  memoryArray.position.set(3, 4.25, -5.5); memoryArray.material = memoryGlass; memoryArray.isPickable = false;
  exitStrip('G3', 0, 1.6, 5.6, false);
  // Main lab partition: the replicated HackSession door occupies the central opening.
  box('lab-door-left', -10.9, 2.35, 2, 16.2, 4.7, 0.7, p.paint); wallCap('lab-door-left', -10.9, 2, 16.2, 1.0);
  box('lab-door-right', 10.4, 2.35, 2, 15.2, 4.7, 0.7, p.paint); wallCap('lab-door-right', 10.4, 2, 15.2, 1.0);
  box('lab-glass-left', -10.9, 6.85, 2, 16.2, 4.3, 0.16, p.glass); box('lab-glass-right', 10.4, 6.85, 2, 15.2, 4.3, 0.16, p.glass);
  wallCap('lab-glass-left', -10.9, 2, 16.2, 0.3, p.metal); wallCap('lab-glass-right', 10.4, 2, 15.2, 0.3, p.metal);
  partitionTrim('lab-partition', 2, [[-10.9, 16.2], [10.4, 15.2]]);
  box('lab-door-header', 0, 7.5, 2, 5.6, 3, 0.7, p.wood); wallCap('lab-door-header', 0, 2, 5.6, 0.9, p.wood);
  sign('lab-sign', '05 LAB', '', 3, 2.6, 2.5, 5);
  sign('dock-sign', '06 DOCK', '', 11, 2.6, 46.5, 5);
  // Hero lab: real-scale benches, clear central floor and a display at human worktop height.
  // Lab/dock partition: solid oak either side of the vault backdrop doors (x -5..5), which open on alarm.
  for (const x of [-12, 12]) {
    box('hero-oak-wall', x, 4.5, 27, 14, 9, 0.4, p.wood); wallCap('hero-oak-wall', x, 27, 14, 0.8);
  }
  for (let x = -10; x <= 16; x += 1.2) if (Math.abs(x) > 5.4) box('oak-batten', x, 4.5, 26.72, 0.12, 9, 0.2, p.wood, false);
  box('lab-floor-inlay', 2, 0.022, 15, 27, 0.04, 22, p.paint, false);
  // Simple, deliberate collision proxies match the bevelled hero art below.
  for (const [x, z] of [[-7, 8], [9, 11]] as const) {
    const top = box('hero-bench-collider', x, 3.75, z, 7.5, 0.4, 3.5); top.isVisible = false;
    for (const dx of [-3.15, 3.15]) {
      const leg = box('hero-leg-collider', x + dx, 1.8, z, 0.35, 3.6, 3); leg.isVisible = false;
    }
  }
  box('vault-dais', 0, 0.18, 18, 11.5, 0.36, 9, p.wood);
  const plinth = box('vault-plinth-collider', 0, 2.3, 18, 3.4, 4.6, 3.4); plinth.isVisible = false;
  for (const x of [-6.2, 6.2]) {
    box('vault-glass', x, 4.4, 20, 0.1, 8, 8, p.glass);
    for (const z of [16, 24]) box('vault-mullion', x, 4.4, z, 0.13, 8, 0.13, p.metal);
  }
  const halo = CreateTorus('vault-halo', { diameter: 7.7, thickness: 0.08, tessellation: 80 }, scene);
  halo.position.set(0, 6.2, 25.9); halo.rotation.x = Math.PI / 2; halo.material = p.light; halo.isPickable = false;
  // ── Vault bell jar: decorative frosted glass cylinder with aluminium cap ──
  const protoX = layout.objects.prototype.x;
  const protoZ = layout.objects.prototype.z;
  // Clear glass reads only at its silhouette: a fresnel rim (edges opaque + softly lit, centre clear)
  // is the jar's rim light, so the core inside stays the brightest, most saturated thing in frame.
  const bellJarGlass = new StandardMaterial('vault-belljar-glass', scene);
  bellJarGlass.diffuseColor = Color3.FromHexString('#D8EDE8'); bellJarGlass.specularColor = new Color3(0.9, 0.9, 0.88);
  bellJarGlass.specularPower = 96; bellJarGlass.alpha = 0.16; bellJarGlass.backFaceCulling = true; // back faces would read as full rim
  bellJarGlass.opacityFresnelParameters = new FresnelParameters({ leftColor: Color3.White(), rightColor: Color3.Black(), bias: 0.08, power: 2.6 });
  bellJarGlass.emissiveFresnelParameters = new FresnelParameters({ leftColor: new Color3(0.72, 0.76, 0.72), rightColor: Color3.Black(), bias: 0, power: 3.2 });
  const bellJar = CreateCylinder('vault-belljar', { diameter: 2.3, height: 2.2, tessellation: 40 }, scene);
  bellJar.position.set(protoX, 4.65 + 1.1, protoZ); bellJar.material = bellJarGlass; bellJar.isPickable = false;
  const capMat = new PBRMaterial('vault-belljar-cap', scene);
  capMat.albedoColor = Color3.FromHexString('#C0C8CC'); capMat.metallic = 0.88; capMat.roughness = 0.3;
  const bellCap = CreateCylinder('vault-belljar-cap', { diameter: 2.35, height: 0.08, tessellation: 40 }, scene);
  bellCap.position.set(protoX, 4.65 + 2.2 + 0.04, protoZ); bellCap.material = capMat; bellCap.isPickable = false;
  // Frosted foot band + rolled aluminium lips (bevelled edges catch the key) ride with the jar.
  const frost = new PBRMaterial('vault-belljar-frost', scene);
  frost.albedoColor = Color3.FromHexString('#EEF2EE'); frost.roughness = 0.6; frost.metallic = 0; frost.alpha = 0.62;
  frost.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  const frostBand = CreateCylinder('vault-belljar-frost', { diameter: 2.33, height: 0.36, tessellation: 40, cap: Mesh.NO_CAP }, scene);
  frostBand.parent = bellJar; frostBand.position.y = -1.1 + 0.2; frostBand.material = frost; frostBand.isPickable = false;
  const jarRig = new TransformNode('vault-belljar-rig', scene); jarRig.parent = bellJar;
  for (const y of [-1.08, 1.08]) {
    const lip = CreateTorus('vault-belljar-lip', { diameter: 2.33, thickness: 0.07, tessellation: 40 }, scene);
    lip.parent = jarRig; lip.position.y = y; lip.material = capMat; lip.isPickable = false;
  }
  bellJar.computeWorldMatrix(true); mergeRigidChildren(jarRig);
  // Museum label printed on the pedestal's front badge (diegetic: replaces the floating title card).
  const plaqueTex = new DynamicTexture('vault-plaque-type', { width: 512, height: 160 }, scene, true);
  const pc = plaqueTex.getContext() as CanvasRenderingContext2D;
  const drawPlaque = () => {
    pc.fillStyle = '#142022'; pc.fillRect(0, 0, 512, 160);
    pc.fillStyle = '#A7B6B5'; pc.fillRect(28, 98, 456, 2);
    pc.fillStyle = '#F4EFE6'; pc.font = "800 58px Archivo, 'Atkinson Hyperlegible Next', sans-serif"; pc.fillText('MORROW', 28, 78);
    pc.fillStyle = '#C9C2B4'; pc.font = "26px 'Atkinson Hyperlegible Next', Archivo, sans-serif"; pc.fillText('P01  ·  Adaptive companion core', 28, 138);
    plaqueTex.update();
  };
  drawPlaque();
  // Archivo is preloaded by index.html; redraw once it is actually ready so the plaque never keeps the fallback face.
  if (typeof document !== 'undefined' && document.fonts) void document.fonts.load("800 58px Archivo").then(drawPlaque, () => undefined);
  const plaqueMat = new StandardMaterial('vault-plaque-ink', scene);
  plaqueMat.diffuseTexture = plaqueTex; plaqueMat.emissiveTexture = plaqueTex;
  plaqueMat.emissiveColor.set(0.45, 0.45, 0.45); plaqueMat.specularColor.set(0.15, 0.15, 0.15);
  const plaque = CreatePlane('vault-plaque', { width: 1.62, height: 0.506 }, scene);
  plaque.position.set(protoX, 2.9, 16.255); plaque.material = plaqueMat; plaque.isPickable = false;
  // Visible source for the hero spotlight: a ceiling can (merged with the pendant fixtures below).
  const pendantCan = createRoundedBox('pendant-shell', { width: 1.0, height: 0.5, depth: 1.0, radius: 0.08 }, scene);
  pendantCan.position.set(protoX, 8.55, protoZ);
  pendantCan.material = p.metal;
  pendantCan.isPickable = false;
  pendantCan.receiveShadows = true;
  box('pendant-diffuser', protoX, 8.28, protoZ, 0.8, 0.04, 0.8, p.light, false);
  box('pendant-wire', protoX, 8.8, protoZ, 0.05, 0.5, 0.05, p.dark, false);
  // Faked volumetric beam from that can to the plinth (additive, top-bright ramp).
  const beamTex = new DynamicTexture('vault-beam-ramp', { width: 8, height: 128 }, scene, false);
  const bc = beamTex.getContext() as CanvasRenderingContext2D;
  const ramp = bc.createLinearGradient(0, 0, 0, 128);
  ramp.addColorStop(0, 'rgba(255,255,255,0.9)'); ramp.addColorStop(0.55, 'rgba(255,255,255,0.35)'); ramp.addColorStop(1, 'rgba(255,255,255,0.02)');
  bc.fillStyle = ramp; bc.fillRect(0, 0, 8, 128); beamTex.update(); beamTex.hasAlpha = true;
  const beamMat = new StandardMaterial('vault-beam', scene);
  beamMat.disableLighting = true; beamMat.emissiveColor = Color3.FromHexString('#FFE2B0'); beamMat.diffuseColor = Color3.Black();
  beamMat.opacityTexture = beamTex; beamMat.alphaMode = Constants.ALPHA_ADD; beamMat.alpha = 0.32;
  // (No opacity fresnel here: Babylon adds the fresnel term to alpha, which saturated the beam.)
  const beamHeight = 8.2 - 4.75;
  const beam = CreateCylinder('vault-spot-beam', { height: beamHeight, diameterTop: 0.78, diameterBottom: 2.9, tessellation: 32, cap: Mesh.NO_CAP }, scene);
  beam.position.set(protoX, 4.75 + beamHeight / 2, protoZ); beam.material = beamMat; beam.isPickable = false;
  const bellJarBaseY = 4.65 + 1.1;
  const bellCapBaseY = 4.65 + 2.2 + 0.04;
  const bellJarOpenY = 6.4;
  const bellCapOpenY = 7.54;
  // ── Warm vault SpotLight ──
  const vaultSpot = new SpotLight('vault-spot', new Vector3(protoX, 8.7, protoZ), new Vector3(0, -1, 0), 0.6, 2, scene);
  vaultSpot.diffuse = Color3.FromHexString('#FFE2B0'); vaultSpot.intensity = 0;
  // ── Emissive plinth ring ──
  const plinthRingMat = new StandardMaterial('plinth-ring-mat', scene);
  plinthRingMat.disableLighting = true; plinthRingMat.emissiveColor = Color3.FromHexString('#FFE2B0');
  const plinthRing = CreateTorus('plinth-ring', { diameter: 3.6, thickness: 0.05, tessellation: 60 }, scene);
  plinthRing.position.set(protoX, 4.62, protoZ); plinthRing.material = plinthRingMat; plinthRing.isPickable = false;
  plinthRing.visibility = 0.1;
  // ── Alarm beacon lamps (6 rotating beacons). Security = amber (ANTI_VIBECODED colour code). ──
  const beaconRedMat = new StandardMaterial('alarm-beacon-amber', scene);
  beaconRedMat.disableLighting = true; beaconRedMat.emissiveColor = SECURITY_AMBER.clone();
  beaconRedMat.diffuseColor = Color3.Black();
  const alarmBeacons: { root: Mesh; beam: Mesh }[] = [];
  const beaconPositions: [number, number, number][] = [
    [-18.5, 8.3, -50], [-18.5, 8.3, -30], [-18.5, 8.3, -10],
    [-18.5, 8.3, 5], [14, 8.3, 10], [-5, 8.3, 18],
  ];
  for (const [bx, by, bz] of beaconPositions) {
    const lamp = CreateCylinder(`alarm-beacon-lamp`, { diameter: 0.4, height: 0.5, tessellation: 12 }, scene);
    lamp.position.set(bx, by, bz); lamp.material = beaconRedMat; lamp.isPickable = false;
    const beam = CreatePlane('alarm-beacon-beam', { width: 2.5, height: 0.12 }, scene);
    beam.position.set(bx, by, bz); beam.material = beaconRedMat; beam.isPickable = false;
    beam.rotation.x = Math.PI / 2;
    lamp.setEnabled(false); beam.setEnabled(false);
    alarmBeacons.push({ root: lamp, beam });
  }
  // Lighting fixtures share one diffuse emitter material; no per-prop realtime lights.
  for (const [x, z] of [[-6, 8], [9, 12], [0, 20]] as const) {
    box('pendant-shell', x, 8.2, z, 7, 0.3, 1.2, p.metal, false);
    box('pendant-diffuser', x, 8.02, z, 6.7, 0.04, 0.95, p.light, false);
    for (const dx of [-2.6, 2.6]) box('pendant-wire', x + dx, 8.55, z, 0.025, 0.7, 0.025, p.dark, false);
  }
  const plugin = scene.getPhysicsEngine()!.getPhysicsPlugin() as HavokPlugin;
  const officeDoor = new Door(scene, plugin, { name: 'office-access-shutter', x: -1, y: 3, z: -26, width: 6, height: 6, depth: 0.5, travel: -6.2 });
  officeDoor.mesh.material = p.sage;
  const vaultDoorLeft = new Door(scene, plugin, { name: 'vault-backdrop-door-left', x: -2.5, y: 4.5, z: 27, width: 5, height: 9, depth: 0.35, travel: -6, axis: 'x' });
  const vaultDoorRight = new Door(scene, plugin, { name: 'vault-backdrop-door-right', x: 2.5, y: 4.5, z: 27, width: 5, height: 9, depth: 0.35, travel: 6, axis: 'x' });
  vaultDoorLeft.mesh.material = p.wood; vaultDoorRight.mesh.material = p.wood;
  exitStrip('G4', 0, 26.72, 10, false);
  exitStrip('G1', -5, -43.35, 5, true);
  exitStrip('G5', 11, 46.4, 10, true);
  const indigo = new StandardMaterial('morrow-indigo', scene);
  indigo.diffuseColor = Color3.FromHexString('#25316B'); indigo.emissiveColor = Color3.FromHexString('#4C59C7'); indigo.disableLighting = true;
  const morrowDisc = CreateCylinder('morrow-disc', { diameter: 4.2, height: 0.14, tessellation: 48 }, scene);
  morrowDisc.position.set(-5, 2.5, -43.32); morrowDisc.rotation.x = Math.PI / 2; morrowDisc.material = indigo; morrowDisc.isPickable = false;
  const lampCyan = new StandardMaterial('key-lamp-cyan', scene); lampCyan.diffuseColor = Color3.FromHexString('#37D7FF'); lampCyan.emissiveColor = lampCyan.diffuseColor.clone(); lampCyan.disableLighting = true;
  const lampCoral = new StandardMaterial('key-lamp-coral', scene); lampCoral.diffuseColor = Color3.FromHexString('#FF718F'); lampCoral.emissiveColor = lampCoral.diffuseColor.clone(); lampCoral.disableLighting = true;
  const keyLamps = (['terminal-a', 'terminal-b'] as const).map((id, i) => {
    const x = i === 0 ? -2.2 : 0.2;
    const ring = CreateTorus(`key-lamp-${id}-ring`, { diameter: 1.15, thickness: 0.12, tessellation: 32 }, scene);
    ring.position.set(x, 3.6, -26.38); ring.rotation.x = Math.PI / 2; ring.material = i === 0 ? lampCyan : lampCoral; ring.isPickable = false;
    const disc = CreateCylinder(`key-lamp-${id}-disc`, { diameter: 0.9, height: 0.08, tessellation: 32 }, scene);
    disc.position.set(x, 3.6, -26.39); disc.rotation.x = Math.PI / 2; disc.material = i === 0 ? lampCyan : lampCoral; disc.isPickable = false; disc.setEnabled(false);
    return { ring, disc };
  });
  // Readability: graphite jamb frames make each doorway read at camera distance.
  for (const dx of [-3.25, 3.25]) box('door-jamb', -1 + dx, 3, -26, 0.5, 6.2, 1.0, p.dark, false);
  for (const dx of [-3.05, 3.05]) box('door-jamb', dx, 2.2, 2, 0.5, 4.6, 1.1, p.dark, false);
  let elapsed = 0;
  let vaultProgress = 0; // 0 = closed, 1 = fully open
  let prevVaultOpen = false;
  // Alarm transformation state (originals captured on the first tick; no per-frame allocations).
  let sunLight: DirectionalLight | null = null;
  let fillLight: HemisphericLight | null = null;
  let origSunIntensity = 1.65;
  let origFillIntensity = 0.48;
  const origClearColor = new Color4();
  const alarmClear = new Color4(0.42, 0.45, 0.46, 1); // dusk-neutral sky, never red
  let alarmBlend = 0; // 0 = normal, 1 = full alarm
  let alarmTime = 0;
  let alarmPhase = 0;
  let alarmStage = 0;
  let alarmLightTamed = false;
  let statusLed: PBRMaterial | null | undefined;
  let completeTintTimer = 0;
  // Objective beacons: a slowly spinning diamond and a breathing floor ring above the next goal(s).
  // Purely presentational and driven from replicated mission state, so they are identical for both players.
  const beaconMat = new StandardMaterial('objective-beacon', scene);
  // Objective = warm diffuser white (never security amber); mint accent only on the core's beacon, exit green on extraction.
  beaconMat.emissiveColor = Color3.FromHexString('#FFF1D6'); beaconMat.diffuseColor = Color3.Black();
  beaconMat.specularColor = Color3.Black(); beaconMat.alpha = 0.85; beaconMat.disableLighting = true;
  const accentMat = (name: string, hex: string) => {
    const m = beaconMat.clone(name); m.emissiveColor = Color3.FromHexString(hex); return m;
  };
  const coreAccent = accentMat('objective-beacon-core', '#7FF0D0');
  const exitAccent = accentMat('objective-beacon-exit', '#71B38C');
  const makeBeacon = (name: string, x: number, y: number, z: number, gemMat = beaconMat, ringMat = beaconMat) => {
    const gem = CreatePolyhedron(`${name}-beacon`, { type: 1, size: 0.32 }, scene);
    gem.scaling.y = 1.6; gem.position.set(x, y + 1.6, z); gem.material = gemMat; gem.isPickable = false;
    const ring = CreateTorus(`${name}-beacon-ring`, { diameter: 2.2, thickness: 0.07, tessellation: 40 }, scene);
    ring.position.set(x, y - 0.45, z); ring.material = ringMat; ring.isPickable = false;
    return { gem, ring, baseY: y + 1.6 };
  };
  const t = layout.terminals;
  const beacons = {
    'terminal-a': makeBeacon('terminal-a', t['terminal-a'].x, t['terminal-a'].y, t['terminal-a'].z),
    'terminal-b': makeBeacon('terminal-b', t['terminal-b'].x, t['terminal-b'].y, t['terminal-b'].z),
    'terminal-c': makeBeacon('terminal-c', t['terminal-c'].x, t['terminal-c'].y, t['terminal-c'].z),
    vault: makeBeacon('vault', layout.objects.prototype.x, layout.objects.prototype.y + 0.8, layout.objects.prototype.z, beaconMat, coreAccent),
    pickup: makeBeacon('pickup', layout.extraction.x, 1.2, layout.extraction.z, exitAccent, exitAccent),
  };
  levels.set(scene, { update(dt, state) {
    elapsed += dt;
    officeDoor.setOpen(state.officeOpen); officeDoor.update(dt);
    const vaultOpen = state.alarm || state.complete;
    vaultDoorLeft.setOpen(vaultOpen); vaultDoorRight.setOpen(vaultOpen);
    vaultDoorLeft.update(dt); vaultDoorRight.update(dt);
    const stripsLit = new Set(['G0', 'G1', ...(state.officeOpen ? ['G2'] : []), ...((state.vaultOpen && !state.alarm) ? ['G3'] : []), ...(vaultOpen ? ['G4'] : []), 'G5']);
    for (const [id, strip] of exitStrips) strip.material = stripsLit.has(id) ? lintelWarm : lintelDark;
    const hacked = state.hacked ?? {};
    for (const [i, id] of ['terminal-a', 'terminal-b'].entries()) {
      keyLamps[i].ring.setEnabled(!hacked[id]); keyLamps[i].disc.setEnabled(!!hacked[id]);
    }
    p.escape.emissiveColor.set(state.alarm ? 0.22 : 0.06, state.alarm ? 0.8 : 0.17, state.alarm ? 0.43 : 0.1);

    // ── Vault reveal ──
    const wantOpen = !!state.vaultOpen;
    if (wantOpen !== prevVaultOpen) prevVaultOpen = wantOpen;
    const vaultTarget = wantOpen ? 1 : 0;
    if (vaultProgress !== vaultTarget) {
      const speed = 1 / 2.5; // ~2.5s full travel
      if (vaultTarget > vaultProgress) {
        vaultProgress = Math.min(vaultTarget, vaultProgress + dt * speed);
      } else {
        vaultProgress = Math.max(vaultTarget, vaultProgress - dt * speed);
      }
    }
    // Ease-out curve for smooth deceleration
    const eased = 1 - (1 - vaultProgress) * (1 - vaultProgress);
    bellJar.position.y = Scalar.Lerp(bellJarBaseY, bellJarOpenY, eased);
    bellCap.position.y = Scalar.Lerp(bellCapBaseY, bellCapOpenY, eased);
    vaultSpot.intensity = Scalar.Lerp(0, 2.2, eased);
    plinthRing.visibility = Scalar.Lerp(0.1, 1, eased);
    // Brief halo pulse when vault first opens
    if (wantOpen && vaultProgress < 0.5) {
      halo.visibility = 0.6 + 0.4 * Math.sin(elapsed * 8);
    } else {
      halo.visibility = 1;
    }

    // ── Alarm transformation (staged, allocation-free) ──
    // Key dims to ~40%; the cool fill and every surface keep their colour. Amber comes only from
    // lamps (beacons, wall ring) and screens. Stages: 1 trip (0-1.5 s, fast strobe), 2 sustained
    // (1.2 Hz), 3 late escape (>30 s, 2 Hz, brighter) so a long escape keeps escalating.
    if (sunLight === null) {
      sunLight = scene.getLightByName('sun') as DirectionalLight | null;
      fillLight = scene.getLightByName('fill') as HemisphericLight | null;
      if (sunLight) origSunIntensity = sunLight.intensity;
      if (fillLight) origFillIntensity = fillLight.intensity;
      origClearColor.copyFrom(scene.clearColor);
    }
    if (!alarmLightTamed) {
      // MissionDirector's red point light would paint surfaces red; keep it on the lamp housings only.
      const al = scene.getLightByName('alarm-light');
      if (al) { al.diffuse.copyFrom(SECURITY_AMBER); al.includedOnlyMeshes = alarmBeacons.map(b => b.root); alarmLightTamed = true; }
    }
    const alarmActive = state.alarm && !state.complete;
    alarmTime = alarmActive ? alarmTime + dt : 0;
    const alarmTarget = alarmActive ? 1 : 0;
    alarmBlend = Scalar.Lerp(alarmBlend, alarmTarget, 1 - Math.exp(-dt * (alarmActive ? 6 : 3)));
    if (Math.abs(alarmBlend - alarmTarget) < 0.001) alarmBlend = alarmTarget;
    alarmStage = !alarmActive ? 0 : alarmTime < 1.5 ? 1 : alarmTime < 30 ? 2 : 3;
    const hz = alarmStage === 1 ? 3 : alarmStage === 3 ? 2 : 1.2;
    alarmPhase += dt * hz * 2 * Math.PI;
    const lampPulse = 0.5 + 0.5 * Math.sin(alarmPhase);
    const lampLevel = alarmStage === 1 ? (lampPulse > 0.5 ? 1.25 : 0.35) : (alarmStage === 3 ? 0.55 : 0.4) + (alarmStage === 3 ? 0.7 : 0.6) * lampPulse;
    if (sunLight) sunLight.intensity = origSunIntensity * (1 - 0.6 * alarmBlend);
    if (fillLight) fillLight.intensity = origFillIntensity * (1 - 0.15 * alarmBlend);
    Color4.LerpToRef(origClearColor, alarmClear, alarmBlend, scene.clearColor);
    beaconRedMat.emissiveColor.copyFrom(SECURITY_AMBER).scaleInPlace(alarmActive ? lampLevel : 1);
    // Screens: instrument displays and rack status LEDs blink amber with the lamps.
    displayMat.emissiveColor.copyFrom(SCREEN_IDLE);
    if (alarmBlend > 0) Color3.LerpToRef(SCREEN_IDLE, SECURITY_AMBER, alarmBlend * (0.35 + 0.5 * lampPulse), displayMat.emissiveColor);
    if (statusLed === undefined) {
      statusLed = scene.getMaterialByName('dress-status-led-warm') as PBRMaterial | null;
      statusLed?.unfreeze();
    }
    if (statusLed) {
      Color3.LerpToRef(STATUS_IDLE, SECURITY_AMBER, alarmBlend * lampPulse, statusLed.emissiveColor);
    }
    // Hero beam: museum-soft when closed, full when revealed, dimmed with the key during the alarm.
    beamMat.alpha = (0.22 + 0.16 * eased) * (1 - 0.55 * alarmBlend);
    halo.material = alarmActive ? beaconRedMat : p.light;
    scene.metadata = { ...(scene.metadata ?? {}), alarmStage };
    // Warm gold tint on complete
    if (!state.complete) completeTintTimer = 0;
    if (state.complete && completeTintTimer < 2) {
      completeTintTimer += dt;
      const gold = Math.max(0, 1 - completeTintTimer / 2);
      if (fillLight) {
        fillLight.diffuse.r = Math.min(1, fillLight.diffuse.r + gold * 0.15);
        fillLight.diffuse.g = Math.min(1, fillLight.diffuse.g + gold * 0.1);
      }
    }
    // Alarm beacon lamps
    for (const ab of alarmBeacons) {
      ab.root.setEnabled(alarmActive); ab.beam.setEnabled(alarmActive);
      if (alarmActive) ab.beam.rotation.y = elapsed * 4; // rotate beam around Y
    }

    if (state.stage) {
      const h = state.hacked ?? {};
      const show: Record<keyof typeof beacons, boolean> = {
        'terminal-a': (state.stage === 'infiltrate' || state.stage === 'hack-security') && !h['terminal-a'],
        'terminal-b': (state.stage === 'infiltrate' || state.stage === 'hack-security') && !h['terminal-b'],
        'terminal-c': state.stage === 'hack-security' && !!h['terminal-a'] && !!h['terminal-b'] && !h['terminal-c'],
        vault: state.stage === 'steal-prototype' && !state.prototypeHeld,
        pickup: state.stage === 'escape',
      };
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3);
      const lum = 0.82 + 0.18 * pulse;
      beaconMat.emissiveColor.set(lum, 0.945 * lum, 0.84 * lum);
      for (const [key, b] of Object.entries(beacons)) {
        const on = show[key as keyof typeof beacons];
        b.gem.setEnabled(on); b.ring.setEnabled(on);
        if (!on) continue;
        b.gem.rotation.y = elapsed * 1.6; b.gem.position.y = b.baseY + Math.sin(elapsed * 2.2) * 0.18;
        b.ring.scaling.setAll(0.85 + 0.3 * pulse);
      }
    } else for (const b of Object.values(beacons)) { b.gem.setEnabled(false); b.ring.setEnabled(false); }
    // ── scene.metadata for PrototypeVisual p01Excited ──
    scene.metadata = { ...(scene.metadata ?? {}), p01Excited: state.alarm ? 1 : state.vaultOpen ? 0.4 : 0 };

  } });
  scene.onDisposeObservable.addOnce(() => levels.delete(scene));

  // One authored asset kit, merged by material. No physics is derived from decorative meshes.
  const art = await ImportMeshAsync(`${import.meta.env.BASE_URL}assets/lab/robotics-hero.glb`, scene);
  // Babylon's glTF handedness conversion rotates the authored Blender world by 180°.
  for (const root of art.meshes.filter(mesh => !mesh.parent)) root.rotate(Vector3.Up(), Math.PI);
  for (const mesh of art.meshes) {
    mesh.isPickable = false; mesh.receiveShadows = true;
    if (mesh.material?.name === 'Oak') mesh.material = p.wood;
    if (mesh.material instanceof PBRMaterial) mesh.material.maxSimultaneousLights = 4;
  }
  // Legible, restrained instrument graphics; two screens share one 512px atlas.
  const display = new DynamicTexture('instrument-display', { width: 512, height: 256 }, scene, true);
  const dc = display.getContext(); dc.fillStyle = '#112e30'; dc.fillRect(0, 0, 512, 256);
  dc.fillStyle = '#c1ded0'; dc.font = '24px sans-serif'; dc.fillText('MORROW / MOTION SYSTEMS', 24, 38);
  dc.fillStyle = '#638b80'; dc.fillRect(24, 56, 464, 2);
  dc.fillStyle = '#99c3a8'; dc.font = '16px sans-serif'; dc.fillText('P01    ADAPTIVE CORE', 24, 88);
  for (let i = 0; i < 38; i++) {
    const h = 15 + (Math.sin(i * 0.38) + 1) * 30;
    dc.fillRect(26 + i * 8, 190 - h, 4, h);
  }
  dc.fillStyle = '#d8b18b'; dc.font = '18px sans-serif'; dc.fillText('CALIBRATED  /  98.4%', 24, 230); display.update();
  const displayMat = new StandardMaterial('instrument-ink', scene);
  displayMat.diffuseTexture = display; displayMat.emissiveTexture = display;
  displayMat.emissiveColor.set(0.35, 0.35, 0.35); displayMat.specularColor.setAll(0);
  for (const [x, z] of [[-7, 8], [9, 11]] as const) {
    const screen = CreatePlane('instrument-screen', { width: 2.52, height: 1.52 }, scene);
    screen.position.set(x + 1.6, 5.4, z + 0.835); screen.material = displayMat; screen.isPickable = false;
  }
  const kit = await loadPropKit(scene);
  // Server gallery: replace the flat rack slabs with instanced Blender rack units (collision box stays).
  for (const x of [-8.5, 8.5] as const) {
    for (let z = -22.5; z <= -9.5; z += 2.4) kit.place({ prop: 'Rack', x, z, scale: [1.2, 0.7, 1] });
    const row = scene.getMeshByName(`rack-row-${x}`); if (row) row.isVisible = false;
  }
  for (const name of ['rack-upright', 'rack-tray', 'rack-status']) for (const m of scene.meshes.filter(m => m.name === name)) m.dispose();
  dressMissionAreas(scene, p, kit);
  kit.commit();
  // Batch Astra's repeated physics-free trim (rack trays/LEDs, battens, fixtures) into one mesh per material.
  mergeDecorative(scene, ['door-jamb', 'exit-jamb-strip', 'rack-upright', 'rack-tray', 'rack-status', 'oak-batten', 'pendant-shell',
    'pendant-diffuser', 'pendant-wire', 'vault-mullion', 'extraction-lamp']);
  // Authored 'Coral' plastic (planters, arm caps) reads as NEE's colour: retint it to clay.
  for (const m of scene.materials) {
    if (m.name !== 'Coral' || !(m instanceof PBRMaterial)) continue;
    const frozen = m.isFrozen; m.unfreeze(); m.albedoColor.copyFrom(p.coral.albedoColor); if (frozen) m.freeze();
  }
  // Collapse remaining static non-occluder decoration (desks, signs, floors, glass, apron leftovers) per material.
  mergeStaticByMaterial(scene, {
    namePrefix: 'batch',
    include: (mesh) => !isDynamicOrInteractive(mesh)
      && !mesh.name.startsWith('dressing-')
      && !mesh.name.startsWith('merged-')
      && !mesh.name.startsWith('batch-')
      && !mesh.name.startsWith('static-'),
  });
  // Freeze world matrices on leftover static visuals (occluders kept separate for camera fade).
  for (const mesh of scene.meshes) {
    if (!(mesh instanceof Mesh) || !mesh.isVisible) continue;
    if (isDynamicOrInteractive(mesh) || (mesh.thinInstanceCount ?? 0) > 0) continue;
    if (mesh.physicsBody && mesh.metadata?.cameraOccluder) continue;
    mesh.isPickable = false;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  }
  // Freeze static palette materials. p.escape emissive pulses on alarm — leave it live.
  for (const [key, mat] of Object.entries(p)) {
    if (key === 'escape') continue;
    try { mat.freeze(); } catch { /* ok */ }
  }
  addHeroLighting(scene);
  return new Vector3(layout.spawn.x, layout.spawn.y, layout.spawn.z);
}
