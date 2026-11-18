# Turns a garment model WITHOUT a sewing pattern (one closed mesh, e.g. from an AI 3D generator) into a web garment:
# outside / lining, panels cut where a hoodie's seams are, each panel flattened into a pattern piece (UVs), drawcords
# and zip found, then a light GLB + islands.json for trace.py.
#   blender -b model.blend --python hoodie_build.py -- <object> <out-dir> <decimate-ratio> [labels-only|cut|all|work]
#     work: write the uncut mesh for the pattern cutter (app/cutter): work.glb (Outside / Inside) + work-auto.json
#     --usercut cut.json: cut along the seams drawn in the pattern cutter and use its pieces (instead of the rules)
import bpy, bmesh, sys, math, json, random, heapq
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
OBJ, OUT, RATIO = args[0], args[1], float(args[2])
MODE = args[3] if len(args) > 3 else 'all'   # 'labels-only' | 'cut' (stop after flattening, write panels.json) | 'all'
LABELS_ONLY = MODE == 'labels-only'
WORK = MODE == 'work'
UC = json.load(open(args[args.index('--usercut') + 1])) if '--usercut' in args else None

INNER, FRONT_L, FRONT_R, BACK, SLEEVE_L, SLEEVE_R, CUFF_L, CUFF_R, HEM_L, HOOD_L, HOOD_R, CORD, ZIP, HEM_R, HEM_B, POCKET_L, POCKET_R = range(17)
NAMES = {FRONT_L: ('frontL', 'Front · left'), FRONT_R: ('frontR', 'Front · right'), BACK: ('back', 'Back'),
         SLEEVE_L: ('sleeveL', 'Left sleeve'), SLEEVE_R: ('sleeveR', 'Right sleeve'), CUFF_L: ('cuffL', 'Left cuff'),
         CUFF_R: ('cuffR', 'Right cuff'), HEM_L: ('waistbandL', 'Waistband · front left'), HEM_R: ('waistbandR', 'Waistband · front right'),
         HEM_B: ('waistbandB', 'Waistband · back'), HOOD_L: ('hoodL', 'Hood · left'), HOOD_R: ('hoodR', 'Hood · right'),
         POCKET_L: ('pocketL', 'Pocket · left'), POCKET_R: ('pocketR', 'Pocket · right')}
PANELS = set(NAMES)
CUFF_TOP = 0.072  # rib cuffs ≈ 5.5 cm above the sleeve end, waistband ≈ 6 cm (as in the pattern)

o = bpy.data.objects[OBJ]
bpy.context.view_layer.objects.active = o; o.select_set(True)
if RATIO < 0.999:
    d = o.modifiers.new('d', 'DECIMATE'); d.ratio = RATIO; d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='d')
me = o.data

