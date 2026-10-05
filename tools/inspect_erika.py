"""Headless inspection of Erika Archer and one locomotion FBX."""
import bpy
import os
import sys

PACK = r"C:\Dev\hackathons\Openai-HandshakeGAme\public\assets\character\Female Locomotion Pack"
BASE = os.path.join(PACK, "Erika Archer.fbx")
SAMPLE = os.path.join(PACK, "walking.fbx")
TURN = os.path.join(PACK, "left turn.fbx")
JUMP = os.path.join(PACK, "jump.fbx")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def summarize(label):
    print(f"\n===== {label} =====")
    print("objects:")
    for obj in bpy.data.objects:
        parent = obj.parent.name if obj.parent else "-"
        extra = ""
        if obj.type == "ARMATURE":
            bones = [b.name for b in obj.data.bones]
            extra = f" bones={len(bones)} root={[b.name for b in obj.data.bones if b.parent is None]}"
        if obj.type == "MESH":
            extra = f" verts={len(obj.data.vertices)} mats={len(obj.data.materials)}"
        print(f"  {obj.type:10} {obj.name} parent={parent} loc={tuple(round(v, 3) for v in obj.location)} scale={tuple(round(v, 3) for v in obj.scale)}{extra}")
    print("actions:")
    for act in bpy.data.actions:
        print(f"  ACTION {act.name} frames={tuple(round(v, 2) for v in act.frame_range)} fcurves={len(act.fcurves)} users={act.users}")
        paths = {}
        for fc in act.fcurves:
            paths.setdefault(fc.data_path, []).append(fc.array_index)
        # print location/rotation paths only, truncated
        shown = 0
        for path, idx in paths.items():
            if "location" in path or path in ("rotation_quaternion", "rotation_euler") or path.endswith("rotation_quaternion") and "Hips" in path or "Root" in path or "pelvis" in path.lower():
                print(f"    {path} idx={idx}")
                shown += 1
                if shown > 30:
                    print("    ...")
                    break
    print("materials:")
    for mat in bpy.data.materials:
        print(f"  MAT {mat.name}")
    print("images:")
    for img in bpy.data.images:
        print(f"  IMG {img.name} size={img.size[:]}")


def import_fbx(path):
    before_obj = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, automatic_bone_orientation=False, ignore_leaf_bones=False)
    new_obj = [o for o in bpy.data.objects if o not in before_obj]
    new_act = [a for a in bpy.data.actions if a not in before_act]
    return new_obj, new_act


def sample_motion(arm, action, frames=8):
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    start, end = int(action.frame_range[0]), int(action.frame_range[1])
    step = max(1, (end - start) // frames)
    roots = [b for b in arm.pose.bones if b.parent is None]
    print(f"  sampling {action.name} on {arm.name} roots={[b.name for b in roots]} range={start}-{end}")
    scene = bpy.context.scene
    scene.frame_start = start
    scene.frame_end = end
    for frame in range(start, end + 1, step):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        obj_loc = tuple(round(v, 4) for v in arm.matrix_world.translation)
        bits = [f"obj={obj_loc}"]
        for bone in roots[:2]:
            head = arm.matrix_world @ bone.head
            bits.append(f"{bone.name}.head={tuple(round(v, 4) for v in head)} loc={tuple(round(v, 4) for v in bone.location)}")
        # also hips-like
        for bone in arm.pose.bones:
            n = bone.name.lower()
            if "hip" in n or "pelvis" in n or n.endswith(":root") or n == "root":
                head = arm.matrix_world @ bone.head
                bits.append(f"{bone.name}.head={tuple(round(v, 4) for v in head)} loc={tuple(round(v, 4) for v in bone.location)}")
                break
        print(f"    f{frame}: " + " | ".join(bits))


def main():
    reset()
    import_fbx(BASE)
    summarize("BASE Erika Archer")
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if arms:
        arm = arms[0]
        print("BONE HIERARCHY (first 40):")
        count = 0
        for b in arm.data.bones:
            print(f"  {b.name} parent={b.parent.name if b.parent else '-'} head={tuple(round(v, 3) for v in b.head_local)}")
            count += 1
            if count >= 40:
                print(f"  ... {len(arm.data.bones) - 40} more")
                break
        # mesh bounds
        for obj in bpy.data.objects:
            if obj.type == "MESH":
                xs, ys, zs = [], [], []
                for v in obj.data.vertices:
                    w = obj.matrix_world @ v.co
                    xs.append(w.x); ys.append(w.y); zs.append(w.z)
                if xs:
                    print(f"MESH {obj.name} world bounds x={min(xs):.3f}..{max(xs):.3f} y={min(ys):.3f}..{max(ys):.3f} z={min(zs):.3f}..{max(zs):.3f}")

    reset()
    objs, acts = import_fbx(SAMPLE)
    summarize("WALKING")
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if arms and acts:
        sample_motion(arms[0], acts[0])
        print("WALK BONES roots and first 15:")
        for i, b in enumerate(arms[0].data.bones):
            if i < 15 or b.parent is None:
                print(f"  {b.name} parent={b.parent.name if b.parent else '-'}")

    reset()
    objs, acts = import_fbx(TURN)
    summarize("LEFT TURN")
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if arms and acts:
        sample_motion(arms[0], acts[0])

    reset()
    objs, acts = import_fbx(JUMP)
    summarize("JUMP")
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if arms and acts:
        sample_motion(arms[0], acts[0])


if __name__ == "__main__":
    main()
