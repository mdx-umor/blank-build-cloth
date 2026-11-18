// Design Master — halftone: turn a picture into dots for a screen-print / DTF finish.
// Styles: Classic (a black-and-white copy becomes dots and cuts the picture out), Colour dots, Palette, One colour,
// Comic (four inks in turned grids) and Fade (only what fades into the shirt turns to dots).
// Dot shapes: dots, lines, engraving, crosshatch, diamonds, squares, circles, grain.
import { makeCanvas, hexToRgb, clamp, mulberry, rad, luminance } from './util.js';

export const HT_STYLES = [
  ['classic', 'Classic', 'As in Photoshop: a black-and-white copy becomes dots and cuts your picture out. Colours stay as they are.'],
  ['dots', 'Colour dots', 'Each dot takes the colour of its spot; the less like the shirt, the bigger.'],
  ['pal', 'Palette', 'Colours from your picture, dots where they meet.'],
  ['ink', 'One colour', 'One ink: the dot follows the light.'],
  ['cmyk', 'Comic', 'Four inks in turned grids, like a comic.'],
  ['fade', 'Fade', 'Colours stay; only what fades into the shirt turns to dots. A softer DTF print.'],
];
export const HT_SHAPES = [['dot', 'Dots'], ['line', 'Lines'], ['engrave', 'Engraving'], ['cross', 'Crosshatch'], ['diamond', 'Diamonds'], ['square', 'Squares'], ['ring', 'Circles'], ['grain', 'Grain']];
export const HT_SIZES = [['L', 'Large', 0.5], ['M', 'Medium', 0.3], ['S', 'Fine', 0.18]]; // cell size in cm
export const htDefaults = (shirt = '#ffffff') => ({ style: 'classic', shape: 'dot', size: 'M', angle: 45, con: 1, ko: luminance(shirt) > 0.5 ? 'light' : 'dark', keep: 'dark', ink: luminance(shirt) > 0.5 ? '#1b1b1f' : '#f4f4f2', colours: null, n: 4 });
// older projects stored a simple on/off with a dot size in mm
export function htOptions(it) {
  if (!it.halftone) return null;
  if (it.halftone === true) return { ...htDefaults(), style: 'dots', size: 'M', cell: (it.halftoneSize || 2) / 10 };
  return it.halftone;
}
let shirt = '#ffffff';
export const setShirtColour = (c) => { shirt = c || '#ffffff'; };
export const shirtColour = () => shirt;

