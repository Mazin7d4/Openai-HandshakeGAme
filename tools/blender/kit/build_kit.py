"""Master script for generating the room, props, and vault kit GLBs.
Run: ~/.local/bin/blender -b --factory-startup --python tools/blender/kit/build_kit.py -- [--sheet <png path>]
"""
import sys
import math
import json
import argparse
from pathlib import Path

import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[3]
ASSETS_DIR = REPO_ROOT / 'public/assets/kit'
MANIFEST_DIR = REPO_ROOT / 'src/level/kit'
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
MANIFEST_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Argument Parsing
# ---------------------------------------------------------------------------
argv = sys.argv
script_args = []
if '--' in argv:
    script_args = argv[argv.index('--') + 1:]

parser = argparse.ArgumentParser(description='Build 3D asset kit')
parser.add_argument('--sheet', type=str, default=None, help='Output path for contact sheet PNG')
args = parser.parse_args(script_args)

# ---------------------------------------------------------------------------
# Clean scene
# ---------------------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials):
    bpy.data.materials.remove(m)
for img in list(bpy.data.images):
    bpy.data.images.remove(img)

# ---------------------------------------------------------------------------
# Helpers & Color conversion
# ---------------------------------------------------------------------------
def hex_to_rgb(hex_str):
    """Convert sRGB hex string (#RRGGBB) to 0.0-1.0 float tuple."""
    hex_str = hex_str.lstrip('#')
    return tuple(int(hex_str[i:i+2], 16) / 255.0 for i in (0, 2, 4))

# Swatch definitions
ATLAS_SPECS = [
    # Row 0
    ('porcelain', '#E5E1D5', 0.42, 0.0),
    ('paper', '#F4EFE6', 0.45, 0.0),
    ('resin', '#B9BBB1', 0.60, 0.0),
    ('sage', '#728D83', 0.50, 0.0),
    ('oak', '#BE9162', 0.50, 0.0),
    ('oakGrain', '#D3B28C', 0.50, 0.0),
    ('alu', '#A7B6B5', 0.32, 0.85),
    ('aluDark', '#7E8C8B', 0.35, 0.85),
    # Row 1
    ('graphite', '#263737', 0.55, 0.0),
    ('rubber', '#1E2A2B', 0.85, 0.0),
    ('bluePoly', '#89949B', 0.35, 0.0),
    ('coralPoly', '#A89D8F', 0.35, 0.0),
    ('terracotta', '#A19585', 0.75, 0.0),
    ('leaf', '#818B7C', 0.60, 0.0),
    ('leafLight', '#9CA590', 0.60, 0.0),
    ('cardboard', '#AB9B86', 0.80, 0.0),
    # Row 2
    ('amberPaint', '#A8A398', 0.45, 0.0),
    ('exitGreen', '#A4AAA0', 0.40, 0.0),
    ('gold', '#A8A091', 0.25, 0.90),
    ('steel', '#8F9A9C', 0.30, 0.90),
    ('fabric', '#8E9A93', 0.90, 0.0),
    ('waterBlue', '#ADB8BB', 0.20, 0.0),
    ('red', '#9E9188', 0.45, 0.0),
    ('white', '#FAFAF7', 0.40, 0.0),
]

EMISSIVE_SPECS = [
    ('screenWarm', '#DCDAD1'),
    ('diffuser', '#D8D6CC'),
    ('lensAmber', '#A8A398'),
    ('exitGreen', '#A4AAA0'),
    ('coreMint', '#B4BCB7'),
    ('ledGreen', '#A4AAA0'),
    ('screenDark', '#142022'),
    ('beaconAmber', '#A8A398'),
]

ATLAS_CELLS = {}
for idx, (name, hex_val, rough, metal) in enumerate(ATLAS_SPECS):
    col = idx % 8
    row = idx // 8
    ATLAS_CELLS[name] = (col, row, hex_to_rgb(hex_val), rough, metal)

EMISSIVE_CELLS = {}
for idx, (name, hex_val) in enumerate(EMISSIVE_SPECS):
    col = idx % 8
    row = 0
    EMISSIVE_CELLS[name] = (col, row, hex_to_rgb(hex_val))

# ---------------------------------------------------------------------------
# Texture Atlas Generation
# ---------------------------------------------------------------------------
W, H = 256, 256
CELL_SIZE = 32

# 1. kit_atlas_base & kit_atlas_mr
img_base = bpy.data.images.new('kit_atlas_base', W, H)
img_base.colorspace_settings.name = 'sRGB'
pixels_base = [1.0, 1.0, 1.0, 1.0] * (W * H)

img_mr = bpy.data.images.new('kit_atlas_mr', W, H)
img_mr.colorspace_settings.name = 'Non-Color'
pixels_mr = [1.0, 0.5, 0.0, 1.0] * (W * H)

for name, (col, row, rgb, rough, metal) in ATLAS_CELLS.items():
    # row 0 is top (py in 224..255)
    py_start = (7 - row) * CELL_SIZE
    px_start = col * CELL_SIZE
    for dy in range(CELL_SIZE):
        py = py_start + dy
        for dx in range(CELL_SIZE):
            px = px_start + dx
            idx = (py * W + px) * 4
            pixels_base[idx] = rgb[0]
            pixels_base[idx + 1] = rgb[1]
            pixels_base[idx + 2] = rgb[2]
            pixels_base[idx + 3] = 1.0

            pixels_mr[idx] = 1.0        # R channel
            pixels_mr[idx + 1] = rough  # G channel = roughness
            pixels_mr[idx + 2] = metal  # B channel = metallic
            pixels_mr[idx + 3] = 1.0

img_base.pixels = pixels_base
img_base.pack()

img_mr.pixels = pixels_mr
img_mr.pack()

# 2. kit_atlas_emit
img_emit = bpy.data.images.new('kit_atlas_emit', W, H)
img_emit.colorspace_settings.name = 'sRGB'
pixels_emit = [0.0, 0.0, 0.0, 1.0] * (W * H)

