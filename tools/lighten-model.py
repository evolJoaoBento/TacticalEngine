"""Make a light copy of a heavy .glb without changing how it reads.

  blender --background --python lighten.py -- <in.glb> <out.glb> <target_tris> <renders_dir|-> [light-only]

The heavy mesh stays in the scene as the source of truth. The light copy is decimated from it and
keeps its UV layout. (A fresh unwrap was tried: Smart UV Project shatters a decimated scan into
thousands of slivers and the result is unusable.) Every map is then carried across from the heavy
model by projection: colour and roughness/metal as they are, and a new tangent-space normal map
from the heavy model's geometry and its own normal map together, so the detail the triangles no
longer carry is carried by the map. Transforms are left
exactly as imported, so the file drops into the game at the same size and facing.
"""
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, dst, target = args[0], args[1], int(args[2])
renders = None if len(args) < 4 or args[3] == '-' else args[3]
only_light = len(args) > 4 and args[4] == 'light-only'
COLOUR = 2048   # what a close camera actually reads
SMALL = 1024    # roughness/metal, and the normal map unless told otherwise
# A face that is looked at closely -- a party member's, in a portrait -- wants the bigger normal map:
# LIGHTEN_NORMAL=2048 in the environment. Baked at twice its size and brought down either way.
NORMAL = int(os.environ.get('LIGHTEN_NORMAL', SMALL))

t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if len(meshes) != 1:
    raise SystemExit(f'expected one mesh, found {len(meshes)}: this script does not merge')
heavy = meshes[0]
if len(heavy.data.materials) != 1:
    raise SystemExit(f'expected one material, found {len(heavy.data.materials)}')
heavy.data.calc_loop_triangles()
before = len(heavy.data.loop_triangles)
print(f'LIGHTEN heavy tris={before}')
scene = bpy.context.scene


def only(*objects, active):
    for o in bpy.data.objects:
        o.select_set(o in objects)
    bpy.context.view_layer.objects.active = active


def open_edges(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    count = sum(1 for e in bm.edges if e.is_boundary)
    bm.free()
    return count


# ---- the light copy: fewer triangles, the same skin ------------------------------------------
light = heavy.copy()
light.data = heavy.data.copy()
light.name = heavy.name + '_light'
scene.collection.objects.link(light)
only(light, active=light)
# A glTF stores one vertex per UV corner, so the mesh arrives as thousands of separate patches that
# only look joined. Decimated like that, each patch shrinks back from its own edge and the model
# opens up along every seam -- seen, as black hairlines. Welded first, it is one skin; the UVs are
# per face corner in Blender, so the seams survive the weld as seams and not as holes.
# A model already at or under the target keeps every vertex exactly where it is -- a floor tile has
# to meet its neighbours to the hair -- and only its maps are brought down.
keep_mesh = target >= before
if not keep_mesh:
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=max(heavy.dimensions) * 1e-5)
    bpy.ops.object.mode_set(mode='OBJECT')
