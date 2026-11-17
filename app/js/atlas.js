// Design Master — compositor. The pattern sheet is both the 2D editor surface and the 3D
// texture atlas. Everything is drawn in centimetres; callers choose the pixel density.
import { makeCanvas, affMul, affInv, affApply, loadImage, rad, hexToRgb, fbm, mulberry } from './util.js';
import { tintedMask } from './fabric.js';

export const FONTS = [
  { family: 'Inter', weights: [400, 600, 800] },
  { family: 'Bebas Neue', weights: [400] },
  { family: 'Anton', weights: [400] },
  { family: 'Oswald', weights: [400, 700] },
  { family: 'Archivo Black', weights: [400] },
  { family: 'Montserrat', weights: [400, 700, 900] },
  { family: 'Space Grotesk', weights: [400, 700] },
  { family: 'Playfair Display', weights: [400, 700, 900] },
  { family: 'Abril Fatface', weights: [400] },
  { family: 'Roboto Slab', weights: [400, 800] },
  { family: 'Pacifico', weights: [400] },
  { family: 'Lobster', weights: [400] },
  { family: 'Permanent Marker', weights: [400] },
  { family: 'Caveat', weights: [400, 700] },
  { family: 'Bungee', weights: [400] },
  { family: 'Rubik Mono One', weights: [400] },
  { family: 'Press Start 2P', weights: [400] },
  { family: 'UnifrakturMaguntia', weights: [400] },
];

export const SHAPES = [
  { id: 'rect', name: 'Rectangle' }, { id: 'round', name: 'Rounded' }, { id: 'circle', name: 'Ellipse' },
  { id: 'triangle', name: 'Triangle' }, { id: 'star', name: 'Star' }, { id: 'heart', name: 'Heart' },
  { id: 'badge', name: 'Badge' }, { id: 'line', name: 'Line' },
];

/* ---------- assets (decoded images) ---------- */
const imgCache = new Map();
export function getImage(assets, id, onReady) {
  const src = assets[id];
  if (!src) return null;
  const hit = imgCache.get(id);
  if (hit && hit.src === src) return hit.img;
  const entry = { src, img: null };
  imgCache.set(id, entry);
  loadImage(src).then(img => { entry.img = img; onReady && onReady(); }).catch(() => {});
  return null;
}

/* ---------- text rasteriser (cached) ---------- */
const textCache = new Map();
const TF = 160; // px per em in the cache
export function textRaster(it) {
  const key = JSON.stringify([it.text, it.font, it.weight, it.italic, it.caps, it.color, it.align, it.lineH, it.letter, it.curve, it.stroke, it.strokeColor, document.fonts?.status]);
  const hit = textCache.get(it.id);
  if (hit && hit.key === key) return hit.cv;
  const lines = String(it.caps ? (it.text || '').toUpperCase() : (it.text || '')).split('\n');
  const font = `${it.italic ? 'italic ' : ''}${it.weight || 400} ${TF}px "${it.font || 'Inter'}", sans-serif`;
  const meas = makeCanvas(4, 4).getContext('2d');
  meas.font = font;
  const ls = (it.letter || 0) * TF / 100;
  const glyphW = (s) => [...s].map(ch => meas.measureText(ch).width + ls);
  const lh = TF * (it.lineH || 1.15);
  const strokePx = (it.stroke || 0) * TF / 100;
  let cv;
  const curve = (it.curve || 0) / 100;
  if (Math.abs(curve) > 0.01) {
    // arc text: each line on a concentric arc
    const widths = lines.map(l => glyphW(l).reduce((a, b) => a + b, 0));
    const maxW = Math.max(1, ...widths);
    const total = curve * Math.PI * 1.1; // sweep angle for the longest line
    const R = maxW / Math.abs(total);
    const placed = [];
    lines.forEach((line, li) => {
      const r = curve > 0 ? R - li * lh : R + li * lh;
      const gws = glyphW(line), w = gws.reduce((a, b) => a + b, 0);
      let a = -w / 2 / r;
      [...line].forEach((ch, k) => {
        const mid = a + gws[k] / 2 / r;
        placed.push({ ch, a: mid, r });
        a += gws[k] / r;
      });
    });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const pos = placed.map(p => {
      const x = Math.sin(p.a) * p.r, y = curve > 0 ? -Math.cos(p.a) * p.r : Math.cos(p.a) * p.r;
      const ext = TF * 0.75 + strokePx;
      x0 = Math.min(x0, x - ext); x1 = Math.max(x1, x + ext); y0 = Math.min(y0, y - ext); y1 = Math.max(y1, y + ext);
      return { ...p, x, y };
    });
    if (!pos.length) { x0 = y0 = 0; x1 = y1 = 10; }
    cv = makeCanvas(x1 - x0, y1 - y0);
    const c = cv.getContext('2d');
    c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    for (const p of pos) {
      c.save(); c.translate(p.x - x0, p.y - y0); c.rotate(curve > 0 ? p.a : -p.a);
      if (strokePx) { c.strokeStyle = it.strokeColor || '#000'; c.lineWidth = strokePx * 2; c.strokeText(p.ch, 0, 0); }
      c.fillStyle = it.color || '#111'; c.fillText(p.ch, 0, 0);
      c.restore();
    }
  } else {
    const widths = lines.map(l => glyphW(l).reduce((a, b) => a + b, 0) - ls);
    const W = Math.max(TF * 0.3, ...widths) + strokePx * 2 + TF * 0.1;
    const H = lh * (lines.length - 1) + TF * 1.25 + strokePx * 2;
    cv = makeCanvas(W, H);
    const c = cv.getContext('2d');
    c.font = font; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
    lines.forEach((line, li) => {
      const w = widths[li];
      let x = it.align === 'left' ? strokePx + TF * 0.05 : it.align === 'right' ? W - strokePx - TF * 0.05 - w : (W - w) / 2;
      const y = strokePx + TF * 0.95 + li * lh;
      for (const ch of line) {
        if (strokePx) { c.strokeStyle = it.strokeColor || '#000'; c.lineWidth = strokePx * 2; c.strokeText(ch, x, y); }
        c.fillStyle = it.color || '#111'; c.fillText(ch, x, y);
        x += meas.measureText(ch).width + ls;
      }
    });
  }
  textCache.set(it.id, { key, cv });
  return cv;
}

