// Design Master — the studio backdrop. Like the original, the backdrop is a picture fixed on the screen behind the
// garment: the backdrop colour, lit through a "backdrop light" (window, leaves, pine…) and darker where the light
// pattern casts shadow, with a soft studio fall-off. Light patterns are greyscale (white = light), so any backdrop
// colour works; the shadows take a deeper tone of the same colour. The garment itself is lit cleanly in 3D.
import { makeCanvas, mulberry, clamp, hexToRgb } from './util.js';

const MAP = 2048; // light patterns are made at this size
let customLight = null;
/** Your own light picture (any image; its brightness becomes the light pattern). */
export function setCustomLight(img) {
  if (!img) { customLight = null; } else {
    const cv = makeCanvas(MAP, MAP), c = cv.getContext('2d'), w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.max(MAP / w, MAP / h);
    c.fillStyle = '#fff'; c.fillRect(0, 0, MAP, MAP); c.filter = 'grayscale(1)'; c.drawImage(img, (MAP - w * k) / 2, (MAP - h * k) / 2, w * k, h * k); c.filter = 'none';
    customLight = cv;
  }
  for (const k of [...goboCache.keys()]) if (k.startsWith('custom')) goboCache.delete(k);
  for (const k of [...maskCache.keys()]) if (k.startsWith('custom')) maskCache.delete(k);
}
const whiteLight = () => { const cv = makeCanvas(8, 8), c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 8, 8); return cv; };
const inverted = (src) => { const cv = makeCanvas(src.width, src.height), c = cv.getContext('2d'); c.drawImage(src, 0, 0); c.globalCompositeOperation = 'difference'; c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); return cv; };
function finishLight(cv, invert) {
  if (!invert) return;
  const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'difference'; c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.globalCompositeOperation = 'source-over';
}

// Backdrop light (a gobo in front of the key light), in the same order and groups as the original.
export const GOBOS = [
  { id: 'none', name: 'None' },
  { id: 'window', name: 'Window' }, { id: 'beam', name: 'Beam' }, { id: 'blinds', name: 'Blinds' }, { id: 'softblinds', name: 'Soft blinds' },
  { id: 'winblinds', name: 'Window blinds' }, { id: 'arch', name: 'Arched window' }, { id: 'winleaves', name: 'Window & leaves' },
  { id: 'stripes', name: 'Light stripes' }, { id: 'leaves', name: 'Leaf shadows' }, { id: 'palm', name: 'Palm fronds' }, { id: 'fanpalm', name: 'Fan palm' },
  { id: 'branches', name: 'Branches' }, { id: 'spot', name: 'Spotlight' }, { id: 'split', name: 'Light & shade' }, { id: 'round', name: 'Round window' },
  { id: 'web', name: 'Spider web', group: '🎃 Halloween' }, { id: 'pumpkins', name: 'Pumpkins · glow', group: '🎃 Halloween' }, { id: 'bats', name: 'Bats', group: '🎃 Halloween' },
  { id: 'bare', name: 'Bare branches', group: '🎃 Halloween' }, { id: 'gothic', name: 'Gothic windows', group: '🎃 Halloween' }, { id: 'jack', name: 'Jack-o’-lantern faces', group: '🎃 Halloween' },
  { id: 'pinewin', name: 'Pine window', group: '🎄 Christmas' }, { id: 'frost', name: 'Frost on glass', group: '🎄 Christmas' }, { id: 'spruce', name: 'Dense spruce', group: '🎄 Christmas' },
  { id: 'spruceframe', name: 'Spruce frame', group: '🎄 Christmas' }, { id: 'garland', name: 'Garland & fir', group: '🎄 Christmas' }, { id: 'archfrost', name: 'Arched window · frost', group: '🎄 Christmas' },
  { id: 'roundfrost', name: 'Round window · frost', group: '🎄 Christmas' }, { id: 'leadfrost', name: 'Leaded window · frost', group: '🎄 Christmas' }, { id: 'winterforest', name: 'Winter forest', group: '🎄 Christmas' },
  { id: 'custom', name: 'Your own light picture…', group: 'Your own' },
];

