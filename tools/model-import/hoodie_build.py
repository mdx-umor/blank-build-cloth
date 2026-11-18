# Turns a garment model WITHOUT a sewing pattern (one closed mesh, e.g. from an AI 3D generator) into a web garment:
# outside / lining, panels cut where a hoodie's seams are, each panel flattened into a pattern piece (UVs), drawcords
# and zip found, then a light GLB + islands.json for trace.py.
#   blender -b model.blend --python hoodie_build.py -- <object> <out-dir> <decimate-ratio> [labels-only]
import bpy, bmesh, sys, math, json, random, heapq
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
OBJ, OUT, RATIO = args[0], args[1], float(args[2])
MODE = args[3] if len(args) > 3 else 'all'   # 'labels-only' | 'cut' (stop after flattening, write panels.json) | 'all'
LABELS_ONLY = MODE == 'labels-only'

INNER, FRONT_L, FRONT_R, BACK, SLEEVE_L, SLEEVE_R, CUFF_L, CUFF_R, HEM_L, HOOD_L, HOOD_R, CORD, ZIP, HEM_R, HEM_B, POCKET_L, POCKET_R = range(17)
NAMES = {FRONT_L: ('frontL', 'Front · left'), FRONT_R: ('frontR', 'Front · right'), BACK: ('back', 'Back'),
         SLEEVE_L: ('sleeveL', 'Left sleeve'), SLEEVE_R: ('sleeveR', 'Right sleeve'), CUFF_L: ('cuffL', 'Left cuff'),
         CUFF_R: ('cuffR', 'Right cuff'), HEM_L: ('waistbandL', 'Waistband · front left'), HEM_R: ('waistbandR', 'Waistband · front right'),
         HEM_B: ('waistbandB', 'Waistband · back'), HOOD_L: ('hoodL', 'Hood · left'), HOOD_R: ('hoodR', 'Hood · right'),
         POCKET_L: ('pocketL', 'Pocket · left'), POCKET_R: ('pocketR', 'Pocket · right')}
PANELS = set(NAMES)

o = bpy.data.objects[OBJ]
bpy.context.view_layer.objects.active = o; o.select_set(True)
if RATIO < 0.999:
    d = o.modifiers.new('d', 'DECIMATE'); d.ratio = RATIO; d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='d')
me = o.data
bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
bm.normal_update()
F = len(bm.faces)
cen = [f.calc_center_median() for f in bm.faces]
print('FACES', F)

# ---- components (the smaller ones are hidden inner layers) -------------------------------------------------
comp = [-1] * F; sizes = []
for f in bm.faces:
    if comp[f.index] >= 0: continue
    st = [f]; comp[f.index] = len(sizes); n = 0
    while st:
        x = st.pop(); n += 1
        for e in x.edges:
            for g in e.link_faces:
                if comp[g.index] < 0: comp[g.index] = len(sizes); st.append(g)
    sizes.append(n)
main = max(range(len(sizes)), key=lambda i: sizes[i])

# ---- outside vs lining: how much of the sky each face sees, smoothed over neighbours --------------------------
bvh = BVHTree.FromBMesh(bm)
rnd = random.Random(3)
dirs = [Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized() for _ in range(32)]
esc = [0.0] * F
for f in bm.faces:
    n = f.normal; p = cen[f.index] + n * 0.0015; k = 0
    for dv in dirs:
        dd = (dv if dv.dot(n) > 0 else -dv) + n * 0.3
        if bvh.ray_cast(p, dd.normalized(), 3.0)[0] is None: k += 1
    esc[f.index] = k / len(dirs)
nbrs = [[g.index for e in f.edges for g in e.link_faces if g is not f] for f in bm.faces]
s = esc[:]
for it in range(6):
    s = [(s[i] + sum(s[j] for j in nbrs[i])) / (1 + len(nbrs[i])) for i in range(F)]
