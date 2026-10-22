import {
  Color3, Color4, CreateBox, CreateCylinder, CreatePlane, CreatePolyhedron, CreateTorus,
  DirectionalLight, DynamicTexture, HemisphericLight, ImportMeshAsync, PBRMaterial, Scalar,
  Mesh, SpotLight, StandardMaterial, Vector3,
  type HavokPlugin, type Material, type Scene,
} from '@babylonjs/core';
import '../assets/registerGltf.ts';
import '../assets/meshopt.ts';
import { addStaticBody } from '../physics/staticBody.ts';
import { Door } from '../gameplay/Door.ts';
import { mergeStaticByMaterial, isDynamicOrInteractive } from '../scene/mergeStatic.ts';
import { createLabPalette } from './LabPalette.ts';
import { dressMissionAreas, mergeDecorative } from './AreaDressing.ts';
import { loadPropKit } from './PropKit.ts';
import layout from './heist-layout.json';

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
  const signGlow = new StandardMaterial('sign-lip-glow', scene);
  signGlow.diffuseColor = new Color3(1, 0.86, 0.62); signGlow.emissiveColor = new Color3(1, 0.8, 0.52);
  signGlow.specularColor = Color3.Black();
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
    if (y > 5) {
      const drop = Math.max(0.4, 14.2 - (y + h / 2));
      for (const dx of [-width * 0.38, width * 0.38]) {
        const rod = CreateCylinder(`${name}-hanger`, { diameter: 0.05, height: drop, tessellation: 6 }, scene);
        rod.parent = mesh; rod.position.set(dx, h / 2 + drop / 2, 0.08); rod.material = p.metal; rod.isPickable = false;
      }
    }
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
  // ── Vault bell jar: decorative frosted glass cylinder with aluminium cap ──
  const protoX = layout.objects.prototype.x;
  const protoZ = layout.objects.prototype.z;
  const bellJarGlass = new PBRMaterial('vault-belljar-glass', scene);
  bellJarGlass.albedoColor = Color3.FromHexString('#D8EDE8'); bellJarGlass.metallic = 0;
  bellJarGlass.roughness = 0.28; bellJarGlass.alpha = 0.3; bellJarGlass.backFaceCulling = false;
  bellJarGlass.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  const bellJar = CreateCylinder('vault-belljar', { diameter: 2.3, height: 2.2, tessellation: 40 }, scene);
  bellJar.position.set(protoX, 4.65 + 1.1, protoZ); bellJar.material = bellJarGlass; bellJar.isPickable = false;
  const capMat = new PBRMaterial('vault-belljar-cap', scene);
  capMat.albedoColor = Color3.FromHexString('#C0C8CC'); capMat.metallic = 0.88; capMat.roughness = 0.28;
  const bellCap = CreateCylinder('vault-belljar-cap', { diameter: 2.35, height: 0.08, tessellation: 40 }, scene);
  bellCap.position.set(protoX, 4.65 + 2.2 + 0.04, protoZ); bellCap.material = capMat; bellCap.isPickable = false;
  const bellJarBaseY = 4.65 + 1.1;
  const bellCapBaseY = 4.65 + 2.2 + 0.04;
  const bellJarOpenY = 11 + 1.1;
  const bellCapOpenY = 11 + 2.2 + 0.04;
  // ── Warm vault SpotLight ──
  const vaultSpot = new SpotLight('vault-spot', new Vector3(protoX, 13, protoZ), new Vector3(0, -1, 0), 0.6, 2, scene);
  vaultSpot.diffuse = Color3.FromHexString('#FFE2B0'); vaultSpot.intensity = 0;
  // ── Emissive plinth ring ──
  const plinthRingMat = new StandardMaterial('plinth-ring-mat', scene);
  plinthRingMat.disableLighting = true; plinthRingMat.emissiveColor = Color3.FromHexString('#FFE2B0');
  const plinthRing = CreateTorus('plinth-ring', { diameter: 3.6, thickness: 0.05, tessellation: 60 }, scene);
  plinthRing.position.set(protoX, 4.62, protoZ); plinthRing.material = plinthRingMat; plinthRing.isPickable = false;
  plinthRing.visibility = 0.1;
  // ── Alarm beacon lamps (6 small red rotating beacons) ──
  const beaconRedMat = new StandardMaterial('alarm-beacon-red', scene);
  beaconRedMat.disableLighting = true; beaconRedMat.emissiveColor = new Color3(1, 0.1, 0.05);
  beaconRedMat.diffuseColor = Color3.Black();
  const alarmBeacons: { root: Mesh; beam: Mesh }[] = [];
  const beaconPositions: [number, number, number][] = [
    [-18.5, 11, -50], [-18.5, 11, -30], [-18.5, 11, -10],
    [-18.5, 11, 5], [14, 11, 10], [-5, 11, 18],
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
    box('pendant-shell', x, 11.7, z, 7, 0.3, 1.2, p.metal, false);
    box('pendant-diffuser', x, 11.52, z, 6.7, 0.04, 0.95, p.light, false);
    for (const dx of [-2.6, 2.6]) box('pendant-wire', x + dx, 13, z, 0.025, 2.5, 0.025, p.dark, false);
  }
  // Escape: a fast west spine, two altitude changes and a final dive onto the delivery pad.
  box('escape-low-obstacle', -15.5, 1.6, -9, 6.4, 3.2, 0.7, p.wood);
  box('escape-low-obstacle-cap', -15.5, 3.24, -9, 6.5, 0.08, 0.8, p.metal, false);
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
  // Objective beacons: a slowly spinning diamond and a breathing floor ring above the next goal(s).
  // Purely presentational and driven from replicated mission state, so they are identical for both players.
  const beaconMat = new StandardMaterial('objective-beacon', scene);
  beaconMat.emissiveColor = Color3.FromHexString('#FFD27A'); beaconMat.diffuseColor = Color3.Black();
  beaconMat.specularColor = Color3.Black(); beaconMat.alpha = 0.85; beaconMat.disableLighting = true;
  const makeBeacon = (name: string, x: number, y: number, z: number) => {
    const gem = CreatePolyhedron(`${name}-beacon`, { type: 1, size: 0.32 }, scene);
    gem.scaling.y = 1.6; gem.position.set(x, y + 1.6, z); gem.material = beaconMat; gem.isPickable = false;
    const ring = CreateTorus(`${name}-beacon-ring`, { diameter: 2.2, thickness: 0.07, tessellation: 40 }, scene);
    ring.position.set(x, y - 0.45, z); ring.material = beaconMat; ring.isPickable = false;
    return { gem, ring, baseY: y + 1.6 };
  };
  const t = layout.terminals;
  const beacons = {
    'terminal-a': makeBeacon('terminal-a', t['terminal-a'].x, t['terminal-a'].y, t['terminal-a'].z),
    'terminal-b': makeBeacon('terminal-b', t['terminal-b'].x, t['terminal-b'].y, t['terminal-b'].z),
    'terminal-c': makeBeacon('terminal-c', t['terminal-c'].x, t['terminal-c'].y, t['terminal-c'].z),
    vault: makeBeacon('vault', layout.objects.prototype.x, layout.objects.prototype.y + 0.8, layout.objects.prototype.z),
    pickup: makeBeacon('pickup', layout.extraction.x, 1.2, layout.extraction.z),
  };
  let elapsed = 0;
  let vaultProgress = 0; // 0 = closed, 1 = fully open
  let prevVaultOpen = false;
  // Alarm transformation: store originals once on first alarm tick.
  let origFillDiffuse: Color3 | null = null;
  let origSunIntensity: number | null = null;
  let origClearColor: Color4 | null = null;
  let alarmBlend = 0; // 0 = normal, 1 = full alarm tint
  let completeTintTimer = 0;
  levels.set(scene, { update(dt, state) {
    elapsed += dt;
    officeDoor.setOpen(state.officeOpen); officeDoor.update(dt);
    escapeDoor.setOpen(state.alarm || state.complete); escapeDoor.update(dt);
    p.escape.emissiveColor.set(state.alarm ? 0.22 : 0.06, state.alarm ? 0.8 : 0.17, state.alarm ? 0.43 : 0.1);
    strips.forEach((mesh, i) => { mesh.visibility = state.alarm ? 0.65 + 0.35 * Math.sin(elapsed * 5 + i * 0.8) : 0.18; });
    exitSign.scaling.setAll(state.alarm ? 1.04 : 1);
    halo.material = state.alarm ? p.coral : p.light;

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

    // ── Alarm transformation ──
    const fillLight = scene.getLightByName('fill') as HemisphericLight | null;
    const sunLight = scene.getLightByName('sun') as DirectionalLight | null;
    // Store originals on first encounter
    if (fillLight && origFillDiffuse === null) origFillDiffuse = fillLight.diffuse.clone();
    if (sunLight && origSunIntensity === null) origSunIntensity = sunLight.intensity;
    if (origClearColor === null) origClearColor = scene.clearColor.clone();
    const alarmActive = state.alarm && !state.complete;
    const alarmTarget = alarmActive ? 1 : 0;
    alarmBlend = Scalar.Lerp(alarmBlend, alarmTarget, 1 - Math.exp(-dt * 3));
    if (Math.abs(alarmBlend - alarmTarget) < 0.001) alarmBlend = alarmTarget;
    if (alarmBlend > 0) {
      const pulse12 = 0.5 + 0.5 * Math.sin(elapsed * 1.2 * 2 * Math.PI); // 1.2 Hz
      const blendedPulse = alarmBlend * pulse12;
      if (fillLight && origFillDiffuse) {
        Color3.LerpToRef(origFillDiffuse, new Color3(1, 0.35, 0.3), blendedPulse * 0.7, fillLight.diffuse);
      }
      if (sunLight && origSunIntensity !== null) {
        sunLight.intensity = Scalar.Lerp(origSunIntensity, origSunIntensity * 0.55, alarmBlend);
      }
      if (origClearColor) {
        const alarmClear = new Color4(0.32, 0.16, 0.16, origClearColor.a);
        Color4.LerpToRef(origClearColor, alarmClear, alarmBlend * 0.8, scene.clearColor);
      }
    } else if (origFillDiffuse && origSunIntensity !== null && origClearColor) {
      // Restore originals when not alarmed
      if (fillLight) fillLight.diffuse.copyFrom(origFillDiffuse);
      if (sunLight) sunLight.intensity = origSunIntensity;
      scene.clearColor.copyFrom(origClearColor);
    }
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

    // ── scene.metadata for PrototypeVisual p01Excited ──
    scene.metadata = { ...(scene.metadata ?? {}), p01Excited: state.alarm ? 1 : state.vaultOpen ? 0.4 : 0 };

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
      beaconMat.emissiveColor.set(state.alarm ? 0.55 + 0.3 * pulse : 1, state.alarm ? 0.95 : 0.78 + 0.1 * pulse, state.alarm ? 0.6 : 0.42);
      for (const [key, b] of Object.entries(beacons)) {
        const on = show[key as keyof typeof beacons];
        b.gem.setEnabled(on); b.ring.setEnabled(on);
        if (!on) continue;
        b.gem.rotation.y = elapsed * 1.6; b.gem.position.y = b.baseY + Math.sin(elapsed * 2.2) * 0.18;
        b.ring.scaling.setAll(0.85 + 0.3 * pulse);
      }
    } else for (const b of Object.values(beacons)) { b.gem.setEnabled(false); b.ring.setEnabled(false); }
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
  for (const [z, x, width] of [[-21, -4, 16], [-13, 7, 22]] as const) {
    const n = Math.round(width / 2.4); const w = width / n;
    for (let i = 0; i < n; i++) kit.place({ prop: 'Rack', x: x - width / 2 + w * (i + 0.5), z, scale: [w / 2.4, 1, 1] });
    const bank = scene.getMeshByName(`rack-bank-${z}`); if (bank) bank.isVisible = false;
  }
  for (const name of ['rack-upright', 'rack-tray', 'rack-status']) for (const m of scene.meshes.filter(m => m.name === name)) m.dispose();
  dressMissionAreas(scene, p, kit);
  kit.commit();
  // Batch Astra's repeated physics-free trim (rack trays/LEDs, battens, fixtures) into one mesh per material.
  mergeDecorative(scene, ['rack-upright', 'rack-tray', 'rack-status', 'oak-batten', 'pendant-shell',
    'pendant-diffuser', 'pendant-wire', 'vault-mullion', 'extraction-lamp']);
  // Collapse remaining static non-occluder decoration (desks, signs, floors, glass) per material.
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
  return new Vector3(layout.spawn.x, layout.spawn.y, layout.spawn.z);
}