/* ---------- gobo textures (white = light, black = shadow; a few seasonal ones glow warm) ---------- */
const goboCache = new Map();
export function goboCanvas(id, invert = false) {
  const key = id + invert;
  if (goboCache.has(key)) return goboCache.get(key);
  if (NATURE[id]) { const cv = NATURE[id](); finishLight(cv, invert); goboCache.set(key, cv); return cv; }
  if (id === 'custom') { const cv = customLight || whiteLight(); goboCache.set(key, invert ? inverted(cv) : cv); return goboCache.get(key); }
  const S = 1024, D = MAP, cv = makeCanvas(D, D), c = cv.getContext('2d');
  c.scale(D / S, D / S); // drawn in 1024 units, stored sharp at full size
  const r = mulberry(id.length * 97 + id.charCodeAt(0) * 13 + 3);
  const W = '#fff', K = '#000';
  c.fillStyle = K; c.fillRect(0, 0, S, S);
  c.fillStyle = W; c.strokeStyle = W;
  // Softness is applied once to the finished picture (blurring every leaf or needle on its own is very slow).
  let soft = 0, frostLater = 0;
  const blur = (px) => { soft = Math.max(soft, px || 0); };
  const ink = (col) => { c.fillStyle = col; c.strokeStyle = col; };
  // building blocks
  const windowPanes = () => { for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) c.fillRect(250 + i * 270, 170 + j * 235, 245, 210); };
  const arches = () => { for (const x of [230, 530]) { c.beginPath(); c.moveTo(x, 900); c.lineTo(x, 380); c.arc(x + 130, 380, 130, Math.PI, 0); c.lineTo(x + 260, 900); c.fill(); } };
  const roundWin = () => { c.beginPath(); c.arc(S / 2, S / 2, 280, 0, Math.PI * 2); c.fill(); };
  const leaf = (x, y, a, l, w) => { c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.ellipse(0, 0, l, w, 0, 0, Math.PI * 2); c.fill(); c.restore(); };
  const leavesOver = (n, sz = 1) => { for (let i = 0; i < n; i++) leaf(r() * S, r() * S, r() * Math.PI, (30 + r() * 40) * sz, (11 + r() * 12) * sz); };
  const branch = (x, y, a, l, w, d, leaves) => { if (d > 7 || l < 8) { if (leaves) leaf(x, y, a, 16 + r() * 14, 7 + r() * 5); return; } const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke(); if (leaves && d > 3) leaf(x2, y2, a + 1.2, 14 + r() * 10, 6 + r() * 4); branch(x2, y2, a - 0.3 - r() * 0.4, l * 0.72, w * 0.7, d + 1, leaves); branch(x2, y2, a + 0.3 + r() * 0.4, l * 0.7, w * 0.7, d + 1, leaves); };
  const fir = (x, y, h, w) => { for (let k = 0; k < 6; k++) { const t = k / 6, yy = y - h * t, ww = w * (1 - t * 0.85); c.beginPath(); c.moveTo(x - ww / 2, yy); c.lineTo(x, yy - h * 0.32); c.lineTo(x + ww / 2, yy); c.closePath(); c.fill(); } c.fillRect(x - w * 0.05, y - 4, w * 0.1, h * 0.12); };
  const bough = (x, y, a, l) => { // a fir bough: a stem with dense needles, thick enough to cast a clear shadow
    c.lineCap = 'round'; c.lineWidth = 12; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    for (let k = 0; k < 48; k++) { const t = k / 48, px = x + Math.cos(a) * l * t, py = y + Math.sin(a) * l * t, L = 58 * (1 - t * 0.55);
      for (const sgn of [-1, 1]) { c.lineWidth = 7; c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a + sgn * 0.7) * L, py + Math.sin(a + sgn * 0.7) * L); c.stroke(); } } };
  const frost = (strength = 1) => { frostLater = strength; }; // drawn after the softening, so it stays crisp
  const drawFrost = (strength) => { // feathery frost growing in from the edges of the glass
    const n = makeCanvas(256, 256), x = n.getContext('2d'), im = x.createImageData(256, 256);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const e = Math.min(px, py, 255 - px, 255 - py) / 128, v = Math.abs(Math.sin(px * 0.21 + Math.sin(py * 0.13) * 4) * Math.cos(py * 0.17 + Math.sin(px * 0.11) * 3));
      const a = Math.max(0, Math.min(1, (0.75 - e) * 1.6 + (v - 0.5) * 0.9 + (r() - 0.5) * 0.35)) * strength, i = (py * 256 + px) * 4;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = 0; im.data[i + 3] = a * 210;
    }
    x.putImageData(im, 0, 0); c.setTransform(1, 0, 0, 1, 0, 0); c.filter = 'blur(6px)'; c.drawImage(n, 0, 0, D, D); c.filter = 'none';
  };
  const lattice = (step, w) => { ink(K); c.lineWidth = w; for (let k = -S; k < S * 2; k += step) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + S, S); c.stroke(); c.beginPath(); c.moveTo(k, S); c.lineTo(k + S, 0); c.stroke(); } };
  const bat = (x, y, s) => { c.save(); c.translate(x, y); c.scale(s, s); c.beginPath(); c.moveTo(0, -6); c.quadraticCurveTo(-12, -16, -34, -10); c.quadraticCurveTo(-28, -2, -30, 6); c.quadraticCurveTo(-20, 0, -14, 6); c.quadraticCurveTo(-8, 2, -4, 10); c.lineTo(0, 4); c.lineTo(4, 10); c.quadraticCurveTo(8, 2, 14, 6); c.quadraticCurveTo(20, 0, 30, 6); c.quadraticCurveTo(28, -2, 34, -10); c.quadraticCurveTo(12, -16, 0, -6); c.fill(); c.restore(); };
  switch (id) {
    case 'none': c.fillRect(0, 0, S, S); break;
    case 'window': blur(10); windowPanes(); break;
    case 'winblinds': blur(10); windowPanes(); blur(4); ink(K); for (let y = 170; y < 880; y += 34) c.fillRect(200, y, 650, 13); break;
    case 'winleaves': blur(10); windowPanes(); ink(K); blur(9); leavesOver(45); break;
    case 'arch': blur(12); arches(); blur(6); ink(K); c.fillRect(0, 600, S, 22); c.fillRect(352, 200, 16, 700); c.fillRect(652, 200, 16, 700); break;
    case 'blinds': blur(5); for (let y = 0; y < S; y += 64) c.fillRect(0, y, S, 34); break;
    case 'softblinds': blur(22); for (let y = 0; y < S; y += 92) c.fillRect(0, y, S, 46); break;
    case 'stripes': blur(14); c.save(); c.translate(S / 2, S / 2); c.rotate(-0.6); for (let k = -3; k <= 3; k++) c.fillRect(k * 150 - 40, -S, 80, S * 2); c.restore(); break;
    case 'leaves': c.fillRect(0, 0, S, S); ink(K); blur(5); leavesOver(320, 0.42); break;
    case 'palm': { c.fillRect(0, 0, S, S); ink(K); blur(6); c.lineCap = 'round';
      for (const [ox, oy, ang] of [[-60, 120, 0.35], [S + 40, 60, Math.PI - 0.5], [200, S + 60, -1.0], [S * 0.85, S + 40, -2.3]]) {
        const L = 620; c.lineWidth = 12; c.beginPath(); c.moveTo(ox, oy);
        const mid = (t) => [ox + Math.cos(ang) * L * t, oy + Math.sin(ang) * L * t + Math.sin(t * Math.PI) * 60];
        for (let k = 1; k <= 20; k++) c.lineTo(...mid(k / 20)); c.stroke();
        for (let k = 2; k < 26; k++) { const t = k / 26, [px, py] = mid(t), len = 170 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 20;
          for (const sg of [-1, 1]) { const a2 = ang + sg * 0.62; c.lineWidth = 7 * (1 - t * 0.5); c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + Math.cos(a2) * len * 0.5, py + Math.sin(a2) * len * 0.5 + 12, px + Math.cos(a2) * len, py + Math.sin(a2) * len + 30); c.stroke(); } } }
      break; }
    case 'fanpalm': c.fillRect(0, 0, S, S); ink(K); blur(6); for (const [ox, oy, a0] of [[S * 0.15, S * 0.95, -1.9], [S * 0.9, S * 0.2, 2.2]]) { c.lineWidth = 10; c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + Math.cos(a0 + Math.PI) * 300, oy + Math.sin(a0 + Math.PI) * 300); c.stroke(); for (let k = 0; k < 22; k++) { const a = a0 - 1.25 + k * 0.12; c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + Math.cos(a - 0.03) * 520, oy + Math.sin(a - 0.03) * 520); c.lineTo(ox + Math.cos(a + 0.03) * 520, oy + Math.sin(a + 0.03) * 520); c.closePath(); c.fill(); } } break;
    case 'branches': c.fillRect(0, 0, S, S); ink(K); blur(4); branch(S * 0.08, S, -1.15, 250, 20, 0, true); branch(S * 0.97, S * 0.08, 2.5, 230, 16, 0, true); break;
    case 'bare': c.fillRect(0, 0, S, S); ink(K); blur(4); branch(S * 0.1, S, -1.2, 260, 22, 0, false); branch(S * 0.95, S * 0.1, 2.4, 220, 18, 0, false); break;
    case 'split': blur(40); c.fillRect(0, 0, S * 0.55, S); break;
    case 'spot': { const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.36); g.addColorStop(0, W); g.addColorStop(0.7, '#ddd'); g.addColorStop(1, K); c.fillStyle = g; c.fillRect(0, 0, S, S); break; }
    case 'beam': blur(30); c.save(); c.translate(S / 2, S / 2); c.rotate(-0.5); c.fillRect(-150, -S, 300, S * 2); c.restore(); break;
    case 'round': blur(10); roundWin(); blur(5); ink(K); c.fillRect(S / 2 - 9, 200, 18, 620); c.fillRect(200, S / 2 - 9, 620, 18); break;
    case 'web': { c.fillRect(0, 0, S, S); ink(K); blur(2); const cx = S * 0.62, cy = S * 0.4, n = 14; c.lineWidth = 4; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * 700, cy + Math.sin(a) * 700); c.stroke(); } c.lineWidth = 3; for (let ring = 30; ring < 650; ring *= 1.22) { c.beginPath(); for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2, rr = ring * (0.92 + 0.08 * Math.sin(k * 2.3)); const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; if (k) c.quadraticCurveTo(cx + Math.cos(a - Math.PI / n) * rr * 0.9, cy + Math.sin(a - Math.PI / n) * rr * 0.9, px, py); else c.moveTo(px, py); } c.stroke(); } break; }
    case 'pumpkins': { blur(28); for (const [x, y, s2] of [[300, 640, 1], [640, 600, 1.25], [820, 760, 0.8], [470, 330, 0.7]]) { const g = c.createRadialGradient(x, y, 0, x, y, 190 * s2); g.addColorStop(0, '#ffd9a0'); g.addColorStop(0.55, '#f08a2a'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.beginPath(); c.ellipse(x, y, 200 * s2, 160 * s2, 0, 0, Math.PI * 2); c.fill(); } break; }
    case 'bats': c.fillRect(0, 0, S, S); ink(K); blur(3); for (let i = 0; i < 26; i++) bat(r() * S, r() * S * 0.8, 1.2 + r() * 2.2); break;
    case 'gothic': blur(10); for (const x of [190, 430, 670]) { c.beginPath(); c.moveTo(x, 920); c.lineTo(x, 420); c.quadraticCurveTo(x, 230, x + 82, 160); c.quadraticCurveTo(x + 164, 230, x + 164, 420); c.lineTo(x + 164, 920); c.fill(); } blur(4); ink(K); for (const x of [190, 430, 670]) { c.fillRect(x + 76, 160, 12, 760); c.beginPath(); c.arc(x + 82, 360, 46, 0, Math.PI * 2); c.lineWidth = 10; c.stroke(); for (let y = 480; y < 900; y += 110) c.fillRect(x, y, 164, 9); } break;
    case 'jack': { blur(10); for (const [x, y, s2] of [[300, 420, 1], [720, 600, 0.9]]) { ink('#ffb04a'); c.save(); c.translate(x, y); c.scale(s2, s2); for (const sg of [-1, 1]) { c.beginPath(); c.moveTo(sg * 90, -60); c.lineTo(sg * 30, -60); c.lineTo(sg * 60, -130); c.closePath(); c.fill(); } c.beginPath(); c.moveTo(-20, -10); c.lineTo(20, -10); c.lineTo(0, -45); c.closePath(); c.fill(); c.beginPath(); c.moveTo(-140, 30); for (let k = 0; k <= 8; k++) c.lineTo(-140 + k * 35, k % 2 ? 50 : 30); c.lineTo(140, 30); c.quadraticCurveTo(0, 170, -140, 30); c.fill(); c.restore(); } break; }
    case 'pinewin': blur(10); windowPanes(); ink(K); blur(5); bough(-40, 120, 0.35, 620); bough(S + 40, 860, Math.PI + 0.25, 600); break;
    case 'frost': c.fillRect(0, 0, S, S); frost(1.1); break;
    case 'spruce': c.fillRect(0, 0, S, S); ink(K); blur(5); for (let i = 0; i < 16; i++) fir(r() * S, S * (0.72 + r() * 0.3), 300 + r() * 380, 180 + r() * 160); break;
    case 'spruceframe': c.fillRect(0, 0, S, S); ink(K); blur(6); for (let i = 0; i < 9; i++) { bough(-30, i * 120, 0.15 + r() * 0.2, 220 + r() * 120); bough(S + 30, i * 120 + 60, Math.PI - 0.15 - r() * 0.2, 220 + r() * 120); bough(i * 120, -30, Math.PI / 2 - 0.2 + r() * 0.4, 160 + r() * 80); } break;
    case 'garland': c.fillRect(0, 0, S, S); ink(K); blur(5); c.lineWidth = 10; c.beginPath(); c.moveTo(0, 120); c.quadraticCurveTo(S / 2, 330, S, 120); c.stroke(); for (let k = 0; k <= 40; k++) { const t = k / 40, x = t * S, y = 120 + 4 * 210 * t * (1 - t); bough(x, y, -Math.PI / 2 + (r() - 0.5) * 2.4, 70 + r() * 40); } for (let k = 1; k < 8; k++) { const t = k / 8, x = t * S, y = 120 + 4 * 210 * t * (1 - t); c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 60 + (k % 3) * 30); c.stroke(); c.beginPath(); c.arc(x, y + 90 + (k % 3) * 30, 26, 0, Math.PI * 2); c.fill(); } break;
    case 'archfrost': blur(12); arches(); blur(6); ink(K); c.fillRect(0, 600, S, 22); c.fillRect(352, 200, 16, 700); c.fillRect(652, 200, 16, 700); blur(0); frost(0.9); break;
    case 'roundfrost': blur(10); roundWin(); blur(5); ink(K); c.fillRect(S / 2 - 9, 200, 18, 620); c.fillRect(200, S / 2 - 9, 620, 18); blur(0); frost(0.9); break;
    case 'leadfrost': blur(8); c.fillRect(200, 150, 620, 740); blur(2); lattice(110, 7); blur(0); frost(0.8); break;
    case 'winterforest': { const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfcfcf'); c.fillStyle = g; c.fillRect(0, 0, S, S); ink(K); blur(5); for (let i = 0; i < 9; i++) { const x = r() * S; c.fillRect(x, 0, 18 + r() * 26, S); } for (let i = 0; i < 7; i++) fir(r() * S, S + 40, 520 + r() * 300, 260 + r() * 160); break; }
  }
  c.filter = 'none'; c.globalCompositeOperation = 'source-over'; c.setTransform(1, 0, 0, 1, 0, 0);
  if (soft) { const t = makeCanvas(D, D); t.getContext('2d').drawImage(cv, 0, 0); c.fillStyle = K; c.fillRect(0, 0, D, D); c.filter = `blur(${soft * D / S}px)`; c.drawImage(t, 0, 0); c.filter = 'none'; }
  if (frostLater) drawFrost(frostLater);
  finishLight(cv, invert);
  goboCache.set(key, cv);
  return cv;
}


