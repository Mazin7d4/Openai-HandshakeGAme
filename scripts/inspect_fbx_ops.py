import bpy

print("=== FBX / GLTF OPERATORS ===")
for op in dir(bpy.ops):
    pass

candidates = []
for mod_name in dir(bpy.ops):
    mod = getattr(bpy.ops, mod_name)
    try:
        names = dir(mod)
    except Exception:
        continue
    for name in names:
        if "fbx" in name.lower() or "gltf" in name.lower():
            candidates.append(f"bpy.ops.{mod_name}.{name}")

for c in sorted(set(candidates)):
    print(c)