const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
/** Halftone `src` (a canvas, `pxPerCm` pixels per printed cm) with options `o`. Returns a new canvas, transparent where no ink. */
export function halftoneCanvas(src, o, pxPerCm) {
  const W = src.width, H = src.height;
  const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const S = hexToRgb(shirt);
  const cellCm = o.cell || (HT_SIZES.find(s => s[0] === o.size) || HT_SIZES[1])[2];
  const cell = Math.max(2.5, cellCm * pxPerCm);
  const out = makeCanvas(W, H), c = out.getContext('2d');
  const con = o.con ?? 1;
  const shape = o.shape || 'dot';
  // average of a block around (x, y)
  const sample = (x, y, r) => {
    let R = 0, G = 0, B = 0, A = 0, n = 0;
    const st = Math.max(1, Math.floor(r / 2));
    for (let oy = -r; oy <= r; oy += st) for (let ox = -r; ox <= r; ox += st) {
      const px = Math.round(x + ox), py = Math.round(y + oy); n++;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const i = (py * W + px) * 4, a = sd[i + 3] / 255;
      R += sd[i] * a; G += sd[i + 1] * a; B += sd[i + 2] * a; A += a;
    }
    return A ? [R / A, G / A, B / A, A / n] : [0, 0, 0, 0];
  };
  const tone = (r, g, b) => clamp((lum(r, g, b) - 0.5) * con + 0.5, 0, 1); // 0 dark … 1 light
  const cover = (v) => o.ko === 'dark' ? v : o.ko === 'light' ? 1 - v : 1; // where the shirt shows through
  const dist = (r, g, b) => Math.min(1, Math.hypot(r - S[0], g - S[1], b - S[2]) / 255 / 0.6);
  // palette for the Palette style: given colours, or picked from the picture (k-means on a few hundred cells)
  let pal = null;
  if (o.style === 'pal') pal = (o.colours?.length ? o.colours.map(hexToRgb) : autoPalette(sd, W, H, o.n || 4));

  // draw one mark of coverage t (0…1) at grid position (gx, gy) in the turned grid, centre (x, y)
  const rnd = mulberry(7);
  const mark = (x, y, t, ang, col) => {
    if (t <= 0.02) return;
    c.fillStyle = col; c.strokeStyle = col;
    c.save(); c.translate(x, y); c.rotate(ang);
    switch (shape) {
      case 'square': { const s = cell * Math.sqrt(t); c.fillRect(-s / 2, -s / 2, s, s); break; }
      case 'diamond': { const s = cell * Math.sqrt(t) * 0.74; c.rotate(Math.PI / 4); c.fillRect(-s, -s, s * 2, s * 2); break; }
      case 'ring': { c.lineWidth = Math.max(0.6, t * cell * 0.62); c.beginPath(); c.arc(0, 0, cell * 0.36, 0, Math.PI * 2); c.stroke(); break; }
      case 'line': { const h = cell * t; c.fillRect(-cell / 2 - 0.3, -h / 2, cell + 0.6, h); break; }
      case 'engrave': { const h = cell * t, wv = Math.sin((x * Math.cos(ang) + y * Math.sin(ang)) / cell * 0.9) * cell * 0.18; c.fillRect(-cell / 2 - 0.3, -h / 2 + wv, cell + 0.6, h); break; }
      case 'cross': { const h = cell * Math.min(1, t * 1.2) * 0.5; c.fillRect(-cell / 2 - 0.3, -h / 2, cell + 0.6, h); if (t > 0.45) { const h2 = cell * (t - 0.45) * 0.9; c.fillRect(-h2 / 2, -cell / 2 - 0.3, h2, cell + 0.6); } break; }
      case 'grain': { const k = 3, sc = cell / k; for (let i = 0; i < k * k; i++) if (rnd() < t) c.fillRect(-cell / 2 + (i % k) * sc, -cell / 2 + Math.floor(i / k) * sc, sc + 0.2, sc + 0.2); break; }
      default: { const r = cell * Math.sqrt(t / Math.PI) * 1.02; c.beginPath(); c.arc(0, 0, Math.min(r, cell * 0.72), 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  };
  // walk a grid turned by `angDeg`
  const grid = (angDeg, fn) => {
    const a = rad(angDeg), ca = Math.cos(a), sa = Math.sin(a), R = Math.hypot(W, H) / 2 + cell;
    for (let gy = -R; gy < R; gy += cell) for (let gx = -R; gx < R; gx += cell) {
      const x = W / 2 + gx * ca - gy * sa, y = H / 2 + gx * sa + gy * ca;
      if (x < -cell || y < -cell || x > W + cell || y > H + cell) continue;
      fn(x, y, a);
    }
  };
  const r = Math.max(1, Math.floor(cell / 2));
  const ang = o.angle ?? 45;
  if (o.style === 'cmyk') {
    c.globalCompositeOperation = 'multiply';
    const inks = [['c', 15, '#00a6e2'], ['m', 75, '#e5007e'], ['y', 0, '#ffe600'], ['k', 45, '#1b1b1b']];
    for (const [ch, a0, col] of inks) grid(a0 + (ang - 45), (x, y, a) => {
      const [R, G, B, A] = sample(x, y, r); if (A < 0.02) return;
      const cc = 1 - R / 255, mm = 1 - G / 255, yy = 1 - B / 255, k = Math.min(cc, mm, yy);
      const v = { c: (cc - k) / (1 - k || 1), m: (mm - k) / (1 - k || 1), y: (yy - k) / (1 - k || 1), k }[ch];
      mark(x, y, clamp((v - 0.5) * con + 0.5, 0, 1) * A, a, col);
    });
    return out;
  }
  if (o.style === 'classic' || o.style === 'fade') {
    // a mask of dots, then the picture itself shows through the dots
    const solid = o.style === 'fade' ? 0.9 : 2;
    grid(ang, (x, y, a) => {
      const [R, G, B, A] = sample(x, y, r); if (A < 0.02) return;
      let t;
      if (o.style === 'classic') { const v = tone(R, G, B); t = (o.keep === 'light' ? v : 1 - v) * A; }
      else t = A * clamp(dist(R, G, B) * 1.6, 0, 1);
      if (t >= solid) { c.fillStyle = '#000'; c.save(); c.translate(x, y); c.rotate(a); c.fillRect(-cell / 2 - 0.5, -cell / 2 - 0.5, cell + 1, cell + 1); c.restore(); }
      else mark(x, y, t, a, '#000');
    });
    c.globalCompositeOperation = 'source-in';
    c.drawImage(src, 0, 0);
    return out;
  }
  grid(ang, (x, y, a) => {
    const [R, G, B, A] = sample(x, y, r); if (A < 0.02) return;
    if (o.style === 'ink') { mark(x, y, cover(tone(R, G, B)) * A, a, o.ink || '#111'); return; }
    let col = [R, G, B];
    if (pal) { let best = pal[0], bd = Infinity; for (const p of pal) { const d = (p[0] - R) ** 2 + (p[1] - G) ** 2 + (p[2] - B) ** 2; if (d < bd) { bd = d; best = p; } } col = best; }
    const t = clamp((dist(...col) - 0.5) * con + 0.5 + 0.25, 0, 1) * A;
    mark(x, y, t, a, `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`);
  });
  return out;
}
// a few colours that describe the picture (simple k-means), shirt-like colours left out
export function autoPalette(sd, W, H, n = 4) {
  const pts = [], step = Math.max(1, Math.floor(Math.sqrt(W * H / 900)));
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const i = (y * W + x) * 4; if (sd[i + 3] > 128) pts.push([sd[i], sd[i + 1], sd[i + 2]]); }
  if (!pts.length) return [[0, 0, 0]];
  let cs = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / n)) === 0).slice(0, n).map(p => [...p]);
  for (let it = 0; it < 8; it++) {
    const acc = cs.map(() => [0, 0, 0, 0]);
    for (const p of pts) { let b = 0, bd = Infinity; cs.forEach((q, j) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (d < bd) { bd = d; b = j; } }); const a = acc[b]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; }
    cs = acc.map((a, j) => a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cs[j]);
  }
  return cs;
}

