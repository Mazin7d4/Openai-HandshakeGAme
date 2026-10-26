import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { createLabPalette } from './LabPalette.ts';
import type { PropPlacement } from './PropKit.ts';

type Palette = ReturnType<typeof createLabPalette>;

/**
 * Decorative, collision-free set dressing for reception, vent, office and server gallery.
 * Everything is batched per material and merged into a handful of static meshes, so the extra detail
 * costs roughly one draw call per material. Nothing here owns physics, mission or network state, and
 * all props sit outside the authored flight routes (under-desk crawl, vent, office door, rack aisles).
 */
export function dressMissionAreas(scene: Scene, p: Palette, kit: { place(p: PropPlacement): unknown }): Mesh[] {
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
  const apronWainscot = make('apron-wainscot', '#CFC9BB', 0.85);
  const cork = make('cork', '#B98E62', 0.95);

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
    box(x, 8.25, z, len, 0.28, 1.1, p.metal);
    box(x, 8.09, z, len - 0.3, 0.04, 0.85, p.light);
    for (const dx of [-len / 2 + 0.6, len / 2 - 0.6]) box(x + dx, 8.7, z, 0.03, 0.9, 0.03, cable);
  };

  // ---------- 00 DELIVERY APRON ----------
  // Base trims: oak skirting board (0.5 tall, 0.12 deep) and brushed-alu chair rail at y≈4.2
  // on all apron wall faces, skipping the doorway gap.
  // South wall (inner face z=-66.7):
  box(0, 0.25, -66.62, 37.4, 0.5, 0.12, p.wood);
  // East wall (inner face x=18.7):
  box(18.62, 0.25, -60.975, 0.12, 0.5, 11.45, p.wood);
  box(18.62, 4.2, -60.975, 0.12, 0.12, 11.45, p.metal);
  // North entry wall (inner face z=-55.25):
  // East of doorway gap x[-6..3]:
  box(10.85, 0.25, -55.33, 15.7, 0.5, 0.12, p.wood);
  box(10.85, 4.2, -55.33, 15.7, 0.12, 0.12, p.metal);
  // West of doorway gap:
  box(-9.0, 0.25, -55.33, 6.0, 0.5, 0.12, p.wood);
  box(-9.0, 4.2, -55.33, 6.0, 0.12, 0.12, p.metal);
  // West wall south of the entry partition:
  box(-18.62, 0.25, -63.35, 0.12, 0.5, 6.7, p.wood);
  box(-18.62, 4.2, -63.35, 0.12, 0.12, 6.7, p.metal);

  // Lower wainscot panels (apron-wainscot #CFC9BB, roughness 0.85) 0.06 deep from floor to chair rail (y=4.2)
  // on south and east walls, split into 6-unit panels with 0.1 graphite shadow gaps.
  // South wall: 6 panels across 37.16 span (-18.58 to 18.58), 5 shadow gaps of 0.1.
  const southPanelW = 6.11;
  const southGapW = 0.1;
  for (let i = 0; i < 6; i++) {
    const px = -15.525 + i * (southPanelW + southGapW);
    box(px, 1.2, -66.65, southPanelW, 2.4, 0.06, apronWainscot);
    if (i < 5) {
      const gx = -12.42 + i * (southPanelW + southGapW);
      box(gx, 1.2, -66.655, southGapW, 2.4, 0.05, p.dark);
    }
  }
  // East wall: 2 panels across 11.37 span (-66.62 to -55.25), 1 shadow gap of 0.1.
  const eastPanelW = 5.635;
  const eastGapW = 0.1;
  for (let i = 0; i < 2; i++) {
    const pz = -63.74 + i * (eastPanelW + eastGapW);
    box(18.65, 2.1, pz, 0.06, 4.2, eastPanelW, apronWainscot);
    if (i === 0) {
      box(18.655, 2.1, -60.935, 0.05, 4.2, eastGapW, p.dark);
    }
  }

  // Wall-mounted everyday props:
  // (South wall is the low camera-side dollhouse cut: no wall clock or sconces on it.)

  // Fire extinguisher on alu bracket beside the entry (north wall, east of doorway at x=3.8):
  box(3.8, 3.0, -55.28, 0.3, 1.2, 0.04, p.metal);
  box(3.8, 3.1, -55.45, 0.55, 0.06, 0.35, p.metal);
  cyl(3.8, 2.9, -55.55, 1.3, 0.52, 0.52, p.dark);
  cyl(3.8, 3.6, -55.55, 0.12, 0.32, 0.52, p.dark);
  cyl(3.8, 2.9, -55.55, 0.48, 0.54, 0.54, white); // paper-white label band
  box(3.8, 3.75, -55.55, 0.14, 0.18, 0.18, p.metal);
  box(3.8, 3.86, -55.50, 0.06, 0.04, 0.30, p.metal);
  box(4.02, 3.25, -55.55, 0.05, 0.9, 0.05, cable);
  cyl(4.02, 2.7, -55.55, 0.2, 0.06, 0.1, p.dark);

  // Light switch plate and thermostat by doorway (north wall, west of doorway at x=-6.8):
  box(-6.8, 3.2, -55.28, 0.35, 0.5, 0.04, p.paint);
  box(-6.8, 3.2, -55.31, 0.14, 0.22, 0.03, white);
  box(-6.8, 3.2, -55.33, 0.14, 0.02, 0.01, p.dark);
  box(-6.8, 3.8, -55.28, 0.48, 0.48, 0.04, white);
  cyl(-6.8, 3.8, -55.31, 0.03, 0.4, 0.4, p.metal, 24).rotation.x = Math.PI / 2;
  cyl(-6.8, 3.8, -55.33, 0.02, 0.3, 0.3, p.dark, 24).rotation.x = Math.PI / 2;
  box(-6.8, 3.8, -55.345, 0.1, 0.03, 0.01, p.light);

  // Cork notice board with paper sheets and push pins on the east wall:
  box(18.64, 6.0, -58.5, 0.08, 2.1, 3.3, p.wood);
  box(18.62, 6.0, -58.5, 0.06, 1.9, 3.1, cork);
  box(18.575, 6.4, -59.3, 0.015, 0.65, 0.5, white);
  box(18.575, 6.3, -58.5, 0.015, 0.75, 0.55, white);
  box(18.575, 6.35, -57.8, 0.015, 0.6, 0.5, yellow, 0.08);
  box(18.575, 5.5, -59.1, 0.015, 0.5, 0.7, white);
  box(18.575, 5.45, -58.1, 0.015, 0.45, 0.45, white, -0.06);
  cyl(18.555, 6.68, -59.3, 0.03, 0.04, 0.04, p.dark, 8).rotation.z = Math.PI / 2;
  cyl(18.555, 6.62, -58.5, 0.03, 0.04, 0.04, yellow, 8).rotation.z = Math.PI / 2;
  cyl(18.555, 6.60, -57.8, 0.03, 0.04, 0.04, p.metal, 8).rotation.z = Math.PI / 2;
  cyl(18.555, 5.70, -59.1, 0.03, 0.04, 0.04, p.dark, 8).rotation.z = Math.PI / 2;
  cyl(18.555, 5.63, -58.1, 0.03, 0.04, 0.04, yellow, 8).rotation.z = Math.PI / 2;

  // Wall-mounted parcel shelf with 3 cardboard boxes (mustard/oak tones) high on east wall (y≈7.5):
  box(18.0, 7.5, -63.5, 1.36, 0.08, 4.5, p.metal);
  for (const bz of [-65.0, -62.0]) {
    box(18.65, 7.0, bz, 0.06, 0.9, 0.12, p.metal);
    box(18.05, 7.42, bz, 1.25, 0.08, 0.12, p.metal);
    const brace = box(18.3, 7.15, bz, 0.85, 0.06, 0.1, p.metal);
    brace.rotation.z = -Math.PI / 4;
  }
  box(18.0, 7.94, -64.7, 1.0, 0.8, 1.1, mustard);
  box(18.0, 7.95, -64.7, 1.02, 0.06, 0.15, p.paint);
  box(18.0, 8.04, -63.4, 1.1, 1.0, 1.3, p.wood);
  box(18.0, 8.05, -63.4, 1.12, 0.06, 0.16, mustard);
  box(18.0, 7.89, -62.1, 0.9, 0.7, 0.9, mustard);
  box(18.0, 7.90, -62.1, 0.92, 0.05, 0.12, p.paint);

  // Floor: painted floor tape (white, 0.15 wide, y=0.02) framing the apron 1.5 units in from the walls,
  // with a gap at the doorway x[-6..3].
  box(0, 0.02, -65.2, 34.4, 0.02, 0.15, white); // south line (z = -66.7 + 1.5)
  box(17.2, 0.02, -60.975, 0.15, 0.02, 8.45, white); // east line (x = 18.7 - 1.5)
  box(10.1, 0.02, -56.75, 14.2, 0.02, 0.15, white); // north line east of doorway
  box(-11.6, 0.02, -56.75, 11.2, 0.02, 0.15, white); // north line west of doorway
  box(-17.2, 0.02, -60.975, 0.15, 0.02, 8.45, white); // west line (x = -18.7 + 1.5)

  // ---------- 01 RECEPTION ----------
  kit.place({ prop: 'Plant', x: 15.5, z: -52, scale: 1.05 }); kit.place({ prop: 'Plant', x: -9.5, z: -52.5, scale: 0.8 });
  // Lounge: a long mustard sofa and a low oak coffee table against the east wall.
  kit.place({ prop: 'Sofa', x: 16.4, z: -47.5, ry: -Math.PI / 2 });

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
  // Floor: oak entry mat.
  box(-1.5, 0.02, -53, 8, 0.03, 3, p.dark);

  // ---------- VENT / OFFICE DIVIDER ----------
  // Louvre slats left and right of the opening, with a duct kept below the cutaway.
  for (let y = 5.4; y < 8; y += 0.45) {
    for (const x of [-9.6, -0.6]) box(x, y, -43.35, 3.6, 0.1, 0.2, p.metal);
  }
  kit.place({ prop: 'Duct', x: -5, y: 8.2, z: -43, ry: Math.PI / 2, scale: 0.9 });
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
  kit.place({ prop: 'Bookshelf', x: 17.6, z: -33 });

  kit.place({ prop: 'Plant', x: 15.5, z: -40.5, scale: 0.85 }); kit.place({ prop: 'Plant', x: 15.8, z: -28.5, scale: 0.65 });
  box(1, 0.06, -35, 18, 0.02, 0.3, mustard); box(1, 0.06, -35.6, 18, 0.02, 0.15, p.paint);
  pendant(-4, -34); pendant(7, -32);

  // ---------- 03 SERVER GALLERY ----------
  // Overhead cable trays stay below the cutaway cap.
  for (const x of [-9, 14]) {
    box(x, 8.25, -14, 2, 0.12, 22, p.metal);
    for (const dx of [-0.95, 0.95]) box(x + dx, 8.5, -14, 0.08, 0.5, 22, p.metal);
    for (let i = 0; i < 4; i++) cyl(x - 0.6 + i * 0.4, 8.47, -14, 22, 0.24, 0.24, i % 2 ? p.blue : cable, 6).rotation.x = Math.PI / 2;
  }
  // Glowing LED bars on the rack faces (cold aisle) and amber backs, all one merged mesh per colour.
  for (const x of [-8.5, 8.5] as const) {
    for (let z = -22.5; z <= -9.5; z += 2.4) {
      box(x, 5.55, z - 1.38, 1.4, 0.08, 0.03, cyanLed);
      box(x, 5.55, z + 1.38, 1.4, 0.08, 0.03, amberLed);
    }
    box(x, 5.85, -16, 3, 0.12, 14, p.metal);
  }
  // Perforated cold-aisle tiles and subtle north-south architectural LED strips.
  for (let x = -11; x <= 17; x += 2.4) box(x, 0.02, -17, 2.2, 0.025, 2.2, x % 4.8 ? p.blue : p.metal);
  const coldAisle = make('cold-aisle-led', '#4A5D91', 0.55, 0, '#536DD1');
  box(-2, 0.045, -16, 0.12, 0.03, 14, coldAisle); box(2, 0.045, -16, 0.12, 0.03, 14, coldAisle);
  // Precision cooling units and copper refrigerant runs on the east wall.
  for (const z of [-22, -9]) {
    kit.place({ prop: 'Cooling', x: 17.4, z });

  }
  for (const y of [7.8, 8.3]) cyl(18.3, y, -15.5, 20, 0.3, 0.3, copper, 8).rotation.x = Math.PI / 2;
  pendant(-4, -17, 8); pendant(8, -9, 8);

  // ---------- 06 LOADING DOCK ----------
  const kraft = make('dock-kraft', '#B98D61', 0.9);
  const concrete = make('dock-concrete', '#8A8178', 0.9);
  const dockMark = make('dock-marking', '#D7B46A', 0.65, 0, '#5A4325');
  box(-14, 0.08, 29, 7, 0.05, 0.18, dockMark);
  box(-14, 0.08, 30, 7, 0.05, 0.18, dockMark);
  for (const [x, z, w, d] of [[-12, 38.5, 2.4, 1.6], [-8, 43, 2.8, 2], [5, 30, 2.2, 1.6]] as const) {
    box(x, 1.15, z, w, 2.2, d, kraft);
    box(x, 2.28, z, w + 0.08, 0.08, d + 0.08, concrete);
  }
  for (const z of [37, 39, 41, 43, 45]) box(-17.9, 1.7, z, 0.08, 3.2, 0.1, concrete);

  const merged: Mesh[] = [];
  for (const [material, meshes] of groups) {
    const m = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!m) continue;
    m.name = `dressing-${material.name}`; m.material = material; m.isPickable = false;
    m.receiveShadows = true; m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true;
    merged.push(m);
  }
  // Freeze static dressing materials whose properties do not change at runtime.
  for (const mat of [mustard, teal, pink, yellow, white, cyanLed, amberLed, copper, cable, apronWainscot, cork, kraft, concrete, dockMark, coldAisle]) mat.freeze();
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