# Seeds: faces that clearly see the sky are outside; faces seen from inside the body, the sleeves and the hood are
# lining. Both grow over the surface; they meet at the openings (hem, cuffs, hood edge), so the outside of the garment
# that you can't see (under the arms, the back under the hood) still counts as outside.
def interior_points():
    pts = [Vector((0, -0.01, z)) for z in (0.15, 0.3, 0.45, 0.6)]
    for sgn in (1, -1):
        for zc in (0.08, 0.18, 0.3, 0.42):
            ring = [cen[i] for i in range(F) if comp[i] == main and abs(cen[i].z - zc) < 0.01 and cen[i].x * sgn > 0.27]
            if len(ring) > 30: pts.append(sum(ring, Vector()) / len(ring))
    hood = [cen[i] for i in range(F) if comp[i] == main and abs(cen[i].z - 0.84) < 0.01 and abs(cen[i].x) < 0.2]
    if hood: pts.append(sum(hood, Vector()) / len(hood))
    return pts
lining_seed = set()
rnd2 = random.Random(9)
for P in interior_points():
    for _ in range(3000):
        dv = Vector((rnd2.gauss(0, 1), rnd2.gauss(0, 1), rnd2.gauss(0, 1))).normalized()
        h = bvh.ray_cast(P, dv, 2.0)
        if h[0] is not None and h[1].dot(dv) < 0: lining_seed.add(h[2])
side = {}; q = []
for i in range(F):
    if comp[i] != main: continue
    if i in lining_seed: side[i] = 0; q.append((0.0, i))
    elif s[i] > 0.6: side[i] = 1; q.append((0.0, i))
heapq.heapify(q); dist = {i: 0.0 for _, i in q}
while q:
    dv, i = heapq.heappop(q)
    if dv > dist.get(i, 1e9): continue
    for j in nbrs[i]:
        nd = dv + (cen[i] - cen[j]).length
        if comp[j] == main and nd < dist.get(j, 1e9): dist[j] = nd; side[j] = side[i]; heapq.heappush(q, (nd, j))
outer = [side.get(i, 0) == 1 and comp[i] == main for i in range(F)]
print('OUTSIDE', sum(outer), 'LINING', F - sum(outer), 'lining seeds', len(lining_seed))

# ---- panels, cut where a hoodie's seams are (+x = the wearer's left; front = -y; metres) ----------------------
CUFF_TOP = 0.072  # rib cuffs ≈ 5.5 cm above the sleeve end, waistband ≈ 6 cm (as in the pattern)
def panel(c):
    x, y, z = c; ax = abs(x); L = x > 0
    zhb = 0.62 + 0.14 * min(1.0, ax / 0.2) ** 2          # lower edge of the hood where it lies on the back
    if (z > 0.775 and ax < 0.2) or (y > 0.06 and z > zhb and ax < 0.22): return HOOD_L if L else HOOD_R
    xarm = 0.25 if z < 0.22 else (0.225 if z < 0.6 else 0.22)   # dropped-shoulder armhole seam
    if ax > xarm: return (CUFF_L if L else CUFF_R) if z < CUFF_TOP else (SLEEVE_L if L else SLEEVE_R)
    if z < 0.06: return (HEM_L if L else HEM_R) if y < -0.01 else HEM_B   # waistband: two fronts and a back, as in the pattern
    if y < -0.01: return FRONT_L if L else FRONT_R
    return BACK
lab = [panel(cen[i]) if outer[i] else INNER for i in range(F)]

# drawcords: on the front, whatever stands out more than 3 mm from the fabric around it (a relief map of the
# front: each face against the median depth of the front within 2.5 cm of it)
zone = [i for i in range(F) if lab[i] in (FRONT_L, FRONT_R, HOOD_L, HOOD_R) and 0.018 < abs(cen[i].x) < 0.11 and 0.5 < cen[i].z < 0.8 and cen[i].y < -0.04]
grid = {}
for i in range(F):
    c = cen[i]
    if outer[i] and abs(c.x) < 0.14 and 0.47 < c.z < 0.83 and c.y < -0.04: grid.setdefault((int(c.x / 0.005), int(c.z / 0.005)), []).append(c.y)
