import {
  Color3, CreateBox, CreateCylinder, CreateTorus, Mesh, PBRMaterial, type Material, type Scene,
} from '@babylonjs/core';
import type { createLabPalette } from './LabPalette.ts';
import type { PropPlacement } from './PropKit.ts';
import { addStaticBody } from '../physics/staticBody.ts';

type Palette = ReturnType<typeof createLabPalette>;

/**
 * Decorative, collision-free set dressing for reception, vent, office, server gallery and escape spine.
 * Everything is batched per material and merged into a handful of static meshes, so the extra detail
 * costs roughly one draw call per material. Nothing here owns physics, mission or network state, and
 * all props sit outside the authored flight routes (under-desk crawl, vent, office door, rack aisles).
 */
export function dressMissionAreas(scene: Scene, p: Palette, kit: { place(p: PropPlacement): unknown }): Mesh[] {
  // Big props get one simple invisible static box so drones no longer fly visually through them.
  const collide = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const c = CreateBox('prop-collider', { width: w, height: h, depth: d }, scene);
    c.position.set(x, y, z); c.isVisible = false; c.isPickable = false; addStaticBody(c, scene);
  };
  const make = (name: string, hex: string, roughness: number, metallic = 0, emissive?: string) => {
    const m = new PBRMaterial(`dress-${name}`, scene);
    m.albedoColor = Color3.FromHexString(hex); m.roughness = roughness; m.metallic = metallic;
    if (emissive) m.emissiveColor = Color3.FromHexString(emissive);
    return m;
  };
  const mustard = make('mustard-felt', '#D9A441', 0.92);
  const teal = make('teal-fabric', '#2F7F86', 0.9);
  const pink = make('sand-polymer', '#D6C2A4', 0.42); // was pink: NEE owns pink/coral
  const yellow = make('safety-yellow', '#F0C230', 0.55);
  const white = make('whiteboard', '#F7F6F1', 0.18);
  const cyanLed = make('status-led-warm', '#F4EFE6', 0.4, 0, '#D8CBB2'); // was cyan: PIX owns cyan
  const amberLed = make('status-led-soft', '#E6E1D6', 0.4, 0, '#9E978A'); // was amber: amber = security only
  const copper = make('copper-pipe', '#C27F55', 0.35, 0.9);
  const cable = make('cable-rubber', '#1E2528', 0.7);

  const groups = new Map<Material, Mesh[]>();
  const add = (mesh: Mesh, material: Material) => {
    mesh.isPickable = false;
    const list = groups.get(material) ?? []; list.push(mesh); groups.set(material, list);
    return mesh;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, m: Material, ry = 0) => {
    const mesh = CreateBox('dress', { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z); mesh.rotation.y = ry; return add(mesh, m);
  };
  const cyl = (x: number, y: number, z: number, h: number, top: number, bottom: number, m: Material, tess = 20) => {
    const mesh = CreateCylinder('dress', { height: h, diameterTop: top, diameterBottom: bottom, tessellation: tess }, scene);
    mesh.position.set(x, y, z); return add(mesh, m);
  };
  const keyboard = (x: number, y: number, z: number) => {
    box(x, y, z, 2.1, 0.1, 0.7, p.dark);
    for (let i = 0; i < 4; i++) box(x, y + 0.06, z - 0.24 + i * 0.16, 1.9, 0.04, 0.1, p.paint);
  };
  const mug = (x: number, y: number, z: number, m: Material) => {
    cyl(x, y + 0.25, z, 0.5, 0.42, 0.42, m, 14);
    const handle = CreateTorus('dress', { diameter: 0.28, thickness: 0.06, tessellation: 12 }, scene);
    handle.position.set(x + 0.25, y + 0.27, z); handle.rotation.x = Math.PI / 2; add(handle, m);
  };
  const frame = (x: number, y: number, z: number, w: number, h: number, art: Material, faceX: boolean) => {
    box(x, y, z, faceX ? 0.12 : w + 0.3, h + 0.3, faceX ? w + 0.3 : 0.12, p.wood);
    box(faceX ? x + (x > 0 ? -0.08 : 0.08) : x, y, faceX ? z : z + (z > 0 ? -0.08 : 0.08), faceX ? 0.06 : w, h, faceX ? w : 0.06, art);
  };
  const pendant = (x: number, z: number, len = 6) => {
    box(x, 13.3, z, len, 0.28, 1.1, p.metal);
    box(x, 13.14, z, len - 0.3, 0.04, 0.85, p.light);
    for (const dx of [-len / 2 + 0.6, len / 2 - 0.6]) box(x + dx, 13.8, z, 0.03, 0.9, 0.03, cable);
  };

  // ---------- 01 RECEPTION ----------
  kit.place({ prop: 'Plant', x: 15.5, z: -52, scale: 1.05 }); kit.place({ prop: 'Plant', x: -9.5, z: -52.5, scale: 0.8 });
  // Lounge: a long mustard sofa and a low oak coffee table against the east wall.
  kit.place({ prop: 'Sofa', x: 16.4, z: -47.5, ry: -Math.PI / 2 }); collide(16.4, 1.5, -47.5, 3.8, 3, 9.6);

  box(11.5, 1.6, -47.5, 4, 0.22, 5, p.wood);
  for (const [dx, dz] of [[-1.6, -2.1], [1.6, -2.1], [-1.6, 2.1], [1.6, 2.1]]) cyl(11.5 + dx, 0.75, -47.5 + dz, 1.5, 0.16, 0.16, p.metal, 8);
  box(11, 1.82, -48.4, 1.6, 0.18, 2.1, pink); box(11.2, 1.98, -48.2, 1.5, 0.14, 2, teal);
  mug(12.4, 1.72, -46.6, yellow);
  // Reception desk dressing: monitor-facing keyboard, a mug and a tiny potted succulent.
  keyboard(-3, 3.97, -48); mug(-8.5, 3.92, -48.6, p.coral); kit.place({ prop: 'PlantSmall', x: -9.4, y: 3.92, z: -50, scale: 0.6 });
  // Gallery wall: three colourful framed prints on the east wall.
  frame(18.65, 8.5, -50, 4, 3, p.blue, true); frame(18.65, 8.5, -45, 2.8, 3.6, p.coral, true);
  frame(18.65, 5.5, -42.6, 2.2, 1.6, yellow, true);
  pendant(4, -49); pendant(12, -46);
  // Floor: oak entry mat and a soft wayfinding stripe toward the staff vent.
  box(-1.5, 0.02, -53, 8, 0.03, 3, p.dark);
  for (let i = 0; i < 4; i++) box(-4.8, 0.035, -51 + i * 1.6, 0.9, 0.03, 0.5, yellow);

  // ---------- VENT / OFFICE DIVIDER ----------
  // Louvre slats left and right of the opening, a duct climbing to the ceiling and hazard chevrons.
  for (let y = 5.4; y < 8; y += 0.45) {
    for (const x of [-9.6, -0.6]) box(x, y, -43.35, 3.6, 0.1, 0.2, p.metal);
  }
  kit.place({ prop: 'Duct', x: -5, y: 12, z: -43, ry: Math.PI / 2, scale: 0.9 });
  for (let i = 0; i < 5; i++) box(-7.2 + i * 1.1, 4.64, -45.7, 0.5, 0.06, 0.35, yellow, 0.6);
  box(-5, 4.66, -45.7, 5.2, 0.03, 0.08, cable);
  kit.place({ prop: 'Plant', x: 14, z: -44.8, scale: 0.7 });

  // ---------- 02 OFFICE ----------
  // PIX's desk chair stands south of its console; NEE's patch-bay desk is left clear underneath.
  kit.place({ prop: 'Chair', x: -5, z: -37.2, ry: Math.PI }); kit.place({ prop: 'Chair', x: 7.5, z: -35.5, ry: Math.PI + 0.35 });
  keyboard(-6, 3.97, -34.2); keyboard(7.2, 3.97, -32.4); mug(-1.7, 3.92, -33.6, pink); mug(9.6, 3.92, -30.4, p.blue);
  // Notebooks and sticky notes on the desks.
  box(-8.2, 4.0, -33.8, 1.6, 0.14, 2.1, p.coral, 0.2); box(9.8, 4.0, -32, 1.4, 0.12, 1.9, yellow, -0.3);
  for (let i = 0; i < 5; i++) box(-2.0 + (i % 2) * 0.32, 4.6 + i * 0.35, -32.3, 0.3, 0.3, 0.02, i % 2 ? yellow : pink);
  // Under-desk cables: bundled runs from each screen to floor boxes.
  for (const [x, z] of [[-3.5, -32.2], [8.7, -30.2]] as const) {
    cyl(x, 2, z, 3.9, 0.14, 0.14, cable, 6); box(x, 0.2, z, 1.4, 0.4, 0.9, p.dark);
  }
  // Whiteboard with a hand-drawn plan of the heist, on the west wall.
  frame(-18.6, 7, -35, 9, 4.6, white, true);
  for (let i = 0; i < 5; i++) box(-18.5, 6 + i * 0.55, -38.5 + i * 0.9, 0.04, 0.12, 2 + (i % 3), i % 2 ? p.blue : p.coral);
  // Bookshelf and planter beyond the office glass.
  kit.place({ prop: 'Bookshelf', x: 17.6, z: -33 }); collide(17.6, 5, -33, 2, 10, 7);

  kit.place({ prop: 'Plant', x: 15.5, z: -40.5, scale: 0.85 }); kit.place({ prop: 'Plant', x: 15.8, z: -28.5, scale: 0.65 });
  box(1, 0.06, -35, 18, 0.02, 0.3, mustard); box(1, 0.06, -35.6, 18, 0.02, 0.15, p.paint);
  pendant(-4, -34); pendant(7, -32);

  // ---------- 03 SERVER GALLERY ----------
  // Overhead cable trays (wayfinding: "follow the cable trays") lead north toward the maintenance shelf.
  for (const x of [-9, 14]) {
    box(x, 12.4, -14, 2, 0.12, 22, p.metal);
    for (const dx of [-0.95, 0.95]) box(x + dx, 12.65, -14, 0.08, 0.5, 22, p.metal);
    for (let i = 0; i < 4; i++) cyl(x - 0.6 + i * 0.4, 12.62, -14, 22, 0.24, 0.24, i % 2 ? p.blue : cable, 6).rotation.x = Math.PI / 2;
  }
  // Glowing LED bars on the rack faces (cold aisle) and amber backs, all one merged mesh per colour.
  for (const [z, x, width] of [[-21, -4, 16], [-13, 7, 22]] as const) {
    for (let dx = -width / 2 + 1.2; dx < width / 2; dx += 2.4) {
      box(x + dx, 7.55, z - 1.38, 1.4, 0.08, 0.03, cyanLed);
      box(x + dx, 7.55, z + 1.38, 1.4, 0.08, 0.03, amberLed);
    }
    box(x, 7.85, z, width, 0.12, 2.8, p.metal);
  }
  // Perforated cold-aisle tiles and a yellow keep-clear floor line.
  for (let x = -11; x <= 17; x += 2.4) box(x, 0.02, -17, 2.2, 0.025, 2.2, x % 4.8 ? p.blue : p.metal);
  box(3, 0.04, -24.5, 30, 0.02, 0.25, yellow); box(3, 0.04, -9, 30, 0.02, 0.25, yellow);
  // Precision cooling units and copper refrigerant runs on the east wall.
  for (const z of [-22, -9]) {
    kit.place({ prop: 'Cooling', x: 17.4, z }); collide(17.4, 5, z, 2.4, 10, 5);

  }
  for (const y of [11.2, 11.7]) cyl(18.3, y, -15.5, 20, 0.3, 0.3, copper, 8).rotation.x = Math.PI / 2;
  pendant(-4, -17, 8); pendant(8, -9, 8);

  // ---------- ESCAPE SPINE / SERVICE ----------
  // Exposed services along the west wall: copper and blue pipes, storage shelving with colourful bins.
  for (const [y, m] of [[12.2, copper], [11.6, p.blue], [11.0, copper]] as const) {
    cyl(-18.4, y, -20, 80, 0.35, 0.35, m, 8).rotation.x = Math.PI / 2;
  }
  for (const z of [-46, -24, -2]) {
    kit.place({ prop: 'Shelving', x: -18.2, z }); collide(-18.25, 6, z, 1.1, 12, 6);

  }
  // Robotics-lab finish for the spine: oak wainscot + aluminium rail on both walls, warm wall washers,
  // a ceiling cable tray, and two planters at the pickup end. All merged; nothing enters the flight lane.
  const glow = make('wall-washer', '#FFF1D6', 0.6, 0, '#FFD9A0');
  for (const [x0, z0, z1] of [[-12.32, -56, 0.5], [-12.32, 1.5, 8.6], [-18.62, -60, 10]] as const) {
    const dir = x0 > -15 ? -1 : 1;
    for (let z = z0; z < z1 - 0.5; z += 4) {
      const len = Math.min(3.85, z1 - z);
      box(x0, 1.5, z + len / 2, 0.12, 2.9, len - 0.1, p.wood);
    }
    box(x0 + dir * 0.06, 3.05, (z0 + z1) / 2, 0.14, 0.12, z1 - z0, p.metal);
    box(x0 + dir * 0.04, 0.12, (z0 + z1) / 2, 0.12, 0.24, z1 - z0, p.dark);
  }
  for (let z = -52; z <= 6; z += 12) {
    box(-12.45, 8.2, z, 0.12, 0.45, 2.6, glow);
    box(-12.33, 8.2, z, 0.1, 0.7, 2.9, p.metal);
  }
  box(-13, 12.6, -24, 0.9, 0.08, 72, p.metal);
  for (const dx of [-0.25, 0, 0.22]) cyl(-13 + dx, 12.72, -24, 72, 0.12, 0.12, cable, 6).rotation.x = Math.PI / 2;
  for (const z of [-58, -50]) kit.place({ prop: 'Plant', x: -18, z });
  // Painted chevrons on the escape floor, pointing toward pickup.
  for (let z = 10; z > -58; z -= 12) {
    for (const s of [-1, 1]) box(-15.5 + s * 1.2, 0.03, z, 2, 0.02, 0.35, yellow, s * 0.7);
  }
  // Extraction pad: hazard border.
  for (let i = 0; i < 6; i++) box(-17.6 + i * 1.05, 0.18, -64.7, 0.5, 0.04, 0.4, yellow, 0.6);

  const merged: Mesh[] = [];
  for (const [material, meshes] of groups) {
    const m = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!m) continue;
    m.name = `dressing-${material.name}`; m.material = material; m.isPickable = false;
    m.receiveShadows = true; m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true;
    merged.push(m);
  }
  // Freeze static dressing materials whose properties do not change at runtime.
  for (const mat of [mustard, teal, pink, yellow, white, cyanLed, amberLed, copper, cable, glow]) mat.freeze();
  return merged;
}

/** Merge decorative, physics-free meshes that share a material. Animated or interactive meshes are skipped. */
export function mergeDecorative(scene: Scene, names: string[]): number {
  const byMat = new Map<Material, Mesh[]>();
  for (const mesh of scene.meshes) {
    if (!(mesh instanceof Mesh) || !names.includes(mesh.name) || mesh.physicsBody || !mesh.material) continue;
    const list = byMat.get(mesh.material) ?? []; list.push(mesh); byMat.set(mesh.material, list);
  }
  let removed = 0;
  for (const [material, meshes] of byMat) {
    if (meshes.length < 2) continue;
    const m = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!m) continue;
    removed += meshes.length - 1;
    m.name = `merged-${material.name}`; m.material = material; m.isPickable = false;
    m.receiveShadows = true; m.freezeWorldMatrix();
  }
  return removed;
}
