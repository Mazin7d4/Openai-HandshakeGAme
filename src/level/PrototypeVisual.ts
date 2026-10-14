import { mergeRigidChildren } from '../scene/mergeChildren.ts';
import {
  Color3, CreateCylinder, CreateSphere, CreateTorus, PBRMaterial, StandardMaterial, TransformNode,
  type Mesh, type Scene,
} from '@babylonjs/core';

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
    glow.emissiveColor.set(0.5 * pulse + excited * 0.4, 0.94 * pulse, 0.82 * pulse);
  });
  body.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(obs));
}
