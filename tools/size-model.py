"""Give a .glb the size it should be drawn at, standing on its base.

  blender --background --python size-model.py -- <in.glb> <out.glb> <height in tiles>

Two things are set, and nothing else is touched.

**How big.** A tile is one unit, and a model is drawn at the size its file says, so a creature scanned
to fit some arbitrary box towers over the board. This scales it about its own centre until it stands
the height it is asked for, which is read as tiles: a person is about 0.95, a hound 0.7.

**Where its pivot is.** At the centre of its base, on the floor - the centre of the footprint the
model actually rests on, not the middle of the whole body dropped down. A figure that leans, reaches
or trails a tail has a bounding box whose middle is nowhere near the feet, and a token pivoting about
that swings as it turns. So the base is measured from the lowest slice of the mesh, the part that
touches the ground, and that slice's middle is where the origin goes.

The transform is baked into the mesh rather than left on the node, so the file is the size it says
it is and its origin is where it says it is, with nothing hidden in a parent. Materials, maps and UVs
are carried across untouched; these models carry no rig or animation, and the script refuses one that
does rather than breaking it quietly.
"""
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, dst, height = args[0], args[1], float(args[2])
# How deep a slice counts as the base: enough to catch the feet, too little to catch the knees.
BASE_SLICE = 0.06

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
if [o for o in bpy.data.objects if o.type == 'ARMATURE'] or bpy.data.actions:
    raise SystemExit('this model is rigged or animated: resize it by hand rather than with this')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if len(meshes) != 1:
    raise SystemExit(f'expected one mesh, found {len(meshes)}')
model = meshes[0]

# Whatever transform it arrived with goes into the geometry, so what follows is the real thing.
bpy.context.view_layer.objects.active = model
model.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

points = [v.co.copy() for v in model.data.vertices]
lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
was = hi.z - lo.z
if was <= 0:
    raise SystemExit('this model has no height')

# The base: the lowest slice of it, and the middle of what that slice covers.
floor = [p for p in points if p.z <= lo.z + BASE_SLICE * was]
base = Vector((
    (min(p.x for p in floor) + max(p.x for p in floor)) / 2,
    (min(p.y for p in floor) + max(p.y for p in floor)) / 2,
    lo.z,
))
factor = height / was
for v in model.data.vertices:
    v.co = (v.co - base) * factor
model.data.update()

bpy.ops.object.select_all(action='DESELECT')
model.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', use_selection=True,
    export_image_format='WEBP', export_image_quality=90,
    export_tangents=True, export_apply=False, export_yup=True, export_animations=False,
)
drift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0)) - Vector((base.x, base.y, 0))
print(
    f'SIZED {os.path.basename(dst)} {was:.2f} -> {height:.2f} tall (x{factor:.3f}),'
    f' base centre off the body centre by {drift.length:.3f},'
    f' now {(hi.x - lo.x) * factor:.2f} wide and {(hi.y - lo.y) * factor:.2f} deep'
)
