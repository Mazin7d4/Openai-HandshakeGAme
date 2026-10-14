"""Reusable prop kit for reception, office, server, vent and service areas.
Each prop is authored at the origin (game coords: 5 units/metre, +Y up, front faces -Z) under an
empty named Prop_<Name>; its parts are joined per material so the game can instance one mesh per
prop+material (one draw call each, however many placements). No collision is exported; the game
adds simple static boxes for big props.
Run: blender -b --python tools/blender/build_props.py
"""
import bpy, math
from pathlib import Path
from mathutils import Vector

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials): bpy.data.materials.remove(m)
OUT = Path(__file__).resolve().parents[2] / 'public/assets/props'; OUT.mkdir(parents=True, exist_ok=True)

def material(name, color, rough=.5, metal=0, emit=None, strength=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    s = m.node_tree.nodes.get('Principled BSDF')
    s.inputs['Base Color'].default_value = (*color, 1)
    s.inputs['Roughness'].default_value = rough; s.inputs['Metallic'].default_value = metal
    if emit:
        s.inputs['Emission Color'].default_value = (*emit, 1); s.inputs['Emission Strength'].default_value = strength
    return m

M = dict(
  oak=material('Oak', (.65,.44,.24), .5), ivory=material('Porcelain', (.83,.82,.75), .42),
  sage=material('Sage', (.30,.46,.39), .48), coral=material('Coral', (.82,.30,.16), .32),
  metal=material('Aluminium', (.6,.66,.66), .29, .82), rubber=material('Rubber', (.035,.055,.05), .84),
  graphite=material('Graphite', (.07,.10,.11), .55, .3), mustard=material('Mustard', (.72,.45,.10), .93),
  teal=material('Teal', (.08,.33,.37), .92), leaf=material('Leaf', (.12,.33,.13), .62),
  leaf2=material('LeafLight', (.30,.55,.16), .66), terracotta=material('Terracotta', (.62,.25,.13), .78),
  screen=material('Screen', (.02,.06,.07), .2, 0, (.10,.45,.50), .6),
  led=material('LedCyan', (.3,.9,.95), .4, 0, (.25,.85,.95), 3.0),
  amber=material('LedAmber', (1,.6,.25), .4, 0, (1,.5,.12), 2.5),
  pink=material('Pink', (.85,.38,.48), .4), yellow=material('Yellow', (.88,.65,.08), .55),
  blue=material('Blue', (.12,.36,.55), .38),
)

def pos(p): return (p[0], p[2], p[1])
parts = []
def finish(o, mat):
    o.data.materials.append(mat); parts.append(o); return o
def box(p, size, mat, bevel=.06, seg=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos(p)); o = bpy.context.object
    o.dimensions = (size[0], size[2], size[1]); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new('b', 'BEVEL'); b.width = bevel; b.segments = seg; b.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=b.name)
        w = o.modifiers.new('w', 'WEIGHTED_NORMAL'); bpy.ops.object.modifier_apply(modifier=w.name)
    return finish(o, mat)
def cyl(p, r, h, mat, v=24, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=v, radius1=r2 if r2 is not None else r, radius2=r, depth=h, location=pos(p))
    o = bpy.context.object
    for f in o.data.polygons: f.use_smooth = True
    return finish(o, mat)