for i in zone:
    c = cen[i]; gx, gz = int(c.x / 0.005), int(c.z / 0.005); ys = []
    for dx in range(-5, 6):
        for dz in range(-5, 6): ys.extend(grid.get((gx + dx, gz + dz), ()))
    if len(ys) > 20:
        ys.sort(); med = ys[int(len(ys) * 0.6)]  # the fabric (cords are the few points in front)
        if c.y < med - 0.003: lab[i] = CORD
# a cord is thin: where what stands out runs wider than 1.6 cm side to side, it is the hood's edge, not a cord
rows = {}
for i in zone:
    if lab[i] == CORD: rows.setdefault((cen[i].x > 0, int(cen[i].z / 0.003)), []).append(i)
for key, ids in rows.items():
    ids.sort(key=lambda i: cen[i].x); run = [ids[0]]
    for i in ids[1:] + [None]:
        if i is not None and cen[i].x - cen[run[-1]].x < 0.006: run.append(i); continue
        if cen[run[-1]].x - cen[run[0]].x > 0.016:
            for j in run: lab[j] = panel(cen[j])
        if i is not None: run = [i]
# fill small gaps along the cords, then drop stray bits
for it in range(2):
    add = [i for i in zone if lab[i] != CORD and sum(1 for j in nbrs[i] if lab[j] == CORD) >= 2]
    for i in add: lab[i] = CORD
seen = set()
for i0 in range(F):
    if lab[i0] != CORD or i0 in seen: continue
    grp = [i0]; seen.add(i0); st = [i0]
    while st:
        i = st.pop()
        for j in nbrs[i]:
            if lab[j] == CORD and j not in seen: seen.add(j); grp.append(j); st.append(j)
    zs = [cen[i].z for i in grp]
    if len(grp) < 40 or max(zs) - min(zs) < 0.03:  # a cord is long and thin
        for i in grp: lab[i] = panel(cen[i])
# pockets: on the lower front, a layer with the front fabric just behind it (look through the pocket to the front)
for i in range(F):
    x, y, z = cen[i]
    if lab[i] in (FRONT_L, FRONT_R) and 0.07 < z < 0.4 and abs(x) > 0.012 and bm.faces[i].normal.y < -0.3:
        p0 = cen[i] + Vector((0, 0.002, 0)); travelled = 0.0; hit = None
        for _ in range(3):
            h = bvh.ray_cast(p0, Vector((0, 1, 0)), 0.05 - travelled)
            if h[0] is None: break
            travelled += h[3]
            if h[1].y < 0: hit = h; break
            p0 = h[0] + Vector((0, 0.0015, 0)); travelled += 0.0015
        if hit is not None and 0.003 < travelled < 0.035: lab[i] = POCKET_L if x > 0 else POCKET_R
# where the hood lies on the back, hood and back are parted by the hood's rim: grow both over the outside surface
# from a hood seed and a back seed, so the line between them lands on that rim
zone = [i for i in range(F) if outer[i] and lab[i] in (BACK, HOOD_L, HOOD_R) and cen[i].y > 0.04 and 0.5 < cen[i].z < 0.86]
zset = set(zone); grow = {}; q = []
for i in zone:
    z = cen[i].z
    if z > 0.82: grow[i] = 'hood'; q.append((0.0, i))
    elif z < 0.55: grow[i] = 'back'; q.append((0.0, i))
heapq.heapify(q); dist = {i: 0.0 for _, i in q}
while q:
    dv, i = heapq.heappop(q)
    if dv > dist.get(i, 1e9): continue
    for j in nbrs[i]:
        if j in zset and outer[j]:
            nd = dv + (cen[i] - cen[j]).length
            if nd < dist.get(j, 1e9): dist[j] = nd; grow[j] = grow[i]; heapq.heappush(q, (nd, j))
for i in zone:
    if grow.get(i) == 'hood': lab[i] = HOOD_L if cen[i].x > 0 else HOOD_R
    elif grow.get(i) == 'back': lab[i] = BACK
