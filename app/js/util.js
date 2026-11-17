// Design Master — shared helpers (geometry, noise, colour, files)

export const uid = (p = 'i') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const deg = (r) => r * 180 / Math.PI;
export const rad = (d) => d * Math.PI / 180;

/* ---------- polygons (arrays of [x, y]) ---------- */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// nearest point on the outline; returns [px, py, dist]
export function nearestOnPoly(x, y, poly) {
  let best = Infinity, bx = 0, by = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [cx, cy] = poly[i];
    const dx = cx - ax, dy = cy - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, py = ay + dy * t;
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < best) { best = d; bx = px; by = py; }
  }
  return [bx, by, Math.sqrt(best)];
}
export function polyBounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return a / 2;
}
// resample a polyline so no segment is longer than `step`
export function densify(pts, step, closed = false) {
  const out = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < k; s++) out.push([lerp(a[0], b[0], s / k), lerp(a[1], b[1], s / k)]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}
export function dedupe(pts, eps = 1e-3) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > eps || Math.abs(q[1] - p[1]) > eps) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps) out.pop();
  }
  return out;
}

/* ---------- 2D affine [a, b, c, d, e, f] — canvas convention: x' = a x + c y + e, y' = b x + d y + f ---------- */
export const affApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function affMul(m, n) { // m ∘ n
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function affInv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/* ---------- value noise (deterministic, seeded) ---------- */
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function vnoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
}
export function fbm(x, y, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
export function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ---------- colour ---------- */
export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export function luminance(hex) { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
export function mixHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); }

/* ---------- files ---------- */
export function download(blobOrUrl, name) {
  const a = document.createElement('a');
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export const canvasToBlob = (cv, type = 'image/png', q = 0.95) => new Promise(r => cv.toBlob(r, type, q));
export const readFileAsDataURL = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
export const readFileAsText = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsText(file); });
export const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = src; });
export function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const slug = (s) => String(s || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';

/* ---------- arc-length sampling + Coons patches (curved 4-sided mappings) ---------- */
export function polyLength(pl) { let s = 0; for (let i = 1; i < pl.length; i++) s += Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]); return s; }
export function sampleAt(pl, t) {
  if (pl.length === 2) return [lerp(pl[0][0], pl[1][0], t), lerp(pl[0][1], pl[1][1], t)];
  if (!pl._cum) { const c = [0]; for (let i = 1; i < pl.length; i++) c.push(c[i - 1] + Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1])); pl._cum = c; }
  const c = pl._cum, L = c[c.length - 1] * clamp(t, 0, 1);
  let i = 1; while (i < c.length - 1 && c[i] < L) i++;
  const k = (L - c[i - 1]) / ((c[i] - c[i - 1]) || 1);
  return [lerp(pl[i - 1][0], pl[i][0], k), lerp(pl[i - 1][1], pl[i][1], k)];
}
// edges: c0(v) at u=0, c1(v) at u=1, d0(u) at v=0, d1(u) at v=1 — corners must agree
export function coons(e, u, v) {
  const a = sampleAt(e.c0, v), b = sampleAt(e.c1, v), c = sampleAt(e.d0, u), d = sampleAt(e.d1, u);
  const p00 = e.d0[0], p10 = e.d0[e.d0.length - 1], p01 = e.d1[0], p11 = e.d1[e.d1.length - 1];
  const f = (k) => (1 - u) * a[k] + u * b[k] + (1 - v) * c[k] + v * d[k] - ((1 - u) * (1 - v) * p00[k] + u * (1 - v) * p10[k] + (1 - u) * v * p01[k] + u * v * p11[k]);
  return [f(0), f(1)];
}
// least-squares affine (canvas convention) mapping src points onto dst points
export function fitAffine(src, dst) {
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = src.length;
  const bx = [0, 0, 0], by = [0, 0, 0];
  src.forEach(([x, y], i) => { const [X, Y] = dst[i]; sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; bx[0] += x * X; bx[1] += y * X; bx[2] += X; by[0] += x * Y; by[1] += y * Y; by[2] += Y; });
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M) || 1e-9;
  const solve = (b) => [0, 1, 2].map(c => det3(M.map((row, r) => row.map((v, k) => (k === c ? b[r] : v)))) / D);
  const [a, c, e] = solve(bx), [b, d, f] = solve(by);
  return [a, b, c, d, e, f];
}
export function cubicPts(p0, p1, p2, p3, n = 20) {
  const o = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
  return o;
}