/* ---------------------------------------------------------------- natural light patterns, in depth
   Leaves, pine and branches are drawn in layers: far ones soft and faint, near ones sharp and dark, as when
   sunlight comes through a window past a plant. Each layer is black shapes on white; the layers multiply. */
function layered(seed, layers) {
  const out = makeCanvas(MAP, MAP), o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, MAP, MAP);
  const r = mulberry(seed);
  for (const L of layers) {
    const cv = makeCanvas(MAP, MAP), c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, MAP, MAP); c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineCap = 'round'; c.lineJoin = 'round';
    L.draw(c, r);
    o.save(); o.globalCompositeOperation = 'multiply'; o.globalAlpha = L.strength; o.filter = L.blur ? `blur(${L.blur}px)` : 'none'; o.drawImage(cv, 0, 0); o.restore();
  }
  return out;
}
const leafPath = (c, x, y, a, L, W) => { c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(L * 0.25, -W * 1.1, L * 0.7, -W * 0.9, L, 0); c.bezierCurveTo(L * 0.7, W * 0.9, L * 0.25, W * 1.1, 0, 0); c.fill(); c.restore(); };
const line = (c, x1, y1, x2, y2, w) => { c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
// a twig with alternating leaves (leafK scales the leaves: big for "Leaf shadows", small for "Branches")
function leafyTwig(c, x, y, a, len, r, s, leafK = 1, depth = 0) {
  const n = Math.max(5, Math.round(len / (64 * s))), step = len / n;
  for (let i = 0; i < n; i++) {
    const t = i / n; a += (r() - 0.5) * 0.28;
    const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
    line(c, x, y, nx, ny, Math.max(1.6, (1 - t) * 9 * s));
    if (t > 0.12) for (const side of [-1, 1]) if (r() < 0.82) {
      const la = a + side * (0.45 + r() * 0.55), L = (70 + r() * 75) * s * leafK * (1 - t * 0.3);
      const px = nx + Math.cos(la) * 12 * s, py = ny + Math.sin(la) * 12 * s;
      line(c, nx, ny, px, py, 2.2 * s);
      leafPath(c, px, py, la + side * r() * 0.35, L, L * (0.27 + r() * 0.12));
    }
    if (depth < 1 && i > 1 && r() < 0.2 + (1 - leafK) * 0.3) leafyTwig(c, nx, ny, a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5), len * 0.5, r, s * 0.9, leafK, depth + 1);
    x = nx; y = ny;
  }
  leafPath(c, x, y, a, 85 * s * leafK, 28 * s * leafK);
}
// a pine spray: a stem with long thin needles, a burst of needles at the tip, side sprays
function pineSpray(c, x, y, a, len, r, s, depth = 0) {
  const n = Math.max(6, Math.round(len / (34 * s))), step = len / n;
  for (let i = 0; i < n; i++) {
    const t = i / n; a += (r() - 0.5) * 0.14;
    const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
    line(c, x, y, nx, ny, Math.max(1.8, (1 - t) * 8 * s));
    for (let k = 0, nn = 4 + r() * 5; k < nn; k++) {
      const na = a + (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.75), nl = (55 + r() * 75) * s * (0.55 + t * 0.55);
      c.lineWidth = 3.2 * s; c.beginPath(); c.moveTo(nx, ny); c.quadraticCurveTo(nx + Math.cos(na) * nl * 0.5, ny + Math.sin(na) * nl * 0.5 + 4 * s, nx + Math.cos(na) * nl, ny + Math.sin(na) * nl); c.stroke();
    }
    if (depth < 2 && i > 2 && r() < 0.2) pineSpray(c, nx, ny, a + (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.5), len * 0.55, r, s * 0.88, depth + 1);
    x = nx; y = ny;
  }
  for (let k = 0; k < 46; k++) { const na = a + (r() - 0.5) * 2.8, nl = (70 + r() * 95) * s; line(c, x, y, x + Math.cos(na) * nl, y + Math.sin(na) * nl, 3.2 * s); }
}
// a bare branch: forking twigs that get thinner
function bareBranch(c, x, y, a, l, w, r, d = 0) {
  if (d > 8 || l < 6) return;
  const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l;
  c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * l * 0.2, (y + y2) / 2 + (r() - 0.5) * l * 0.2, x2, y2); c.stroke();
  bareBranch(c, x2, y2, a - 0.25 - r() * 0.45, l * (0.68 + r() * 0.1), w * 0.68, r, d + 1);
  bareBranch(c, x2, y2, a + 0.25 + r() * 0.45, l * (0.66 + r() * 0.1), w * 0.68, r, d + 1);
}
// a palm frond: a curving midrib with long narrow leaflets
function palmFrond(c, x, y, a, len, r, s) {
  const mid = (t) => [x + Math.cos(a) * len * t - Math.sin(a) * Math.sin(t * Math.PI) * 90 * s, y + Math.sin(a) * len * t + Math.cos(a) * Math.sin(t * Math.PI) * 90 * s];
  c.lineWidth = 10 * s; c.beginPath(); c.moveTo(x, y); for (let k = 1; k <= 24; k++) c.lineTo(...mid(k / 24)); c.stroke();
  for (let k = 3; k < 40; k++) {
    const t = k / 40, [px, py] = mid(t), L = (260 * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 30) * s;
    for (const sg of [-1, 1]) { const la = a + sg * (0.55 + r() * 0.12) + (r() - 0.5) * 0.08; c.lineWidth = 9 * s * (1 - t * 0.6); c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + Math.cos(la) * L * 0.5, py + Math.sin(la) * L * 0.5 + 18 * s, px + Math.cos(la) * L, py + Math.sin(la) * L + 50 * s); c.stroke(); }
  }
}
// things reaching in from the edges of the light (left, top, right), so the middle stays brighter
function fromEdges(c, r, n, s, draw) {
  for (let i = 0; i < n; i++) {
    const side = [0, 1, 2, 0, 2, 1][i % 6];
    let x, y, a;
    if (side === 0) { x = -40; y = MAP * (0.05 + r() * 0.9); a = (r() - 0.5) * 1.1; }
    else if (side === 1) { x = MAP * (0.05 + r() * 0.9); y = -40; a = Math.PI / 2 + (r() - 0.5) * 1.1; }
    else { x = MAP + 40; y = MAP * (0.05 + r() * 0.9); a = Math.PI + (r() - 0.5) * 1.1; }
    draw(x, y, a, (620 + r() * 520) * s);
  }
}
// a window's soft shadow: the frame around the light and its crossbars
const windowShade = (bars = true) => ({ blur: 40, strength: 0.85, draw: (c) => {
  c.fillRect(0, 0, MAP, MAP); c.fillStyle = '#fff'; c.fillRect(MAP * 0.06, MAP * 0.0, MAP * 1.0, MAP * 0.93); c.fillStyle = '#000';
  if (bars) { c.fillRect(MAP * 0.76, 0, 120, MAP); c.fillRect(0, MAP * 0.4, MAP, 105); }
} });
const NATURE = {
  leaves: () => layered(11, [
    { blur: 30, strength: 0.42, draw: (c, r) => fromEdges(c, r, 6, 1.7, (x, y, a, l) => leafyTwig(c, x, y, a, l, r, 1.7)) },
    { blur: 11, strength: 0.66, draw: (c, r) => fromEdges(c, r, 6, 1.15, (x, y, a, l) => leafyTwig(c, x, y, a, l, r, 1.15)) },
    { blur: 2.5, strength: 0.9, draw: (c, r) => fromEdges(c, r, 4, 0.85, (x, y, a, l) => leafyTwig(c, x, y, a, l, r, 0.85)) },
  ]),
  winleaves: () => layered(12, [windowShade(),
    { blur: 16, strength: 0.6, draw: (c, r) => fromEdges(c, r, 5, 1.2, (x, y, a, l) => leafyTwig(c, x, y, a, l, r, 1.2)) },
    { blur: 3, strength: 0.88, draw: (c, r) => fromEdges(c, r, 3, 0.9, (x, y, a, l) => leafyTwig(c, x, y, a, l, r, 0.9)) },
  ]),
  branches: () => layered(13, [
    { blur: 24, strength: 0.45, draw: (c, r) => fromEdges(c, r, 5, 1.5, (x, y, a, l) => leafyTwig(c, x, y, a, l, r, 1.5, 0.45)) },
    { blur: 6, strength: 0.72, draw: (c, r) => fromEdges(c, r, 5, 1.05, (x, y, a, l) => leafyTwig(c, x, y, a, l, r, 1.05, 0.45)) },
    { blur: 1.5, strength: 0.9, draw: (c, r) => fromEdges(c, r, 3, 0.8, (x, y, a, l) => leafyTwig(c, x, y, a, l, r, 0.8, 0.45)) },
  ]),
  pinewin: () => layered(14, [windowShade(),
    { blur: 20, strength: 0.55, draw: (c, r) => fromEdges(c, r, 4, 1.6, (x, y, a, l) => pineSpray(c, x, y, a, l, r, 1.6)) },
    { blur: 6, strength: 0.8, draw: (c, r) => fromEdges(c, r, 5, 1.1, (x, y, a, l) => pineSpray(c, x, y, a, l, r, 1.1)) },
    { blur: 1.5, strength: 0.97, draw: (c, r) => fromEdges(c, r, 3, 0.85, (x, y, a, l) => pineSpray(c, x, y, a, l, r, 0.85)) },
  ]),
  palm: () => layered(15, [
    { blur: 24, strength: 0.5, draw: (c, r) => fromEdges(c, r, 4, 1.5, (x, y, a, l) => palmFrond(c, x, y, a, l, r, 1.5)) },
    { blur: 5, strength: 0.9, draw: (c, r) => fromEdges(c, r, 4, 1.0, (x, y, a, l) => palmFrond(c, x, y, a, l, r, 1.0)) },
  ]),
  bare: () => layered(16, [
    { blur: 20, strength: 0.45, draw: (c, r) => { bareBranch(c, -30, MAP * 0.9, -0.9, 420, 30, r); bareBranch(c, MAP + 30, MAP * 0.15, 2.6, 380, 26, r); } },
    { blur: 3, strength: 0.9, draw: (c, r) => { bareBranch(c, MAP * 0.1, -30, 1.25, 360, 22, r); bareBranch(c, MAP + 30, MAP * 0.7, 3.4, 330, 20, r); } },
  ]),
};

