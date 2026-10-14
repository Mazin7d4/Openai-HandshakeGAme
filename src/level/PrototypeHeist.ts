import {
  Color3, CreateBox, CreatePlane, CreateTorus, DynamicTexture, ImportMeshAsync,
  PBRMaterial, StandardMaterial, Vector3, type HavokPlugin, type Material, type Mesh, type Scene,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { addStaticBody } from '../physics/staticBody.ts';
import { Door } from '../gameplay/Door.ts';
import { createLabPalette } from './LabPalette.ts';
import { dressMissionAreas, mergeDecorative } from './AreaDressing.ts';
import layout from './heist-layout.json';

export interface HeistPresentation { alarm: boolean; complete: boolean; officeOpen: boolean }
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
  const sign = (name: string, title: string, sub: string, x: number, y: number, z: number, width = 7) => {
    const t = new DynamicTexture(`${name}-type`, { width: 1024, height: 256 }, scene, true);
    const c = t.getContext(); c.fillStyle = '#203c39'; c.fillRect(0, 0, 1024, 256);
    c.fillStyle = '#f3eee0'; c.font = '600 70px sans-serif'; c.fillText(title, 45, 110);
    c.fillStyle = '#afd0ba'; c.font = '32px sans-serif'; c.fillText(sub, 48, 185); t.update();
    const m = new StandardMaterial(`${name}-ink`, scene); m.diffuseTexture = t;
    m.emissiveColor = new Color3(0.2, 0.2, 0.2); m.specularColor = Color3.Black();
    const mesh = CreatePlane(name, { width, height: width / 4 }, scene);
    mesh.position.set(x, y, z); mesh.material = m; mesh.isPickable = false;
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
  box('foundation', 0, -0.4, -20, 40, 0.8, 96, p.floor);
  box('east-wall', 19, 7, -18, 0.6, 14, 92, p.paint, true, true);
  box('west-wall', -19, 7, -18, 0.6, 14, 92, p.sage, true, true);
  box('north-wall', 0, 7, 27, 38, 14, 0.6, p.paint, true, true);
  box('south-boundary', 0, 7, -67, 38, 14, 0.6, p.sage, true, true);
  const roof = box('cutaway-roof-collider', 0, 14.4, -19, 38, 0.5, 94); roof.isVisible = false;
  // Continuous service spine is isolated until the alarm vents it at the north end.
  box('service-spine-south', -12, 7, -28, 0.5, 14, 58, p.sage, true, true);
  box('service-spine-north', -12, 7, 5, 0.5, 14, 8, p.sage, true, true);
  box('service-spine-vault', -12, 7, 22, 0.5, 14, 10, p.sage, true, true);
  box('service-entry-header', -12, 10, 13, 0.5, 8, 8, p.paint, true, true);
  // Arrival: delivery apron, human reception and a visible high service vent.
  box('entry-wall-left', -9, 7, -55, 6, 14, 0.5, p.paint, true, true);
  box('entry-wall-right', 11, 7, -55, 16, 14, 0.5, p.paint, true, true);
  box('entry-header', -1.5, 10, -55, 9, 8, 0.5, p.wood, true, true);
  desk('reception', -4.5, -49, 11);
  sign('reception-sign', 'MORROW / ROBOTICS', '01   RESEARCH ANNEX     /     DELIVERIES BELOW', 2, 9, -54.6, 12);
  sign('tiny-route', 'STAFF ACCESS  ↑', 'Under the desk. Up through the service vent.', -4, 2.1, -51.25, 5);
  // A crawl route under furniture leads to a mandatory ascent, with a broad alternate opening.
  box('office-divider-low', 3, 2.35, -43, 30, 4.7, 0.6, p.sage, true, true);
  box('office-divider-high', 3, 11, -43, 30, 6, 0.6, p.paint, true, true);
  box('vent-sill', -5, 4.8, -43, 5, 0.22, 5, p.metal);
  box('vent-left', -7.6, 6.4, -43, 0.2, 3.4, 5, p.metal, true, true);
  box('vent-right', -2.4, 6.4, -43, 0.2, 3.4, 5, p.metal, true, true);
  sign('vent-sign', '↑  SERVICE VENT', 'Rise together • keep the cord loose', -5, 8.8, -46, 6);
  // Office cooperative pocket: PIX on the desktop; NEE at the under-desk patch bay.
  desk('office-pix', -5, -33, 9);
  desk('office-nee', 7, -31, 8);
  box('office-rug', 1, 0.025, -35, 20, 0.04, 12, p.blue, false);
  box('office-glass', 13, 7, -35, 0.14, 14, 15, p.glass, true);
  sign('office-sign', '02 / TWO KEYS', 'PIX: desk console    /    NEE: patch bay below', 1, 10, -27.4, 11);
  // A full-height partition prevents simply flying over the access shutter.
  for (const x of [-8, 10.5]) box('office-wall', x, 7, -26, x < 0 ? 8 : 17, 14, 0.6, p.paint, true, true);
  box('office-door-header', -1, 10, -26, 6, 8, 0.6, p.wood, true, true);
  // Server gallery: alternating aisle ends and a high maintenance shelf. All flight gaps ≥ 2.4 units.
  for (const [z, x, width] of [[-21, -4, 16], [-13, 7, 22]] as const) {
    box(`rack-bank-${z}`, x, 3.9, z, width, 7.8, 2.6, p.dark, true, true);
    for (let dx = -width / 2 + 1; dx < width / 2; dx += 2.4) {
      box('rack-upright', x + dx, 4, z - 1.34, 0.08, 7.3, 0.08, p.metal, false);
      for (let y = 1; y < 7; y += 1.3) {
        box('rack-tray', x + dx + 0.8, y, z - 1.35, 1.35, 0.42, 0.06, p.metal, false);
        box('rack-status', x + dx + 0.3, y, z - 1.4, 0.08, 0.08, 0.04, p.escape, false);
      }
    }
  }
  box('server-maintenance-shelf', -5, 5.7, -5.8, 10, 0.25, 5, p.metal);
  sign('server-sign', '03 / MEMORY ARRAY', 'Follow the cable trays ↑  Authorize the vault', -3, 10.6, -4.8, 10);
  // Main lab door retains the existing replicated all-hacks-complete condition.
  box('lab-door-left', -7.4, 7, 2, 9.2, 14, 0.7, p.paint, true, true);
  box('lab-door-right', 10.4, 7, 2, 15.2, 14, 0.7, p.paint, true, true);
  box('lab-door-header', 0, 9.2, 2, 5.6, 9.6, 0.7, p.wood, true, true);
  sign('lab-sign', '04 / ROBOTICS', 'MORROW     /     SMALL THINGS. BIG IDEAS.', 3, 11.3, 2.5, 12);
  // Hero lab: real-scale benches, clear central floor and a display at human worktop height.
  box('hero-oak-wall', 2, 6, 26.55, 28, 12, 0.18, p.wood, false);
  for (let x = -10; x <= 16; x += 1.2) box('oak-batten', x, 6, 26.35, 0.12, 12, 0.2, p.wood, false);
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
    box('vault-glass', x, 5.8, 20, 0.1, 11.2, 8, p.glass);
    for (const z of [16, 24]) box('vault-mullion', x, 5.8, z, 0.13, 11.6, 0.13, p.metal);
  }
  sign('vault-title', 'M O R R O W', 'P 0 1     /     ADAPTIVE COMPANION CORE', 0, 8.7, 25.9, 11);
  const halo = CreateTorus('vault-halo', { diameter: 7.7, thickness: 0.08, tessellation: 80 }, scene);
  halo.position.set(0, 6.2, 25.9); halo.rotation.x = Math.PI / 2; halo.material = p.light; halo.isPickable = false;
  // Lighting fixtures share one diffuse emitter material; no per-prop realtime lights.
  for (const [x, z] of [[-6, 8], [9, 12], [0, 20]] as const) {
    box('pendant-shell', x, 11.7, z, 7, 0.3, 1.2, p.metal, false);
    box('pendant-diffuser', x, 11.52, z, 6.7, 0.04, 0.95, p.light, false);
    for (const dx of [-2.6, 2.6]) box('pendant-wire', x + dx, 13, z, 0.025, 2.5, 0.025, p.dark, false);
  }
  // Escape: a fast west spine, two altitude changes and a final dive onto the delivery pad.
  box('escape-low-obstacle', -15.5, 1.6, -9, 6.4, 3.2, 0.7, p.sage);
  box('escape-high-obstacle', -15.5, 10.6, -34, 6.4, 6.8, 0.7, p.sage, true, true);
  const strips: Mesh[] = [];
  for (let z = 13; z > -60; z -= 6) {
    const strip = box('escape-route-light', -15.5, 0.055, z, 0.5, 0.06, 2.8, p.escape, false);
    strips.push(strip);
  }
  const exitSign = sign('exit-sign', '←  PRESSURE RELIEF', 'Automatic evacuation route', -11.6, 7.3, 13, 6);
  exitSign.rotation.y = -Math.PI / 2;
  const pickupSign = sign('extraction-sign', 'PICKUP / 01', 'Both drones + the core. Then we go home.', -15, 5.5, -65.5, 7);
  pickupSign.rotation.y = Math.PI;
  box('extraction-pad', -15, 0.08, -61, 6.5, 0.16, 7, p.dark);
  for (const dx of [-2.8, 2.8]) box('extraction-lamp', -15 + dx, 0.22, -61, 0.15, 0.1, 6, p.escape, false);

  const plugin = scene.getPhysicsEngine()!.getPhysicsPlugin() as HavokPlugin;
  const officeDoor = new Door(scene, plugin, { name: 'office-access-shutter', x: -1, y: 3, z: -26, width: 6, height: 6, depth: 0.5, travel: 7 });
  officeDoor.mesh.material = p.sage; officeDoor.mesh.metadata = { cameraOccluder: true };
  const escapeDoor = new Door(scene, plugin, { name: 'pressure-relief-shutter', x: -12, y: 3, z: 13, width: 0.5, height: 6, depth: 8, travel: 7 });
  escapeDoor.mesh.material = p.coral; escapeDoor.mesh.metadata = { cameraOccluder: true };
  let elapsed = 0;
  levels.set(scene, { update(dt, state) {
    elapsed += dt;
    officeDoor.setOpen(state.officeOpen); officeDoor.update(dt);
    escapeDoor.setOpen(state.alarm || state.complete); escapeDoor.update(dt);
    p.escape.emissiveColor.set(state.alarm ? 0.22 : 0.06, state.alarm ? 0.8 : 0.17, state.alarm ? 0.43 : 0.1);
    strips.forEach((mesh, i) => { mesh.visibility = state.alarm ? 0.65 + 0.35 * Math.sin(elapsed * 5 + i * 0.8) : 0.18; });
    exitSign.scaling.setAll(state.alarm ? 1.04 : 1);
    halo.material = state.alarm ? p.coral : p.light;
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
  dressMissionAreas(scene, p);
  // Batch Astra's repeated physics-free trim (rack trays/LEDs, battens, fixtures) into one mesh per material.
  mergeDecorative(scene, ['rack-upright', 'rack-tray', 'rack-status', 'oak-batten', 'pendant-shell',
    'pendant-diffuser', 'pendant-wire', 'vault-mullion', 'extraction-lamp']);
  return new Vector3(layout.spawn.x, layout.spawn.y, layout.spawn.z);
}
