"""
Builds the PIX / NEE mascot drone from the approved character sheet and writes
public/assets/drone/drone.blend + drone.glb.

Run headless:
  blender -b --python tools/blender/build_drone.py -- <output-dir>

Conventions (Blender space): +Z up, drone faces -Y (Blender front), +X is the
drone's left. The glTF exporter converts to Y-up with the front on +Z, which is
what Babylon's glTF loader presents as +Z forward in a left-handed scene.

Named objects: Body, FaceScreen, Antenna, HoverPod_FL/FR/BL/BR, TetherSocket.
Every child is parented to Body with a clean pivot: pods pivot at their mount,
the antenna at its base, the socket at the body's back surface.

Materials (shared, swapped per player in Babylon by name):
  Shell, Accent, Glow, Screen, DarkMetal, FaceRim
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------- #
# Dimensions (metres). Slightly wider than tall, like the sheet (28 x 22 x 24).
# --------------------------------------------------------------------------- #
BODY_W = 1.26  # x
BODY_D = 1.04  # y
BODY_H = 0.84  # z
BODY_R = 0.22  # corner radius -> squircle silhouette
BODY_SEGS = 10

SCREEN_W = 0.94
SCREEN_H = 0.54
SCREEN_R = 0.15
SCREEN_DEPTH = 0.05
SCREEN_PROTRUDE = 0.035
SCREEN_Z = 0.02

POD_X = 0.56
POD_Y = 0.38
POD_MOUNT_Z = -0.45
POD_RADIUS = 0.15
POD_HEIGHT = 0.14
POD_TILT = math.radians(14)

ANTENNA_BASE = Vector((0.0, 0.10, 0.43))
ANTENNA_LEN = 0.24
ANTENNA_TILT = math.radians(12)

SOCKET_Y = BODY_D / 2


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def make_material(name, base, roughness, metallic=0.0, emission=None, strength=0.0, coat=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.08
    return mat


def bm_rounded_box(w, d, h, r, segs, profile=0.55):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    r = min(r, w / 2 - 1e-3, d / 2 - 1e-3, h / 2 - 1e-3)
    bmesh.ops.bevel(
        bm,
        geom=list(bm.edges) + list(bm.verts),
        offset=r,
        segments=segs,
        profile=profile,
        affect="EDGES",
        clamp_overlap=True,
    )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_cylinder(radius, height, segments=32, radius2=None):
    """Cylinder along +Z, base at z=0, top at z=height."""
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        radius1=radius,
        radius2=radius if radius2 is None else radius2,
        depth=height,
    )
    bmesh.ops.translate(bm, vec=(0, 0, height / 2), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_sphere(radius, u=24, v=14):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_torus(major, minor, seg_major=36, seg_minor=12):
    """Torus in the XY plane around +Z."""
    bm = bmesh.new()
    rings = []
    for i in range(seg_major):
        a = 2 * math.pi * i / seg_major
        ring = []
        for j in range(seg_minor):
            b = 2 * math.pi * j / seg_minor
            rad = major + minor * math.cos(b)
            ring.append(bm.verts.new((rad * math.cos(a), rad * math.sin(a), minor * math.sin(b))))
        rings.append(ring)
    for i in range(seg_major):
        for j in range(seg_minor):
            v1 = rings[i][j]
            v2 = rings[(i + 1) % seg_major][j]
            v3 = rings[(i + 1) % seg_major][(j + 1) % seg_minor]
            v4 = rings[i][(j + 1) % seg_minor]
            bm.faces.new((v1, v2, v3, v4))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_rounded_rect_slab(w, h, r, depth, corner_segs=8, rim=0.012, rim_segs=3):
    """Rounded rectangle in the XZ plane, extruded along -Y from y=0 to y=-depth.
    Front face is at y=-depth (the drone's front)."""
    bm = bmesh.new()
    hw, hh = w / 2, h / 2
    r = min(r, hw - 1e-3, hh - 1e-3)
    centers = [(hw - r, hh - r), (-hw + r, hh - r), (-hw + r, -hh + r), (hw - r, -hh + r)]
    starts = [0.0, math.pi / 2, math.pi, 3 * math.pi / 2]
    verts = []
    for (cx, cz), start in zip(centers, starts):
        for k in range(corner_segs + 1):
            a = start + (math.pi / 2) * k / corner_segs
            verts.append(bm.verts.new((cx + r * math.cos(a), 0.0, cz + r * math.sin(a))))
    # Remove duplicate corner joins (each arc ends where the next starts along straight edges, fine as-is)
    face = bm.faces.new(verts)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, -depth, 0), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if rim > 0:
        bmesh.ops.bevel(
            bm,
            geom=list(bm.edges),
            offset=rim,
            segments=rim_segs,
            profile=0.6,
            affect="EDGES",
            clamp_overlap=True,
        )
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def rounded_rect_points(w, h, r, corner_segs=8):
    """Perimeter used by the face-glass trim in the XZ plane."""
    hw, hh = w / 2, h / 2
    r = min(r, hw - 1e-3, hh - 1e-3)
    centers = [(hw - r, hh - r), (-hw + r, hh - r), (-hw + r, -hh + r), (hw - r, -hh + r)]
    starts = [0.0, math.pi / 2, math.pi, 3 * math.pi / 2]
    return [
        (cx + r * math.cos(start + (math.pi / 2) * k / corner_segs),
         cz + r * math.sin(start + (math.pi / 2) * k / corner_segs))
        for (cx, cz), start in zip(centers, starts)
        for k in range(corner_segs + 1)
    ]


