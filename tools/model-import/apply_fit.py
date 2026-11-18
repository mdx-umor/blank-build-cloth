# Last step for a garment cut with hoodie_build.py ('cut') and fitted with fit_panels.py: write the fitted pattern
# positions into the model as its UVs (sheet cm / 100), send what lies inside a pocket outline on a front to the
# pocket piece (only when pairs.json has one), let the lining and stray bits take the UV of the nearest panel, set the materials, export the GLB.
#   blender -b cut.blend --python apply_fit.py -- <object> <dir with panels.json, labels.json, fit.json> <out.glb>
import bpy, bmesh, sys, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OBJ, D, OUT = sys.argv[sys.argv.index('--') + 1:][:3]
panels = json.load(open(D + '/panels.json'))['panels']; lab = json.load(open(D + '/labels.json')); F = json.load(open(D + '/fit.json'))
fit, pockets = F['fit'], F['pockets']
INNER, CORD, ZIP, EXTRA = 0, 11, 12, 17
o = bpy.data.objects[OBJ]; me = o.data
# the model is made the size of the pattern
ms = F.get('model_scale', 1.0)
if abs(ms - 1) > 1e-3:
    for v in me.vertices: v.co *= ms
    me.update()
    print('scaled the model by', round(ms, 3))
bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.normal_update()
uvl = bm.loops.layers.uv.active or bm.loops.layers.uv.new('UVMap')

def inside(x, y, poly):
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i - 1]; x2, y2 = poly[i]
        if (y2 > y) != (y1 > y) and x < (x1 - x2) * (y - y2) / (y1 - y2) + x2: c = not c
    return c
def persp(H, x, y):
    w = H[2][0] * x + H[2][1] * y + H[2][2]
    return ((H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w)

panel_faces = set(); pocketed = 0
for pn in panels:
    pts = fit.get(pn['id'])
    if not pts: continue
    # the loops entries come face by face, in each face's loop order
    by_face = {}
    for fi, _, loc in pn['loops']: by_face.setdefault(fi, []).append(loc)
    pk = pockets.get(pn['id'])
    for fi, locs in by_face.items():
        f = bm.faces[fi]; xy = [pts[l] for l in locs]
        if pk and 'H' in pk:  # only when the pocket is a piece of its own
            cx = sum(p[0] for p in xy) / len(xy); cy = sum(p[1] for p in xy) / len(xy)
            if inside(cx, cy, pk['outline']): xy = [persp(pk['H'], x, y) for x, y in xy]; pocketed += 1
        for lp, (x, y) in zip(f.loops, xy): lp[uvl].uv = (x / 100, -y / 100)
        panel_faces.add(fi)
print('panel faces', len(panel_faces), 'on the pockets', pocketed)

# everything else follows the nearest panel face (lining, stray bits); cords and zip have no print
src = bmesh.new(); idx = []
for fi in sorted(panel_faces):
    f = bm.faces[fi]; src.faces.new([src.verts.new(v.co) for v in f.verts]); idx.append(fi)
src.faces.ensure_lookup_table(); tree = BVHTree.FromBMesh(src)
def uv_at(fi, p):
    L = list(bm.faces[fi].loops); a, b, c = (l.vert.co for l in L[:3]); ua, ub, uc = (l[uvl].uv for l in L[:3])
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01 or 1e-12
    w1 = (d11 * d20 - d01 * d21) / den; w2 = (d00 * d21 - d01 * d20) / den; w0 = 1 - w1 - w2
    w = [min(1, max(0, t)) for t in (w0, w1, w2)]; s = sum(w) or 1
    return (ua * w[0] + ub * w[1] + uc * w[2]) / s
for f in bm.faces:
    if f.index in panel_faces: continue
    if lab[f.index] in (CORD, ZIP):
        for lp in f.loops: lp[uvl].uv = (0, 0)
        continue
    hit = tree.find_nearest(f.calc_center_median())
    if hit[0] is None: continue
    s = idx[hit[2]]
    for lp in f.loops: lp[uvl].uv = uv_at(s, lp.vert.co)
bm.to_mesh(me); me.update()

# materials: Fabric (prints), Inside (lining: the inside print sheet), Cord, Zip
me.materials.clear()
names = ['Fabric', 'Inside', 'Cord', 'Zip']
for n in names: me.materials.append(bpy.data.materials.get(n) or bpy.data.materials.new(n))
mi = [2 if l == CORD else 3 if l == ZIP else 1 if l == INNER else 0 for l in lab]
me.polygons.foreach_set('material_index', mi)
me.update()
bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_texcoords=True,
    export_normals=True, export_materials='EXPORT', export_yup=True, export_image_format='NONE')
xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
print('BBOX3D_CM', json.dumps({'min': [round(min(xs) * 100, 2), round(min(zs) * 100, 2), round(-max(ys) * 100, 2)], 'max': [round(max(xs) * 100, 2), round(max(zs) * 100, 2), round(-min(ys) * 100, 2)]}))
print('EXPORTED', OUT)