# ---- cut the mesh along the straight seam lines first ----------------------------------------------------------
# Labels below are given face by face. Without this, a seam follows the triangles and comes out as a zigzag (the
# zip edges, the waistband and cuff tops, the side seams). After these cuts no face straddles a seam line, so every
# panel ends on a clean line. Each cut is made only where that line is a seam (region), not across the whole model.
# The vertex normals are kept: a new vertex on an old edge takes the normal in between, so the cuts don't show.
def cut_seams(bm):
    nl = [bm.verts.layers.float.new(k) for k in ('nx', 'ny', 'nz')]
    bm.normal_update()
    for v in bm.verts:
        for k in range(3): v[nl[k]] = v.normal[k]
    X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
    ax = lambda c: abs(c.x)
    cuts = [  # (point on the plane, normal, where the line is a seam)
        ((0, 0, 0.06), Z, lambda c: ax(c) < 0.27 and c.z < 0.14),                       # waistband top
        ((0, 0, CUFF_TOP), Z, lambda c: ax(c) > 0.23 and c.z < 0.14),                   # cuff tops
        ((0, 0, 0.22), Z, lambda c: 0.21 < ax(c) < 0.27),                                # armhole steps
        ((0, 0, 0.6), Z, lambda c: 0.2 < ax(c) < 0.24),
        ((0, 0, 0.775), Z, lambda c: ax(c) < 0.23 and c.y < 0.07),                       # hood neckline (front, sides)
        ((0, 0, 0.8), Z, lambda c: ax(c) < 0.03 and c.y < -0.03),                        # zip top
        ((0, 0, 0), X, lambda c: True),                                                  # centre line
        ((0.0075, 0, 0), X, lambda c: c.y < -0.03 and c.z < 0.82),                       # zip edges
        ((-0.0075, 0, 0), X, lambda c: c.y < -0.03 and c.z < 0.82),
        ((0.25, 0, 0), X, lambda c: c.z < 0.24), ((-0.25, 0, 0), X, lambda c: c.z < 0.24),          # armholes
        ((0.225, 0, 0), X, lambda c: 0.2 < c.z < 0.62), ((-0.225, 0, 0), X, lambda c: 0.2 < c.z < 0.62),
        ((0.22, 0, 0), X, lambda c: c.z > 0.58), ((-0.22, 0, 0), X, lambda c: c.z > 0.58),
        ((0.2, 0, 0), X, lambda c: c.z > 0.74), ((-0.2, 0, 0), X, lambda c: c.z > 0.74),            # hood sides
        ((0, -0.01, 0), Y, lambda c: ax(c) < 0.27 and c.z < 0.8),                       # side seams
        ((0, -0.05, 0), Y, lambda c: ax(c) < 0.03 and c.z < 0.82),                      # zip (front only)
    ]
    for co, no, where in cuts:
        fs = [f for f in bm.faces if where(f.calc_center_median())]
        if not fs: continue
        es = list({e for f in fs for e in f.edges}); vs = list({v for f in fs for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=vs + es + fs, dist=0.0004, plane_co=co, plane_no=no)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    normals = {v: Vector((v[nl[0]], v[nl[1]], v[nl[2]])).normalized() for v in bm.verts}
    return normals

# ---- seams drawn in the pattern cutter (app/cutter) ---------------------------------------------------------------
# Each seam segment: the plane through its two points standing upright on the surface (normal = segment × average of
# the two surface normals), cut with the part of the surface joined to the two points within reach of the segment
# (the same rule the cutter draws with). Points are in Blender's axes, metres.
def uc_segments(UC):
    out = []
    for s_ in UC.get('seams', []):
        pts = s_['pts']; pairs = list(zip(pts, pts[1:]))
        if s_.get('closed') and len(pts) > 2: pairs.append((pts[-1], pts[0]))
        for a, b in pairs:
            pa, na, pb, nb_ = Vector(a[:3]), Vector(a[3:6]).normalized(), Vector(b[:3]), Vector(b[3:6]).normalized()
            d = pb - pa; L = d.length
            if L < 1e-4: continue
            dr = d / L; navg = na + nb_
            if navg.length < 0.2: navg = na.copy()
            navg.normalize(); pn = dr.cross(navg)
            if pn.length < 1e-3: pn = dr.cross(Vector((0, 0, 1)) if abs(dr.z) < 0.9 else Vector((1, 0, 0)))
            pn.normalize()
            out.append({'pa': pa, 'pb': pb, 'na': na, 'nb': nb_, 'dr': dr, 'L': L, 'navg': navg, 'pn': pn, 'r': max(0.02, 0.35 * L)})
    return out
def uc_nearest(bm_, tree, p, n):
    best = None
    for loc, nrm, fi, dist in tree.find_nearest_range(p, 0.03):
        f = bm_.faces[fi]
        if f.normal.dot(n) < 0.2: continue
        if best is None or dist < best[0]: best = (dist, fi)
    if best is None:
        h = tree.find_nearest(p); return h[2]
    return best[1]
def uc_capsule(bm_, tree, sg):
    # faces joined to the two end points within reach of the segment, facing about the same way
    pa, dr, L, r, navg = sg['pa'], sg['dr'], sg['L'], sg['r'], sg['navg']
    def near(c):
        w = c - pa; t = min(L, max(0.0, w.dot(dr))); return (w - dr * t).length <= r
    def ok(f):  # its centre or a corner within reach (a long thin triangle crossing the seam has its centre far off)
        return f.normal.dot(navg) > -0.2 and (near(f.calc_center_median()) or any(near(v.co) for v in f.verts))
    fa = uc_nearest(bm_, tree, pa, sg['na']); fb = uc_nearest(bm_, tree, sg['pb'], sg['nb'])
    seen = {fa, fb}; st = [fa, fb]
    while st:
        f = bm_.faces[st.pop()]
        for e in f.edges:
            for g in e.link_faces:
                if g.index not in seen and ok(g): seen.add(g.index); st.append(g.index)
    return seen, fa, fb
def user_cut_seams(bm_, SEG):
    nl = [bm_.verts.layers.float.new(k) for k in ('nx', 'ny', 'nz')]
    bm_.normal_update()
    for v in bm_.verts:
        for k in range(3): v[nl[k]] = v.normal[k]
    for sg in SEG:
        bm_.faces.ensure_lookup_table(); tree = BVHTree.FromBMesh(bm_)
        seen, fa, fb = uc_capsule(bm_, tree, sg)
        pa, pn, dr, L = sg['pa'], sg['pn'], sg['dr'], sg['L']
        cut = set()
        for fi in seen:
            f = bm_.faces[fi]; ds = [(v.co - pa).dot(pn) for v in f.verts]
            if min(ds) > 1e-7 or max(ds) < -1e-7: continue
            ts = [(v.co - pa).dot(dr) for v in f.verts]
            if max(ts) < 0 or min(ts) > L: continue
            cut.add(f)
        cut.update((bm_.faces[fa], bm_.faces[fb]))
        fs = list(cut); es = list({e for f in fs for e in f.edges}); vs = list({v for f in fs for v in f.verts})
        bmesh.ops.bisect_plane(bm_, geom=vs + es + fs, dist=0.0002, plane_co=pa, plane_no=pn)
    bmesh.ops.triangulate(bm_, faces=[f for f in bm_.faces if len(f.verts) > 3])
    return {v: Vector((v[nl[0]], v[nl[1]], v[nl[2]])).normalized() for v in bm_.verts}

bm = bmesh.new(); bm.from_mesh(me)
SEG = uc_segments(UC) if UC else []
vnorm = None if WORK else user_cut_seams(bm, SEG) if UC else cut_seams(bm)
if vnorm:
    bm.verts.index_update()
    vn = [None] * len(bm.verts)
    for v, n in vnorm.items(): vn[v.index] = n
bm.to_mesh(me); bm.free(); me.update()
if vnorm:
    if hasattr(me, 'use_auto_smooth'): me.use_auto_smooth = True
    me.normals_split_custom_set_from_vertices([tuple(n) for n in vn])
if UC: print('USER CUT', len(UC.get('seams', [])), 'seams,', len(SEG), 'segments cut;', len(UC.get('fills', [])), 'fills,', len(UC.get('strokes', [])), 'brush strokes')
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
    # in the neck opening: from here you see the inside of the neck and the hood's lining behind it, which faces up and
    # forward (it sees the sky, so without these it came out as outside in patches)
    for x, y, z in ((0, -0.02, 0.78), (0, 0.0, 0.8), (0.05, 0.0, 0.8), (-0.05, 0.0, 0.8), (0, 0.03, 0.82)):
        p = Vector((x, y, z))
        # only where that point is in the air (not inside the cloth): the nearest surface faces it
        loc, nrm, fi, d = bvh.find_nearest(p)
        if loc is not None and d > 0.01 and nrm.dot(p - loc) > 0: pts.append(p)
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
# the hood's lining behind the neck (what you see inside the hood from the front) faces forward up to the hood's top
# edge, where the cloth turns to face up. It sits well back (y > 6 cm), the hood's outside walls either side of it sit
# forward (y < 4 cm). Seen first from the front, facing forward, that far back → lining; the line to the outside is
# then the hood's top edge
hood_in = 0
for i in range(F):
    c = cen[i]; n = bm.faces[i].normal
    if not outer[i] or comp[i] != main or not (0.8 < c.z < 0.94 and c.y > 0.06 and abs(c.x) < 0.16 and n.y < -0.15 and n.z < 0.85): continue
    h = bvh.ray_cast(Vector((c.x, -1.0, c.z)), Vector((0, 1, 0)), 3.0)
    if h[0] is not None and (h[2] == i or (h[0] - c).length < 0.003): outer[i] = False; hood_in += 1
print('hood lining seen from the front:', hood_in, 'faces')
# pockets: the bag behind the front is reachable from outside through the pocket opening, but it is inside the garment:
# whatever has the outside of the front right in front of it (looking forward, within 4 cm) is lining. Without this the
# bag hangs off the front as flaps when the front is flattened
pocket_in = 0
for i in range(F):
    c = cen[i]
    if not outer[i] or comp[i] != main or not (0.04 < c.z < 0.45 and c.y < 0.0 and 0.01 < abs(c.x) < 0.19): continue   # the front torso (not the sleeves)
    p0 = c + Vector((0, -0.0005, 0)); travelled = 0.0
    for _ in range(6):
        h = bvh.ray_cast(p0, Vector((0, -1, 0)), 0.04 - travelled)
        if h[0] is None: break
        travelled += h[3]
        if outer[h[2]] and h[1].y < -0.2 and travelled > 0.002: outer[i] = False; pocket_in += 1; break
        p0 = h[0] + Vector((0, -0.0004, 0)); travelled += 0.0004
print('pocket bags (behind the front) → lining:', pocket_in, 'faces')
# islands: inside the hood some of the lining sees the sky through the opening and came out as outside, in patches.
# Any patch of outside not joined to the main outside (smaller than 150 cm²) is lining, and a small hole of lining in
# the outside (smaller than 20 cm²) is outside.
def islands_of(flag):
    seen = [False] * F; out = []
    for i0 in range(F):
        if seen[i0] or outer[i0] != flag or comp[i0] != main: continue
        grp = [i0]; seen[i0] = True; st = [i0]
        while st:
            i = st.pop()
            for j in nbrs[i]:
                if not seen[j] and outer[j] == flag and comp[j] == main: seen[j] = True; grp.append(j); st.append(j)
        out.append(grp)
    return sorted(out, key=len)
area = [f.calc_area() for f in bm.faces]
fixed = [0, 0]
for grp in islands_of(True)[:-1]:
    if sum(area[i] for i in grp) < 0.015:
        for i in grp: outer[i] = False
        fixed[0] += len(grp)
for grp in (islands_of(False)[:-1] if '--no-holes' not in args else []):
    if sum(area[i] for i in grp) < 0.002:
        for i in grp: outer[i] = True
        fixed[1] += len(grp)
print('outside patches → lining', fixed[0], 'faces; lining holes → outside', fixed[1])
print('OUTSIDE', sum(outer), 'LINING', F - sum(outer), 'lining seeds', len(lining_seed))

# ---- panels, cut where a hoodie's seams are (+x = the wearer's left; front = -y; metres) ----------------------
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
# (off by default: prints run over the pocket, which stays marked on the front piece; a separate pocket piece cut
# the print off in a zigzag where the pocket starts)
POCKETS = '--pockets' in args
for i in (range(F) if POCKETS else ()):
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
# where the hood lies on the back, hood and back are parted by the hood's rim. A face is hood when, looking from it
# straight into the body, there is more of the outside of the garment within 12 cm (the hood lies on the back: behind
# its top layer are its other layer and the back); the back sees only its own lining and the body's hollow (the front
# is much further). The hood's rim curls under (its outside faces the body there): hood too. So the line between them
# is the rim you see, not a ragged line across the hood or the back.
zone = [i for i in range(F) if outer[i] and lab[i] in (BACK, HOOD_L, HOOD_R) and cen[i].y > 0.04 and 0.5 < cen[i].z < 0.86]
def garment_behind(i, reach=0.12):
    p0 = cen[i] + Vector((0, -0.0004, 0)); travelled = 0.0
    for _ in range(8):
        h = bvh.ray_cast(p0, Vector((0, -1, 0)), reach - travelled)
        if h[0] is None: return False
        travelled += h[3]
        if outer[h[2]] and travelled > 0.004: return True
        p0 = h[0] + Vector((0, -0.0004, 0)); travelled += 0.0004
    return False
n_hood = 0
for i in zone:
    hood = cen[i].z > 0.82 or bm.faces[i].normal.y < -0.2 or garment_behind(i)
    lab[i] = (HOOD_L if cen[i].x > 0 else HOOD_R) if hood else BACK; n_hood += hood
print('hood/back zone', len(zone), 'faces,', n_hood, 'hood')
# loose bits: a bit of back not joined to the back (where the look passed through the hood's opening) is hood; then a
# bit of hood not joined to the hood (on the back, near the arms) is back
def components(l):
    seen = set(); out = []
    for i0 in range(F):
        if lab[i0] != l or i0 in seen: continue
        grp = [i0]; seen.add(i0); st = [i0]
        while st:
            i = st.pop()
            for j in nbrs[i]:
                if lab[j] == l and j not in seen: seen.add(j); grp.append(j); st.append(j)
        out.append(grp)
    return sorted(out, key=len)
zset = set(zone); moved = [0, 0]
for grp in components(BACK)[:-1]:
    if all(i in zset for i in grp):
        for i in grp: lab[i] = HOOD_L if cen[i].x > 0 else HOOD_R
        moved[0] += len(grp)
for l in (HOOD_L, HOOD_R):
    for grp in components(l)[:-1]:
        if all(i in zset for i in grp):
            for i in grp: lab[i] = BACK
            moved[1] += len(grp)
print('loose bits: back → hood', moved[0], 'faces, hood → back', moved[1])
# tidy up: a face takes the label most of its neighbours have (panels only, cords and lining stay)
# (a face on a straight seam line, with the rule's label on both sides, is left alone: that line is already clean)
rule = [panel(cen[i]) if outer[i] else INNER for i in range(F)]
for it in range(3):
    new = lab[:]
    for i in range(F):
        if lab[i] in (INNER, CORD): continue
        if lab[i] == rule[i] and all(lab[j] == rule[j] for j in nbrs[i]): continue
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
# a cord hangs along a smooth line: fit that line (x against height, ignoring what lies off it) and keep only what is
# within a cord's width of it (a fold of fabric next to a cord is not the cord)
for sgn in (1, -1):
    ids = [i for i in range(F) if lab[i] == CORD and cen[i].x * sgn > 0]
    if len(ids) < 30: continue
    use = ids[:]
    for it in range(5):
        zs = [cen[i].z for i in use]; xs = [cen[i].x for i in use]
        n = len(use); sz = sum(zs) / n
        # least squares x = a + b·(z - sz) + c·(z - sz)²
        S = [[0.0] * 3 for _ in range(3)]; R = [0.0] * 3
        for z, x in zip(zs, xs):
            t = z - sz; v = (1, t, t * t)
            for r in range(3):
                R[r] += v[r] * x
                for c_ in range(3): S[r][c_] += v[r] * v[c_]
        # solve 3×3
        import copy
        M = copy.deepcopy(S); B = R[:]
        for col in range(3):
            pv = max(range(col, 3), key=lambda r: abs(M[r][col])); M[col], M[pv] = M[pv], M[col]; B[col], B[pv] = B[pv], B[col]
            for r in range(3):
                if r != col and M[col][col]:
                    f_ = M[r][col] / M[col][col]
                    for c_ in range(3): M[r][c_] -= f_ * M[col][c_]
                    B[r] -= f_ * B[col]
        a, b, c2 = (B[r] / M[r][r] if M[r][r] else 0 for r in range(3))
        line = lambda z: a + b * (z - sz) + c2 * (z - sz) ** 2
        tol = [0.012, 0.009, 0.007, 0.0055, 0.0055][it]
        use = [i for i in ids if abs(cen[i].x - line(cen[i].z)) < tol] or use
    dropped = 0
    for i in ids:
        if abs(cen[i].x - line(cen[i].z)) >= 0.0055: lab[i] = panel(cen[i]); dropped += 1
    print('cord', 'left' if sgn > 0 else 'right', len(ids), 'faces,', dropped, 'off its line dropped')
# the zip: a narrow strip down the centre front
for i in range(F):
    x, y, z = cen[i]
    if lab[i] in (FRONT_L, FRONT_R, HEM_L, HEM_R) and abs(x) < 0.0075 and y < -0.05 and z < 0.8: lab[i] = ZIP


# ---- the pieces from the pattern cutter, instead of the rules above ------------------------------------------------
def user_labels(UC, SEG):
    global outer
    ids = {v[0]: k for k, v in NAMES.items()}; ids.update({'zip': ZIP, 'cords': CORD, 'lining': INNER})
    nxt = 20
    for pc in UC.get('pieces', []):
        if pc['id'] not in ids: ids[pc['id']] = nxt; NAMES[nxt] = (pc['id'], pc['name']); PANELS.add(nxt); nxt += 1
    tree = BVHTree.FromBMesh(bm)
    # seam edges: on a seam's plane, within its segment
    seam = set()
    for sg in SEG:
        seen, _, _ = uc_capsule(bm, tree, sg)
        pa, pn, dr, L = sg['pa'], sg['pn'], sg['dr'], sg['L']
        for fi in seen:
            for e in bm.faces[fi].edges:
                a, b = e.verts
                if abs((a.co - pa).dot(pn)) < 3e-4 and abs((b.co - pa).dot(pn)) < 3e-4 and -0.004 < ((a.co + b.co) / 2 - pa).dot(dr) < L + 0.004: seam.add(e.index)
    print('seam edges', len(seam))
    if '--debug-seams' in args:
        deg = {}
        for ei in seam:
            for v in bm.edges[ei].verts: deg[v.index] = deg.get(v.index, 0) + 1
        ends = [bm.verts[v].co for v, d in deg.items() if d == 1]
        print('seam loose ends', len(ends), [[round(c.x, 4), round(c.y, 4), round(c.z, 4)] for c in ends[:12]])
        for v, d in deg.items():
            if d != 1: continue
            V_ = bm.verts[v]
            for sg in SEG:
                dd = (V_.co - sg['pa']).dot(sg['pn']); t = (V_.co - sg['pa']).dot(sg['dr'])
                if abs(dd) < 3e-4 and 0.005 < t < sg['L'] - 0.005:
                    print(' loose end mid-segment', [round(c, 4) for c in V_.co], 't', round(t, 4), 'L', round(sg['L'], 4))
                    for e in V_.link_edges:
                        w = e.other_vert(V_); print('   edge to', [round(c, 4) for c in w.co], 'plane dist', round((w.co - sg['pa']).dot(sg['pn']) * 1000, 3), 'mm', 'faces', [(round(f.normal.dot(sg['navg']), 2), round(((f.calc_center_median() - sg['pa']) - sg['dr'] * min(sg['L'], max(0, (f.calc_center_median() - sg['pa']).dot(sg['dr'])))).length, 4)) for f in e.link_faces])
    side = outer[:]
    ul = [None] * F
    for fl in UC.get('fills', []):
        if fl['piece'] not in ids: continue
        L_ = ids[fl['piece']]; p = Vector(fl['p'][:3]); n = Vector(fl['p'][3:6]); want = not fl.get('inside', False)
        best = None
        for loc, nrm, fi, dist in tree.find_nearest_range(p, 0.03):
            if side[fi] == want and bm.faces[fi].normal.dot(n) > 0.2 and (best is None or dist < best[0]): best = (dist, fi)
        if best is None: print('fill', fl['piece'], 'found no surface'); continue
        f0 = best[1]; reg = [f0]; seen = {f0}
        for i in reg:
            for e in bm.faces[i].edges:
                if e.index in seam: continue
                for g in e.link_faces:
                    j = g.index
                    if j not in seen and side[j] == side[f0]: seen.add(j); reg.append(j)
        for i in reg: ul[i] = L_
        print('fill', fl['piece'], len(reg), 'faces')
    base = ul[:]
    for st in UC.get('strokes', []):
        L_ = ids.get(st['piece']) if st.get('piece') else None
        if st.get('piece') and L_ is None: continue
        for q in st['pts']:
            p = Vector(q[:3]); n = Vector(q[3:6])
            for loc, nrm, fi, dist in tree.find_nearest_range(p, st['r'] + 0.004):
                if (cen[fi] - p).length <= st['r'] and bm.faces[fi].normal.dot(n) >= 0.2: ul[fi] = L_ if st.get('piece') else base[fi]
    out = []
    for i in range(F):
        if ul[i] is None: out.append(17 if outer[i] else INNER)   # outside nobody filled: follows the nearest piece
        else: out.append(ul[i]); outer[i] = ul[i] != INNER
    cnt_ = {}
    for l in out: cnt_[NAMES.get(l, ('lining' if l == INNER else 'zip' if l == ZIP else 'cords' if l == CORD else 'not filled',))[0]] = cnt_.get(NAMES.get(l, ('lining' if l == INNER else 'zip' if l == ZIP else 'cords' if l == CORD else 'not filled',))[0], 0) + 1
    print('USER PIECES', cnt_)
    return out
if UC: lab = user_labels(UC, SEG)

# ---- work mesh for the pattern cutter: the uncut model, Outside / Inside, and the rules' cut to compare with -----------
if WORK:
    import base64
    me.materials.clear()
    for n_ in ('Outside', 'Inside'): me.materials.append(bpy.data.materials.get(n_) or bpy.data.materials.new(n_))
    mi = [0 if outer[i] else 1 for i in range(F)]
    bm.to_mesh(me); me.polygons.foreach_set('material_index', mi); me.update()
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=OUT + '/work.glb', export_format='GLB', use_selection=True, export_apply=True, export_texcoords=False,
        export_normals=False, export_materials='EXPORT', export_yup=True, export_image_format='NONE')
    # the glTF has one primitive per material, triangles in the mesh's order: Outside first, then Inside
    order = [i for i in range(F) if mi[i] == 0] + [i for i in range(F) if mi[i] == 1]
    idl = sorted({NAMES[l][0] for l in lab if l in NAMES} | ({'zip'} if ZIP in lab else set()) | ({'cords'} if CORD in lab else set()))
    code = {k: n_ + 1 for n_, k in enumerate(idl)}
    def lid(l): return code.get(NAMES[l][0]) if l in NAMES else code.get('zip') if l == ZIP else code.get('cords') if l == CORD else 0
    raw = bytes(lid(lab[i]) or 0 for i in order)
    to3 = lambda c: [round(c.x, 5), round(c.z, 5), round(-c.y, 5)]
    check = [[k] + to3(cen[order[k]]) for k in (0, 1, 2, len(order) // 2, len(order) - 1)]
    json.dump({'faces': F, 'ids': idl, 'labels': base64.b64encode(raw).decode(), 'check': check}, open(OUT + '/work-auto.json', 'w'), separators=(',', ':'))
    print('WORK', F, 'faces →', OUT + '/work.glb', OUT + '/work-auto.json'); sys.exit(0)

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
# the body's sides under the arms reach past the armhole line but are not part of the sleeve (not joined to it):
# they belong to the front / back, cut at the side seam like the rest of the body
def body(c):
    x, y, z = c; L = x > 0
    if z < 0.06: return (HEM_L if L else HEM_R) if y < -0.01 else HEM_B
    return (FRONT_L if L else FRONT_R) if y < -0.01 else BACK
# (they hang off the front/back as flaps when flattened; fit_panels stands each piece upright by its 3D height, so they
# don't tilt it. --strays-for-sides leaves them as stray bits that take the nearest piece's print instead)
for l in ((SLEEVE_L, SLEEVE_R, CUFF_L, CUFF_R) if not UC and '--strays-for-sides' not in args else ()):
    seen = set(); comps = []
    for i0 in range(F):
        if lab[i0] != l or i0 in seen: continue
        grp = [i0]; seen.add(i0); st = [i0]
        while st:
            i = st.pop()
            for j in nbrs[i]:
                if lab[j] == l and j not in seen: seen.add(j); grp.append(j); st.append(j)
        comps.append(grp)
    comps.sort(key=len)
    for grp in comps[:-1]:
        for i in grp: lab[i] = body(cen[i])
    if len(comps) > 1: print(NAMES[l][0], len(comps) - 1, 'loose bits given to the body,', sum(len(g) for g in comps[:-1]), 'faces')
# drawcords: cut out of the front (their tube would add width to the flattened front and bend it). With
# --cords-in-panel they stay part of the panel under them for flattening instead; only their material is the cord's
is_cord = [l == CORD for l in lab] if '--cords-in-panel' in args else [False] * F
if not UC:
    for i in range(F):
        if is_cord[i]: lab[i] = panel(cen[i])
else:  # the piece next to them
    q_ = [i for i in range(F) if not is_cord[i] and lab[i] in PANELS]; got = set(q_)
    for i in q_:
        for j in nbrs[i]:
            if is_cord[j] and j not in got: lab[j] = lab[i]; got.add(j); q_.append(j)
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
        # a disk, or a hole (a pocket opening): fine to flatten. A tube has a second opening about as long as the first
        if len(loops) < 2 or loops[1][0] < 0.12 or loops[1][0] < 0.3 * loops[0][0]: break
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
    json.dump([CORD if is_cord[i] else lab[i] for i in range(F)], open(OUT + '/labels.json', 'w'))
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
