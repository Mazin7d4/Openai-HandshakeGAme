"""Neutral miniature furniture. One vertex-coloured PBR mesh per prop, no collision or emission.
Run: blender -b --factory-startup --python tools/blender/build_props.py
PROP_OUT optionally selects an external preview directory. Compress with gltf-transform meshopt.
"""
import bpy, math, os
from pathlib import Path
from mathutils import Vector

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
OUT = Path(os.environ.get('PROP_OUT', Path(__file__).resolve().parents[2] / 'public/assets/props'))
OUT.mkdir(parents=True, exist_ok=True)
# Linear colour values: reserved drone / interaction colours never enter this palette.
COLORS = dict(oak=(.43,.34,.25), ivory=(.70,.68,.61), felt=(.23,.27,.26),
              metal=(.40,.44,.44), rubber=(.065,.077,.080), slate=(.18,.22,.25),
              linen=(.47,.44,.37), leaf=(.22,.25,.22), leaf2=(.32,.35,.30),
              clay=(.34,.29,.25), paper=(.76,.74,.67), glass=(.16,.20,.22))
mat = bpy.data.materials.new('DecorMatte')
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (1,1,1,1)
bsdf.inputs['Roughness'].default_value = .72
bsdf.inputs['Metallic'].default_value = .12
parts = []

def pos(p): return (p[0],p[2],p[1])
def finish(o, color):
    o.data.materials.append(mat)
    attr = o.data.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    base = COLORS[color]
    # A restrained baked contact feel, darkest on undersides. No runtime AO pass.
    for poly in o.data.polygons:
        shade = .88 + .12 * max(0, poly.normal.z)
        for li in poly.loop_indices: attr.data[li].color = (*[v*shade for v in base],1)
    parts.append(o)
    return o

def box(p,size,c,bevel=.05):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos(p))
    o=bpy.context.object
    o.dimensions=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('edge chamfer','BEVEL'); b.width=min(bevel,min(size)*.3); b.segments=1
        bpy.ops.object.modifier_apply(modifier=b.name)
        n=o.modifiers.new('weighted normals','WEIGHTED_NORMAL'); bpy.ops.object.modifier_apply(modifier=n.name)
    return finish(o,c)

def cyl(p,r,h,c,v=12,top=None):
    bpy.ops.mesh.primitive_cone_add(vertices=v,radius1=r,radius2=r if top is None else top,depth=h,location=pos(p))
    return finish(bpy.context.object,c)