# tidy up: a face takes the label most of its neighbours have (panels only, cords and lining stay)
for it in range(3):
    new = lab[:]
    for i in range(F):
        if lab[i] in (INNER, CORD): continue
        cnt = {}
        for j in nbrs[i]:
            if lab[j] in PANELS: cnt[lab[j]] = cnt.get(lab[j], 0) + 1
        if cnt:
            best = max(cnt, key=cnt.get)
            if cnt[best] >= 2 and best != lab[i]: new[i] = best
    lab = new
# cords: keep only sizeable connected bits (a stray face is not a cord)
seen = set()
for f in bm.faces:
    if lab[f.index] != CORD or f.index in seen: continue
    grp = [f.index]; seen.add(f.index); st = [f.index]
    while st:
        i = st.pop()
        for j in nbrs[i]:
            if lab[j] == CORD and j not in seen: seen.add(j); grp.append(j); st.append(j)
    if len(grp) < 40:
        for i in grp: lab[i] = panel(cen[i])
# the zip: a narrow strip down the centre front
for i in range(F):
    x, y, z = cen[i]
    if lab[i] in (FRONT_L, FRONT_R, HEM_L, HEM_R) and abs(x) < 0.0075 and y < -0.05 and z < 0.8: lab[i] = ZIP

json.dump(lab, open(OUT + '/labels.json', 'w'))
cnt = {}
for l in lab: cnt[l] = cnt.get(l, 0) + 1
print('LABELS', {k: cnt[k] for k in sorted(cnt)})
if LABELS_ONLY:
    bm.to_mesh(me); bpy.ops.wm.save_as_mainfile(filepath=OUT + '/labelled.blend'); sys.exit(0)

# ---- seams: between panels, and a cut through any tube-shaped panel -----------------------------------------
def boundary_loops(faces):
    fs = set(faces); edges = [e for f in faces for e in bm.faces[f].edges]
    bnd = set(e.index for e in edges if sum(1 for g in e.link_faces if g.index in fs and not e.seam) == 1 or (e.seam and any(g.index in fs for g in e.link_faces)))
    loops = []; used = set()
    for ei in bnd:
        if ei in used: continue
        st = [ei]; used.add(ei); vs = set(); length = 0
        while st:
            e = bm.edges[st.pop()]; length += e.calc_length(); vs.update(v.index for v in e.verts)
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2.index in bnd and e2.index not in used: used.add(e2.index); st.append(e2.index)
        loops.append((length, vs))
    return sorted(loops, key=lambda t: -t[0])
for e in bm.edges:
    lf = e.link_faces
    e.seam = len(lf) == 2 and lab[lf[0].index] != lab[lf[1].index]
islands = {}
for i in range(F):
    if lab[i] in PANELS: islands.setdefault(lab[i], []).append(i)
# split each panel into its connected parts (a label can land in a few places)
parts = []
for l, faces in islands.items():
    fs = set(faces); seen = set()
    for f0 in faces:
        if f0 in seen: continue
        grp = [f0]; seen.add(f0); st = [f0]
        while st:
            i = st.pop()
            for e in bm.faces[i].edges:
                if e.seam: continue
                for g in e.link_faces:
                    if g.index in fs and g.index not in seen: seen.add(g.index); grp.append(g.index); st.append(g.index)
        parts.append((l, grp))
# one part per panel: the biggest; other bits of the outside follow the nearest panel later (EXTRA)
EXTRA = 17
best = {}
for l, grp in parts:
    if l not in best or len(grp) > len(best[l]): best[l] = grp
for l, grp in parts:
    if best[l] is not grp:
        for i in grp: lab[i] = EXTRA
keep = [(l, best[l]) for l in best]
for e in bm.edges:
    lf = e.link_faces
    e.seam = len(lf) == 2 and lab[lf[0].index] != lab[lf[1].index]
