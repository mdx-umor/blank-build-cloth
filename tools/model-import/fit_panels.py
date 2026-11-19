# Fit each flattened 3D panel (panels.json from hoodie_build.py 'cut') onto its traced pattern piece (from
# trace_screenshot.py): match size and place, pin the panel's outline onto the piece's outline, and let the inside
# follow smoothly (a harmonic map with the 3D mesh's cotangent weights). Writes fit.json (flat position of every panel
# vertex, in sheet cm) and the app's pieces.json.
#   python3 fit_panels.py panels.json traced.json pairs.json shot.png fit.json pieces.json
import sys, json, math, cv2, numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve

Pj, Tj, pairs, shot, out_fit, out_pieces = sys.argv[1:7]
panels = json.load(open(Pj))['panels']; T = json.load(open(Tj)); pairs = json.load(open(pairs))
k = T['cm_per_px']; M = 6.0  # sheet margin (cm)
ox, oy = pairs.get('crop', [0, 0])[:2]

def area(P): return 0.5 * sum(P[i - 1][0] * P[i][1] - P[i][0] * P[i - 1][1] for i in range(len(P)))
def centroid(P):
    a = area(P) or 1e-9; cx = cy = 0
    for i in range(len(P)):
        x0, y0 = P[i - 1]; x1, y1 = P[i]; c = x0 * y1 - x1 * y0; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    return [cx / (6 * a), cy / (6 * a)]