for name, (col, row, rgb) in EMISSIVE_CELLS.items():
    py_start = (7 - row) * CELL_SIZE
    px_start = col * CELL_SIZE
    for dy in range(CELL_SIZE):
        py = py_start + dy
        for dx in range(CELL_SIZE):
            px = px_start + dx
            idx = (py * W + px) * 4
            pixels_emit[idx] = rgb[0]
            pixels_emit[idx + 1] = rgb[1]
            pixels_emit[idx + 2] = rgb[2]
            pixels_emit[idx + 3] = 1.0

# Bottom-right 2x2 cells (cols 6..7, rows 6..7 => px: 192..255, py: 0..63)
# Contain warm-white background #DCDAD1 with dot-matrix 9x9 power-plug glyph #1E2A2B
bg_plug = hex_to_rgb('#DCDAD1')
dot_plug = hex_to_rgb('#1E2A2B')

# 9x9 power plug dot matrix pattern (gy=8 top, gy=0 bottom)
# prongs at col 2 and 6
plug_dots = set()
# Prongs
plug_dots.update([(2, 8), (6, 8), (2, 7), (6, 7)])
# Plug body
for gy in (3, 4, 5, 6):
    for gx in range(1, 8):
        plug_dots.add((gx, gy))
# Bottom taper
for gx in range(2, 7):
    plug_dots.add((gx, 2))
# Cord
plug_dots.add((4, 1))
plug_dots.add((4, 0))

# Pitch 6px, centered in 64px: gx=0..8 -> cx = 8 + gx*6
for py_rel in range(64):
    py = py_rel
    for px_rel in range(64):
        px = 192 + px_rel
        idx = (py * W + px) * 4

        # Check if inside any dot
        is_glyph = False
        for gx, gy in plug_dots:
            cx = 8.0 + gx * 6.0
            cy = 8.0 + gy * 6.0
            dist_sq = (px_rel - cx) ** 2 + (py_rel - cy) ** 2
            if dist_sq <= 2.2 ** 2:
                is_glyph = True
                break

        col_val = dot_plug if is_glyph else bg_plug
        pixels_emit[idx] = col_val[0]
        pixels_emit[idx + 1] = col_val[1]
        pixels_emit[idx + 2] = col_val[2]
        pixels_emit[idx + 3] = 1.0

img_emit.pixels = pixels_emit
img_emit.pack()

# ---------------------------------------------------------------------------
# Exactly 4 Materials Creation
# ---------------------------------------------------------------------------
# 1. KitAtlas
mat_atlas = bpy.data.materials.new('KitAtlas')
mat_atlas.use_nodes = True
bsdf_atlas = mat_atlas.node_tree.nodes.get('Principled BSDF')

tex_atlas_base = mat_atlas.node_tree.nodes.new('ShaderNodeTexImage')
tex_atlas_base.image = img_base
tex_atlas_base.interpolation = 'Closest'
mat_atlas.node_tree.links.new(tex_atlas_base.outputs['Color'], bsdf_atlas.inputs['Base Color'])

tex_atlas_mr = mat_atlas.node_tree.nodes.new('ShaderNodeTexImage')
tex_atlas_mr.image = img_mr
tex_atlas_mr.interpolation = 'Closest'
sep_atlas = mat_atlas.node_tree.nodes.new('ShaderNodeSeparateColor')
mat_atlas.node_tree.links.new(tex_atlas_mr.outputs['Color'], sep_atlas.inputs['Color'])
mat_atlas.node_tree.links.new(sep_atlas.outputs['Green'], bsdf_atlas.inputs['Roughness'])
mat_atlas.node_tree.links.new(sep_atlas.outputs['Blue'], bsdf_atlas.inputs['Metallic'])

# 2. KitEmissive
mat_emit = bpy.data.materials.new('KitEmissive')
mat_emit.use_nodes = True
bsdf_emit = mat_emit.node_tree.nodes.get('Principled BSDF')

tex_emit = mat_emit.node_tree.nodes.new('ShaderNodeTexImage')
tex_emit.image = img_emit
tex_emit.interpolation = 'Closest'
mat_emit.node_tree.links.new(tex_emit.outputs['Color'], bsdf_emit.inputs['Base Color'])
mat_emit.node_tree.links.new(tex_emit.outputs['Color'], bsdf_emit.inputs['Emission Color'])
bsdf_emit.inputs['Emission Strength'].default_value = 0.0

# 3. KitGlass
mat_glass = bpy.data.materials.new('KitGlass')
mat_glass.use_nodes = True
bsdf_glass = mat_glass.node_tree.nodes.get('Principled BSDF')
glass_rgb = hex_to_rgb('#E8F0EE')
bsdf_glass.inputs['Base Color'].default_value = (*glass_rgb, 1.0)
bsdf_glass.inputs['Alpha'].default_value = 0.3
bsdf_glass.inputs['Roughness'].default_value = 0.35
bsdf_glass.inputs['Metallic'].default_value = 0.0
mat_glass.blend_method = 'BLEND'
mat_glass.use_backface_culling = False

# 4. KitGlassClear
mat_clear = bpy.data.materials.new('KitGlassClear')
mat_clear.use_nodes = True
bsdf_clear = mat_clear.node_tree.nodes.get('Principled BSDF')
clear_rgb = hex_to_rgb('#F4FAF8')
bsdf_clear.inputs['Base Color'].default_value = (*clear_rgb, 1.0)
bsdf_clear.inputs['Alpha'].default_value = 0.16
bsdf_clear.inputs['Roughness'].default_value = 0.05
bsdf_clear.inputs['Metallic'].default_value = 0.0
mat_clear.blend_method = 'BLEND'
mat_clear.use_backface_culling = False

# ---------------------------------------------------------------------------
# Helper API
# ---------------------------------------------------------------------------
pending_parts = []
manifest_assets = []

