// Design Master — procedural fabrics: tileable knit/weave normal maps and wash overlays.
import { fbm, vnoise, mulberry, makeCanvas, clamp, smooth } from './util.js';

export const FABRICS = [
  { id: 'jersey', name: 'Cotton jersey', rough: 0.92, sheen: 0.15, tileCm: 1.1 },
  { id: 'smooth', name: 'Cotton-elastane (smooth)', rough: 0.78, sheen: 0.25, tileCm: 0.8 },
  { id: 'heavy', name: 'Heavyweight cotton', rough: 0.95, sheen: 0.1, tileCm: 1.6 },
  { id: 'fleece', name: 'Fleece / French terry', rough: 1.0, sheen: 0.55, tileCm: 1.4 },
  { id: 'pique', name: 'Piqué', rough: 0.9, sheen: 0.15, tileCm: 1.3 },
  { id: 'rib', name: 'Rib knit', rough: 0.9, sheen: 0.15, tileCm: 1.2 },
  { id: 'waffle', name: 'Waffle', rough: 0.95, sheen: 0.1, tileCm: 2.2 },
  { id: 'interlock', name: 'Interlock', rough: 0.85, sheen: 0.2, tileCm: 0.9 },
  { id: 'mesh', name: 'Sport mesh', rough: 0.55, sheen: 0.3, tileCm: 1.4 },
  { id: 'poly', name: 'Sport poly (dri-fit)', rough: 0.5, sheen: 0.35, tileCm: 0.7 },
  { id: 'canvas', name: 'Canvas', rough: 0.95, sheen: 0.05, tileCm: 1.2 },
  { id: 'denim', name: 'Denim twill', rough: 0.9, sheen: 0.08, tileCm: 1.0 },
];

export const WASHES = [
  { id: 'none', name: 'None' },
  { id: 'stone', name: 'Stone wash' },
  { id: 'acid', name: 'Acid wash' },
  { id: 'mineral', name: 'Mineral wash' },
  { id: 'vintage', name: 'Vintage fade' },
  { id: 'enzyme', name: 'Enzyme wash' },
  { id: 'snow', name: 'Snow wash' },
  { id: 'bleach', name: 'Bleach splatter' },
  { id: 'tiedye', name: 'Tie-dye spiral', tint: true },
  { id: 'crumple', name: 'Crumple tie-dye', tint: true },
  { id: 'dipdye', name: 'Dip-dye ombré', tint: true },
];

export const SWATCHES = [
  '#ffffff', '#f4f1ea', '#e9e2d0', '#d8cbb0', '#b9a58a', '#8a6f55', '#5b4636', '#3a2f28',
  '#d9d9d9', '#9ea3a8', '#6b7075', '#3d4146', '#22252a', '#121314',
  '#f3d6d6', '#e39aa0', '#c2414b', '#8c1d2a', '#f0b37e', '#e0702f', '#f2d36b', '#c8a53a',
  '#cfe3c4', '#8fb58a', '#557f69', '#2f5141', '#3f4a2a', '#b7d3e6', '#6d9cc5', '#2f5b8c', '#1d2d4d', '#c7b9e3', '#7a5ea8',
];