def mirrored_half(P, keep_left=True):
    """symmetric piece from its left half (the back's right side is cut off by the window edge)"""
    xs = [p[0] for p in P]; ys = [p[1] for p in P]
    S = 8; x0, y0 = min(xs) - 2, min(ys) - 2
    mask = np.zeros((int((max(ys) - y0 + 4) * S), int((max(xs) - x0 + 4) * S) * 2), np.uint8)
    cv2.fillPoly(mask, [np.round((np.array(P) - [x0, y0]) * S).astype(np.int32)], 255)
    cx = pairs.get('back_centre_cm') or (min(xs) + max(xs)) / 2
    c = int(round((cx - x0) * S)); half = mask[:, :c].copy()
    sym = np.zeros_like(mask); sym[:, :c] = half; sym[:, c:c + c] = half[:, ::-1][:, :min(c, mask.shape[1] - c)]
    cs, _ = cv2.findContours(sym, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cc = max(cs, key=cv2.contourArea)
    return [[x / S + x0, y / S + y0] for x, y in cv2.approxPolyDP(cc, 1.2, True)[:, 0, :]]

# ---- the pieces, in sheet cm (the screenshot's own layout, which is a sensible cutting layout) ------------------
pieces = {}
for pid, info in pairs['pieces'].items():
    tp = T['pieces'][info['traced']]
    P = [[x * k, y * k] for x, y in tp['poly_px']]
    if info.get('mirror_left_half'): P = mirrored_half(P)
    if area(P) < 0: P = P[::-1]
    pieces[pid] = {'poly': P, 'rib': tp['rib'], 'label': info['label']}
minx = min(x for p in pieces.values() for x, _ in p['poly']); miny = min(y for p in pieces.values() for _, y in p['poly'])
for p in pieces.values(): p['poly'] = [[x - minx + M, y - miny + M] for x, y in p['poly']]

# ---- pocket outlines: the red lines drawn on the front pieces --------------------------------------------------
img = cv2.imread(shot)[:, :, ::-1].astype(int)
def pocket_outline(front_traced, side):
    x, y, w, h = T['pieces'][front_traced]['px_bbox']
    X0, Y0 = x + ox, y + oy
    sub = img[Y0:Y0 + h, X0:X0 + w]
    red = (sub[..., 0] - sub[..., 1] > 25) & (sub[..., 0] - sub[..., 2] > 25) & (sub[..., 1] < 200)  # thin maroon lines
    ys, xs = np.nonzero(red)
    keep = (ys > h * 0.55) & ((xs > 3) if side == 'zip-left' else (xs < w - 4))  # lower part, not the zip's stitching
    ys, xs = ys[keep], xs[keep]
    if len(xs) < 10: return None
    pts = np.stack([xs + x, ys + y], 1).astype(np.float32)
    # the pocket runs from its red outline to the zip edge and down to the hem
    zipx = x if side == 'zip-left' else x + w
    pts = np.concatenate([pts, [[zipx, pts[:, 1].min()], [zipx, y + h], [pts[:, 0].min() if side == 'zip-left' else pts[:, 0].max(), y + h]]]).astype(np.float32)
    hull = cv2.convexHull(pts)[:, 0, :]
    return [[float(px * k - minx + M), float(py * k - miny + M)] for px, py in hull]

# ---- fit every panel -------------------------------------------------------------------------------------------
fit = {}; report = []
# one scale for the whole garment: the 3D model is made the size of the pattern (main pieces' areas)
_main = [pn for pn in panels if pn['id'] in pieces and not pieces[pn['id']]['rib'] and not pn['id'].startswith('pocket')]
_tri_a = lambda pn: sum(abs((np.array(pn['verts'])[t[1], 3] - np.array(pn['verts'])[t[0], 3]) * (np.array(pn['verts'])[t[2], 4] - np.array(pn['verts'])[t[0], 4]) - (np.array(pn['verts'])[t[2], 3] - np.array(pn['verts'])[t[0], 3]) * (np.array(pn['verts'])[t[1], 4] - np.array(pn['verts'])[t[0], 4])) / 2 for t in pn['tris'])
# (pocket panels lie on the fronts: the front pieces of the pattern include their area)
_pk = [pn for pn in panels if pn['id'].startswith('pocket')]
scale_all = math.sqrt(sum(abs(area(pieces[pn['id']]['poly'])) for pn in _main) / sum(_tri_a(pn) for pn in _main + _pk))
print('model scale to match the pattern:', round(scale_all, 3))
wb = [np.array(p['verts'])[:, :2] for p in panels if p['id'].startswith('waistband')]
torso_c = np.concatenate(wb).mean(0) if wb else np.zeros(2)
import os
_only = set(filter(None, os.environ.get('FIT_ONLY', '').split(',')))   # for experiments: fit only these panels
for pn in panels:
    pid = pn['id']
    if pid not in pieces or (_only and pid not in _only): continue
    V = np.array(pn['verts']); X3, F2 = V[:, :3], V[:, 3:5].copy(); tris = np.array(pn['tris'])
    n = len(V)
    # outline of the panel (edges used by one triangle), the longest loop
    cnt = {}
    for t in tris:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            key = (min(a, b), max(a, b)); cnt[key] = cnt.get(key, 0) + 1
    adj = {}
    for (a, b), c in cnt.items():
        if c == 1: adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
    loops = []; seen = set()
    for s0 in adj:
        if s0 in seen: continue
        loop = [s0]; seen.add(s0); prev, cur = None, s0
        while True:
            nxt = [v for v in adj[cur] if v != prev and v not in seen]
            if not nxt: break
            prev, cur = cur, nxt[0]; loop.append(cur); seen.add(cur)
        loops.append(loop)
    bloop = max(loops, key=lambda L: sum(np.linalg.norm(F2[L[i]] - F2[L[i - 1]]) for i in range(len(L))))
    P = pieces[pid]['poly']; Ap = abs(area(P)); Cp = np.array(centroid(P))
    if pieces[pid]['rib']:
        # rib bands (cuffs, waistband): along the band = the angle round its axis (unwrapped across the panel, so the
        # cut edge of a cuff stays at the two ends), across = height; stretched evenly onto the rectangle
        if pid.startswith('waistband'): c = torso_c
        else: c = X3[:, :2].mean(0)
        ang = np.arctan2(X3[:, 1] - c[1], X3[:, 0] - c[0])
        nb = {}
        for t in tris:
            for a_, b_ in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])): nb.setdefault(a_, set()).add(b_); nb.setdefault(b_, set()).add(a_)
        un = np.full(n, np.nan); start = int(np.argmin(X3[:, 2])); un[start] = ang[start]; stack = [start]
        while stack:
            v = stack.pop()
            for w in nb.get(v, ()):
                if np.isnan(un[w]): un[w] = un[v] + (ang[w] - ang[v] + np.pi) % (2 * np.pi) - np.pi; stack.append(w)
        un = np.nan_to_num(un, nan=np.nanmean(un))
        Rm = np.hypot(X3[:, 0] - c[0], X3[:, 1] - c[1]).mean()
        uu = un * Rm * 100; vv = -X3[:, 2] * 100   # left-to-right seen from outside = round the axis; top = highest
        xs = [x for x, _ in P]; ys = [y for _, y in P]
        out = np.column_stack([min(xs) + (uu - uu.min()) / (np.ptp(uu) or 1) * (max(xs) - min(xs)), min(ys) + (vv - vv.min()) / (np.ptp(vv) or 1) * (max(ys) - min(ys))])
        fit[pid] = out.round(3).tolist()
        report.append(f"{pid:12s} rib band: {np.ptp(uu):.0f} × {np.ptp(vv):.1f} cm round the body → {max(xs) - min(xs):.0f} × {max(ys) - min(ys):.1f} cm piece")
        continue
    if pairs.get('method', 'shape') == 'shape':
        # keep the panel's own flat shape (prints stay true), at the pattern's scale; slide/turn it over the piece
        # to where they overlap most, then tuck in whatever sticks out past the piece's edge
        # stand it upright: the direction the 3D height grows in on the flat piece points up the sheet (−y)
        A_ = np.column_stack([F2[:, 0], F2[:, 1], np.ones(n)]); ga, gb, _ = np.linalg.lstsq(A_, X3[:, 2], rcond=None)[0]
        if ga * ga + gb * gb > 1e-12:
            rot = -math.pi / 2 - math.atan2(gb, ga); cr, sr = math.cos(rot), math.sin(rot)
            c0 = F2.mean(0); F2 = (F2 - c0) @ np.array([[cr, sr], [-sr, cr]]) + c0
            if abs(math.degrees(rot)) > 2: print(f'{pid}: stood upright, turned {math.degrees(rot):.0f}°')
        G0 = F2 * scale_all; S_ = 2.0
        if pid.startswith('pocket'):
            # a pocket cut on the model can be bigger or smaller than the pattern's pocket piece: make it the piece's
            # size (same shape), so a print in the middle of the piece sits in the middle of the pocket
            Ta = np.abs((G0[tris[:, 1], 0] - G0[tris[:, 0], 0]) * (G0[tris[:, 2], 1] - G0[tris[:, 0], 1]) - (G0[tris[:, 2], 0] - G0[tris[:, 0], 0]) * (G0[tris[:, 1], 1] - G0[tris[:, 0], 1])).sum() / 2
            if Ta > 0:
                k_ = math.sqrt(Ap / Ta); G0 = (G0 - G0.mean(0)) * k_ + G0.mean(0)
                print(f'{pid}: made the size of the pattern piece (×{k_:.2f})')
        Pa = np.array(P); x0, y0 = np.minimum(Pa.min(0), G0.min(0) - Cp + Pa.mean(0)) - 40; Wd, Hd = int((Pa[:, 0].max() - x0 + 80) * S_), int((Pa[:, 1].max() - y0 + 80) * S_)
        mp = np.zeros((Hd, Wd), np.float32); cv2.fillPoly(mp, [np.round((Pa - [x0, y0]) * S_).astype(np.int32)], 1.0)
        best = None
        for deg in (-6, -3, 0, 3, 6):
            th = math.radians(deg); Rm = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
            Gr = (G0 - G0.mean(0)) @ Rm.T + Cp
            mi = np.zeros_like(mp)
            for t in tris: cv2.fillConvexPoly(mi, np.round((Gr[t] - [x0, y0]) * S_).astype(np.int32), 1.0)
            cc = np.real(np.fft.ifft2(np.fft.fft2(mp) * np.conj(np.fft.fft2(mi))))
            iy, ix = np.unravel_index(np.argmax(cc), cc.shape); val = cc[iy, ix]
            dy = iy if iy < Hd / 2 else iy - Hd; dx = ix if ix < Wd / 2 else ix - Wd
            if best is None or val > best[0]: best = (val, Gr + np.array([dx, dy]) / S_, deg)
            if deg == 0: upright = (val, Gr + np.array([dx, dy]) / S_, deg)
        # pieces hang upright: keep it straight unless turning fits clearly better (a turned piece tilts the print)
        if best[2] != 0 and upright[0] >= best[0] * 0.97: best = upright
        out = best[1]
        # anchor by a seam: slide sideways so a known line of the 3D panel sits on the matching edge of the piece
        X = X3[:, 0]; Y = X3[:, 1]; Z = X3[:, 2]; px0, px1 = Pa[:, 0].min(), Pa[:, 0].max()
        anchor = None
        if pid == 'back' and (np.abs(X) < 0.01).sum() > 5: anchor = (np.median(out[np.abs(X) < 0.01, 0]), (px0 + px1) / 2)
        elif pid in ('frontL', 'frontR') and (np.abs(X) < 0.012).sum() > 5:
            anchor = (np.median(out[np.abs(X) < 0.012, 0]), px0 if pid == 'frontL' else px1)        # the zip edge
        elif pid.startswith('sleeve'):
            top = np.argsort(-Z)[:12]; peak = Pa[np.argmin(Pa[:, 1])]; anchor = (np.median(out[top, 0]), peak[0])   # shoulder point → cap top
        elif pid.startswith('hood'):
            face = Y < Y.min() + 0.02                                                                  # the face opening
            if face.sum() > 5: anchor = (np.median(out[face, 0]), px0 if pid == 'hoodL' else px1)
        if anchor: out[:, 0] += anchor[1] - anchor[0]
        # ease in: what sticks out past the piece's edge is brought inside by squeezing a band along the edge (as wide
        # as needed, at least 4 cm), along the edge's normal, so nothing is crushed onto the edge line (that smears a
        # print); how far to squeeze varies smoothly along the edge
        Pf = Pa.astype(np.float32); E0 = Pa; E1 = np.roll(Pa, -1, 0); dE = E1 - E0
        ins = np.array([cv2.pointPolygonTest(Pf, (float(x), float(y)), False) >= 0 for x, y in out])
        def nearest_edge(q):
            tt = np.clip(((q - E0) * dE).sum(1) / ((dE * dE).sum(1) + 1e-12), 0, 1); pr = E0 + dE * tt[:, None]
            k = np.argmin(((pr - q) ** 2).sum(1)); return pr[k], math.sqrt(((pr[k] - q) ** 2).sum())
        dist_in = np.array([cv2.pointPolygonTest(Pf, (float(x), float(y)), True) for x, y in out])  # + inside, − outside
        near = np.nonzero(dist_in < 12)[0]
        proj = np.zeros((len(out), 2)); dist = np.zeros(len(out))
        for i in near: proj[i], dist[i] = nearest_edge(out[i])
        outs = near[~ins[near]]
        if len(outs):
            R = 6.0
            # how far it sticks out near each point (smoothly along the edge)
            reach = np.zeros(len(near))
            for a in range(0, len(near), 800):
                dd = np.sqrt(((proj[near[a:a + 800]][:, None, :] - proj[outs][None, :, :]) ** 2).sum(2))
                reach[a:a + 800] = (dist[outs][None, :] * np.clip(1 - dd / R, 0, None)).max(1)
            new = out.copy()
            for kk, i in enumerate(near):
                dm = reach[kk]
                if dm <= 1e-6: continue
                B = min(11.5, max(4.0, dm))
                sd = -dist[i] if ins[i] else dist[i]             # signed distance, + outside
                if sd <= -B: continue
                nrm = (out[i] - proj[i]) / (dist[i] or 1) if not ins[i] else (proj[i] - out[i]) / (dist[i] or 1)
                if dist[i] < 1e-6: continue
                s2 = -B + (sd + B) * B / (B + dm)                  # −B stays, the furthest point lands on the edge
                new[i] = proj[i] + nrm * min(s2, -0.05)
            # smooth the push over neighbouring points (neighbours pushed different ways would fold the print), then
            # bring in what is still a hair outside
            D = new - out
            rows = np.concatenate([tris[:, 0], tris[:, 1], tris[:, 2], tris[:, 1], tris[:, 2], tris[:, 0]])
            cols = np.concatenate([tris[:, 1], tris[:, 2], tris[:, 0], tris[:, 0], tris[:, 1], tris[:, 2]])
            Wm = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(out), len(out))).tocsr(); Wm.data[:] = 1.0
            deg = np.asarray(Wm.sum(1)).ravel(); deg[deg == 0] = 1
            for _ in range(40): D = 0.5 * D + 0.5 * (Wm @ D) / deg[:, None]
            out = out + D
            for i in range(len(out)):
                if cv2.pointPolygonTest(Pf, (float(out[i, 0]), float(out[i, 1])), False) < 0: out[i] = nearest_edge(out[i])[0]
        cover = best[0] / mp.sum()
        Q = out[tris]; sgn = (Q[:, 1, 0] - Q[:, 0, 0]) * (Q[:, 2, 1] - Q[:, 0, 1]) - (Q[:, 2, 0] - Q[:, 0, 0]) * (Q[:, 1, 1] - Q[:, 0, 1])
        Q0 = G0[tris]; sg0 = (Q0[:, 1, 0] - Q0[:, 0, 0]) * (Q0[:, 2, 1] - Q0[:, 0, 1]) - (Q0[:, 2, 0] - Q0[:, 0, 0]) * (Q0[:, 1, 1] - Q0[:, 0, 1])
        flips = int(((sgn * sg0) < 0).sum())
        fit[pid] = out.round(3).tolist()
        report.append(f"{pid:12s} kept its shape: covers {cover * 100:.0f}% of the piece, turned {best[2]}°, {int((~ins).sum())} edge points eased in, folded {flips}/{len(tris)}")
        continue
    # place: same area and centre as the piece
    tri_area = lambda Q: 0.5 * np.abs((Q[:, 1, 0] - Q[:, 0, 0]) * (Q[:, 2, 1] - Q[:, 0, 1]) - (Q[:, 2, 0] - Q[:, 0, 0]) * (Q[:, 1, 1] - Q[:, 0, 1]))
    Ai = tri_area(F2[tris]).sum(); Ci = (F2[tris].mean(1) * tri_area(F2[tris])[:, None]).sum(0) / Ai
    s = math.sqrt(Ap / Ai)
    G = Cp + (F2 - Ci) * s
    # pin the outline onto the piece outline, in order: each outline point goes to where a line from the piece's
    # centre meets the edge, then the positions are made to run steadily round (no back-and-forth)
    Pn = np.array(P + [P[0]]); seg = np.linalg.norm(np.diff(Pn, axis=0), axis=1); cum = np.concatenate([[0], np.cumsum(seg)]); Lp = cum[-1]
    def param(pt):
        d = pt - Cp; best = None
        for i in range(len(Pn) - 1):
            a, b = Pn[i], Pn[i + 1]; e = b - a
            den = d[0] * e[1] - d[1] * e[0]
            if abs(den) < 1e-12: continue
            w = a - Cp; lam = (w[0] * e[1] - w[1] * e[0]) / den; mu = (w[0] * d[1] - w[1] * d[0]) / den
            if lam > 0 and -1e-9 <= mu <= 1 + 1e-9 and (best is None or lam > best[0]): best = (lam, cum[i] + seg[i] * min(1, max(0, mu)))
        return best[1] if best else 0.0
    def point(t):
        t = t % Lp; i = min(np.searchsorted(cum, t, side='right') - 1, len(seg) - 1)
        return Pn[i] + (Pn[i + 1] - Pn[i]) * ((t - cum[i]) / (seg[i] or 1))
    Lpts = G[bloop]
    if np.sign(area(Lpts.tolist())) != np.sign(area(P)): bloop = bloop[::-1]; Lpts = Lpts[::-1]
    t = np.array([param(q) for q in Lpts])
    inc = np.diff(np.concatenate([t, t[:1]])); inc = (inc + Lp / 2) % Lp - Lp / 2   # steps round the outline
    c = np.concatenate([[t[0]], t[0] + np.cumsum(inc[:-1])])
    # pool adjacent violators: make the run non-decreasing
    vals, wts = [], []
    for v in c:
        vals.append(v); wts.append(1)
        while len(vals) > 1 and vals[-2] > vals[-1]:
            v2, w2 = vals.pop(), wts.pop(); vals[-1] = (vals[-1] * wts[-1] + v2 * w2) / (wts[-1] + w2); wts[-1] += w2
    iso = np.concatenate([[v] * w for v, w in zip(vals, wts)])
    # spread equal values by the panel's own outline lengths, keep the whole turn = the piece's outline
    own = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(Lpts, axis=0), axis=1))]); own = own / (own[-1] + np.linalg.norm(Lpts[0] - Lpts[-1])) * Lp
    span = iso[-1] - iso[0]
    tt = iso[0] + (0.75 * (iso - iso[0]) / (span or 1) + 0.25 * own / Lp) * min(span, Lp) if span > 0 else iso[0] + own
    fixed = {v: point(tv) for v, tv in zip(bloop, tt)}
    # mean-value weights from the 3D mesh (always positive: the inside does not fold over)
    rows, cols, vals_ = [], [], []
    for tr in tris:
        for i0, i1, i2 in ((tr[0], tr[1], tr[2]), (tr[1], tr[2], tr[0]), (tr[2], tr[0], tr[1])):
            e1, e2 = X3[i1] - X3[i0], X3[i2] - X3[i0]; l1, l2 = np.linalg.norm(e1) + 1e-12, np.linalg.norm(e2) + 1e-12
            ang = math.acos(max(-1, min(1, np.dot(e1, e2) / (l1 * l2)))); tn = math.tan(ang / 2)
            rows += [i0, i0]; cols += [i1, i2]; vals_ += [tn / l1, tn / l2]
    W = coo_matrix((vals_, (rows, cols)), shape=(n, n)).tocsr()
    deg = np.asarray(W.sum(1)).ravel()
    isfix = np.zeros(n, bool); isfix[list(fixed)] = True
    free = np.nonzero(~isfix)[0]; fx = np.nonzero(isfix)[0]
    idx = -np.ones(n, int); idx[free] = np.arange(len(free))
    Lff = (coo_matrix((deg[free], (np.arange(len(free)), np.arange(len(free)))), shape=(len(free), len(free))) - W[free][:, free]).tocsc()
    B = np.array([fixed[v] for v in fx])
    rhs = W[free][:, fx] @ B
    out = np.zeros((n, 2)); out[fx] = B
    if len(free): out[free] = np.column_stack([spsolve(Lff, rhs[:, 0]), spsolve(Lff, rhs[:, 1])])
    # folded triangles (flipped in the flat layout)
    Q = out[tris]; sgn = (Q[:, 1, 0] - Q[:, 0, 0]) * (Q[:, 2, 1] - Q[:, 0, 1]) - (Q[:, 2, 0] - Q[:, 0, 0]) * (Q[:, 1, 1] - Q[:, 0, 1])
    flips = int((sgn > 0).sum()) if (sgn < 0).sum() > (sgn > 0).sum() else int((sgn < 0).sum())
    fit[pid] = out.round(3).tolist()
    report.append(f"{pid:12s} 3D {pn['area3d_cm2']:6.0f} cm²  flat {Ai:6.0f}  piece {Ap:6.0f}  scale {s:4.2f}  outline {len(bloop)} pts  folded {flips}/{len(tris)}")