cuts = 0
for l, grp in keep:
    for _ in range(3):
        loops = boundary_loops(grp)
        if len(loops) < 2 or loops[1][0] < 0.12: break   # a disk (or a tiny hole): fine to flatten
        # open the tube: shortest path along the panel's edges from one opening to the other
        fs = set(grp); A, B = loops[0][1], loops[1][1]
        dist = {v: 0.0 for v in A}; prev = {}; pq = [(0.0, v) for v in A]; heapq.heapify(pq); end = None
        while pq:
            dv, vi = heapq.heappop(pq)
            if dv > dist.get(vi, 1e9): continue
            if vi in B: end = vi; break
            v = bm.verts[vi]
            for e in v.link_edges:
                if not any(g.index in fs for g in e.link_faces): continue
                w = e.other_vert(v).index; nd = dv + e.calc_length()
                if nd < dist.get(w, 1e9): dist[w] = nd; prev[w] = (vi, e.index); heapq.heappush(pq, (nd, w))
        if end is None: break
        vi = end
        while vi in prev: pv, ei = prev[vi]; bm.edges[ei].seam = True; vi = pv
        cuts += 1
print('PANELS', len(keep), 'TUBE CUTS', cuts)

# ---- flatten each panel (ABF), keep real proportions, stand it upright, not mirrored --------------------------
bm.to_mesh(me); me.update()
me.polygons.foreach_set('select', [l in PANELS for l in lab])
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_mode(type='FACE')
bpy.ops.uv.unwrap(method='ANGLE_BASED', fill_holes=True, correct_aspect=True, margin=0.0)
bpy.ops.uv.average_islands_scale()
bpy.ops.object.mode_set(mode='OBJECT')
bm.free(); bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.normal_update()
uvl = bm.loops.layers.uv.active
def tri_uv_area(f):
    p = [l[uvl].uv for l in f.loops]; return sum(p[i - 1].x * p[i].y - p[i].x * p[i - 1].y for i in range(len(p))) / 2
for l, grp in keep:
    # direction of "up" (3D +z) in UV, averaged over the panel
    gx = gy = 0.0; signed = 0.0
    for i in grp:
        f = bm.faces[i]; L3 = list(f.loops)
        p0, p1, p2 = (lp.vert.co for lp in L3[:3]); q0, q1, q2 = (lp[uvl].uv for lp in L3[:3])
        du1, du2 = q1 - q0, q2 - q0; dz1, dz2 = p1.z - p0.z, p2.z - p0.z
        det = du1.x * du2.y - du1.y * du2.x
        if abs(det) < 1e-14: continue
        a = f.calc_area()
        gx += a * (dz1 * du2.y - dz2 * du1.y) / det; gy += a * (-dz1 * du2.x + dz2 * du1.x) / det
        signed += tri_uv_area(f)
    th = math.atan2(gx, gy)  # rotate so that up in 3D is +v
    c, s_ = math.cos(th), math.sin(th)
    mirror = signed < 0
    for i in grp:
        for lp in bm.faces[i].loops:
            u, v = lp[uvl].uv
            u2, v2 = c * u - s_ * v, s_ * u + c * v
            lp[uvl].uv = (-u2 if mirror else u2, v2)
bm.to_mesh(me); me.update()
if MODE == 'cut':
    # each panel: its vertices (3D + flat position, split where the flat layout is cut), triangles, label
    k_flat = math.sqrt(sum(bm.faces[i].calc_area() for l, g in keep for i in g) / (sum(abs(tri_uv_area(bm.faces[i])) for l, g in keep for i in g) or 1)) * 100
    out = []
    for pi, (l, grp) in enumerate(keep):
        ids = {}; verts = []; tris = []; loops = []
        for i in grp:
            t = []
            for lp in bm.faces[i].loops:
                key = (lp.vert.index, round(lp[uvl].uv.x, 6), round(lp[uvl].uv.y, 6))
                if key not in ids: ids[key] = len(verts); verts.append([*lp.vert.co, lp[uvl].uv.x * k_flat, -lp[uvl].uv.y * k_flat])
                t.append(ids[key]); loops.append([i, lp.index, ids[key]])
            tris.append(t)
        out.append({'label': l, 'id': NAMES[l][0], 'name': NAMES[l][1], 'area3d_cm2': sum(bm.faces[i].calc_area() for i in grp) * 1e4, 'verts': verts, 'tris': tris, 'loops': loops})
    json.dump({'panels': out}, open(OUT + '/panels.json', 'w'))
    json.dump(lab, open(OUT + '/labels.json', 'w'))
    bpy.ops.wm.save_as_mainfile(filepath=OUT + '/cut.blend')
    print('CUT', len(out), 'panels written'); sys.exit(0)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.pack_islands(rotate=False, margin=0.012)