/* ---------- height maps (tileable, 256 px) ---------- */
const TS = 256;
function heightField(type) {
  const h = new Float32Array(TS * TS);
  const rnd = mulberry(7);
  const tn = (x, y, f, s) => { // tileable noise
    const u = x / TS, v = y / TS;
    const a = vnoise(u * f, v * f, s), b = vnoise((u - 1) * f, v * f, s), c = vnoise(u * f, (v - 1) * f, s), d = vnoise((u - 1) * f, (v - 1) * f, s);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    let v = 0;
    const fx = x / TS, fy = y / TS;
    switch (type) {
      case 'jersey': case 'heavy': case 'interlock': {
        const cols = type === 'interlock' ? 16 : 8, rows = type === 'interlock' ? 22 : 11;
        const cx = fx * cols, cy = fy * rows;
        const ix = Math.floor(cx), lx = cx - ix - 0.5, ly = cy - Math.floor(cy) - 0.5;
        // V-shaped knit loop: two slanted lobes per stitch column
        const s = lx < 0 ? -1 : 1;
        const ex = (Math.abs(lx) - 0.25) / 0.24, ey = (ly + s * 0 + (Math.abs(lx) - 0.25) * 0.9) / 0.55;
        v = Math.max(0, 1 - (ex * ex + ey * ey)); v = Math.sqrt(v);
        v += tn(x, y, 16, 3) * 0.12;
        break;
      }
      case 'smooth': case 'poly': v = tn(x, y, 32, 4) * 0.35 + tn(x, y, 64, 5) * 0.2; break;
      case 'fleece': v = tn(x, y, 24, 4) * 0.6 + tn(x, y, 64, 6) * 0.4 + (rnd() - 0.5) * 0.25; break;
      case 'pique': {
        const n = 10, cx = fx * n, cy = fy * n * 1.15;
        const row = Math.floor(cy), off = row % 2 ? 0.5 : 0;
        const lx = (cx + off) % 1 - 0.5, ly = cy % 1 - 0.5;
        v = Math.max(0, 1 - Math.hypot(lx, ly) * 2.6); v = smooth(v); break;
      }
      case 'rib': { const n = 14; v = Math.pow(Math.abs(Math.sin(fx * n * Math.PI)), 0.6) + tn(x, y, 32, 2) * 0.1; break; }
      case 'waffle': {
        const n = 5, lx = (fx * n) % 1, ly = (fy * n) % 1;
        const e = Math.min(lx, 1 - lx, ly, 1 - ly);
        v = 1 - smooth(clamp(e / 0.18, 0, 1)) * 0.9; break;
      }
      case 'mesh': {
        const n = 9, cx = fx * n, cy = fy * n * 1.15;
        const row = Math.floor(cy), off = row % 2 ? 0.5 : 0;
        const lx = (cx + off) % 1 - 0.5, ly = cy % 1 - 0.5;
        const d = Math.hypot(lx, ly);
        v = d < 0.26 ? -1 : smooth(clamp((d - 0.26) / 0.2, 0, 1)); break;
      }
      case 'canvas': {
        const n = 24, ix = Math.floor(fx * n), iy = Math.floor(fy * n);
        const lx = (fx * n) % 1 - 0.5, ly = (fy * n) % 1 - 0.5;
        const over = (ix + iy) % 2 === 0;
        v = over ? Math.cos(ly * Math.PI) * 0.8 : Math.cos(lx * Math.PI) * 0.8;
        v += (rnd() - 0.5) * 0.12; break;
      }
      case 'denim': { const n = 20; v = Math.abs(Math.sin((fx + fy) * n * Math.PI)) * 0.8 + tn(x, y, 64, 9) * 0.25; break; }
      default: v = 0;
    }
    h[y * TS + x] = v;
  }
  return h;
}

const nmCache = new Map();
export function normalMapCanvas(type) {
  if (nmCache.has(type)) return nmCache.get(type);
  const h = heightField(type);
  const cv = makeCanvas(TS, TS), ctx = cv.getContext('2d'), img = ctx.createImageData(TS, TS);
  const S = type === 'mesh' ? 2.2 : type === 'fleece' ? 1.2 : 2.6;
  const at = (x, y) => h[((y + TS) % TS) * TS + ((x + TS) % TS)];
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * S, dy = (at(x, y + 1) - at(x, y - 1)) * S;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * TS + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  nmCache.set(type, cv);
  return cv;
}