print('\n'.join(report))

# ---- pockets: the red outline on a front is marked on that piece; with a pocket piece in pairs.json, the 3D surface
# inside the outline belongs to the pocket piece instead -------------------------------------------------------
pockets = {}
for front, pocket, side in pairs.get('pockets', []):
    poly = pocket_outline(pairs['pieces'][front]['traced'], side)
    if not poly: continue
    if pocket not in pieces:  # no pocket piece: prints run over the pocket, its outline is only marked on the front
        pockets[front] = {'outline': poly}; print('pocket outline', len(poly), 'pts on', front, '(marked only)'); continue
    src = np.array(poly, np.float32); dst = np.array(pieces[pocket]['poly'], np.float32)
    box = lambda Q: np.array([[Q[:, 0].min(), Q[:, 1].min()], [Q[:, 0].max(), Q[:, 1].min()], [Q[:, 0].max(), Q[:, 1].max()], [Q[:, 0].min(), Q[:, 1].max()]], np.float32)
    H = cv2.getPerspectiveTransform(box(src), box(dst))  # the pocket's box on the front → the pocket piece's box
    pockets[front] = {'pocket': pocket, 'outline': poly, 'H': H.tolist()}
    print('pocket', pocket, 'outline', len(poly), 'pts on', front)
if _only and os.path.exists(out_fit):   # fitted only some panels: keep the others from the last run
    _old = json.load(open(out_fit)); _old['fit'].update(fit); fit = _old['fit']
