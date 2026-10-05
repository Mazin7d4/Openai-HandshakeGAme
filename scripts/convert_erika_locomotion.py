"""Headless Blender conversion: Erika Archer + locomotion FBXs -> one in-place player.glb."""

import bpy
import os
from mathutils import Quaternion, Vector

PACK = r"C:\Dev\hackathons\Openai-HandshakeGAme\public\assets\character\Female Locomotion Pack"
OUT = r"C:\Dev\hackathons\Openai-HandshakeGAme\public\assets\character\player.glb"

CLIPS = [
    ("idle", "idle.fbx", False),
    ("walk", "walking.fbx", False),
    ("run", "running.fbx", False),
    ("strafeLeftWalk", "left strafe walk.fbx", False),
    ("strafeRightWalk", "right strafe walk.fbx", False),
    ("strafeLeft", "left strafe.fbx", False),
    ("strafeRight", "right strafe.fbx", False),
    ("turnLeft", "left turn.fbx", True),
    ("turnRight", "right turn.fbx", True),
    ("jump", "jump.fbx", False),
]

HIPS_LOC = 'pose.bones["mixamorig:Hips"].location'
HIPS_QUAT = 'pose.bones["mixamorig:Hips"].rotation_quaternion'


def log(msg):
    print(msg, flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def action_fcurves(action):
    fcurves = []
    layers = getattr(action, "layers", None)
    slots = list(getattr(action, "slots", []) or [])
    if layers:
        for layer in layers:
            for strip in layer.strips:
                if getattr(strip, "type", None) not in (None, "KEYFRAME"):
                    continue
                if hasattr(strip, "channelbags"):
                    bags = list(strip.channelbags)
                    if bags:
                        for bag in bags:
                            fcurves.extend(list(bag.fcurves))
                        continue
                for slot in slots:
                    try:
                        bag = strip.channelbag(slot)
                    except Exception:
                        bag = None
                    if bag is not None:
                        fcurves.extend(list(bag.fcurves))
    legacy = getattr(action, "fcurves", None)
    if legacy:
        fcurves.extend(list(legacy))
    # unique by identity
    uniq = []
    seen = set()
    for fc in fcurves:
        if id(fc) in seen:
            continue
        seen.add(id(fc))
        uniq.append(fc)
    return uniq


def fcurve_map(action):
    out = {}
    for fc in action_fcurves(action):
        out[(fc.data_path, fc.array_index)] = fc
    return out


def curve_stats(fc):
    vals = [kp.co.y for kp in fc.keyframe_points]
    frames = [kp.co.x for kp in fc.keyframe_points]
    if not vals:
        return None
    return {
        "min": min(vals),
        "max": max(vals),
        "delta": max(vals) - min(vals),
        "first": vals[0],
        "frame0": frames[0],
        "frame1": frames[-1],
    }


def set_curve_constant(fc, value):
    for kp in fc.keyframe_points:
        kp.co.y = value
        kp.handle_left.y = value
        kp.handle_right.y = value
    fc.update()


def remove_twist(q: Quaternion, axis: Vector) -> Quaternion:
    q = q.normalized()
    axis = axis.normalized()
    dot = q.x * axis.x + q.y * axis.y + q.z * axis.z
    twist = Quaternion((q.w, axis.x * dot, axis.y * dot, axis.z * dot))
    if twist.magnitude < 1e-8:
        return q
    twist.normalize()
    swing = q @ twist.inverted()
    return swing.normalized()


def strip_turn_yaw(action):
    curves = fcurve_map(action)
    channels = [curves.get((HIPS_QUAT, i)) for i in range(4)]
    if any(c is None for c in channels):
        log(f"  no hips quaternion on {action.name}")
        return
    count = min(len(c.keyframe_points) for c in channels)
    for i in range(count):
        w = channels[0].keyframe_points[i].co.y
        x = channels[1].keyframe_points[i].co.y
        y = channels[2].keyframe_points[i].co.y
        z = channels[3].keyframe_points[i].co.y
        swing = remove_twist(Quaternion((w, x, y, z)), Vector((0.0, 1.0, 0.0)))
        for idx, val in enumerate((swing.w, swing.x, swing.y, swing.z)):
            kp = channels[idx].keyframe_points[i]
            kp.co.y = val
            kp.handle_left.y = val
            kp.handle_right.y = val
    for c in channels:
        c.update()


def neutralize_root(action, clip_name, rest_xz):
    curves = fcurve_map(action)
    stats = {}
    for axis in (0, 1, 2):
        fc = curves.get((HIPS_LOC, axis))
        if fc is None:
            log(f"  missing hips location[{axis}]")
            continue
        stats[axis] = curve_stats(fc)
        log(
            f"  hips.loc[{axis}] delta={stats[axis]['delta']:.3f} "
            f"range={stats[axis]['min']:.3f}..{stats[axis]['max']:.3f}"
        )

    # Horizontal root travel lives on X (strafe) and Z (forward) in armature space.
    for axis, rest in ((0, rest_xz[0]), (2, rest_xz[1])):
        fc = curves.get((HIPS_LOC, axis))
        if fc is not None:
            set_curve_constant(fc, rest)

    if clip_name == "jump":
        fc = curves.get((HIPS_LOC, 1))
        if fc is not None and len(fc.keyframe_points) > 0:
            # Keep the crouch dip. Drop the upward root hop so the controller owns jump height.
            start = fc.keyframe_points[0].co.y
            for kp in fc.keyframe_points:
                if kp.co.y > start:
                    kp.co.y = start
                    kp.handle_left.y = start
                    kp.handle_right.y = start
            fc.update()
            log(f"  jump vertical clamped to start {start:.3f}")

    return stats


def import_fbx(path):
    before = set(bpy.data.objects)
    result = bpy.ops.wm.fbx_import(filepath=path)
    if result != {"FINISHED"}:
        raise RuntimeError(f"FBX import failed for {path}: {result}")
    new_objs = [obj for obj in bpy.data.objects if obj not in before]
    return new_objs


def find_armature(objs):
    arms = [obj for obj in objs if obj.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("No armature in imported FBX")
    return arms[0]


def delete_objects(objs):
    for obj in objs:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and data.users == 0:
            if isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)
            elif isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


def push_nla(armature, action, name):
    if armature.animation_data is None:
        armature.animation_data_create()
    track = armature.animation_data.nla_tracks.new()
    track.name = name
    start = int(round(action.frame_range[0]))
    strip = track.strips.new(name, start, action)
    if action.slots:
        strip.action_slot = action.slots[0]
    strip.name = name
    action.name = name
    action.use_fake_user = True
    return strip


def main():
    reset_scene()
    base_path = os.path.join(PACK, "Erika Archer.fbx")
    log(f"Import base {base_path}")
    base_objs = import_fbx(base_path)
    armature = find_armature(base_objs)
    armature.name = "Erika"

    scene = bpy.context.scene
    log(f"scene fps={scene.render.fps} fps_base={scene.render.fps_base}")
    if scene.render.fps != 30:
        scene.render.fps = 30
        log("forced fps to 30")

    rest_xz = (0.0, 0.0)
    if armature.animation_data and armature.animation_data.action:
        bind = armature.animation_data.action
        curves = fcurve_map(bind)
        x = curves.get((HIPS_LOC, 0))
        z = curves.get((HIPS_LOC, 2))
        if x and len(x.keyframe_points):
            rest_xz = (x.keyframe_points[0].co.y, rest_xz[1])
        if z and len(z.keyframe_points):
            rest_xz = (rest_xz[0], z.keyframe_points[0].co.y)
        armature.animation_data.action = None
        bind.use_fake_user = False
        if bind.users == 0:
            bpy.data.actions.remove(bind)
    log(f"rest hips XZ={rest_xz}")

    images = [img.name for img in bpy.data.images]
    log(f"images={images}")
    log("objects after base:")
    for obj in bpy.data.objects:
        parent = obj.parent.name if obj.parent else None
        log(f"  {obj.type} {obj.name} parent={parent}")

    fps = scene.render.fps / scene.render.fps_base
    authored = {}

    for clip_name, filename, strip_yaw in CLIPS:
        path = os.path.join(PACK, filename)
        log(f"\n== {clip_name} <= {filename} ==")
        new_objs = import_fbx(path)
        src = find_armature(new_objs)
        if not src.animation_data or not src.animation_data.action:
            raise RuntimeError(f"No action on {filename}")
        action = src.animation_data.action
        action.name = clip_name
        action.use_fake_user = True
        stats = neutralize_root(action, clip_name, rest_xz)
        if strip_yaw:
            strip_turn_yaw(action)
            log("  removed hips yaw so the controller owns facing")

        # Authored horizontal speed from the pre-strip delta, in meters / second.
        # Armature scale is 0.01, so bone units are centimeters.
        axis = 0 if "strafe" in clip_name else 2
        if clip_name.startswith("turn") or clip_name in ("idle", "jump"):
            axis = 0 if stats.get(0, {}).get("delta", 0) > stats.get(2, {}).get("delta", 0) else 2
        st = stats.get(axis)
        if st:
            duration = max((st["frame1"] - st["frame0"]) / fps, 1e-4)
            speed = (st["delta"] * 0.01) / duration
            authored[clip_name] = {"axis": axis, "meters": st["delta"] * 0.01, "seconds": duration, "mps": speed}
            log(f"  authored axis={axis} {speed:.3f} m/s over {duration:.3f}s ({st['delta'] * 0.01:.3f} m)")

        src.animation_data.action = None
        # Drop imported duplicate armature/mesh. Action stays via fake user.
        delete_objects(new_objs)
        push_nla(armature, action, clip_name)
        log(f"  nla tracks now: {[t.name for t in armature.animation_data.nla_tracks]}")

    if armature.animation_data:
        armature.animation_data.action = None

    log("\nFinal objects:")
    armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    log(f"  armatures={len(armatures)} meshes={len(meshes)}")
    for obj in bpy.data.objects:
        log(f"  {obj.type} {obj.name}")
    if len(armatures) != 1:
        raise RuntimeError(f"Expected 1 armature, found {len(armatures)}")

    log("Actions:")
    for act in bpy.data.actions:
        log(f"  {act.name} range={tuple(round(v, 2) for v in act.frame_range)} slots={len(act.slots)}")

    log(f"\nAUTHORED {authored}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)

    log(f"Export {OUT}")
    result = bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_skins=True,
        export_morph=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_anim_single_armature=True,
        export_frame_range=False,
        export_force_sampling=True,
        export_frame_step=1,
        export_bake_animation=False,
        export_anim_slide_to_zero=True,
        export_rest_position_armature=True,
        export_reset_pose_bones=True,
        export_optimize_animation_size=True,
        export_yup=True,
        export_apply=False,
        export_lights=False,
        export_cameras=False,
        use_selection=False,
    )
    log(f"export result {result}")
    log(f"bytes {os.path.getsize(OUT)}")


if __name__ == "__main__":
    main()