welded_open = open_edges(light.data)
print(f'LIGHTEN welded {len(heavy.data.vertices)} -> {len(light.data.vertices)} vertices')
if not keep_mesh:
    mod = light.modifiers.new('Decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, target / before)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # The heavy mesh's custom normals describe a surface that is no longer there.
    if light.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth()
light.data.calc_loop_triangles()
after = len(light.data.loop_triangles)
print(f'LIGHTEN light tris={after} ({after / before:.1%})')

# Two things a swap must not change: how big the model stands, and how closed its skin is. Open
# edges are counted against the *welded* original, since the file as stored is open along every seam.
drift = max(abs(a - b) / max(b, 1e-9) for a, b in zip(light.dimensions, heavy.dimensions))
print(f'LIGHTEN bounds drift={drift:.4%} open_edges welded_heavy={welded_open} light={open_edges(light.data)}')

# ---- what the heavy model's material is made of ----------------------------------------------
source = heavy.data.materials[0]
principled = next(n for n in source.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def texture_behind(socket_name):
    """The image feeding a Principled input, looking through a Separate Color or a Normal Map."""
    socket = principled.inputs[socket_name]
    if not socket.links:
        return None
    node = socket.links[0].from_node
    while node.type != 'TEX_IMAGE':
        feed = next((i for i in node.inputs if i.links), None)
        if feed is None:
            return None
        node = feed.links[0].from_node
    return node.image


colour_src = texture_behind('Base Color')
orm_src = texture_behind('Roughness') or texture_behind('Metallic')
has_normal = texture_behind('Normal') is not None
print(f'LIGHTEN maps colour={colour_src.name if colour_src else None} orm={orm_src.name if orm_src else None} normal={has_normal}')


def emitting(image, name):
    """A material that simply glows with one image, so an EMIT bake copies that image across."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    emit = nodes.new('ShaderNodeEmission')
    out = nodes.new('ShaderNodeOutputMaterial')
    links.new(tex.outputs['Color'], emit.inputs['Color'])
    links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


# ---- the light model's material: the heavy one's, with every map carried across ---------------
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
size = max(heavy.dimensions)
bake = scene.render.bake
bake.margin = 16
bake.margin_type = 'EXTEND'
bake.normal_space = 'TANGENT'
bake.use_clear = True


mat = source.copy()
mat.name = source.name + '_light'
light.data.materials[0] = mat
nodes, links = mat.node_tree.nodes, mat.node_tree.links
# Short rays: a decimated skin lies within a fraction of a percent of the original, and a long ray
# in a tight fold reaches the cloth on the far side of it.
bake.cage_extrusion = size * 0.006
bake.max_ray_distance = size * 0.02


def pixels_of(image):
    flat = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(flat)
    return flat


def bake_onto_light(material, name, data, side):
    """Bake whatever `material` makes the heavy model glow with onto the light model's layout."""
    node = nodes.new('ShaderNodeTexImage')
    node.image = bpy.data.images.new(name, side, side, alpha=False, float_buffer=False, is_data=data)
    node.image.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    for n in nodes:
        n.select = False
    node.select = True
    nodes.active = node
    heavy.data.materials[0] = material
    only(heavy, light, active=light)
    bake.use_selected_to_active = True
    scene.cycles.samples = 4
    bpy.ops.object.bake(type='EMIT')
    heavy.data.materials[0] = source
    return node


def original_padded(image, data, side):
    """The heavy model's own image, its islands grown outward into the gutters, at `side` pixels.

    Baking the heavy model's texture onto its own layout copies it texel for texel and lets the bake
    margin paint the gaps between islands in the colour of whatever is next to them.
    """
    glow = emitting(image, 'emit_self')
    node = glow.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = bpy.data.images.new('self', image.size[0], image.size[1], alpha=False, float_buffer=False, is_data=data)
    node.image.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    for n in glow.node_tree.nodes:
        n.select = False
    node.select = True
    glow.node_tree.nodes.active = node
    heavy.data.materials[0] = glow
    only(heavy, active=heavy)
    bake.use_selected_to_active = False
    scene.cycles.samples = 1
    bpy.ops.object.bake(type='EMIT')
    heavy.data.materials[0] = source
    if node.image.size[0] != side:
        node.image.scale(side, side)
    return node.image


def white():
    mat_white = bpy.data.materials.new('emit_white')
    mat_white.use_nodes = True
    tree = mat_white.node_tree
    tree.nodes.clear()
    emit = tree.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (1, 1, 1, 1)
    out_node = tree.nodes.new('ShaderNodeOutputMaterial')
    tree.links.new(emit.outputs['Emission'], out_node.inputs['Surface'])
    return mat_white


def projected(image, name, data, final):
    """One of the heavy model's maps, carried across onto the light model's surface.

    Reusing the original image as it is was tried, and is wrong in a way that only shows on a face:
    a collapse decimation does not keep the UV layout still, so the old picture is stretched a
    little differently over every new triangle. Projecting asks the question the right way round --
    for each texel of the light model, what colour is the heavy model *at that point in space* -- so
    the picture lands where it was painted whatever the UVs did.

    Projection has its own failure, found on the knight's cloak: deep in a fold a ray finds nothing,
    and the texel comes back black. So the rays are kept short, a second bake records which texels
    were actually hit, and wherever one was not the original image answers instead -- slightly
    stretched, which in a crevice nobody can see, rather than black, which everybody can. Baked at
    twice the size and brought down, so the join between the two is a blend and not an edge.
    """
    started = time.time()
    side = final * 2
    node = bake_onto_light(emitting(image, 'emit_' + name), name, data, side)
    hit_node = bake_onto_light(white(), name + '_hit', True, side)
    node.image.scale(final, final)
    hit_node.image.scale(final, final)
    fallback = original_padded(image, data, final)
    hit = pixels_of(hit_node.image).reshape(-1, 4)[:, :1]
    mixed = pixels_of(node.image).reshape(-1, 4) * hit + pixels_of(fallback).reshape(-1, 4) * (1 - hit)
    mixed[:, 3] = 1
    node.image.pixels.foreach_set(mixed.reshape(-1))
    node.image.update()
    node.image.pack()
    missed = float((hit < 0.5).mean())
    nodes.remove(hit_node)
    print(f'LIGHTEN projected {name} in {time.time() - started:.0f}s, {missed:.1%} of the image from the original')
    return node

if keep_mesh:
    # Same vertices, same UVs: the maps are the model's own, only smaller. Copies, so the heavy
    # material keeps the originals for the comparison renders.
    for node in [n for n in nodes if n.type == 'TEX_IMAGE' and n.image is not None]:
        image = node.image.copy()
        node.image = image
        limit = COLOUR if image is not None and node.image.colorspace_settings.name == 'sRGB' else SMALL
        if max(image.size) > limit:
            image.scale(limit, limit)
        image.pack()
    print('LIGHTEN kept the mesh; maps resized only')

for old in [] if keep_mesh else [n for n in nodes if n.type == 'TEX_IMAGE' and n.image is not None]:
    if old.image is colour_src:
        fresh = projected(colour_src, 'colour', data=False, final=min(COLOUR, max(colour_src.size)))
    elif old.image is orm_src:
        fresh = projected(orm_src, 'roughness_metal', data=True, final=min(SMALL, max(orm_src.size)))
    else:
        continue
    # Wired where the old image was, so roughness and metal still come off the same two channels.
    for link in list(old.outputs['Color'].links):
        links.new(fresh.outputs['Color'], link.to_socket)
    nodes.remove(old)
# The normal map is baked, not padded: from the heavy model -- its geometry and its own normal map
# together -- onto the light one, so what the triangles no longer carry the map does.
if has_normal and not keep_mesh:
    bump = next(n for n in nodes if n.type == 'NORMAL_MAP')
    old_tex = bump.inputs['Color'].links[0].from_node
    target_node = nodes.new('ShaderNodeTexImage')
    target_node.image = bpy.data.images.new('normal', NORMAL * 2, NORMAL * 2, alpha=False, float_buffer=False, is_data=True)
    target_node.image.colorspace_settings.name = 'Non-Color'
    for n in nodes:
        n.select = False
    target_node.select = True
    nodes.active = target_node
    only(heavy, light, active=light)
    bake.use_selected_to_active = True
    scene.cycles.samples = 8
    started = time.time()
    bpy.ops.object.bake(type='NORMAL')
    print(f'LIGHTEN baked normal in {time.time() - started:.0f}s')
    target_node.image.scale(NORMAL, NORMAL)
    target_node.image.pack()
    links.new(target_node.outputs['Color'], bump.inputs['Color'])
    nodes.remove(old_tex)

# ---- renders, before anything is thrown away -------------------------------------------------
def render_pair(tag, location, aim, lens):
    cam_data = bpy.data.cameras.new('cam_' + tag)
    cam_data.lens = lens
    cam = bpy.data.objects.new('cam_' + tag, cam_data)
    scene.collection.objects.link(cam)
    cam.location = location
    cam.rotation_euler = (Vector(aim) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    for which, shown, hidden in (('heavy', heavy, light), ('light', light, heavy)):
        if only_light and which == 'heavy':
            continue
        shown.hide_render = False
        hidden.hide_render = True
        scene.render.filepath = os.path.join(renders, f'{tag}-{which}.png')
        bpy.ops.render.render(write_still=True)
    # The light mesh with no textures at all: a crack, a hole or a crumpled patch that the maps
    # would hide shows here, which is how the unwelded seams were found.
    if tag == 'close':
        sun_data.use_shadow = True
        light.data.materials[0] = grey
        scene.render.filepath = os.path.join(renders, f'{tag}-grey.png')
        bpy.ops.render.render(write_still=True)
        light.data.materials[0] = mat
        sun_data.use_shadow = False


if renders is not None:
    os.makedirs(renders, exist_ok=True)
    grey = bpy.data.materials.new('grey')
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.32, 0.33, 0.36, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = 3.2
    # No cast shadows in the textured pairs. Cycles draws a shadow's edge against the real triangles
    # even where the shading is smooth, so a coarser mesh shows hard wedges along the terminator
    # that no rasteriser draws -- they are the ray tracer's, not the model's, and they made a good
    # face look faceted. The grey render keeps them: a hole shows best with a dark inside.
    sun_data.use_shadow = False
    sun = bpy.data.objects.new('sun', sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(38))
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 720, 900
    corners = [heavy.matrix_world @ Vector(c) for c in heavy.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    mid = (lo + hi) / 2
    tall = hi.z - lo.z
    # glTF's front is +Z, which arrives in Blender as -Y: the camera stands out along -Y.
    render_pair('full', (mid.x + tall * 0.9, mid.y - tall * 2.6, mid.z + tall * 0.45), (mid.x, mid.y, mid.z), 50)
    render_pair('close', (mid.x + tall * 0.35, mid.y - tall * 1.15, hi.z - tall * 0.12), (mid.x, mid.y, hi.z - tall * 0.24), 70)
    print('LIGHTEN rendered')

# ---- export only the light one ---------------------------------------------------------------
only(light, active=light)
light.name = heavy.name
os.makedirs(os.path.dirname(dst), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', use_selection=True,
    export_image_format='WEBP', export_image_quality=90,
    export_tangents=True, export_apply=False, export_yup=True, export_animations=False,
)
print(f'LIGHTEN wrote {dst} {os.path.getsize(dst) / 1e6:.1f}MB (was {os.path.getsize(src) / 1e6:.1f}MB) in {time.time() - t0:.0f}s')