def sw(name):
    """Return (material, cell) for the given swatch name."""
    if name in ATLAS_CELLS:
        col, row, _, _, _ = ATLAS_CELLS[name]
        return (mat_atlas, (col, row))
    if name in EMISSIVE_CELLS:
        col, row, _ = EMISSIVE_CELLS[name]
        return (mat_emit, (col, row))
    if name in ('glass', 'KitGlass'):
        return (mat_glass, None)
    if name in ('glassClear', 'KitGlassClear'):
        return (mat_clear, None)
    raise ValueError(f"Unknown swatch name: {name}")

def resolve_swatch(swatch):
    if isinstance(swatch, str):
        return sw(swatch)
    return swatch

def assign_uv_cell(obj, cell):
    """Collapse all UVs of obj to the cell center."""
    if cell is None:
        return
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if not uv_layer:
        uv_layer = mesh.uv_layers.new(name='UVMap')
    col, row = cell
    u_center = (col + 0.5) / 8.0
    v_center = (7 - row + 0.5) / 8.0
    for loop in uv_layer.data:
        loop.uv = (u_center, v_center)

ROOM_SEG = False

def box(name_part, center, size, swatch, bevel=0.01, seg=2):
    """Create a box part, apply bevel and weighted normals, and assign swatch."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    obj = bpy.context.object
    obj.name = name_part
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    if ROOM_SEG:
        seg = 1
    if bevel and bevel > 0.0001:
        max_b = min(size) * 0.45
        b_width = min(bevel, max_b)
        if b_width > 0.0001:
            b = obj.modifiers.new('b', 'BEVEL')
            b.width = b_width
            b.segments = seg
            b.limit_method = 'ANGLE'
            b.use_clamp_overlap = True
            bpy.ops.object.modifier_apply(modifier=b.name)
            w = obj.modifiers.new('w', 'WEIGHTED_NORMAL')
            w.keep_sharp = True
            bpy.ops.object.modifier_apply(modifier=w.name)

    mat, cell = resolve_swatch(swatch)
    obj.data.materials.append(mat)
    assign_uv_cell(obj, cell)
    if name_part == 'HackTerminal_Screen':
        # Planar-map the front onto the plug-icon region of kit_atlas_emit (px 192-256, py 0-64).
        uv = obj.data.uv_layers.active
        xs = [v.co.x for v in obj.data.vertices]; zs = [v.co.z for v in obj.data.vertices]
        x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
        for poly in obj.data.polygons:
            for li in poly.loop_indices:
                co = obj.data.vertices[obj.data.loops[li].vertex_index].co
                uv.data[li].uv = (0.75 + 0.25 * (co.x - x0) / max(x1 - x0, 1e-6), 0.25 * (co.z - z0) / max(z1 - z0, 1e-6))
    for f in obj.data.polygons:
        f.use_smooth = True

    pending_parts.append(obj)
    return obj

def cyl(name_part, center, r, h, swatch, v=16, r2=None, rot=None):
    """Create a cylinder part, smooth shade, and assign swatch."""
    if rot is None:
        rot = (0.0, 0.0, 0.0)
    bpy.ops.mesh.primitive_cone_add(
        vertices=v,
        radius1=r2 if r2 is not None else r,
        radius2=r,
        depth=h,
        location=center,
        rotation=rot
    )
    obj = bpy.context.object
    obj.name = name_part
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    mat, cell = resolve_swatch(swatch)
    obj.data.materials.append(mat)
    assign_uv_cell(obj, cell)
    for f in obj.data.polygons:
        f.use_smooth = True

    pending_parts.append(obj)
    return obj

def tube_along_curve(points, radius, swatch, res=2):
    """Create a low-poly tube curve converted to mesh."""
    curve_data = bpy.data.curves.new('Tube', type='CURVE')
    curve_data.dimensions = '3D'
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = res

    spline = curve_data.splines.new(type='POLY')
    spline.points.add(len(points) - 1)
    for i, pt in enumerate(points):
        spline.points[i].co = (*pt, 1.0)

    curve_obj = bpy.data.objects.new('TubeObj', curve_data)
    bpy.context.collection.objects.link(curve_obj)
    bpy.context.view_layer.objects.active = curve_obj
    curve_obj.select_set(True)

    bpy.ops.object.convert(target='MESH')
    mesh_obj = bpy.context.object

    mat, cell = resolve_swatch(swatch)
    mesh_obj.data.materials.append(mat)
    assign_uv_cell(mesh_obj, cell)
    for f in mesh_obj.data.polygons:
        f.use_smooth = True

    pending_parts.append(mesh_obj)
    return mesh_obj

def commit(name, category, custom_footprint=None):
    """Join all pending parts per material under Kit_<name> empty and record manifest entry."""
    global pending_parts
    root = bpy.data.objects.new('Kit_' + name, None)
    bpy.context.collection.objects.link(root)

    by_mat = {}
    for part in pending_parts:
        mat = part.data.materials[0]
        by_mat.setdefault(mat.name, []).append(part)

    joined_objs = []
    for mat_name, objs in by_mat.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = f'{name}_{mat_name}'
        joined.parent = root

        for f in joined.data.polygons:
            f.use_smooth = True

        wn = joined.modifiers.new('w', 'WEIGHTED_NORMAL')
        wn.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=wn.name)
        joined_objs.append(joined)

    # Compute tris
    total_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in joined_objs)

    # Compute bounds and footprint in Blender coordinates (metres)
    all_verts = [v.co for o in joined_objs for v in o.data.vertices]
    if all_verts:
        min_bx = min(v.x for v in all_verts)
        max_bx = max(v.x for v in all_verts)
        min_by = min(v.y for v in all_verts)
        max_by = max(v.y for v in all_verts)
        min_bz = min(v.z for v in all_verts)
        max_bz = max(v.z for v in all_verts)
    else:
        min_bx = max_bx = min_by = max_by = min_bz = max_bz = 0.0

    # Bounds in game units after x5 scale, glTF axes: x=bx*5, y-up=bz*5, z=-by*5
    # glTF Z = -by * 5, so min_gz corresponds to -max_by * 5, max_gz to -min_by * 5
    min_gx = min_bx * 5.0
    max_gx = max_bx * 5.0
    min_gy = min_bz * 5.0
    max_gy = max_bz * 5.0
    min_gz = -max_by * 5.0
    max_gz = -min_by * 5.0

    bounds = {
        'min': [round(min_gx, 3), round(min_gy, 3), round(min_gz, 3)],
        'max': [round(max_gx, 3), round(max_gy, 3), round(max_gz, 3)]
    }

    if custom_footprint:
        footprint = {'w': custom_footprint[0], 'd': custom_footprint[1]}
    else:
        footprint = {'w': round(max_bx - min_bx, 3), 'd': round(max_by - min_by, 3)}

    glb_map = {
        'room': 'assets/kit/room-kit.glb',
        'prop': 'assets/kit/props-kit.glb',
        'vault': 'assets/kit/vault-kit.glb',
    }

    entry = {
        'name': name,
        'category': category,
        'glb': glb_map[category],
        'materials': sorted(list(by_mat.keys())),
        'tris': total_tris,
        'bounds': bounds,
        'footprint': footprint,
        'gridSnap': True if category == 'room' else False
    }
    manifest_assets.append(entry)

    # Check tri limit warnings
    if category == 'room' and total_tris > 300:
        print(f"WARNING: room piece {name} tri count {total_tris} > 300")
    elif (category in ('prop', 'vault')) and total_tris > 1500:
        print(f"WARNING: {category} asset {name} tri count {total_tris} > 1500")

    pending_parts = []
    return root

# ---------------------------------------------------------------------------
# Room Kit (category 'room')
# ---------------------------------------------------------------------------
def build_room_kit():
    global ROOM_SEG
    ROOM_SEG = True
    # 1. WallStraight (1 m long, 3.0 m tall, 0.12 m thick)
    box('Wall_Skirting', (0.0, 0.0, 0.075), (1.0, 0.124, 0.15), 'oak', bevel=0.005)
    box('Wall_Body', (0.0, 0.0, 1.575), (1.0, 0.12, 2.85), 'porcelain', bevel=0.008)
    commit('WallStraight', 'room', custom_footprint=(1.0, 0.12))

    # 2. WallStraight2 (2 m long)
    box('Wall2_Skirting', (0.0, 0.0, 0.075), (2.0, 0.124, 0.15), 'oak', bevel=0.005)
    box('Wall2_Body', (0.0, 0.0, 1.575), (2.0, 0.12, 2.85), 'porcelain', bevel=0.008)
    commit('WallStraight2', 'room', custom_footprint=(2.0, 0.12))

    # 3. WallCorner (L, 1x1 outer)
    # Leg 1 along X (-0.5 to 0.5, Y in 0.38..0.50, center Y=0.44)
    box('Corner_X_Skirt', (0.0, 0.44, 0.075), (1.0, 0.124, 0.15), 'oak', bevel=0.005)
    box('Corner_X_Body', (0.0, 0.44, 1.575), (1.0, 0.12, 2.85), 'porcelain', bevel=0.008)
    # Leg 2 along Y (-0.5 to 0.38, X in 0.38..0.50, center X=0.44, length=0.88)
    box('Corner_Y_Skirt', (0.44, -0.06, 0.075), (0.124, 0.88, 0.15), 'oak', bevel=0.005)
    box('Corner_Y_Body', (0.44, -0.06, 1.575), (0.12, 0.88, 2.85), 'porcelain', bevel=0.008)
    commit('WallCorner', 'room', custom_footprint=(1.0, 1.0))

    # 4. WallDoor (2 m wide, 1.0x2.2 m opening, alu trim)
    # Left wall (-1.0 to -0.5, center -0.75, width 0.5)
    box('Door_Left_Skirt', (-0.75, 0.0, 0.075), (0.5, 0.124, 0.15), 'oak', bevel=0.005)
    box('Door_Left_Body', (-0.75, 0.0, 1.575), (0.5, 0.12, 2.85), 'porcelain', bevel=0.008)
    # Right wall (0.5 to 1.0, center 0.75, width 0.5)
    box('Door_Right_Skirt', (0.75, 0.0, 0.075), (0.5, 0.124, 0.15), 'oak', bevel=0.005)
    box('Door_Right_Body', (0.75, 0.0, 1.575), (0.5, 0.12, 2.85), 'porcelain', bevel=0.008)
    # Lintel (-0.5 to 0.5, center 0, width 1.0, Z 2.2 to 3.0, center 2.6)
    box('Door_Lintel', (0.0, 0.0, 2.6), (1.0, 0.12, 0.8), 'porcelain', bevel=0.008)
    # Alu trim frame around door opening
    box('Door_Jamb_L', (-0.48, 0.0, 1.1), (0.04, 0.13, 2.2), 'alu', bevel=0.004)
    box('Door_Jamb_R', (0.48, 0.0, 1.1), (0.04, 0.13, 2.2), 'alu', bevel=0.004)
    box('Door_Header', (0.0, 0.0, 2.18), (1.0, 0.13, 0.04), 'alu', bevel=0.004)
    commit('WallDoor', 'room', custom_footprint=(2.0, 0.12))

    # 5. WallWindow (2 m wide, window 1.4x1.2 m at sill 0.9 m, alu frame + KitGlass pane)
    # Bottom wall (Z 0 to 0.9)
    box('Win_Bottom_Skirt', (0.0, 0.0, 0.075), (2.0, 0.124, 0.15), 'oak', bevel=0.005)
    box('Win_Bottom_Body', (0.0, 0.0, 0.525), (2.0, 0.12, 0.75), 'porcelain', bevel=0.008)
    # Top wall (Z 2.1 to 3.0, center 2.55, height 0.9)
    box('Win_Top_Body', (0.0, 0.0, 2.55), (2.0, 0.12, 0.9), 'porcelain', bevel=0.008)
    # Left wall (-1.0 to -0.7, width 0.3, center -0.85, Z 0.9 to 2.1, center 1.5, height 1.2)
    box('Win_Left_Body', (-0.85, 0.0, 1.5), (0.3, 0.12, 1.2), 'porcelain', bevel=0.008)
    # Right wall (0.7 to 1.0, width 0.3, center 0.85, Z 0.9 to 2.1)
    box('Win_Right_Body', (0.85, 0.0, 1.5), (0.3, 0.12, 1.2), 'porcelain', bevel=0.008)
    # Alu frame trim
    box('Win_Frame_B', (0.0, 0.0, 0.9), (1.44, 0.13, 0.04), 'alu', bevel=0.004)
    box('Win_Frame_T', (0.0, 0.0, 2.1), (1.44, 0.13, 0.04), 'alu', bevel=0.004)
    box('Win_Frame_L', (-0.68, 0.0, 1.5), (0.04, 0.13, 1.16), 'alu', bevel=0.004)
    box('Win_Frame_R', (0.68, 0.0, 1.5), (0.04, 0.13, 1.16), 'alu', bevel=0.004)
    # KitGlass pane
    box('Win_Glass_Pane', (0.0, 0.0, 1.5), (1.36, 0.01, 1.16), 'KitGlass', bevel=0)
    commit('WallWindow', 'room', custom_footprint=(2.0, 0.12))

    # 6. FloorTile (1x1 resin, 0.02 thick, subtle 4 mm bevel)
    box('Floor_Tile', (0.0, 0.0, 0.01), (1.0, 1.0, 0.02), 'resin', bevel=0.004)
    commit('FloorTile', 'room', custom_footprint=(1.0, 1.0))

    # 7. FloorTileOak (1x1 oak)
    box('Floor_Oak', (0.0, 0.0, 0.01), (1.0, 1.0, 0.02), 'oak', bevel=0.004)
    commit('FloorTileOak', 'room', custom_footprint=(1.0, 1.0))

    # 8. CeilingTile (1x1 porcelain with a recessed edge)
    box('Ceiling_Lip', (0.0, 0.0, 0.004), (1.0, 1.0, 0.008), 'porcelain', bevel=0)
    box('Ceiling_Drop', (0.0, 0.0, 0.018), (0.94, 0.94, 0.02), 'porcelain', bevel=0.004)
    commit('CeilingTile', 'room', custom_footprint=(1.0, 1.0))

    # 9. TrimStrip (1 m oak skirting 0.08 tall + alu cap)
    box('Trim_Oak', (0.0, 0.0, 0.035), (1.0, 0.02, 0.07), 'oak', bevel=0.003)
    box('Trim_Alu', (0.0, 0.0, 0.075), (1.0, 0.022, 0.01), 'alu', bevel=0.002)
    commit('TrimStrip', 'room', custom_footprint=(1.0, 0.022))

    # 10. Vent (0.6x0.4 alu grille with 6 slats, wall-mount)
    # Frame
    box('Vent_Frame_T', (0.0, 0.0, 0.38), (0.6, 0.03, 0.04), 'alu', bevel=0.003)
    box('Vent_Frame_B', (0.0, 0.0, 0.02), (0.6, 0.03, 0.04), 'alu', bevel=0.003)
    box('Vent_Frame_L', (-0.28, 0.0, 0.2), (0.04, 0.03, 0.32), 'alu', bevel=0.003)
    box('Vent_Frame_R', (0.28, 0.0, 0.2), (0.04, 0.03, 0.32), 'alu', bevel=0.003)
    # Recessed backing
    box('Vent_Back', (0.0, 0.01, 0.2), (0.54, 0.008, 0.34), 'graphite', bevel=0)
    # 6 slats
    for i in range(6):
        z_slat = 0.065 + i * 0.05
        box(f'Vent_Slat_{i}', (0.0, -0.004, z_slat), (0.54, 0.018, 0.006), 'alu', bevel=0.001)
    commit('Vent', 'room', custom_footprint=(0.6, 0.03))

    # 11. CableTray (1 m alu ladder tray, ceiling-hung on 2 rods)
    # Side rails
    box('Tray_Rail_L', (0.0, -0.135, 0.02), (1.0, 0.03, 0.04), 'alu', bevel=0.003)
    box('Tray_Rail_R', (0.0, 0.135, 0.02), (1.0, 0.03, 0.04), 'alu', bevel=0.003)
    # 5 rungs
    for r_idx, rx in enumerate((-0.4, -0.2, 0.0, 0.2, 0.4)):
        box(f'Tray_Rung_{r_idx}', (rx, 0.0, 0.01), (0.02, 0.24, 0.015), 'alu', bevel=0.002)
    # 2 hanger rods
    cyl('Tray_Rod_1', (-0.3, 0.0, 0.32), 0.008, 0.6, 'alu', v=12)
    cyl('Tray_Rod_2', (0.3, 0.0, 0.32), 0.008, 0.6, 'alu', v=12)
    commit('CableTray', 'room', custom_footprint=(1.0, 0.3))

    # 12. CableRun (2 m, 3 graphite rubber cables sagging between two clips — curves, never straight)
    box('Cable_Clip_L', (-0.98, 0.0, 0.25), (0.04, 0.08, 0.06), 'aluDark', bevel=0.003)
    box('Cable_Clip_R', (0.98, 0.0, 0.25), (0.04, 0.08, 0.06), 'aluDark', bevel=0.003)
    pts1 = [(-0.98, -0.022, 0.25), (-0.5, -0.022, 0.19), (0.0, -0.022, 0.16), (0.5, -0.022, 0.19), (0.98, -0.022, 0.25)]
    pts2 = [(-0.98, 0.0, 0.25), (-0.5, 0.0, 0.16), (0.0, 0.0, 0.12), (0.5, 0.0, 0.16), (0.98, 0.0, 0.25)]
    pts3 = [(-0.98, 0.022, 0.25), (-0.5, 0.022, 0.18), (0.0, 0.022, 0.15), (0.5, 0.022, 0.18), (0.98, 0.022, 0.25)]
    tube_along_curve(pts1, 0.009, 'rubber', res=2)
    tube_along_curve(pts2, 0.010, 'graphite', res=2)
    tube_along_curve(pts3, 0.008, 'rubber', res=2)
    commit('CableRun', 'room', custom_footprint=(2.0, 0.08))

    # 13. Pillar (0.4x0.4x3.0 porcelain with alu corner guards)
    box('Pillar_Body', (0.0, 0.0, 1.5), (0.4, 0.4, 3.0), 'porcelain', bevel=0.01)
    for c_idx, (cx, cy) in enumerate([(-0.19, -0.19), (0.19, -0.19), (-0.19, 0.19), (0.19, 0.19)]):
        box(f'Pillar_Guard_{c_idx}', (cx, cy, 0.6), (0.03, 0.03, 1.2), 'alu', bevel=0.003)
    commit('Pillar', 'room', custom_footprint=(0.4, 0.4))

    # 14. GlassPartition (1 m wide x 2.4 m, alu top/bottom rails 3 cm + KitGlass pane)
    box('Part_Rail_B', (0.0, 0.0, 0.015), (1.0, 0.04, 0.03), 'alu', bevel=0.003)
    box('Part_Rail_T', (0.0, 0.0, 2.385), (1.0, 0.04, 0.03), 'alu', bevel=0.003)
    box('Part_Post_L', (-0.485, 0.0, 1.2), (0.03, 0.04, 2.34), 'alu', bevel=0.003)
    box('Part_Post_R', (0.485, 0.0, 1.2), (0.03, 0.04, 2.34), 'alu', bevel=0.003)
    box('Part_Glass', (0.0, 0.0, 1.2), (0.94, 0.01, 2.34), 'KitGlass', bevel=0)
    commit('GlassPartition', 'room', custom_footprint=(1.0, 0.04))

# ===== PROPS (chunk B) =====
def build_props():
    global ROOM_SEG
    ROOM_SEG = False
    """Builds props kit assets: Desk here, the rest in kit_props_a.py / kit_props_b.py."""
    import sys, importlib
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    box('Desk_Top', (0.0, 0.0, 0.735), (1.6, 0.8, 0.03), 'oak', bevel=0.005)
    box('Desk_Frame', (0.0, 0.0, 0.70), (1.44, 0.68, 0.04), 'alu', bevel=0.003)
    for lx in (-0.72, 0.72):
        for ly in (-0.34, 0.34):
            box('Desk_Leg', (lx, ly, 0.355), (0.04, 0.04, 0.69), 'alu', bevel=0.003, seg=1)
    commit('Desk', 'prop', custom_footprint=(1.6, 0.8))
    for mod_name in ('kit_props_a', 'kit_props_b'):
        try:
            mod = importlib.import_module(mod_name)
        except ModuleNotFoundError:
            print(f'WARNING: {mod_name}.py missing, skipped'); continue
        mod.build(box=box, cyl=cyl, tube=tube_along_curve, commit=commit)

# ---------------------------------------------------------------------------
# Vault Kit (category 'vault')
# ---------------------------------------------------------------------------
def build_vault_kit():
    # 16. VaultDoor (round 1.8 m dia steel door 0.35 thick, spoke wheel handle + hinge block)
    # Round door disc centered at (0, 0, 1.2) facing -Y
    rot_y = (math.pi / 2.0, 0.0, 0.0)
    cyl('Door_Disc', (0.0, 0.0, 1.2), 0.9, 0.32, 'steel', v=24, rot=rot_y)
    cyl('Door_Bezel', (0.0, -0.165, 1.2), 0.915, 0.03, 'aluDark', v=24, rot=rot_y)
    # Central spoke wheel hub
    cyl('Door_Hub', (0.0, -0.19, 1.2), 0.09, 0.05, 'steel', v=16, rot=rot_y)
    # Spokes radiating to radius 0.35 m
    for s_idx in range(5):
        ang = s_idx * (2.0 * math.pi / 5.0)
        sx = math.cos(ang) * 0.18
        sz = 1.2 + math.sin(ang) * 0.18
        box(f'Door_Spoke_{s_idx}', (sx, -0.195, sz), (0.03, 0.025, 0.32), 'steel', bevel=0.003)
    # Hand wheel outer ring
    for r_idx in range(8):
        ang = r_idx * (2.0 * math.pi / 8.0)
        rx = math.cos(ang) * 0.35
        rz = 1.2 + math.sin(ang) * 0.35
        cyl(f'Door_Rim_{r_idx}', (rx, -0.20, rz), 0.02, 0.025, 'steel', v=8, rot=rot_y)
    # Hinge block on left
    box('Door_Hinge_Body', (-0.93, 0.0, 1.2), (0.16, 0.36, 0.6), 'steel', bevel=0.01)
    box('Door_Hinge_Pin1', (-0.93, 0.0, 0.96), (0.18, 0.38, 0.12), 'graphite', bevel=0.005)
    box('Door_Hinge_Pin2', (-0.93, 0.0, 1.44), (0.18, 0.38, 0.12), 'graphite', bevel=0.005)
    commit('VaultDoor', 'vault', custom_footprint=(1.8, 0.38))

    # 17. VaultFrame (square 2.4x2.4 graphite/steel frame ring around 1.9 m round opening)
    # Create outer cube
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 1.2))
    outer_box = bpy.context.object
    outer_box.name = 'Frame_Outer'
    outer_box.dimensions = (2.4, 0.4, 2.4)
    bpy.ops.object.transform_apply(scale=True)

    # Boolean cutter cylinder (1.9 m dia => 0.95 m radius)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.95, depth=0.45, location=(0.0, 0.0, 1.2), rotation=(math.pi/2, 0, 0))
    cyl_cut = bpy.context.object
    bpy.ops.object.transform_apply(rotation=True, scale=True)

    b_mod = outer_box.modifiers.new('cutter', 'BOOLEAN')
    b_mod.object = cyl_cut
    b_mod.operation = 'DIFFERENCE'
    b_mod.solver = 'EXACT'
    bpy.context.view_layer.objects.active = outer_box
    bpy.ops.object.modifier_apply(modifier=b_mod.name)
    bpy.data.objects.remove(cyl_cut)

    outer_box.data.materials.append(mat_atlas)
    assign_uv_cell(outer_box, ATLAS_CELLS['graphite'][:2])
    for f in outer_box.data.polygons:
        f.use_smooth = True
    pending_parts.append(outer_box)

    # Steel inner bezel/collar
    for b_idx in range(16):
        ang = b_idx * (2.0 * math.pi / 16.0)
        bx = math.cos(ang) * 0.95
        bz = 1.2 + math.sin(ang) * 0.95
        cyl(f'Frame_Collar_{b_idx}', (bx, -0.205, bz), 0.035, 0.03, 'steel', v=8, rot=rot_y)

    commit('VaultFrame', 'vault', custom_footprint=(2.4, 0.4))

    # 18. VaultBolts (ring of 12 locking bolt cylinders, separate so they can animate)
    for i in range(12):
        ang = i * (2.0 * math.pi / 12.0)
        # Radius 0.91 m, bolts point radially outward
        r_bolt = 0.91
        bx = math.cos(ang) * r_bolt
        bz = 1.2 + math.sin(ang) * r_bolt
        # Radial orientation Euler
        rot_bolt = (0.0, math.pi / 2.0 - ang, 0.0)
        cyl(f'Bolt_{i}', (bx, 0.0, bz), 0.035, 0.14, 'steel', v=12, rot=rot_bolt)
    commit('VaultBolts', 'vault', custom_footprint=(2.0, 0.15))

    # 19. VaultPedestal (oak + alu pedestal 0.9 tall, 0.6 dia, amber-free mint LED ring at top)
    cyl('Pedestal_Base', (0.0, 0.0, 0.03), 0.31, 0.06, 'alu', v=20)
    cyl('Pedestal_Col', (0.0, 0.0, 0.46), 0.28, 0.80, 'oak', v=20)
    cyl('Pedestal_Rim', (0.0, 0.0, 0.87), 0.30, 0.02, 'alu', v=20)
    cyl('Pedestal_Led', (0.0, 0.0, 0.89), 0.295, 0.02, 'coreMint', v=20)
    commit('VaultPedestal', 'vault', custom_footprint=(0.62, 0.62))

    # 20. VaultJar (bell jar shell KitGlassClear 0.35 dia x 0.5 tall on alu base ring + alu knob)
    cyl('Jar_Base_Ring', (0.0, 0.0, 0.0125), 0.19, 0.025, 'alu', v=20)
    cyl('Jar_Rim_Opaque', (0.0, 0.0, 0.0325), 0.178, 0.015, 'alu', v=20)
    # Bell jar shell in KitGlassClear
    cyl('Jar_Glass_Body', (0.0, 0.0, 0.245), 0.175, 0.41, 'KitGlassClear', v=20)
    cyl('Jar_Glass_Dome', (0.0, 0.0, 0.465), 0.175, 0.05, 'KitGlassClear', v=20, r2=0.10)
    # Small alu knob on top
    cyl('Jar_Knob', (0.0, 0.0, 0.505), 0.025, 0.03, 'alu', v=12)
    commit('VaultJar', 'vault', custom_footprint=(0.38, 0.38))

    # 21. VaultCore (0.12 m rounded cube in KitEmissive coreMint)
    box('Core_Body', (0.0, 0.0, 0.06), (0.12, 0.12, 0.12), 'coreMint', bevel=0.02, seg=2)
    commit('VaultCore', 'vault', custom_footprint=(0.12, 0.12))

# ---------------------------------------------------------------------------
# Build All Assets
# ---------------------------------------------------------------------------
build_room_kit()
build_props()
build_vault_kit()

# ---------------------------------------------------------------------------
# Scale roots x5 and export GLBs
# ---------------------------------------------------------------------------
# Reset roots to origin and apply x5 scale
for asset_entry in manifest_assets:
    root = bpy.data.objects.get('Kit_' + asset_entry['name'])
    if root:
        root.location = (0.0, 0.0, 0.0)
        root.scale = (5.0, 5.0, 5.0)
        bpy.ops.object.select_all(action='DESELECT')
        root.select_set(True)
        bpy.context.view_layer.objects.active = root
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for child in root.children:
            bpy.ops.object.select_all(action='DESELECT')
            child.select_set(True)
            bpy.context.view_layer.objects.active = child
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Export GLBs by category
categories = [
    ('room', ASSETS_DIR / 'room-kit.glb'),
    ('prop', ASSETS_DIR / 'props-kit.glb'),
    ('vault', ASSETS_DIR / 'vault-kit.glb'),
]

for cat_name, glb_path in categories:
    bpy.ops.object.select_all(action='DESELECT')
    cat_roots = [
        bpy.data.objects.get('Kit_' + a['name'])
        for a in manifest_assets if a['category'] == cat_name
    ]
    for r in cat_roots:
        if r:
            r.select_set(True)
            for ch in r.children:
                ch.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        use_selection=True,
        export_image_format='AUTO',
        export_draco_mesh_compression_enable=False,
        export_materials='EXPORT',
    )

# ---------------------------------------------------------------------------
# Write Manifest
# ---------------------------------------------------------------------------
sorted_assets = sorted(manifest_assets, key=lambda a: (a['category'], a['name']))

manifest_data = {
    'version': 1,
    'unitsPerMetre': 5,
    'generatedBy': 'tools/blender/kit/build_kit.py',
    'files': {
        'room': 'assets/kit/room-kit.glb',
        'prop': 'assets/kit/props-kit.glb',
        'vault': 'assets/kit/vault-kit.glb',
    },
    'assets': sorted_assets
}

manifest_file = MANIFEST_DIR / 'kit-manifest.json'
with open(manifest_file, 'w', encoding='utf-8') as f:
    json.dump(manifest_data, f, indent=2)

# Print Summary Table
print(f"{'NAME':<20} {'CATEGORY':<10} {'TRIS':>6}  {'MATS'}")
for a in sorted_assets:
    mats_str = ','.join(a['materials'])
    print(f"{a['name']:<20} {a['category']:<10} {a['tris']:>6}  {mats_str}")

print(f"KIT_COMPLETE assets={len(sorted_assets)}")

# ---------------------------------------------------------------------------
# Contact Sheet Rendering (only if --sheet provided)
# ---------------------------------------------------------------------------
if args.sheet:
    sheet_path = Path(args.sheet).resolve()
    sheet_path.parent.mkdir(parents=True, exist_ok=True)

    # Scale back by 0.2 to restore real-world metre scale for contact rendering
    for asset_entry in manifest_assets:
        root = bpy.data.objects.get('Kit_' + asset_entry['name'])
        if root:
            root.scale = (0.2, 0.2, 0.2)
            bpy.ops.object.select_all(action='DESELECT')
            root.select_set(True)
            bpy.context.view_layer.objects.active = root
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            for child in root.children:
                bpy.ops.object.select_all(action='DESELECT')
                child.select_set(True)
                bpy.context.view_layer.objects.active = child
                bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Grid layout: 8 columns, spacing by max footprint
    # Room pieces in first rows, then props, then vault
    room_assets = [a for a in manifest_assets if a['category'] == 'room']
    prop_assets = [a for a in manifest_assets if a['category'] == 'prop']
    vault_assets = [a for a in manifest_assets if a['category'] == 'vault']

    grid_layout = []
    COLS = 10
    row = 0
    for group in (room_assets, prop_assets, vault_assets):
        for idx, a in enumerate(group):
            grid_layout.append((a['name'], idx % COLS, row + idx // COLS))
        row += (len(group) + COLS - 1) // COLS
    n_rows = row

    step_x = 2.6
    step_y = 2.8

    for name, col_idx, row_idx in grid_layout:
        root = bpy.data.objects.get('Kit_' + name)
        if root:
            x_pos = (col_idx - 4.5) * step_x
            y_pos = -row_idx * step_y
            root.location = (x_pos, y_pos, 0.0)

            # Add Text object label on the floor in front of each asset
            bpy.ops.object.text_add(location=(x_pos, y_pos - 1.15, 0.005))
            txt_obj = bpy.context.object
            txt_obj.name = 'Label_' + name
            txt_obj.data.body = name
            txt_obj.data.size = 0.15
            txt_obj.data.align_x = 'CENTER'
            txt_obj.data.align_y = 'TOP'

            # Assign graphite material to label
            label_mat = bpy.data.materials.get('SheetLabel')
            if label_mat is None:
                label_mat = bpy.data.materials.new('SheetLabel'); label_mat.use_nodes = True
                label_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.03, 0.03, 1)
                label_mat.diffuse_color = (0.02, 0.03, 0.03, 1)
            txt_obj.data.materials.append(label_mat)

    # Large resin floor plane
    bpy.ops.mesh.primitive_plane_add(size=120.0, location=(0.0, -10.0, -0.001))
    floor_obj = bpy.context.object
    floor_obj.name = 'ContactFloor'
    floor_obj.data.materials.append(mat_atlas)
    assign_uv_cell(floor_obj, ATLAS_CELLS['resin'][:2])

    # Sun light (warm #D8D6CC, angle 2 deg)
    sun_data = bpy.data.lights.new('Sun', type='SUN')
    sun_data.color = hex_to_rgb('#D8D6CC')
    sun_data.angle = math.radians(2.0)
    sun_data.energy = 2.5
    sun_obj = bpy.data.objects.new('Sun', sun_data)
    bpy.context.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(50.0), math.radians(25.0), math.radians(-20.0))

    # World colour #E5E1D5 strength 0.6
    world = bpy.context.scene.world
    if not world:
        world = bpy.data.worlds.new('World')
        bpy.context.scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get('Background')
    if bg_node:
        bg_node.inputs['Color'].default_value = (*hex_to_rgb('#E5E1D5'), 1.0)
        bg_node.inputs['Strength'].default_value = 0.6

    # Orthographic camera looking down at ~55 deg from the front fitting the whole grid
    cam_data = bpy.data.cameras.new('ContactCam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 28.0
    cam_obj = bpy.data.objects.new('ContactCam', cam_data)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    # Center camera over grid
    cy = -(n_rows - 1) * step_y / 2.0
    cam_obj.location = (0.0, cy - 30.0 * math.sin(math.radians(38.0)) - 0.6, 30.0 * math.cos(math.radians(38.0)))
    cam_obj.rotation_euler = (math.radians(38.0), 0.0, 0.0)

    # Render settings
    scene = bpy.context.scene
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1600
    scene.render.filepath = str(sheet_path)

    # Render engine fallback logic
    import ctypes.util
    has_egl = ctypes.util.find_library('EGL') is not None

    rendered = False
    if has_egl:
        try:
            scene.render.engine = 'BLENDER_EEVEE_NEXT'
            bpy.ops.render.render(write_still=True)
            rendered = True
        except Exception as e:
            print(f"BLENDER_EEVEE_NEXT render failed: {e}")

        if not rendered:
            try:
                scene.render.engine = 'BLENDER_WORKBENCH'
                scene.display.shading.color_type = 'TEXTURE'
                scene.display.shading.light = 'STUDIO'
                bpy.ops.render.render(write_still=True)
                rendered = True
            except Exception as e:
                print(f"BLENDER_WORKBENCH render failed: {e}")

    if not rendered:
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 16
        scene.cycles.use_denoising = False
        bpy.ops.render.render(write_still=True)

    print(f"Contact sheet rendered to {sheet_path}")
