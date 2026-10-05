import bpy
import os

PACK = r"C:\Dev\hackathons\Openai-HandshakeGAme\public\assets\character\Female Locomotion Pack"


def reset():
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
                targets = slots or [None]
                for slot in targets:
                    bag = None
                    try:
                        bag = strip.channelbag(slot) if slot is not None else None
                    except Exception as e:
                        print("  channelbag error", e)
                    if bag is None and hasattr(strip, "channelbags"):
                        for b in strip.channelbags:
                            fcurves.extend(list(b.fcurves))
                    elif bag is not None:
                        fcurves.extend(list(bag.fcurves))
    legacy = getattr(action, "fcurves", None)
    if legacy:
        fcurves.extend(list(legacy))
    return fcurves


def dump(label):
    print(f"\n===== {label} =====")
    for obj in bpy.data.objects:
        parent = obj.parent.name if obj.parent else None
        extra = ""
        if obj.type == "ARMATURE":
            roots = [b.name for b in obj.data.bones if b.parent is None]
            extra = f" bones={len(obj.data.bones)} roots={roots}"
        if obj.type == "MESH":
            xs, ys, zs = [], [], []
            for v in obj.data.vertices:
                w = obj.matrix_world @ v.co
                xs.append(w.x)
                ys.append(w.y)
                zs.append(w.z)
            if xs:
                extra = (
                    f" world x={min(xs):.3f}..{max(xs):.3f}"
                    f" y={min(ys):.3f}..{max(ys):.3f}"
                    f" z={min(zs):.3f}..{max(zs):.3f}"
                )
        print(
            f"  {obj.type:10} {obj.name!r} parent={parent}"
            f" loc={tuple(round(v, 4) for v in obj.location)}"
            f" rot={tuple(round(v, 4) for v in obj.rotation_euler)}"
            f" scale={tuple(round(v, 4) for v in obj.scale)}{extra}"
        )
    print("-- actions --")
    for act in bpy.data.actions:
        fcurves = action_fcurves(act)
        print(
            f"  action {act.name!r} range={tuple(round(x, 2) for x in act.frame_range)}"
            f" fcurves={len(fcurves)} slots={[s.name_display if hasattr(s, 'name_display') else s.name for s in getattr(act, 'slots', [])]}"
        )
        interesting = []
        for fc in fcurves:
            path = fc.data_path
            low = path.lower()
            if any(k in low for k in ("location", "hips", "root", "armature")):
                interesting.append(fc)
        print(f"    location-like curves: {len(interesting)}")
        for fc in interesting[:30]:
            vals = [kp.co.y for kp in fc.keyframe_points]
            mn = min(vals) if vals else None
            mx = max(vals) if vals else None
            print(f"    {fc.data_path}[{fc.array_index}] keys={len(fc.keyframe_points)} min={mn} max={mx}")


def import_new(path):
    bpy.ops.wm.fbx_import(filepath=path)


def summarize_file(filename, mode):
    reset()
    path = os.path.join(PACK, filename)
    print(f"\n######## {mode} {filename} ########")
    if mode == "new":
        import_new(path)
    else:
        bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    dump(filename)


summarize_file("Erika Archer.fbx", "new")
for name in [
    "idle.fbx",
    "walking.fbx",
    "running.fbx",
    "left strafe walk.fbx",
    "jump.fbx",
    "left turn.fbx",
]:
    summarize_file(name, "new")