/* ---------- garment-space overlays: light (bleach), dark (shade), tint (second colour) ---------- */
// Returns { canvas: [front, back], rect: {x0,y0,w,h}, ppc } — draw with ctx in garment space.
export function buildOverlays(garment, fabric) {
  const b = garment.washBounds || garment.bounds;
  const pad = 6;
  const rect = { x0: b.x0 - pad, y0: b.y0 - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  const ppc = Math.min(6, 1400 / Math.max(rect.w, rect.h));
  const W = Math.ceil(rect.w * ppc), H = Math.ceil(rect.h * ppc);
  const wash = fabric.wash || 'none', heather = fabric.heather;
  const out = [];
  if (wash === 'none' && !heather) return null;
  for (const face of [0, 1]) {
    const cv = makeCanvas(W, H), ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
    const seed = 11 + face * 31 + (fabric.washSeed || 0) * 7;
    const rnd = mulberry(seed);
    const drops = [];
    if (wash === 'bleach') {
      for (let i = 0; i < 70; i++) {
        const r = Math.pow(rnd(), 3) * 3.8 + 0.25;
        drops.push([rect.x0 + rnd() * rect.w, rect.y0 + rnd() * rect.h, r]);
        if (r > 1.5) for (let k = 0; k < 6; k++) drops.push([drops[drops.length - 1][0] + (rnd() - 0.5) * r * 5, drops[drops.length - 1][1] + (rnd() - 0.5) * r * 5, rnd() * 0.45 + 0.1]);
      }
    }
    const cx = 0, cy = b.y0 + b.h * 0.55;
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const x = rect.x0 + px / ppc, y = rect.y0 + (H - 1 - py) / ppc; // canvas row 0 = top of garment
      let L = 0, D = 0, T = 0;
      switch (wash) {
        case 'stone': { const n = fbm(x * 0.07, y * 0.07, 4, seed) * 0.5 + 0.5; L = Math.pow(n, 2.2) * 0.65 + fbm(x * 0.4, y * 0.4, 2, seed + 3) * 0.06; break; }
        case 'acid': { const v = Math.abs(fbm(x * 0.045, y * 0.045, 5, seed)); const w2 = Math.abs(fbm(x * 0.09 + 3, y * 0.09, 4, seed + 2)); L = Math.pow(1 - Math.min(1, v * 7), 2.4) * 0.95 + Math.pow(1 - Math.min(1, w2 * 9), 3) * 0.6; D = smooth(clamp(fbm(x * 0.03, y * 0.03, 3, seed + 8) * 2, 0, 1)) * 0.25; break; }
        case 'mineral': { const n = fbm(x * 0.028, y * 0.028, 5, seed); L = smooth(clamp((n + 0.05) * 2.1, 0, 1)) * 0.62; D = smooth(clamp(-n * 2.4 - 0.2, 0, 1)) * 0.28; break; }
        case 'vintage': { L = 0.24 + fbm(x * 0.05, y * 0.05, 3, seed) * 0.12 + Math.pow(Math.abs(fbm(x * 0.02, y * 0.11, 3, seed + 5)), 0.5) * 0.12; break; }
        case 'enzyme': { L = clamp(fbm(x * 0.12, y * 0.12, 4, seed) * 0.5 + 0.18, 0, 1) * 0.4; break; }
        case 'snow': { const n = vnoise(x * 1.1, y * 1.1, seed) * 0.6 + vnoise(x * 2.7, y * 2.7, seed + 4) * 0.4; L = smooth(clamp((n - 0.35) * 3, 0, 1)) * 0.85 + fbm(x * 0.05, y * 0.05, 2, seed) * 0.1; break; }
        case 'bleach': { for (const [dx, dy, r] of drops) { const dd = Math.hypot(x - dx, y - dy); if (dd < r * 1.5) { const ed = r * (1 + fbm(x * 0.8, y * 0.8, 2, seed) * 0.35); if (dd < ed) L = Math.max(L, 0.92 - (dd / ed) * 0.25); else L = Math.max(L, (1 - (dd - ed) / (r * 0.5)) * 0.4); } } break; }
        case 'tiedye': { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx); const band = Math.sin(a * 3 + r * 0.22 + fbm(x * 0.06, y * 0.06, 3, seed) * 2.2); T = smooth(clamp(band * 1.6 + 0.2, 0, 1)); L = smooth(clamp(-band * 3 - 2, 0, 1)) * 0.5; break; }
        case 'crumple': { const n = fbm(x * 0.06, y * 0.06, 5, seed); T = smooth(clamp(n * 3 + 0.5, 0, 1)); L = Math.pow(1 - Math.min(1, Math.abs(n) * 9), 3) * 0.55; break; }
        case 'dipdye': { const edge = b.y0 + b.h * 0.42 + fbm(x * 0.08, 1, 3, seed) * 6; T = smooth(clamp((edge - y) / 9, 0, 1)); break; }
      }
      if (heather) {
        const r = rnd();
        if (r < 0.06) L += 0.35; else if (r < 0.12) D += 0.3;
        L += vnoise(x * 3, y * 0.6, seed + 77) * 0.06;
      }
      const i = (py * W + px) * 4;
      // pack: R = light, G = dark, B = tint (as alpha channels)
      d[i] = clamp(L, 0, 1) * 255; d[i + 1] = clamp(D, 0, 1) * 255; d[i + 2] = clamp(T, 0, 1) * 255; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    out.push(splitChannels(cv));
  }
  return { faces: out, rect, ppc };
}

// splits the packed RGB canvas into three alpha masks (white light, black dark, white tint)
function splitChannels(cv) {
  const W = cv.width, H = cv.height, src = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const mk = (ch, rgb) => {
    const c = makeCanvas(W, H), x = c.getContext('2d'), im = x.createImageData(W, H), d = im.data;
    let any = false;
    for (let i = 0; i < d.length; i += 4) { d[i] = rgb; d[i + 1] = rgb; d[i + 2] = rgb; d[i + 3] = src[i + ch]; if (src[i + ch]) any = true; }
    x.putImageData(im, 0, 0);
    return any ? c : null;
  };
  return { light: mk(0, 255), dark: mk(1, 0), tint: mk(2, 255) };
}

// tint mask is white; colourise it on demand
export function tintedMask(mask, color) {
  const c = makeCanvas(mask.width, mask.height), x = c.getContext('2d');
  x.drawImage(mask, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}