/* ---------- shapes ---------- */
function shapePath(c, s, w, h) {
  c.beginPath();
  const x = -w / 2, y = -h / 2;
  switch (s) {
    case 'round': { const r = Math.min(w, h) * 0.18; c.roundRect(x, y, w, h, r); break; }
    case 'circle': c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'triangle': c.moveTo(0, y); c.lineTo(w / 2, h / 2); c.lineTo(x, h / 2); c.closePath(); break;
    case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; c.lineTo(Math.cos(a) * w / 2 * r, Math.sin(a) * h / 2 * r + h * 0.05); } c.closePath(); break;
    case 'heart': c.moveTo(0, h * 0.35); c.bezierCurveTo(-w * 0.62, -h * 0.05, -w * 0.38, -h * 0.62, 0, -h * 0.25); c.bezierCurveTo(w * 0.38, -h * 0.62, w * 0.62, -h * 0.05, 0, h * 0.35); c.closePath(); break;
    case 'badge': for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, r = i % 2 ? 0.88 : 1; c.lineTo(Math.cos(a) * w / 2 * r, Math.sin(a) * h / 2 * r); } c.closePath(); break;
    case 'line': c.moveTo(x, 0); c.lineTo(w / 2, 0); break;
    default: c.rect(x, y, w, h);
  }
}

// item natural height (cm)
export function itemHeight(it, assets) {
  if (it.type === 'shape') return it.h;
  if (it.type === 'text') { const cv = textRaster(it); return it.w * cv.height / cv.width; }
  return it.w / (it.aspect || 1);
}

/* distress mask (tileable) */
let distressTile = null;
function getDistress() {
  if (distressTile) return distressTile;
  const S = 512, cv = makeCanvas(S, S), c = cv.getContext('2d'), im = c.createImageData(S, S);
  const r = mulberry(5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 40, y / 40, 4, 8), crack = Math.abs(fbm(x / 22, y / 22, 3, 12));
    const a = (n > 0.18 ? 1 : 0) || (crack < 0.025 ? 1 : 0) || (r() < 0.04 ? 1 : 0);
    const i = (y * S + x) * 4; im.data[i + 3] = a * 255;
  }
  c.putImageData(im, 0, 0);
  return (distressTile = cv);
}

