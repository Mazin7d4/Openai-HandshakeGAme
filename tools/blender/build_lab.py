"""One hero-area kit. Game coordinates: 5 units/metre, +Y up; Blender: +Z up.
Run with the user's Blender executable, -b --python tools/blender/build_lab.py.
The exported art has no collision. PrototypeHeist.ts owns simple collision proxies.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
OUT = Path(__file__).resolve().parents[2] / 'public/assets/lab'
OUT.mkdir(parents=True, exist_ok=True)

def material(name, color, rough=.5, metal=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    s = m.node_tree.nodes.get('Principled BSDF')
    s.inputs['Base Color'].default_value = (*color, 1)
    s.inputs['Roughness'].default_value = rough
    s.inputs['Metallic'].default_value = metal
    return m

oak = material('Oak', (.65,.44,.24))
ivory = material('Porcelain', (.83,.82,.75), .42)
sage = material('Sage', (.30,.46,.39), .48)
coral = material('Coral', (.82,.30,.16), .3)
metal = material('Aluminium', (.6,.66,.66), .29, .82)
rubber = material('Rubber', (.035,.055,.05), .84)
fabric = material('Fabric', (.25,.39,.43), .95)
leaf = material('Leaf', (.12,.29,.13), .69)
screen = material('Screen', (.022,.065,.072), .22)

def pos(p): return (p[0], p[2], p[1])
def finish(obj, name, mat):
    obj.name = name
    obj.data.materials.append(mat)
    return obj

def box(name, p, size, mat, bevel=.07):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos(p))
    o = bpy.context.object
    o.dimensions = (size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Manufactured edge', 'BEVEL')
        mod.width = bevel; mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,mat)

def cyl(name, p, r, h, mat, vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=h, location=pos(p))
    o=bpy.context.object
    b=o.modifiers.new('Edge radii','BEVEL'); b.width=.045; b.segments=3
    bpy.ops.object.modifier_apply(modifier=b.name)
    for f in o.data.polygons: f.use_smooth=True
    return finish(o,name,mat)

def link(name,a,b,r,mat):
    av,bv=Vector(pos(a)),Vector(pos(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=r,depth=(bv-av).length,location=(av+bv)/2)
    o=bpy.context.object; o.rotation_euler=(bv-av).to_track_quat('Z','Y').to_euler()
    for f in o.data.polygons: f.use_smooth=True
    return finish(o,name,mat)

def cable(name, points, radius=.045):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.bevel_depth=radius; c.bevel_resolution=2
    s=c.splines.new('BEZIER'); s.bezier_points.add(len(points)-1)
    for b,p in zip(s.bezier_points,points):
        b.co=pos(p); b.handle_left_type='AUTO'; b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o); o.data.materials.append(rubber)
    bpy.context.view_layer.objects.active=o; o.select_set(True)
    bpy.ops.object.convert(target='MESH'); o.select_set(False)

for x,z in [(-7,8),(9,11)]:
    box('Oak worktop',(x,3.75,z),(7.5,.4,3.5),oak,.12)
    for dx in [-3.15,3.15]:
        box('Powdercoat leg',(x+dx,1.9,z),(.3,3.6,2.9),ivory,.08)
        box('Rubber foot',(x+dx,.12,z),(.48,.24,3.1),rubber)
    box('Cable tray',(x,3.25,z+1),(6.5,.35,.65),metal)
    box('Desk mat',(x+.5,3.98,z-.3),(3.1,.055,2.2),fabric,.024)
    box('Monitor shell',(x+1.6,5.4,z+1),(2.8,1.8,.24),ivory,.11)
    box('Monitor glass',(x+1.6,5.4,z+.863),(2.57,1.57,.035),screen,.07)
    box('Monitor stand',(x+1.6,4.48,z+1),(.2,1,.22),metal)
    box('Monitor base',(x+1.6,4.02,z+.9),(1.35,.1,.8),metal)
    # Deliberate clutter: one driver, electronics tray, instrument, and loose cable.
    box('Parts tray',(x-1.8,4.07,z-.7),(1.5,.2,.9),sage)
    for i in range(3):
        box('PCB',(x-2.15+i*.35,4.2,z-.7),(.22,.07,.5),sage,.02)
        box('Chip',(x-2.15+i*.35,4.25,z-.7),(.12,.045,.18),rubber,.012)
    link('Driver shaft',(x+.2,4.1,z-1),(x+1.2,4.1,z-.65),.04,metal)
    link('Driver handle',(x-.4,4.1,z-1.2),(x+.2,4.1,z-1),.12,coral)
    cable('Loose lead',[(x-2,4.05,z+.4),(x-2.5,4.04,z-.1),(x-3.6,3.95,z-.6),(x-3.8,2,z-.9),(x-3.4,.2,z-1)])

# Friendly tabletop collaborative robot, articulated silhouette and visible rubber joints.
cyl('Arm pedestal',(-8.5,4.1,8.4),.8,.3,metal)
cyl('Arm base',(-8.5,4.55,8.4),.57,.7,ivory)
points=[(-8.5,4.9,8.4),(-9.3,6.6,8.4),(-7.6,7.5,8.1),(-6.6,6.7,7.8)]
for i,(a,b) in enumerate(zip(points,points[1:])):
    link('Arm segment',a,b,.30 if i==0 else .23,ivory)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,radius=.36,location=pos(a))
    finish(bpy.context.object,'Joint boot',rubber)
    cyl('Joint cap',(a[0],a[1]+.2,a[2]),.29,.10,coral)
for dx in [-.23,.23]: link('Soft gripper',points[-1],(-6.6+dx,6.08,7.8),.075,metal)
cable('Arm harness',[(-8.8,4.5,8.7),(-9.6,6.5,8.7),(-7.6,7.8,8.4),(-6.5,6.8,8.1)],.07)

# Vault instrument pedestal: a finished physical object with layered construction.
box('Vault toe',(0,.42,18),(3.7,.48,3.7),rubber,.22)
box('Vault shell',(0,2.35,18),(3.4,3.6,3.4),ivory,.3)
box('Vault seam',(0,3.75,18),(3.48,.12,3.48),metal,.15)
box('Vault top',(0,4.27,18),(3.9,.65,3.9),sage,.25)
cyl('Core cradle',(0,4.66,18),.86,.15,metal)
box('Vault front badge',(0,2.9,16.29),(1.7,.55,.035),screen,.05)
for x in [-1.3,1.3]: box('Service latch',(x,1.4,16.28),(.13,.6,.09),metal,.04)

# One human chair and two plants establish scale, softness, and a lived-in lab.
box('Chair seat',(12,2.3,16),(2.3,.4,2.3),fabric,.22)
box('Chair back',(12,3.8,17),(2.3,2.8,.35),fabric,.3)
cyl('Chair stem',(12,1.2,16),.17,2,metal)
for a in range(5):
    angle=a*math.tau/5
    link('Chair foot',(12,.45,16),(12+math.cos(angle)*1.5,.35,16+math.sin(angle)*1.5),.085,metal)
for x,z in [(-9,22),(14,22)]:
    cyl('Planter',(x,1.15,z),1,2.3,coral)
    cyl('Soil',(x,2.25,z),.88,.1,rubber)
    for i in range(9):
        a=i*2.4; h=3.2+(i%3)*.8
        tip=(x+math.cos(a)*1.25,h,z+math.sin(a)*1.25)
        link('Plant stem',(x,2.2,z),tip,.04,leaf)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=pos(tip))
        o=bpy.context.object; o.scale=(.45,.8,.075); o.rotation_euler=(.45*math.sin(a),.4*math.cos(a),a)
        finish(o,'Leaf',leaf)

# Merge static kit by material to keep browser draw calls low.
for mat in list(bpy.data.materials):
    bpy.ops.object.select_all(action='DESELECT')
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.materials and o.data.materials[0]==mat]
    if not objects: continue
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join()
    objects[0].name='Hero_'+mat.name
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'robotics-hero.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'robotics-hero.glb'),export_format='GLB',export_yup=True,export_apply=True)
print('HERO_ART_COMPLETE', OUT)
