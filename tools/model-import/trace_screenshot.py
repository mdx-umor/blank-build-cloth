# Trace sewing-pattern pieces from a screenshot of a 2D pattern window (Marvelous Designer / CLO): light pieces on a
# grey grid. Writes pieces in centimetres (the grid is 10 cm unless told otherwise), named by where they sit.
#   python3 trace_screenshot.py shot.png out.json [x0 y0 x1 y1 of the pattern window] [grid_cm]
import sys, json, cv2, numpy as np

src, dst = sys.argv[1], sys.argv[2]
box = [int(v) for v in sys.argv[3:7]] if len(sys.argv) >= 7 else None
grid_cm = float(sys.argv[7]) if len(sys.argv) >= 8 else 10.0
im = cv2.imread(src)[:, :, ::-1].astype(np.int32)  # RGB
if box: im = im[box[1]:box[3], box[0]:box[2]]
H, W = im.shape[:2]
R, G, B = im[..., 0], im[..., 1], im[..., 2]

# grid spacing: background columns/rows that are a little darker, repeating
bg = (abs(R - G) < 6) & (abs(G - B) < 6) & (R > 180) & (R < 212)
col = np.array([np.mean(R[:, x][bg[:, x]]) if bg[:, x].sum() > H * 0.3 else 255 for x in range(W)])
lines = [x for x in range(1, W - 1) if col[x] < col[x - 1] - 1.5 and col[x] <= col[x + 1] and col[x] < np.median(col) - 2]
gaps = np.diff(lines); gaps = gaps[(gaps > 8) & (gaps < 80)]
spacing = float(np.median(gaps)) if len(gaps) else 21.0
cm_per_px = grid_cm / spacing
print('grid spacing', round(spacing, 2), 'px →', round(cm_per_px, 4), 'cm/px')

# pieces: white or rib-beige fill (the blue band around a piece is a highlight, not the piece)
white = (R > 222) & (G > 222) & (B > 222)
beige = (R > 205) & (G > 180) & (G < 222) & (B > 140) & (B < 200) & (R - B > 25)
mask = ((white | beige) * 255).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))  # bridge internal lines (zip, pockets)
cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
out = []
for c in cs:
    a = cv2.contourArea(c)
    if a < 60: continue
    x, y, w, h = cv2.boundingRect(c)
    m = np.zeros_like(mask); cv2.drawContours(m, [c], -1, 255, -1)
    rib = beige[m > 0].mean() > 0.5
    poly = cv2.approxPolyDP(c, 0.6, True)[:, 0, :].tolist()
    out.append({'px_bbox': [x, y, w, h], 'px_area': a, 'rib': bool(rib), 'cut_by_edge': x + w >= W - 2 or y + h >= H - 2 or x <= 1 or y <= 1,
                'poly_px': poly, 'centre_px': [x + w / 2, y + h / 2]})
out.sort(key=lambda p: (p['centre_px'][1], p['centre_px'][0]))
for i, p in enumerate(out):
    x, y, w, h = p['px_bbox']
    print(i, 'centre', [round(v) for v in p['centre_px']], 'size', round(w * cm_per_px, 1), '×', round(h * cm_per_px, 1), 'cm', 'rib' if p['rib'] else '', 'CUT BY EDGE' if p['cut_by_edge'] else '')
json.dump({'cm_per_px': cm_per_px, 'size_px': [W, H], 'pieces': out}, open(dst, 'w'))