json.dump({'fit': fit, 'pockets': pockets, 'model_scale': scale_all}, open(out_fit, 'w'))

# ---- pieces.json for the app ------------------------------------------------------------------------------------
P_out = []
for pid, p in pieces.items():
    xs = [x for x, _ in p['poly']]; ys = [y for _, y in p['poly']]; x0, y0 = min(xs), min(ys)
    marks = []
    if pid in pockets: marks = [[[round(x - x0, 2), round(y - y0, 2)] for x, y in pockets[pid]['outline']]]
    P_out.append({'id': pid, 'label': p['label'], 'sx': round(x0, 2), 'sy': round(y0, 2), 'poly': [[round(x - x0, 2), round(y - y0, 2)] for x, y in p['poly']], 'holes': [], 'rib': p['rib'], 'marks': marks})
W_ = max(p['sx'] + max(x for x, _ in p['poly']) for p in P_out) + M; H_ = max(p['sy'] + max(y for _, y in p['poly']) for p in P_out) + M
json.dump({'version': 2, 'name': pairs.get('name', 'Hoodie'), 'cmPerUV': 100, 'uvOrigin': [0, 0], 'margin': 0, 'sheet': {'w': round(W_, 2), 'h': round(H_, 2)}, 'pieces': P_out, 'presets': pairs.get('presets', []), 'bbox3d': None},
          open(out_pieces, 'w'), separators=(',', ':'))
print('pieces', len(P_out), 'sheet', round(W_), '×', round(H_), 'cm')
