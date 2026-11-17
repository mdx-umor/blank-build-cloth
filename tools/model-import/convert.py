# Converts a cloth-sim garment (.blend) into: model.glb (fabric + trims) and pieces.json (sewing pattern from UV islands)
import bpy, bmesh, json, sys, math
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
OBJ, OUT = args[0], args[1]
TRIM_MATS = ('Bottons', 'Button', 'Thread', 'Zip')
for o in list(bpy.data.objects):
    if o.name != OBJ: bpy.data.objects.remove(o, do_unlink=True)
o = bpy.data.objects[OBJ]
bpy.context.view_layer.objects.active = o; o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = o.data
slot_names = [s.material.name if s.material else 'none' for s in o.material_slots]
is_trim = [any(t.lower() in n.lower() for t in TRIM_MATS) for n in slot_names]

# ---- UV islands -> pattern pieces -------------------------------------------------
bm = bmesh.new(); bm.from_mesh(me)
uvl = bm.loops.layers.uv.active
bm.faces.ensure_lookup_table()
fabric = [f for f in bm.faces if not is_trim[f.material_index]]
parent = {f.index: f.index for f in fabric}
def find(a):
    while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
    return a
def luv(f, v):
    for l in f.loops:
        if l.vert == v: return l[uvl].uv
same = lambda a, b: (a - b).length < 1e-5
for e in bm.edges:
    lf = [f for f in e.link_faces if f.index in parent]
    if len(lf) == 2:
        f1, f2 = lf
        if all(same(luv(f1, v), luv(f2, v)) for v in e.verts): parent[find(f1.index)] = find(f2.index)
islands = {}
for f in fabric: islands.setdefault(find(f.index), []).append(f)

tot3, totuv = 0.0, 0.0
def uvarea(f):
    p = [l[uvl].uv for l in f.loops]; a = 0
    for i in range(len(p)): a += p[i - 1].x * p[i].y - p[i].x * p[i - 1].y
    return abs(a) / 2
for f in fabric: tot3 += f.calc_area(); totuv += uvarea(f)
k = math.sqrt(tot3 / totuv) * 100  # cm per UV unit (mesh is in metres after apply)

def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-12
        d = abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L
        if d > dmax: dmax, idx = d, i
    if dmax > eps: return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [a, b]
def simplify_closed(loop, eps):
    # split the ring at its farthest point from the start, simplify both halves
    a = loop[0]
    far = max(range(len(loop)), key=lambda i: (loop[i][0] - a[0]) ** 2 + (loop[i][1] - a[1]) ** 2)
    h1 = rdp(loop[:far + 1], eps); h2 = rdp(loop[far:] + [loop[0]], eps)
    return h1[:-1] + h2[:-1]
def area(loop): return sum(loop[i - 1][0] * loop[i][1] - loop[i][0] * loop[i - 1][1] for i in range(len(loop))) / 2

# dump islands (UV polygons) — contours are traced outside Blender with OpenCV
out_isl = []
for root, faces in islands.items():
    mats = {}; c3 = Vector((0, 0, 0)); a3 = 0
    for f in faces:
        mats[f.material_index] = mats.get(f.material_index, 0) + 1
        fa = f.calc_area(); c3 += f.calc_center_median() * fa; a3 += fa
    c3 /= a3 or 1
    out_isl.append({'material': slot_names[max(mats, key=mats.get)], 'centroid3d_cm': [round(c3.x * 100, 1), round(c3.z * 100, 1), round(-c3.y * 100, 1)],
                    'polys': [[[round(l[uvl].uv.x, 5), round(l[uvl].uv.y, 5)] for l in f.loops] for f in faces]})
json.dump({'cmPerUV': k, 'slots': slot_names, 'islands': out_isl}, open(OUT + '/islands.json', 'w'))
print('ISLANDS', len(out_isl), 'k', round(k, 2))

# ---- materials: one fabric material + trims ---------------------------------------
fab = bpy.data.materials.new('Fabric'); btn = bpy.data.materials.new('Buttons'); thr = bpy.data.materials.new('Threads')
remap = []
for n, t in zip(slot_names, is_trim):
    remap.append(0 if not t else (2 if 'thread' in n.lower() else 1))
old = [p.material_index for p in me.polygons]
me.materials.clear(); me.materials.append(fab); me.materials.append(btn); me.materials.append(thr)
for p, oi in zip(me.polygons, old): p.material_index = remap[oi]
bpy.ops.export_scene.gltf(filepath=OUT + '/model.glb', export_format='GLB', use_selection=True, export_apply=True,
    export_texcoords=True, export_normals=True, export_materials='EXPORT', export_yup=True, export_image_format='NONE')
print('EXPORTED')