def link(a, b, r, mat, v=12):
    av, bv = Vector(pos(a)), Vector(pos(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=v, radius=r, depth=(bv-av).length, location=(av+bv)/2)
    o = bpy.context.object; o.rotation_euler = (bv-av).to_track_quat('Z','Y').to_euler()
    for f in o.data.polygons: f.use_smooth = True
    return finish(o, mat)
def blob(p, scale, rot, mat, seg=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=6, radius=1, location=pos(p))
    o = bpy.context.object; o.scale = scale; o.rotation_euler = rot
    for f in o.data.polygons: f.use_smooth = True
    return finish(o, mat)

def commit(name):
    """Join this prop's parts per material under an empty Prop_<name>."""
    global parts
    root = bpy.data.objects.new('Prop_' + name, None); bpy.context.collection.objects.link(root)
    bymat = {}
    for o in parts: bymat.setdefault(o.data.materials[0].name, []).append(o)
    for mname, objs in bymat.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1: bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        j.name = f'{name}_{mname}'; j.parent = root
    parts = []

# ---- Sofa: 9 wide (x), 3.8 deep, back toward +z, front -z. Seat height ~2.2 (45 cm).
box((0,.9,0),(9,1.1,3.6),M['mustard'],.25,3)
for i in (-1,0,1): box((i*2.75,1.75,-.25),(2.7,.65,3.0),M['mustard'],.28,4)
for i in (-1,0,1): box((i*2.75,3.1,1.35),(2.7,2.2,.85),M['mustard'],.32,4)
for s in (-1,1): box((s*4.6,2.0,0),(.85,2.1,3.7),M['mustard'],.3,4)
for sx in (-4.2,4.2):
    for sz in (-1.5,1.5): link((sx,.4,sz),(sx*1.02,0,sz*1.05),.12,M['oak'])
box((-2.5,2.7,.6),(1.6,1.3,.5),M['teal'],.25,4); box((2.9,2.6,.7),(1.4,1.1,.45),M['coral'],.22,4)
commit('Sofa')

# ---- Office chair (seat ~2.3), back toward +z.
box((0,2.3,0),(2.3,.38,2.2),M['teal'],.2,3); box((0,3.85,.95),(2.2,2.5,.32),M['teal'],.25,3)
link((0,2.1,0),(0,.55,0),.13,M['metal']); link((0,2.4,.6),(0,3.2,1.0),.08,M['metal'])
for a in range(5):
    ang = a*math.tau/5; tip = (math.cos(ang)*1.35, .32, math.sin(ang)*1.35)
    link((0,.5,0), tip, .08, M['metal']); blob((tip[0],.16,tip[2]),(.17,.17,.17),(0,0,0),M['rubber'],8)
for s in (-1,1): box((s*1.25,3.05,-.1),(.18,.12,1.4),M['rubber'],.05); link((s*1.25,2.45,-.1),(s*1.25,3.0,-.1),.05,M['metal'])
commit('Chair')

# ---- Server rack unit: 2.4 wide, 7.8 tall, 2.6 deep. Front face -z.
box((0,3.9,0),(2.4,7.8,2.6),M['graphite'],.06)
for i in range(11):
    y = .55 + i*.62
    box((0,y,-1.31),(2.05,.5,.06),M['rubber'] if i%3 else M['metal'],.02,1)
    box((-.82,y,-1.36),(.08,.08,.04),M['led'] if i%4 else M['amber'],0)
    box((-.62,y,-1.36),(.08,.08,.04),M['led'],0)
    box((.8,y,-1.36),(.18,.32,.05),M['metal'],.02,1)
for sx in (-1.13,1.13): box((sx,3.9,-1.33),(.12,7.6,.1),M['metal'],.02,1)
box((0,7.75,0),(2.45,.12,2.65),M['metal'],.03,1)
for i in range(6): box((-.75+i*.3,8.0,.4),(.12,.35,1.4),M['blue'] if i%2 else M['rubber'],.04,1)
commit('Rack')

# ---- Steel shelving with bins: 1.2 deep (x), 6 long (z), 12 tall.
for sz in (-2.9,2.9):
    for sx in (-.55,.55): box((sx,6,sz),(.1,12,.1),M['metal'],.02,1)
for y in (.3,4.2,7.8,11.4): box((0,y,0),(1.2,.12,6),M['metal'],.03,1)
cols=[M['coral'],M['yellow'],M['teal'],M['pink'],M['blue']]
for k,y in enumerate((.36,4.26,7.86)):
    for j,z in enumerate((-1.8,0,1.8)):
        c = cols[(k*3+j)%5]; box((0,y+.7,z),(1.0,1.35,1.6),c,.12,3); box((-.52,y+1.1,z),(.04,.25,.7),M['ivory'],.02,1)
commit('Shelving')

# ---- Large and small plants (tapered pot, soil, curved stems, broad leaves).
def plant(name, s):
    cyl((0,1.1*s,0),1.1*s,2.2*s,M['terracotta'],28,r2=.85*s); cyl((0,2.2*s,0),.98*s,.1*s,M['rubber'],20)
    box((0,.04,0),(2.4*s,.08,2.4*s),M['oak'],.03,1) if s>1 else None
    for i in range(11):
        a=i*2.39996; h=(3.1+(i%4)*.75)*s; r=(.9+(i%3)*.45)*s
        tip=(math.cos(a)*r,h,math.sin(a)*r); mid=(math.cos(a)*r*.4,h*.75,math.sin(a)*r*.4)
        link((0,2.2*s,0),mid,.045*s,M['leaf']); link(mid,tip,.04*s,M['leaf'])
        blob(tip,(.95*s,.55*s,.06*s),(.5*math.sin(a),.45*math.cos(a),a),M['leaf'] if i%2 else M['leaf2'],12)
    commit(name)
plant('Plant', 1.2); plant('PlantSmall', .55)

# ---- Precision cooling unit: 2.4 (x) deep, 10 tall, 5 long (z). Face -x.
box((0,5,0),(2.4,10,5),M['ivory'],.12,3)
for i in range(14): box((-1.22,1+i*.32,0),(.05,.12,4.2),M['graphite'],.02,1)
box((-1.23,7,0),(.05,2.4,3.4),M['screen'],.03,1); box((-1.24,8.6,0),(.04,.1,3.4),M['led'],0)
box((0,10.1,0),(2.2,.25,4.6),M['metal'],.04,1)
commit('Cooling')

# ---- Rectangular duct segment + elbow up (vent ductwork). Length along x = 6.
box((0,0,0),(6,2.6,3.4),M['metal'],.08,2)
for x in (-2.9,0,2.9): box((x,0,0),(.18,2.9,3.7),M['metal'],.04,1)
box((2.6,2.6,0),(2.6,3.2,3.4),M['metal'],.08,2)
for i in range(5): box((-1.8+i*.7,-1.32,0),(.1,.05,3),M['graphite'],.01,1)
commit('Duct')

# ---- Bookshelf: 2 deep (x), 10 tall, 7 long (z). Face -x.
box((0,5,0),(2,10,7),M['oak'],.08)
for y in (1.9,4.1,6.3,8.5): box((-.1,y-1.0,0),(1.9,.15,6.6),M['oak'],.03,1)
k=0
for y in (1.0,3.2,5.4,7.6):
    z=-3.0
    while z<2.8:
        w=.28+((k*37)%5)*.08; h=1.0+((k*13)%4)*.18
        box((-.2,y+h/2,z+w/2),(1.4,h,w),cols[k%5] if k%7 else M['ivory'],.02,1); z+=w+.04; k+=1
commit('Bookshelf')

# ---- Monitor (2.8 wide) with stand, faces -z.
box((0,1.4,0),(2.8,1.8,.22),M['ivory'],.1,3); box((0,1.4,-.12),(2.55,1.55,.03),M['screen'],.04,1)
box((0,.5,.05),(.2,1,.2),M['metal'],.04,1); box((0,.05,-.05),(1.3,.1,.8),M['metal'],.04,1)
commit('Monitor')

bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'office-kit.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'office-kit.glb'), export_format='GLB', export_yup=True, export_apply=True)
print('PROP_KIT_COMPLETE')