/** Draws one item, with ctx in piece-local cm space. */
export function drawItem(c, it, assets, onReady, pxPerCm = 10) {
  if (it.hidden) return;
  const h = itemHeight(it, assets);
  c.save();
  c.translate(it.x, it.y);
  c.rotate(rad(it.rot || 0));
  if (it.flip) c.scale(-1, 1);
  c.globalAlpha *= it.opacity ?? 1;
  if (it.blend === 'multiply') c.globalCompositeOperation = 'multiply';
  const drawCore = (cx) => {
    if (it.type === 'image') {
      const img = getImage(assets, it.asset, onReady);
      if (img) cx.drawImage(img, -it.w / 2, -h / 2, it.w, h);
    } else if (it.type === 'text') {
      const cv = textRaster(it);
      cx.drawImage(cv, -it.w / 2, -h / 2, it.w, h);
    } else if (it.type === 'shape') {
      shapePath(cx, it.shape, it.w, it.h);
      const lw = (it.thick || 3) / 10;
      if (it.shape === 'line' || it.outline) {
        cx.lineWidth = lw; cx.strokeStyle = it.color; cx.lineJoin = 'round'; cx.lineCap = 'round';
        if (it.dashed) cx.setLineDash([lw * 3, lw * 2.2]);
        cx.stroke();
      } else { cx.fillStyle = it.color; cx.fill(); }
    }
  };
  if (it.distress) {
    // render into an offscreen layer so the distress mask only eats this item
    const pad = 0.5, W = it.w + pad * 2, H = h + pad * 2;
    const k = Math.min(pxPerCm, 4096 / Math.max(W, H));
    const off = makeCanvas(W * k, H * k), o = off.getContext('2d');
    o.scale(k, k); o.translate(W / 2, H / 2);
    drawCore(o);
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'destination-out';
    o.globalAlpha = it.distress;
    const pat = o.createPattern(getDistress(), 'repeat');
    const sc = Math.max(0.35, 8 * k / 512 * 2.5);
    pat.setTransform(new DOMMatrix([sc, 0, 0, sc, 0, 0]));
    o.fillStyle = pat; o.fillRect(0, 0, off.width, off.height);
    c.drawImage(off, -W / 2, -H / 2, W, H);
  } else drawCore(c);
  c.restore();
}

/* ---------- pieces ---------- */
export function piecePath(c, piece) {
  c.beginPath();
  piece.poly.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath();
}
// garment space → sheet cm for one panel face
export const faceMatrix = (pn, piece) => [pn.toLocal[0], pn.toLocal[1], pn.toLocal[2], pn.toLocal[3], pn.toLocal[4] + piece.sx, pn.toLocal[5] + piece.sy];

/**
 * Fabric layer: base colour/gradient + wash overlays + stitches, per piece, in sheet cm.
 * c must already be scaled to cm. Returns nothing.
 */
