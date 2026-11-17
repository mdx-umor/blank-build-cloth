# Step 3: name the traced pieces and write app/models/<id>/pieces.json
#   python3 assemble.py pieces.traced.json names.json out/pieces.json
# names.json: ["back:Back", "frontL:Front · left", ...] in the order trace.py printed (largest first)
import json, sys
P = json.load(open(sys.argv[1])); names = json.load(open(sys.argv[2]))
area = lambda L: sum(L[i-1][0]*L[i][1]-L[i][0]*L[i-1][1] for i in range(len(L)))/2
pieces = []
for i, p in enumerate(P['pieces']):
    pid, label = (names[i].split(':', 1) if i < len(names) else (f"piece{i}", f"Piece {i + 1}"))
    x0, y0 = p['bb'][0], p['bb'][1]
    loc = lambda L: [[round(x - x0, 2), round(y - y0, 2)] for x, y in L]
    outer = loc(p['poly']); outer = outer if area(outer) > 0 else outer[::-1]
    holes = [h if area(h) < 0 else h[::-1] for h in map(loc, p['holes'])]
    pieces.append({'id': pid, 'label': label, 'sx': round(x0, 2), 'sy': round(y0, 2), 'poly': outer, 'holes': holes, 'centroid3d': p['centroid3d_cm']})
out = {'version': 1, 'cmPerUV': P['cmPerUV'], 'uvOrigin': P['uvOrigin'], 'margin': P['margin'], 'sheet': P['sheet'], 'pieces': pieces, 'presets': [], 'bbox3d': None}
json.dump(out, open(sys.argv[3], 'w'), separators=(',', ':'))
print('wrote', len(pieces), 'pieces — add presets and bbox3d (from `gltf-transform inspect`) by hand')