def link(a,b,r,c,v=8):
    av,bv=Vector(pos(a)),Vector(pos(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=v,radius=r,depth=(bv-av).length,location=(av+bv)/2)
    o=bpy.context.object; o.rotation_euler=(bv-av).to_track_quat('Z','Y').to_euler()
    return finish(o,c)

def leaf(p,a,c,s=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=1,location=pos(p))
    o=bpy.context.object; o.scale=(.68*s,.15*s,.30*s); o.rotation_euler=(.3, .4, a)
    return finish(o,c)

def commit(name):
    global parts
    root=bpy.data.objects.new('Prop_'+name,None); bpy.context.collection.objects.link(root)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    bpy.ops.object.join(); o=bpy.context.object
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.name=name+'_DecorMatte'; o.parent=root
    parts=[]

# Reception lounge: upholstered cushions, inset seams, open base.
box((0,.65,0),(8.7,.45,3.4),'rubber')
for x in (-4,4):
    for z in (-1.35,1.35): link((x,.55,z),(x,0,z),.11,'metal')
for x in (-2.8,0,2.8):
    box((x,1.4,-.2),(2.72,.8,3.1),'linen',.18)
    box((x,2.65,1.25),(2.72,2.4,.65),'linen',.15)
for x in (-4.35,4.35): box((x,1.9,0),(.65,2.2,3.5),'linen',.15)
box((-2.7,2.3,.6),(1.25,1.1,.5),'felt',.15)
commit('Sofa')

box((0,2.3,0),(2.3,.38,2.2),'felt',.12)
box((0,3.7,.95),(2.2,2.35,.3),'felt',.12)
link((0,2.1,0),(0,.4,0),.13,'metal')
for i in range(5):
    a=i*math.tau/5; x,z=math.cos(a)*1.2,math.sin(a)*1.2
    link((0,.4,0),(x,.23,z),.08,'metal'); box((x,.13,z),(.24,.26,.25),'rubber',.04)
commit('Chair')

# Server cabinet: readable perforated doors, brushed rails, tiny unlit indicator insets.
box((0,3,0),(2.8,6,2.6),'slate',.08)
for x in (-1.27,1.27): box((x,3,-1.34),(.12,5.7,.13),'metal',.02)
for i in range(8):
    y=.5+i*.69
    box((0,y,-1.33),(2.32,.56,.08),'rubber',.02)
    box((.78,y,-1.39),(.24,.08,.03),'metal',0)
    for x in (-.82,-.52,-.22): box((x,y,-1.39),(.12,.25,.025),'slate',0)
box((0,5.95,0),(2.88,.12,2.68),'metal',.03)
commit('Rack')

for x in (-.6,.6):
    for z in (-2.8,2.8): box((x,3.4,z),(.1,6.8,.1),'metal',.02)
for y in (.2,2.35,4.5,6.65):
    box((0,y,0),(1.35,.12,5.7),'metal',.02)
    if y<6:
        for z in (-1.9,0,1.9):
            box((0,y+.76,z),(1.1,1.4,1.6),'clay',.06)
            box((-.56,y+.95,z),(.025,.24,.7),'paper',0)
commit('Shelving')

def plant(name,s):
    cyl((0,1*s,0),.85*s,2*s,'clay',12,.99*s)
    cyl((0,2.01*s,0),.87*s,.06*s,'rubber',12)
    for i in range(8):
        a=i*2.39996; h=(2.8+(i%3)*.6)*s; r=(.7+(i%2)*.6)*s
        tip=(math.cos(a)*r,h,math.sin(a)*r)
        link((0,1.9*s,0),tip,.035*s,'leaf',6)
        leaf(tip,a,'leaf2' if i%2 else 'leaf',s)
    commit(name)
plant('Plant',1.1); plant('PlantSmall',.40)

box((0,3.35,0),(2.4,6.7,4.6),'ivory',.1)
for i in range(10): box((-1.23,.6+i*.5,0),(.05,.12,3.9),'slate',.01)
box((-1.24,5.9,0),(.04,.75,2.5),'metal',.03)
commit('Cooling')

# Straight, shallow duct; no roof-piercing elbow.
box((0,0,0),(6,1.15,2.6),'metal',.07)
for x in (-2.9,0,2.9): box((x,0,0),(.16,1.3,2.75),'slate',.02)
commit('Duct')

box((0,3.5,0),(1.9,7,6),'oak',.05)
for y in (.3,2.4,4.5,6.6):
    box((-.1,y,0),(1.9,.16,5.8),'ivory',.02)
    if y<6:
        for i in range(9):
            z=-2.45+i*.57; h=1.2+(i%3)*.16
            box((-.3,y+.1+h/2,z),(1.4,h,.46),'paper' if i%3 else 'felt',.01)
commit('Bookshelf')

box((0,1.4,0),(2.8,1.8,.22),'ivory',.07)
box((0,1.4,-.13),(2.5,1.5,.03),'glass',.02)
box((0,.55,.05),(.2,1,.2),'metal',.03)
box((0,.06,0),(1.3,.12,.8),'metal',.02)
commit('Monitor')

# Far-wall office archive: hardware and recessed panels read as storage, never consoles.
for x in (-1.6,0,1.6):
    box((x,2.9,0),(1.55,5.8,1.4),'felt',.07)
    for y in (1.2,3,4.8):
        box((x,y,-.73),(1.4,1.65,.06),'ivory',.03)
        box((x,y+.45,-.78),(.6,.1,.04),'metal',.02)
commit('Lockers')

# Dock trolley: four wheels, inset parcels, vertical grab rail. Rectilinear and unlit.
box((0,.55,0),(3.5,.18,2.5),'metal',.04)
for x in (-1.4,1.4):
    for z in (-.9,.9): cyl((x,.25,z),.23,.5,'rubber',10)
for x in (-1.5,1.5): box((x,1.8,1.1),(.12,2.4,.12),'metal',.03)
box((0,2.95,1.1),(3.1,.12,.12),'metal',.03)
for x in (-.85,.85):
    box((x,1.35,-.1),(1.55,1.4,1.9),'clay',.06)
    box((x,2.06,-.1),(.18,.03,1.92),'paper',0)
commit('ParcelTrolley')

# Server landmark / acoustic wall module: layered fin stack with solid silhouette.
box((0,3.6,0),(4.1,7.2,.5),'rubber',.06)
for i in range(9): box((-1.7+i*.425,3.6,-.34),(.18,6.7,.38),'metal',.035)
commit('AcousticPanel')

bpy.ops.export_scene.gltf(filepath=str(OUT/'office-kit.glb'),export_format='GLB',export_yup=True,
                          export_apply=True,export_vertex_color='ACTIVE',export_texcoords=False,export_materials='EXPORT')
print('PROP_KIT_COMPLETE', (OUT/'office-kit.glb').stat().st_size)