/* ---------------------------------------------------------------- the Halftone dialog */
let E = null, cur = null, opts = null, view = { s: 1, x: 0, y: 0 }, prev = null, prevKey = '';
export function initHalftone(env) {
  E = env;
  const { $ } = E, cv = $('#htCv');
  $('#htSide').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ht]'); if (!b) return;
    const [k, v] = [b.dataset.ht, b.dataset.v];
    if (k === 'apply') return apply();
    if (k === 'remove') return remove();
    if (k === 'reset') { opts = htDefaults(shirt); return refresh(); }
    if (k === 'cancel') { $('#htDlg').hidden = true; return; }
    if (k === 'auto') { opts.colours = null; return refresh(); }
    if (k === 'addc') { opts.colours = [...(opts.colours || currentPalette()), '#888888'].slice(0, 6); return refresh(); }
    if (k === 'delc') { opts.colours = (opts.colours || currentPalette()).filter((_, i) => i !== +v); if (!opts.colours.length) opts.colours = null; return refresh(); }
    if (k in opts || ['style', 'shape', 'size', 'ko', 'keep'].includes(k)) { opts[k] = v; refresh(); }
  });
  $('#htSide').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.hr === 'angle') opts.angle = +t.value;
    if (t.dataset.hr === 'con') opts.con = +t.value;
    if (t.dataset.hr === 'ink') opts.ink = t.value;
    if (t.dataset.hc != null) { opts.colours = opts.colours || currentPalette(); opts.colours[+t.dataset.hc] = t.value; }
    if (t.dataset.hr) { const o = t.parentElement.querySelector('output'); if (o) o.textContent = t.dataset.hr === 'angle' ? `${t.value}°` : `${Math.round(t.value * 100)}%`; }
    drawPreview(true);
  });
  // zoom & pan the preview (close-up of the print, dot for dot)
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; view.x = drag.vx + (e.clientX - drag.x); view.y = drag.vy + (e.clientY - drag.y); paint(); });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * cv.width / r.width, my = (e.clientY - r.top) * cv.height / r.height;
    if (!prev) return;
    const r0 = rectOf(cv.width, cv.height), px = (mx - r0.left) / r0.dw, py = (my - r0.top) / r0.dh;
    view.s = clamp(view.s * Math.exp(-e.deltaY * 0.0015), 1, 24);
    if (view.s === 1) { view.x = view.y = 0; paint(); return; }
    const r1 = rectOf(cv.width, cv.height);
    view.x += mx - (r1.left + px * r1.dw); view.y += my - (r1.top + py * r1.dh); paint();
  }, { passive: false });
}
export function openHalftone(it) {
  if (!it || it.type !== 'image') return;
  cur = it; opts = { ...(htOptions(it) || htDefaults(shirt)) }; delete opts.cell;
  view = { s: 1, x: 0, y: 0 }; prevKey = '';
  E.$('#htDlg').hidden = false;
  refresh();
}
function currentPalette() {
  const src = sourceCanvas(); const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
  return autoPalette(d, src.width, src.height, opts.n || 4).map(([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
}
let srcCache = null;
function sourceCanvas() {
  const key = cur.id + JSON.stringify([cur.asset, cur.crop, cur.invert, cur.hue, cur.sat, cur.fill, cur.fillColor]);
  if (srcCache?.key === key) return srcCache.cv;
  const plain = { ...cur, halftone: false };
  const img = E.imageSource(plain);
  if (!img) return makeCanvas(2, 2);
  const k = Math.min(1, 1800 / Math.max(img.width || img.naturalWidth, img.height || img.naturalHeight));
  const cv = makeCanvas((img.width || img.naturalWidth) * k, (img.height || img.naturalHeight) * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  srcCache = { key, cv };
  return cv;
}
function seg(k, list, val) { return `<div class="seg small wrap">${list.map(([v, n]) => `<button data-ht="${k}" data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`; }
function refresh() {
  const { $, app } = E, o = opts, st = HT_STYLES.find(s => s[0] === o.style) || HT_STYLES[0];
  const dpi = cur.px ? Math.round(cur.px[0] * (cur.crop?.w || 1) / (cur.w / 2.54)) : 0;
  let html = `<div class="fld">Style</div>${seg('style', HT_STYLES.map(s => [s[0], s[1]]), o.style)}<p class="dlg-note">${st[2]}</p>`;
  if (o.style === 'ink') html += `<div class="row"><label>Ink colour</label><div class="ctl"><input type="color" data-hr="ink" value="${o.ink}" aria-label="Ink colour"></div></div>`;
  if (o.style === 'pal') {
    const cols = o.colours || currentPalette();
    html += `<div class="fld">Colours</div><div class="ht-cols"><button class="btn sm ${o.colours ? '' : 'on'}" data-ht="auto">Auto</button>${cols.map((c, i) => `<span class="ht-col"><input type="color" data-hc="${i}" value="${c}" aria-label="Colour ${i + 1}" title="Colour ${i + 1}"><button class="ib" data-ht="delc" data-v="${i}" title="Remove this colour">✕</button></span>`).join('')}${cols.length < 6 ? '<button class="btn sm" data-ht="addc" title="Add a colour">+</button>' : ''}</div>`;
  }
  if (o.style !== 'cmyk') html += `<div class="fld">Dot shape</div>${seg('shape', HT_SHAPES, o.shape)}`;
  html += `<div class="fld">Dot size</div>${seg('size', HT_SIZES.map(s => [s[0], s[1]]), o.size)}`;
  html += `<div class="row"><label>Angle</label><div class="ctl"><input type="range" data-hr="angle" min="0" max="90" step="1" value="${o.angle}" aria-label="Angle"><output>${o.angle}°</output></div></div>`;
  html += `<div class="row"><label>Contrast</label><div class="ctl"><input type="range" data-hr="con" min="0.4" max="2.5" step="0.01" value="${o.con}" aria-label="Contrast"><output>${Math.round(o.con * 100)}%</output></div></div>`;
  if (o.style === 'ink' || o.style === 'dots' || o.style === 'pal') html += `<div class="fld" title="Let the shirt show through">Shirt shows in</div>${seg('ko', [['dark', 'Dark'], ['light', 'Light'], ['none', 'Nowhere']], o.ko)}`;
  if (o.style === 'classic') html += `<div class="fld">Stays solid</div>${seg('keep', [['light', 'Light'], ['dark', 'Dark']], o.keep)}`;
  if (dpi && dpi < 150) html += `<p class="xerr">The picture is small for this size (${dpi} DPI): the colours inside the dots will be soft.</p>`;
  html += `<p class="dlg-note">Changes apply to the garment only when you click Apply.</p>
    <div class="row2">${cur.halftone ? '<button class="btn" data-ht="remove">Remove halftone</button>' : '<button class="btn" data-ht="cancel">Cancel</button>'}<button class="btn" data-ht="reset">Reset halftone</button></div>
    <button class="btn primary block" data-ht="apply">Apply</button>`;
  $('#htSide').innerHTML = html;
  $('#htInfo').textContent = `${app.fmtLen(cur.w)} × ${app.fmtLen(cur.w / (cur.aspect || 1))} ${app.unit()} · ${dpi} DPI · scroll to zoom, drag to pan`;
  drawPreview();
}
let pending = 0;
function drawPreview(soon) {
  clearTimeout(pending);
  pending = setTimeout(() => {
    const src = sourceCanvas(), key = JSON.stringify(opts) + shirt;
    if (key !== prevKey) { prev = halftoneCanvas(src, opts, src.width / cur.w); prevKey = key; }
    paint();
  }, soon ? 60 : 0);
}
// image rectangle on the preview canvas: fitted, then zoomed by view.s and moved by view.x/y
function rectOf(W, H) {
  const fit = Math.min((W - 24) / prev.width, (H - 24) / prev.height), dw = prev.width * fit * view.s, dh = prev.height * fit * view.s;
  return { fit, dw, dh, left: (W - dw) / 2 + view.x, top: (H - dh) / 2 + view.y };
}
function paint() {
  const cv = E.$('#htCv'), box = cv.parentElement.getBoundingClientRect();
  const W = Math.max(200, Math.round(box.width)), H = Math.max(200, Math.round(Math.min(box.height || 520, 560)));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext('2d');
  c.fillStyle = shirt; c.fillRect(0, 0, W, H);
  if (!prev) return;
  const r = rectOf(W, H);
  c.imageSmoothingEnabled = view.s < 3;
  c.drawImage(prev, r.left, r.top, r.dw, r.dh);
}
async function apply() {
  const { app, $, toast } = E;
  $('#htDlg').hidden = true;
  toast('Making the full print…', 20000);
  await new Promise(r => setTimeout(r, 30));
  cur.halftone = { ...opts }; delete cur.halftoneSize;
  E.changed();
  toast('Halftone applied');
  void app;
}
function remove() {
  const { $, toast } = E;
  delete cur.halftone; delete cur.halftoneSize;
  $('#htDlg').hidden = true;
  E.changed();
  toast('Halftone removed');
}
