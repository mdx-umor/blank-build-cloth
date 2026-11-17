# Trace pattern-piece outlines from UV islands (rasterise + contour), output pieces.json in centimetres
import json, sys, cv2, numpy as np
src, dst = sys.argv[1], sys.argv[2]
D = json.load(open(src)); k = D['cmPerUV']
PPC = 8.0                      # raster pixels per cm
ppu = PPC * k
allu = [c[0] for isl in D['islands'] for p in isl['polys'] for c in p]
allv = [c[1] for isl in D['islands'] for p in isl['polys'] for c in p]
u0, v1 = min(allu), max(allv)
M = 6.0                         # sheet margin, cm
out = []
for isl in D['islands']:
    us = [c[0] for p in isl['polys'] for c in p]; vs = [c[1] for p in isl['polys'] for c in p]
    bu0, bu1, bv0, bv1 = min(us), max(us), min(vs), max(vs)
    W, H = int((bu1 - bu0) * ppu) + 8, int((bv1 - bv0) * ppu) + 8
    if W < 6 or H < 6: continue
    mask = np.zeros((H, W), np.uint8)
    for p in isl['polys']:
        pts = np.array([[(x - bu0) * ppu + 4, (bv1 - y) * ppu + 4] for x, y in p], np.float32)
        cv2.fillPoly(mask, [np.round(pts * 4).astype(np.int32)], 255, lineType=cv2.LINE_8, shift=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if not cs: continue
    hier = hier[0]
    oi = max((i for i in range(len(cs)) if hier[i][3] == -1), key=lambda i: cv2.contourArea(cs[i]))
    area_cm2 = cv2.contourArea(cs[oi]) / PPC / PPC
    if area_cm2 < 4: continue
    toCm = lambda c: [[round((x - 4) / ppu * k + (bu0 - u0) * k + M, 2), round((y - 4) / ppu * k + (v1 - bv1) * k + M, 2)] for [[x, y]] in c]
    outer = cv2.approxPolyDP(cs[oi], 0.7, True)
    holes = [cv2.approxPolyDP(cs[i], 0.7, True) for i in range(len(cs)) if hier[i][3] == oi and cv2.contourArea(cs[i]) / PPC / PPC > 6]
    out.append({'material': isl['material'], 'centroid3d_cm': isl['centroid3d_cm'], 'area_cm2': round(area_cm2, 1), 'faces': len(isl['polys']),
                'poly': toCm(outer), 'holes': [toCm(h) for h in holes]})
# stacked layers (outer + inner fabric) share a UV island: keep one
out.sort(key=lambda p: -p['area_cm2'])
uniq = []
for p in out:
    xs = [x for x, _ in p['poly']]; ys = [y for _, y in p['poly']]
    p['bb'] = [min(xs), min(ys), max(xs), max(ys)]
    if any(abs(q['area_cm2'] - p['area_cm2']) < 0.02 * p['area_cm2'] + 1 and all(abs(a - b) < 0.6 for a, b in zip(q['bb'], p['bb'])) for q in uniq): continue
    uniq.append(p)
sheet_w = max(p['bb'][2] for p in uniq) + M; sheet_h = max(p['bb'][3] for p in uniq) + M
for i, p in enumerate(uniq):
    print(i, p['material'], p['area_cm2'], 'cm2', 'c3d', p['centroid3d_cm'], 'bb', [round(v) for v in p['bb']], 'pts', len(p['poly']), 'holes', len(p['holes']))
json.dump({'cmPerUV': k, 'uvOrigin': [u0, v1], 'margin': M, 'sheet': {'w': round(sheet_w, 2), 'h': round(sheet_h, 2)}, 'pieces': uniq}, open(dst, 'w'))
print('sheet', round(sheet_w), 'x', round(sheet_h), 'cm')