/* ---------------------------------------------------------------- the backdrop picture */
const maskCache = new Map();
// the light pattern as an alpha mask (opaque where lit)
function lightMask(id, invert) {
  const key = id + '|' + invert;
  if (maskCache.has(key)) return maskCache.get(key);
  const src = goboCanvas(id, invert);
  const cv = makeCanvas(src.width, src.height), c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(src, 0, 0);
  const im = c.getImageData(0, 0, cv.width, cv.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; d[i] = d[i + 1] = d[i + 2] = 255; }
  c.putImageData(im, 0, 0);
  maskCache.set(key, cv);
  return cv;
}
const WARM = new Set(['pumpkins', 'jack']);
/**
 * The backdrop as a picture `w` × `h`: the colour where the light falls, a deeper tone of the same colour in its
 * shadows, and a soft studio fall-off. `sc` is the scene settings (bgColor, bgBright, bgContrast, gobo, goboInvert).
 */
export function composeBackdrop(w, h, sc) {
  const cv = makeCanvas(w, h), c = cv.getContext('2d');
  const bg = hexToRgb(sc.bgColor || '#ebeae8'), br = sc.bgBright ?? 1, con = sc.bgContrast ?? 1;
  const lit = bg.map(v => clamp((v + (255 - v) * 0.05) * br, 0, 255));
  const depth = clamp(0.7 * con, 0.08, 0.95); // how deep the shadows of the light pattern go
  const shade = bg.map(v => clamp((v * (1 - depth) + (v * v / 255) * depth * 0.78) * br, 0, 255));
  const rgb = (a) => `rgb(${a.map(Math.round).join(',')})`;
  c.fillStyle = rgb(shade); c.fillRect(0, 0, w, h);
  const id = sc.gobo || 'none';
  if (id === 'none') { c.fillStyle = rgb(lit); c.fillRect(0, 0, w, h); }
  else {
    const m = lightMask(id, !!sc.goboInvert), k = Math.max(w, h) / m.width, rx = (w - m.width * k) / 2, ry = (h - m.height * k) / 2;
    const lay = makeCanvas(w, h), l = lay.getContext('2d');
    l.drawImage(m, rx, ry, m.width * k, m.height * k);
    l.globalCompositeOperation = 'source-in'; l.fillStyle = rgb(lit); l.fillRect(0, 0, w, h);
    c.drawImage(lay, 0, 0);
    if (WARM.has(id)) { c.save(); c.globalCompositeOperation = 'soft-light'; c.globalAlpha = 0.75; c.drawImage(goboCanvas(id, !!sc.goboInvert), rx, ry, m.width * k, m.height * k); c.restore(); }
  }
  // studio fall-off: a touch brighter where the garment hangs, darker towards the corners
  const g = c.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, 'rgba(255,255,255,0.09)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.2)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  return cv;
}
/** The deeper tone of the backdrop colour that shadows take (for the garment's shadow on the backdrop). */
export function shadowTone(sc) {
  const bg = hexToRgb(sc.bgColor || '#ebeae8');
  return '#' + bg.map(v => Math.round(clamp(v * v / 255 * 0.55, 0, 255)).toString(16).padStart(2, '0')).join('');
}