export function drawFabric(c, garment, fabric, overlays, { fillSheet = false } = {}) {
  const base = fabric.color || '#ffffff';
  if (fillSheet) { c.fillStyle = base; c.fillRect(-2, -2, garment.sheet.w + 4, garment.sheet.h + 4); }
  const b = garment.bounds;
  for (const pn of garment.panels) {
    const piece = garment.pieces.find(p => p.id === pn.piece);
    const m = faceMatrix(pn, piece);
    c.save();
    c.transform(...m);
    c.beginPath(); pn.outline.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
    c.lineWidth = 0.6; // tiny overdraw hides anti-alias seams between faces
    const override = fabric.pieceColors?.[pn.piece];
    let fill = override || base;
    if (!override && fabric.mode === 'linear') {
      const a = rad(fabric.angle ?? 90), dx = Math.cos(a), dy = Math.sin(a);
      const half = Math.abs(dx) * b.w / 2 + Math.abs(dy) * b.h / 2;
      const g = c.createLinearGradient(b.cx - dx * half, b.cy + dy * half, b.cx + dx * half, b.cy - dy * half);
      g.addColorStop(0, base); g.addColorStop(1, fabric.color2 || '#000'); fill = g;
    } else if (!override && fabric.mode === 'radial') {
      const g = c.createRadialGradient(b.cx, b.y0 + b.h * 0.6, 0, b.cx, b.y0 + b.h * 0.6, Math.max(b.w, b.h) * 0.62);
      g.addColorStop(0, base); g.addColorStop(1, fabric.color2 || '#000'); fill = g;
    }
    c.fillStyle = fill; c.strokeStyle = fill;
    c.fill(); c.stroke();
    if (overlays) {
      c.clip();
      const f = overlays.faces[pn.side > 0 ? 0 : 1], r = overlays.rect;
      // overlay canvas row 0 = garment top, so flip y while drawing in garment space
      c.save(); c.translate(r.x0, r.y0 + r.h); c.scale(1, -1);
      const amt = fabric.washAmt ?? 0.8;
      if (f.tintColored) { c.globalAlpha = Math.min(1, amt * 1.1); c.drawImage(f.tintColored, 0, 0, r.w, r.h); }
      if (f.dark) { c.globalAlpha = amt * 0.9; c.drawImage(f.dark, 0, 0, r.w, r.h); }
      if (f.light) { c.globalAlpha = amt; c.drawImage(f.light, 0, 0, r.w, r.h); }
      c.restore();
    }
    c.restore();
  }
  // stitching
  const ink = luminanceOf(base) > 0.5 ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.18)';
  for (const p of garment.pieces) {
    if (!p.stitches?.length) continue;
    c.save(); c.translate(p.sx, p.sy);
    c.strokeStyle = ink; c.lineWidth = 0.07; c.setLineDash([0.32, 0.18]);
    for (const pl of p.stitches) { c.beginPath(); pl.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); }
    c.restore();
  }
}
const luminanceOf = (hex) => { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

export function prepareOverlayTint(overlays, color) {
  if (!overlays) return;
  for (const f of overlays.faces) f.tintColored = f.tint ? tintedMask(f.tint, color || '#000') : null;
}

/** Artwork for all pieces (sheet cm space), each item clipped to its piece. */
export function drawArtwork(c, garment, items, assets, onReady, pxPerCm) {
  for (const piece of garment.pieces) {
    const list = items.filter(i => i.piece === piece.id && !i.hidden);
    if (!list.length) continue;
    c.save(); c.translate(piece.sx, piece.sy);
    piecePath(c, piece); c.clip();
    for (const it of list) drawItem(c, it, assets, onReady, pxPerCm);
    c.restore();
  }
}

/** Full atlas canvas for the 3D texture. */
export function renderAtlas(cv, garment, doc, assets, overlays, ppc, onReady) {
  const W = Math.round(garment.sheet.w * ppc), H = Math.round(garment.sheet.h * ppc);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext('2d');
  c.setTransform(ppc, 0, 0, ppc, 0, 0);
  c.clearRect(0, 0, garment.sheet.w, garment.sheet.h);
  drawFabric(c, garment, doc.fabric, overlays, { fillSheet: true });
  drawArtwork(c, garment, doc.items, assets, onReady, ppc);
  c.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

/** Item bounds helpers (piece-local). */
export function itemCorners(it, assets) {
  const h = itemHeight(it, assets), a = rad(it.rot || 0), cs = Math.cos(a), sn = Math.sin(a);
  return [[-it.w / 2, -h / 2], [it.w / 2, -h / 2], [it.w / 2, h / 2], [-it.w / 2, h / 2]].map(([x, y]) => [it.x + x * cs - y * sn, it.y + x * sn + y * cs]);
}
export function hitItem(it, assets, lx, ly, pad = 0) {
  const h = itemHeight(it, assets), a = -rad(it.rot || 0);
  const dx = lx - it.x, dy = ly - it.y;
  const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(x) <= it.w / 2 + pad && Math.abs(y) <= h / 2 + pad;
}

/* ---------- image helpers ---------- */
export async function trimTransparent(src) {
  const img = await loadImage(src);
  const cv = makeCanvas(img.naturalWidth, img.naturalHeight), c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(cv, -x0, -y0);
  return out.toDataURL('image/png');
}
// flood-fill style background removal from the image borders (works for white/solid backgrounds)
export async function removeBackground(src, tol = 38) {
  const img = await loadImage(src);
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = makeCanvas(W, H), c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  const im = c.getImageData(0, 0, W, H), d = im.data;
  const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; });
  const ref = corners[0];
  const seen = new Uint8Array(W * H), stack = [];
  const close = (i) => Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]) < tol * 3 && d[i + 3] > 0;
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop(); if (seen[p]) continue; seen[p] = 1;
    const i = p * 4; if (!close(i)) continue;
    d[i + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1); if (x < W - 1) stack.push(p + 1); if (y > 0) stack.push(p - W); if (y < H - 1) stack.push(p + W);
  }
  // soften the new edge
  for (let p = 0; p < W * H; p++) {
    if (d[p * 4 + 3] === 0) continue;
    const x = p % W, y = (p / W) | 0;
    let n = 0; for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < W * H && d[q * 4 + 3] === 0 && Math.abs((q % W) - x) <= 1) n++;
    if (n) d[p * 4 + 3] = Math.min(d[p * 4 + 3], 255 - n * 50);
  }
  c.putImageData(im, 0, 0);
  return cv.toDataURL('image/png');
}

export { affMul, affInv, affApply };