bpy.ops.object.mode_set(mode='OBJECT')

# ---- the lining takes the pattern place of the outside it sits under -----------------------------------------
bm.free(); bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.normal_update()
uvl = bm.loops.layers.uv.active
ob = bmesh.new()
omap = {}
for f in bm.faces:
    if lab[f.index] in PANELS:
        vs = [ob.verts.new(v.co) for v in f.verts]; nf = ob.faces.new(vs); omap[nf.index if False else len(omap)] = f.index
ob.faces.ensure_lookup_table()
obvh = BVHTree.FromBMesh(ob)
ofaces = [i for i in range(len(bm.faces)) if lab[i] in PANELS]
def uv_at(fi, p):
    f = bm.faces[fi]; L = list(f.loops)
    a, b, c = (lp.vert.co for lp in L[:3]); ua, ub, uc = (lp[uvl].uv for lp in L[:3])
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01 or 1e-12
    w1 = (d11 * d20 - d01 * d21) / den; w2 = (d00 * d21 - d01 * d20) / den; w0 = 1 - w1 - w2
    w0, w1, w2 = [min(1, max(0, w)) for w in (w0, w1, w2)]; t = (w0 + w1 + w2) or 1
    return (ua * w0 + ub * w1 + uc * w2) / t
for f in bm.faces:
    if lab[f.index] in PANELS: continue
    # one outside face for the whole lining face (keeps its UVs on one piece)
    hit = obvh.find_nearest(f.calc_center_median())
    if hit[0] is None: continue
    src = ofaces[hit[2]]
    for lp in f.loops: lp[uvl].uv = uv_at(src, lp.vert.co)
bm.to_mesh(me); me.update()

# ---- materials, then export -------------------------------------------------------------------------------
mats = {}
def mat(name):
    if name not in mats:
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name); mats[name] = len(mats); me.materials.append(m)
    return mats[name]
me.materials.clear()
mi = [mat('Fabric') if l in PANELS else mat('Inside') if l == INNER else mat('Cord') if l == CORD else mat('Zip') for l in lab]
me.polygons.foreach_set('material_index', mi)
# islands.json for trace.py: one entry per panel part, named
tot3 = sum(bm.faces[i].calc_area() for l, g in keep for i in g)
bm.free(); bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); uvl = bm.loops.layers.uv.active
totuv = sum(abs(sum(lp[uvl].uv.x * lq[uvl].uv.y - lq[uvl].uv.x * lp[uvl].uv.y for lp, lq in zip(list(bm.faces[i].loops)[-1:] + list(bm.faces[i].loops)[:-1], bm.faces[i].loops)) / 2) for l, g in keep for i in g)
k = math.sqrt(tot3 / totuv) * 100
isl = []
for l, grp in keep:
    a3 = 0; c3 = Vector()
    for i in grp: fa = bm.faces[i].calc_area(); c3 += bm.faces[i].calc_center_median() * fa; a3 += fa
    c3 /= a3 or 1
    pid, label = NAMES[l]
    isl.append({'material': f'Fabric|{pid}|{label}', 'centroid3d_cm': [round(c3.x * 100, 1), round(c3.z * 100, 1), round(-c3.y * 100, 1)],
                'polys': [[[round(lp[uvl].uv.x, 5), round(lp[uvl].uv.y, 5)] for lp in bm.faces[i].loops] for i in grp]})
json.dump({'cmPerUV': k, 'islands': isl}, open(OUT + '/islands.json', 'w'))
print('ISLANDS', len(isl), 'cmPerUV', round(k, 2))
bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT + '/model.glb', export_format='GLB', use_selection=True, export_apply=True,
    export_texcoords=True, export_normals=True, export_materials='EXPORT', export_yup=True, export_image_format='NONE')
bpy.ops.wm.save_as_mainfile(filepath=OUT + '/built.blend')
print('EXPORTED')
