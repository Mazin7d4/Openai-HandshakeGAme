import { mergeRigidChildren } from '../scene/mergeChildren.ts';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';

/**
 * P01 Adaptive Companion Core: a hand-sized glass capsule in brushed aluminium caps with a
 * glowing companion core held by a slowly turning gimbal. Decorative only: the verified
 * grabbable body and its replication stay intact (body is just hidden).
 */
export function dressPrototype(body: Mesh, scene: Scene): void {
  body.isVisible = false;
  const pick = (m: Mesh) => { m.isPickable = false; m.parent = root; return m; };
  const root = new TransformNode('p01-root', scene); root.parent = body;
  root.rotation.z = Math.PI / 2; // lies on its side in the cradle like a museum piece
  const alu = new PBRMaterial('p01-aluminium', scene);
  alu.albedoColor = Color3.FromHexString('#C9CDD1'); alu.metallic = 0.92; alu.roughness = 0.32;
  const ceramic = new PBRMaterial('p01-ceramic', scene);
  ceramic.albedoColor = Color3.FromHexString('#EEE5D1'); ceramic.metallic = 0.1; ceramic.roughness = 0.35;
  const glass = new PBRMaterial('p01-glass', scene);
  glass.albedoColor = Color3.FromHexString('#DDEFF0'); glass.metallic = 0; glass.roughness = 0.04;
  glass.alpha = 0.22; glass.backFaceCulling = false;
  const glow = new StandardMaterial('p01-core-glow', scene);
  glow.disableLighting = true; glow.emissiveColor = Color3.FromHexString('#7FF0D0');
  const led = new StandardMaterial('p01-led', scene);
  led.disableLighting = true; led.emissiveColor = Color3.FromHexString('#FFD27A');

  const tube = pick(CreateCylinder('p01-glass', { height: 0.86, diameter: 0.74, tessellation: 40 }, scene));
  tube.material = glass;
  for (const y of [-0.5, 0.5]) {
    const cap = pick(CreateCylinder('p01-cap', { height: 0.16, diameterTop: y > 0 ? 0.62 : 0.84, diameterBottom: y > 0 ? 0.84 : 0.62, tessellation: 40 }, scene));
    cap.position.y = y; cap.material = alu;
    const lip = pick(CreateTorus('p01-lip', { diameter: 0.8, thickness: 0.05, tessellation: 40 }, scene));
    lip.position.y = y * 0.85; lip.material = ceramic;
    const dot = pick(CreateSphere('p01-led', { diameter: 0.07, segments: 8 }, scene));
    dot.position.set(0.41, y * 0.85, 0); dot.material = led;
  }
  // Two spine rails keep it reading as an engineered instrument, not a bubble.
  for (const a of [0, Math.PI]) {
    const rail = pick(CreateCylinder('p01-rail', { height: 0.9, diameter: 0.05, tessellation: 8 }, scene));
    rail.position.set(Math.cos(a) * 0.39, 0, Math.sin(a) * 0.39); rail.material = alu;
  }
  const core = pick(CreateSphere('p01-core', { diameter: 0.3, segments: 20 }, scene)); core.material = glow;
  const halo = pick(CreateSphere('p01-core-halo', { diameter: 0.46, segments: 16 }, scene));
  const haloMat = glow.clone('p01-halo'); haloMat.alpha = 0.25; halo.material = haloMat;
  const ringA = pick(CreateTorus('p01-gimbal-a', { diameter: 0.58, thickness: 0.025, tessellation: 40 }, scene));
  const ringB = pick(CreateTorus('p01-gimbal-b', { diameter: 0.5, thickness: 0.025, tessellation: 40 }, scene));
  ringA.material = alu; ringB.material = ceramic;
  // Mint bloom card: the core's light spilling through the capsule glass. Cheap (one additive quad),
  // so it still reads on the low tier where the GlowLayer is off.
  const bloomTex = new DynamicTexture('p01-bloom-ramp', { width: 64, height: 64 }, scene, false);
  const bctx = bloomTex.getContext() as CanvasRenderingContext2D;
  const rg = bctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  bctx.fillStyle = rg; bctx.fillRect(0, 0, 64, 64); bloomTex.update(); bloomTex.hasAlpha = true;
  const bloomMat = new StandardMaterial('p01-bloom', scene);
  bloomMat.disableLighting = true; bloomMat.diffuseColor = Color3.Black(); bloomMat.emissiveColor = Color3.FromHexString('#7FF0D0');
  bloomMat.opacityTexture = bloomTex; bloomMat.alphaMode = Constants.ALPHA_ADD; bloomMat.alpha = 0.7;
  const bloom = CreatePlane('p01-bloom', { size: 2.4 }, scene);
  bloom.parent = body; bloom.billboardMode = Mesh.BILLBOARDMODE_ALL; bloom.material = bloomMat; bloom.isPickable = false;
  root.computeWorldMatrix(true);
  mergeRigidChildren(root, [core, halo, ringA, ringB]);
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000; t += dt;
    const excited = (scene.metadata as { p01Excited?: number } | undefined)?.p01Excited ?? 0;
    const speed = 0.6 + excited * 3;
    ringA.rotation.x += dt * speed; ringB.rotation.z += dt * speed * 1.3;
    const pulse = 0.85 + 0.15 * Math.sin(t * (2 + excited * 6));
    core.scaling.setAll(pulse); halo.scaling.setAll(1 + 0.12 * Math.sin(t * 2.4) + excited * 0.25);
    const k = 1.3 * pulse; // hotter core: the brightest, most saturated thing in the vault
    glow.emissiveColor.set(0.5 * k + excited * 0.4, 0.94 * k, 0.82 * k);
    bloom.scaling.setAll(0.9 + 0.12 * pulse + excited * 0.35); bloomMat.alpha = 0.55 + 0.2 * pulse;
  });
  body.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(obs));
}