def bm_rounded_rect_frame(w, h, r, border, depth=0.012, corner_segs=10):
    """Thin rounded frame in the XZ plane; just enough geometry to catch a rim light."""
    bm = bmesh.new()
    outer = rounded_rect_points(w, h, r, corner_segs)
    inner = rounded_rect_points(w - border * 2, h - border * 2, r - border, corner_segs)
    front_outer = [bm.verts.new((x, -depth, z)) for x, z in outer]
    front_inner = [bm.verts.new((x, -depth, z)) for x, z in inner]
    back_outer = [bm.verts.new((x, 0, z)) for x, z in outer]
    back_inner = [bm.verts.new((x, 0, z)) for x, z in inner]
    count = len(outer)
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((front_outer[i], front_outer[j], front_inner[j], front_inner[i]))
        bm.faces.new((back_inner[i], back_inner[j], back_outer[j], back_outer[i]))
        bm.faces.new((front_outer[j], front_outer[i], back_outer[i], back_outer[j]))
        bm.faces.new((front_inner[i], front_inner[j], back_inner[j], back_inner[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def append_part(target, part, matrix=Matrix.Identity(4), material_index=0):
    """Bake `part` into `target` with a transform and material slot index."""
    for f in part.faces:
        f.material_index = material_index
    part.transform(matrix)
    tmp = bpy.data.meshes.new("tmp")
    part.to_mesh(tmp)
    part.free()
    target.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)


def finish_object(name, bm, materials, location=Vector((0, 0, 0)), sharp_angle=math.radians(38)):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if e.is_boundary or len(e.link_faces) != 2:
            continue
        if e.calc_face_angle(0.0) > sharp_angle:
            e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    me.validate()
    me.update()
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def rot_x(angle):
    return Matrix.Rotation(angle, 4, "X")


def rot_y(angle):
    return Matrix.Rotation(angle, 4, "Y")


def tr(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def build(out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    shell = make_material("Shell", (0.93, 0.905, 0.85), roughness=0.42, coat=0.35)
    accent = make_material("Accent", (0.10, 0.50, 1.00), roughness=0.30, coat=0.4)
    glow = make_material("Glow", (0.35, 0.80, 1.00), roughness=0.4, emission=(0.35, 0.82, 1.0), strength=4.0)
    screen = make_material("Screen", (0.008, 0.008, 0.011), roughness=0.08, coat=0.6)
    dark = make_material("DarkMetal", (0.12, 0.13, 0.15), roughness=0.45, metallic=0.55)
    face_rim = make_material("FaceRim", (0.62, 0.68, 0.74), roughness=0.24, metallic=0.62, coat=0.35)

    # ---------------- Body ----------------
    body_mats = [shell, accent, dark]
    SHELL, ACCENT, DARK = 0, 1, 2
    bm = bmesh.new()

    append_part(bm, bm_rounded_box(BODY_W, BODY_D, BODY_H, BODY_R, BODY_SEGS), material_index=SHELL)

    # Dark underbelly plate the pods mount to.
    append_part(bm, bm_rounded_box(1.05, 0.84, 0.12, 0.06, 5), tr(0, 0, -0.43), material_index=DARK)

    # Two shallow top-shell panel breaks. Kept sparse so the mascot stays clean.
    for y, width in ((-0.16, 0.66), (0.13, 0.78)):
        seam = bm_rounded_box(width, 0.012, 0.008, 0.004, 2)
        append_part(bm, seam, tr(0, y, BODY_H / 2 + 0.001), material_index=DARK)

    # Side accent discs with a dark hub (the ring on the side view of the sheet).
    for sx in (-1, 1):
        disc = bm_cylinder(0.17, 0.05, 48)
        m = tr(sx * (BODY_W / 2 - 0.035), 0.04, 0.0) @ rot_y(sx * math.pi / 2)
        append_part(bm, disc, m, material_index=ACCENT)
        hub = bm_cylinder(0.09, 0.07, 32)
        m = tr(sx * (BODY_W / 2 - 0.035), 0.04, 0.0) @ rot_y(sx * math.pi / 2)
        append_part(bm, hub, m, material_index=DARK)
        ring = bm_torus(0.125, 0.012, 48, 8)
        m = tr(sx * (BODY_W / 2 + 0.016), 0.04, 0.0) @ rot_y(math.pi / 2)
        append_part(bm, ring, m, material_index=DARK)

    # Dark bezel the screen sits in.
    bezel = bm_rounded_rect_slab(SCREEN_W + 0.04, SCREEN_H + 0.04, SCREEN_R + 0.02, 0.03, rim=0.006, rim_segs=2)
    append_part(bm, bezel, tr(0, -BODY_D / 2 + 0.015, SCREEN_Z), material_index=DARK)

    # Pod arms (short stubs from the belly to each pod mount).
    for sx in (-1, 1):
        for sy in (-1, 1):
            arm = bm_cylinder(0.05, 0.14, 16)
            append_part(bm, arm, tr(sx * POD_X, sy * POD_Y, POD_MOUNT_Z - 0.01), material_index=DARK)

    # Antenna base.
    append_part(bm, bm_cylinder(0.06, 0.035, 24), tr(*ANTENNA_BASE) @ tr(0, 0, -0.012), material_index=DARK)

    # Small top accent strip (status light bar behind the antenna).
    strip = bm_rounded_box(0.26, 0.05, 0.03, 0.012, 3)
    append_part(bm, strip, tr(0, 0.26, BODY_H / 2 - 0.004), material_index=ACCENT)

    body = finish_object("Body", bm, body_mats)

    # ---------------- FaceScreen ----------------
    bm = bmesh.new()
    slab = bm_rounded_rect_slab(SCREEN_W, SCREEN_H, SCREEN_R, SCREEN_DEPTH, corner_segs=10, rim=0.014, rim_segs=3)
    # Planar UVs along -Y so Babylon can draw the eyes on an emissive texture.
    uv_layer = slab.loops.layers.uv.new("UVMap")
    for f in slab.faces:
        for loop in f.loops:
            co = loop.vert.co
            # +X is the drone's left; flip U so the texture reads left->right from the drone's front.
            u = 1.0 - (co.x + SCREEN_W / 2) / SCREEN_W
            v = (co.z + SCREEN_H / 2) / SCREEN_H
            loop[uv_layer].uv = (min(max(u, 0.0), 1.0), min(max(v, 0.0), 1.0))
    append_part(bm, slab, Matrix.Identity(4), material_index=0)
    # Copy the UV layer name onto the merged bmesh (from_mesh keeps layers).
    screen_origin = Vector((0.0, -BODY_D / 2 - SCREEN_PROTRUDE + SCREEN_DEPTH, SCREEN_Z))
    face_screen = finish_object("FaceScreen", bm, [screen], location=screen_origin)

    # A hairline metallic surround catches the studio light without changing the face silhouette.
    bm = bm_rounded_rect_frame(SCREEN_W + 0.052, SCREEN_H + 0.052, SCREEN_R + 0.026, 0.016)
    face_rim_obj = finish_object(
        "FaceRim",
        bm,
        [face_rim],
        location=Vector((0.0, -BODY_D / 2 - SCREEN_PROTRUDE - 0.010, SCREEN_Z)),
    )

    # ---------------- Antenna ----------------
    bm = bmesh.new()
    stem = bm_cylinder(0.016, ANTENNA_LEN, 12)
    append_part(bm, stem, rot_x(-ANTENNA_TILT), material_index=0)
    tip_pos = rot_x(-ANTENNA_TILT) @ Vector((0, 0, ANTENNA_LEN + 0.03))
    append_part(bm, bm_sphere(0.05, 24, 14), tr(*tip_pos), material_index=1)
    collar = bm_cylinder(0.026, 0.03, 16)
    append_part(bm, collar, rot_x(-ANTENNA_TILT) @ tr(0, 0, ANTENNA_LEN - 0.05), material_index=0)
    antenna = finish_object("Antenna", bm, [dark, glow], location=ANTENNA_BASE + Vector((0, 0, 0.02)))

    # ---------------- Hover pods ----------------
    pods = {}
    for name, sx, sy in (("HoverPod_FL", 1, -1), ("HoverPod_FR", -1, -1), ("HoverPod_BL", 1, 1), ("HoverPod_BR", -1, 1)):
        bm = bmesh.new()
        tilt = rot_y(-sx * POD_TILT) @ rot_x(sy * POD_TILT)
        housing = bm_cylinder(POD_RADIUS, POD_HEIGHT, 32)
        append_part(bm, housing, tilt @ tr(0, 0, -POD_HEIGHT), material_index=0)
        lip = bm_torus(POD_RADIUS - 0.004, 0.018, 32, 10)
        append_part(bm, lip, tilt @ tr(0, 0, -POD_HEIGHT + 0.012), material_index=0)
        ring = bm_torus(0.105, 0.028, 32, 10)
        append_part(bm, ring, tilt @ tr(0, 0, -POD_HEIGHT - 0.004), material_index=1)
        core = bm_cylinder(0.062, 0.014, 20)
        append_part(bm, core, tilt @ tr(0, 0, -POD_HEIGHT - 0.012), material_index=1)
        pods[name] = finish_object(name, bm, [dark, glow], location=Vector((sx * POD_X, sy * POD_Y, POD_MOUNT_Z)))

    # ---------------- Tether socket ----------------
    bm = bmesh.new()
    face_rot = rot_x(math.pi / 2)  # torus/cylinder +Z -> +Y (points out the back)
    append_part(bm, bm_torus(0.14, 0.035, 40, 12), tr(0, 0.015, 0) @ face_rot, material_index=0)
    append_part(bm, bm_cylinder(0.118, 0.07, 36), tr(0, -0.035, 0) @ face_rot, material_index=1)
    append_part(bm, bm_cylinder(0.06, 0.02, 24), tr(0, 0.03, 0) @ face_rot, material_index=1)
    append_part(bm, bm_cylinder(0.028, 0.012, 16), tr(0, 0.05, 0) @ face_rot, material_index=2)
    socket = finish_object("TetherSocket", bm, [accent, dark, glow], location=Vector((0.0, SOCKET_Y - 0.01, 0.0)))

    # ---------------- Hierarchy ----------------
    for child in [face_screen, face_rim_obj, antenna, socket, *pods.values()]:
        child.parent = body
        child.matrix_parent_inverse = body.matrix_world.inverted()

    # ---------------- Report ----------------
    total_tris = 0
    for obj in bpy.data.objects:
        me = obj.data
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        total_tris += tris
        print(f"  {obj.name:14s} verts={len(me.vertices):5d} tris={tris:5d} mats={[m.name for m in me.materials]}")
    print(f"  TOTAL tris={total_tris}")

    # ---------------- Save ----------------
    os.makedirs(out_dir, exist_ok=True)
    blend_path = os.path.join(out_dir, "drone.blend")
    glb_path = os.path.join(out_dir, "drone.glb")
    bpy.context.preferences.filepaths.save_version = 0  # no drone.blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_extras=False,
        use_selection=False,
    )
    print(f"Wrote {blend_path}")
    print(f"Wrote {glb_path} ({os.path.getsize(glb_path) / 1024:.1f} KB)")


if __name__ == "__main__":
    argv = sys.argv
    out = argv[argv.index("--") + 1] if "--" in argv else os.path.join(os.getcwd(), "public", "assets", "drone")
    build(os.path.abspath(out))
