// Design Master — application controller.
import { buildGarment, GARMENT_LIST, garmentThumbSVG, isModelGarment, modelLoaded, loadModelGarment } from './garments.js';
import { Studio, GOBOS, goboCanvas } from './scene.js';
import { PatternEditor } from './editor.js';
import { FABRICS, WASHES, SWATCHES, buildOverlays } from './fabric.js';
import { FONTS, SHAPES, drawFabric, drawArtwork, prepareOverlayTint, itemHeight, textRaster, trimTransparent, removeBackground, piecePath, drawItem, itemCorners, hitItem } from './atlas.js';
import { uid, clamp, download, canvasToBlob, readFileAsDataURL, readFileAsText, loadImage, makeCanvas, debounce, slug, luminance, pointInPoly } from './util.js';
import * as store from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FACTORY_SCENE = { backdrop: true, bgColor: '#ebeae8', bgBright: 1, gobo: 'window', goboInvert: false, lightSide: -32, lightHeight: 38, lightPower: 1, softness: 0.5, envPower: 0.55, ambient: 1, fill: 1, shadows: true, hanger: true, hangerColor: '#b08a5c', spin: false };
const DEFAULT_DOC = () => ({
  v: 1, name: 'Untitled design', garment: 'tee', items: [],
  fabric: { color: '#ffffff', mode: 'solid', color2: '#5b5bd6', angle: 90, type: 'jersey', knit: 1, relief: 0.6, wash: 'none', washAmt: 0.8, washSeed: 0, heather: false, wrinkles: 0.8, pieceColors: {} },
  details: { label: true, labelText: 'DESIGN MASTER', labelColor: '#1f2330', labelInk: '#ffffff', cord: '#ffffff', buttons: '#f2f0ea' },
  scene: { ...FACTORY_SCENE, ...loadLook() },
  view: { marks: true, unit: 'cm' },
});
function loadLook() { try { return JSON.parse(localStorage.getItem('dm.look') || '{}'); } catch { return {}; } }

const COLOR_GROUPS = [
  { id: 'sleeves', name: 'Sleeves', pieces: ['sleeveL', 'sleeveR'] },
  { id: 'hood', name: 'Hood', pieces: ['hood', 'hoodIn'] },
  { id: 'pocket', name: 'Pocket', pieces: ['pocket'] },
  { id: 'ribs', name: 'Cuffs & waistband', pieces: ['ribF', 'ribB', 'cuffL', 'cuffR'] },
  { id: 'back', name: 'Back', pieces: ['back'] },
  { id: 'trim', name: 'Neck rib & straps', pieces: ['neckF', 'neckB', 'trim'] },
  { id: 'collar', name: 'Collar', pieces: ['collar', 'collarStand'] },
  { id: 'yoke', name: 'Back yoke', pieces: ['yoke'] },
];
const RENDER_SIZES = [
  [2000, 2500, '4:5 · catalogue'], [1600, 2000, '4:5'], [3000, 3750, '4:5 · large'], [1200, 1500, '4:5 · web'],
  [2000, 2000, '1:1'], [3000, 3000, '1:1 · large'], [1500, 2000, '3:4'], [2250, 3000, '3:4'],
  [1080, 1920, '9:16 · stories'], [2160, 3840, '9:16 · 4K'], [1920, 1080, '16:9'], [3840, 2160, '16:9 · 4K'], [2000, 1500, '4:3'],
];

/* ====================================================================== */
const app = {
  doc: DEFAULT_DOC(), assets: {}, garment: null, selId: null, presetIdx: 0,
  baseCanvas: null, atlasCanvas: makeCanvas(4, 4), overlays: null,
  history: [], future: [],
  $,
  selected() { return this.doc.items.find(i => i.id === this.selId) || null; },
  select(id) { if (this.selId === id) return; this.selId = id; editor.redraw(); renderDesign(); },
  itemsChanged(live) { scheduleAtlas(); editor.redraw(); if (live) syncSelectedFields(); else { renderLayers(); syncSelectedFields(); } },
  commit, assetReady() { scheduleAtlas(); editor.redraw(); renderLayers(); },
  focusText() { const t = $('#tabDesign textarea'); if (t) { switchTab('design'); t.focus(); t.select(); } },
  unit() { return this.doc.view.unit || 'cm'; },
  fmtLen(cm) { const u = this.unit(); const v = u === 'in' ? cm / 2.54 : u === 'mm' ? cm * 10 : cm; return u === 'mm' ? v.toFixed(0) : v.toFixed(u === 'in' ? 2 : 1); },
  toCm(v) { const u = this.unit(); return u === 'in' ? v * 2.54 : u === 'mm' ? v / 10 : v; },
};
window.DM = app; // handy for debugging from the console

const studio = new Studio($('#gl'));
const editor = new PatternEditor($('#pat'), app);
app.studio = studio;

/* ---------- garment / fabric pipeline ---------- */
function geoKey() { const d = app.doc; return [d.garment, d.fabric.wrinkles, d.details.label, d.scene.hanger].join('|'); }
let lastGeoKey = '';
async function applyGarment(id, { reframe = false } = {}) {
  app.doc.garment = id;
  if (isModelGarment(id) && !modelLoaded(id)) {
    toast('Loading the 3D model…', 8000);
    try { await loadModelGarment(id); } catch (e) { console.error(e); toast('Could not load the 3D model.'); return; }
    if (app.doc.garment !== id) return;
  }
  app.garment = buildGarment(id);
  // keep artwork on matching pieces; anything else lands on the front
  for (const it of app.doc.items) {
    let p = app.garment.pieces.find(p => p.id === it.piece);
    if (!p) { p = app.garment.pieces.find(p => p.id === 'front'); it.piece = 'front'; it.x = p.w / 2; it.y = p.h * 0.35; }
    it.x = clamp(it.x, 0, p.w); it.y = clamp(it.y, 0, p.h);
  }
  // garments with built-in contrast parts (baseball tee) set them; leaving such a garment removes them again
  const pc = app.doc.fabric.pieceColors || {};
  if (pc._auto && pc._auto !== id) { const c = pc._autoColor; for (const k of ['sleeveL', 'sleeveR', 'trim', 'neckF', 'neckB']) if (pc[k] === c) delete pc[k]; delete pc._auto; delete pc._autoColor; }
  if (app.garment.contrast && pc._auto !== id && !pc.sleeveL) Object.assign(pc, { sleeveL: app.garment.contrast, sleeveR: app.garment.contrast, trim: app.garment.contrast, neckF: app.garment.contrast, neckB: app.garment.contrast, _auto: id, _autoColor: app.garment.contrast });
  app.doc.fabric.pieceColors = pc;
  rebuildOverlays();
  rebuildBase();
  rebuildGeometry(reframe);
  studio.updateFabric(app.doc.fabric);
  updateLabel();
  editor._fitted = false; editor.fit(); editor._fitted = true;
  $('#garmentName').textContent = app.garment.name;
  $('#garmentCut').textContent = app.garment.cut;
  $('#garmentThumb').innerHTML = garmentThumbSVG(app.garment, '#fff');
  renderAll();
}
function rebuildGeometry(reframe = false) {
  const d = app.doc;
  studio.setGarment(app.garment, { wrinkles: d.fabric.wrinkles * 1.6, label: d.details.label, hanger: d.scene.hanger, res: 100, reframe, seed: 3 });
  studio.mats.cord.color.set(d.details.cord || '#ffffff'); studio.mats.button.color.set(d.details.buttons || '#f2f0ea');
  lastGeoKey = geoKey();
}
const rebuildGeometrySoon = debounce(() => { if (geoKey() !== lastGeoKey) rebuildGeometry(false); }, 120);
function rebuildOverlays() {
  app.overlays = buildOverlays(app.garment, app.doc.fabric);
  prepareOverlayTint(app.overlays, app.doc.fabric.color2);
}
function atlasPpc(hi = false) {
  const max = Math.max(app.garment.sheet.w, app.garment.sheet.h);
  const tex = Math.min(studio.renderer.capabilities.maxTextureSize, hi ? 8192 : 3072);
  return Math.min(hi ? 60 : 14, tex / max);
}
function rebuildBase(ppc = atlasPpc()) {
  const g = app.garment;
  const cv = app.baseCanvas && app.baseCanvas._ppc === ppc ? app.baseCanvas : makeCanvas(g.sheet.w * ppc, g.sheet.h * ppc);
  cv.width = Math.round(g.sheet.w * ppc); cv.height = Math.round(g.sheet.h * ppc); cv._ppc = ppc;
  const c = cv.getContext('2d');
  c.setTransform(ppc, 0, 0, ppc, 0, 0);
  drawFabric(c, g, app.doc.fabric, app.overlays, { fillSheet: true });
  app.baseCanvas = cv;
  scheduleAtlas(); editor.redraw();
}
function composeAtlas(target, base, ppc) {
  const g = app.garment;
  target.width = base.width; target.height = base.height;
  const c = target.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(base, 0, 0);
  c.setTransform(ppc, 0, 0, ppc, 0, 0);
  drawArtwork(c, g, app.doc.items, app.assets, () => app.assetReady(), ppc);
  return target;
}
let atlasRaf = 0;
function scheduleAtlas() {
  if (atlasRaf) return;
  atlasRaf = requestAnimationFrame(() => { atlasRaf = 0; composeAtlas(app.atlasCanvas, app.baseCanvas, app.baseCanvas._ppc); studio.setAtlas(app.atlasCanvas); });
}
// temporarily switch the 3D texture to a high-resolution atlas for final renders
async function withHiResAtlas(fn) {
  const ppc = atlasPpc(true), g = app.garment;
  const base = makeCanvas(g.sheet.w * ppc, g.sheet.h * ppc), c = base.getContext('2d');
  c.setTransform(ppc, 0, 0, ppc, 0, 0);
  drawFabric(c, g, app.doc.fabric, app.overlays, { fillSheet: true });
  const hi = composeAtlas(makeCanvas(4, 4), base, ppc);
  studio.setAtlas(hi);
  try { return await fn(); } finally { studio.setAtlas(app.atlasCanvas); scheduleAtlas(); }
}
function updateLabel() {
  const d = app.doc.details, cv = makeCanvas(560, 320), c = cv.getContext('2d');
  c.fillStyle = d.labelColor; c.fillRect(0, 0, 560, 320);
  c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 6; c.strokeRect(14, 14, 532, 292);
  c.fillStyle = d.labelInk; c.textAlign = 'center'; c.textBaseline = 'middle';
  const t = (d.labelText || '').toUpperCase();
  let fs = 96; c.font = `800 ${fs}px Inter, sans-serif`;
  while (c.measureText(t).width > 470 && fs > 20) { fs -= 4; c.font = `800 ${fs}px Inter, sans-serif`; }
  c.fillText(t, 280, 140);
  c.font = '600 40px Inter, sans-serif'; c.globalAlpha = 0.7; c.fillText('M', 280, 240);
  studio.setLabel(cv);
}

/* ---------- history ---------- */
const snapshot = () => JSON.stringify(app.doc);
function commit() {
  const s = snapshot();
  if (app.history[app.history.length - 1] === s) return;
  app.history.push(s); if (app.history.length > 120) app.history.shift();
  app.future = [];
  updateUndo(); autosave();
}
function restore(s) {
  const prev = app.doc;
  app.doc = JSON.parse(s);
  if (prev.garment !== app.doc.garment) applyGarment(app.doc.garment);
  else {
    rebuildOverlays(); rebuildBase(); studio.updateFabric(app.doc.fabric); studio.updateScene(app.doc.scene); updateLabel();
    if (geoKey() !== lastGeoKey) rebuildGeometry(false);
    renderAll();
  }
  if (!app.selected()) app.selId = null;
  editor.redraw(); scheduleAtlas(); autosave();
}
function undo() { if (app.history.length < 2) return; app.future.push(app.history.pop()); restore(app.history[app.history.length - 1]); updateUndo(); }
function redo() { const s = app.future.pop(); if (!s) return; app.history.push(s); restore(s); updateUndo(); }
function updateUndo() { $('#undoBtn').disabled = app.history.length < 2; $('#redoBtn').disabled = !app.future.length; }
const autosave = debounce(() => {
  const used = new Set(app.doc.items.filter(i => i.asset).map(i => i.asset));
  for (const k of Object.keys(app.assets)) if (!used.has(k) && !app.history.some(h => h.includes(k))) delete app.assets[k];
  store.save('autosave', { doc: app.doc, assets: app.assets }).catch(() => {});
}, 600);

/* ---------- items ---------- */
function currentPreset() { return app.garment.presets[app.presetIdx] || app.garment.presets[0]; }
function placeAt(it, preset, keepSize = false) {
  const p = app.garment.pieces.find(p => p.id === preset.piece) || app.garment.pieces[0];
  it.piece = p.id; it.x = p.w * preset.fx; it.y = p.h * preset.fy;
  if (!keepSize) {
    it.w = Math.min(preset.w, p.w * 0.9);
    if (it.type === 'shape') it.h = it.w;
    // keep tall artwork inside the piece
    const h = itemHeight(it, app.assets);
    if (h > p.h * 0.8) it.w *= (p.h * 0.8) / h;
    if (it.type === 'shape') it.h = Math.min(it.h, it.w);
  }
}
function addItem(it, at) {
  it.id = it.id || uid('it');
  Object.assign(it, { rot: 0, opacity: 1, flip: false, hidden: false, locked: false, blend: 'normal', distress: 0, ...it });
  if (at) { it.piece = at.piece; it.x = at.x; it.y = at.y; it.w = Math.min(it.w || 20, (app.garment.pieces.find(p => p.id === at.piece)?.w || 40) * 0.7); if (it.type === 'shape') it.h = it.w; }
  else placeAt(it, currentPreset());
  app.doc.items.push(it);
  app.selId = it.id;
  app.itemsChanged(false); renderDesign(); commit();
  return it;
}
async function addImageFile(file, at) {
  if (file.type === 'application/json' || /\.(dmproj|json)$/i.test(file.name)) return openProjectFile(file);
  if (!file.type.startsWith('image/')) return toast('That file is not an image.');
  let src = await readFileAsDataURL(file);
  let img = await loadImage(src);
  let w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
  if (file.type === 'image/svg+xml') { // rasterise SVGs once, at print resolution
    const k = 4000 / Math.max(w, h); const cv = makeCanvas(w * k, h * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); src = cv.toDataURL('image/png'); w = cv.width; h = cv.height;
  } else if (Math.max(w, h) > 8000) {
    const k = 8000 / Math.max(w, h); const cv = makeCanvas(w * k, h * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); src = cv.toDataURL('image/png'); w = cv.width; h = cv.height;
  }
  const asset = uid('a'); app.assets[asset] = src;
  addItem({ type: 'image', asset, aspect: w / h, px: [w, h], name: file.name.replace(/\.[^.]+$/, ''), w: 25 }, at);
}
function addText(at) {
  const dark = luminance(app.doc.fabric.color) > 0.5;
  addItem({ type: 'text', text: 'YOUR TEXT', font: 'Archivo Black', weight: 400, italic: false, caps: true, color: dark ? '#1f2330' : '#ffffff', align: 'center', lineH: 1.05, letter: 2, curve: 0, stroke: 0, strokeColor: dark ? '#ffffff' : '#1f2330', name: 'Text', w: 22 }, at);
  setTimeout(() => app.focusText(), 30);
}
function addShape(shape = 'star', at) {
  addItem({ type: 'shape', shape, color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b5bd6', outline: false, thick: 4, dashed: false, name: SHAPES.find(s => s.id === shape)?.name || 'Shape', w: 10, h: 10 }, at);
}
function deleteSel() { const it = app.selected(); if (!it) return; app.doc.items = app.doc.items.filter(i => i !== it); app.selId = null; app.itemsChanged(false); renderDesign(); commit(); }
function duplicateSel() { const it = app.selected(); if (!it) return; const c = JSON.parse(JSON.stringify(it)); c.id = uid('it'); c.x += 1.5; c.y += 1.5; c.name = (c.name || '') + ' copy'; const i = app.doc.items.indexOf(it); app.doc.items.splice(i + 1, 0, c); app.selId = c.id; app.itemsChanged(false); renderDesign(); commit(); }
function moveZ(dir) { const it = app.selected(); if (!it) return; const a = app.doc.items, i = a.indexOf(it), j = clamp(i + dir, 0, a.length - 1); a.splice(i, 1); a.splice(j, 0, it); app.itemsChanged(false); commit(); }
function alignSel(how) {
  const it = app.selected(); if (!it) return;
  const p = app.garment.pieces.find(p => p.id === it.piece);
  const cs = itemCorners(it, app.assets);
  const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
  const hw = (Math.max(...xs) - Math.min(...xs)) / 2, hh = (Math.max(...ys) - Math.min(...ys)) / 2;
  // pieces aren't rectangles: find the inside span at the item's row/column
  const span = (axis, at) => { const pts = []; for (let t = 0; t <= 1; t += 0.005) { const q = axis === 'x' ? [t * p.w, at] : [at, t * p.h]; if (pointInPoly(q[0], q[1], p.poly)) pts.push(axis === 'x' ? q[0] : q[1]); } return pts.length ? [Math.min(...pts), Math.max(...pts)] : [0, axis === 'x' ? p.w : p.h]; };
  const m = 1.5;
  if (how === 'l') it.x = span('x', it.y)[0] + hw + m;
  if (how === 'c') { const s = span('x', it.y); it.x = (s[0] + s[1]) / 2; }
  if (how === 'r') it.x = span('x', it.y)[1] - hw - m;
  if (how === 't') it.y = span('y', it.x)[0] + hh + m;
  if (how === 'm') { const s = span('y', it.x); it.y = (s[0] + s[1]) / 2; }
  if (how === 'b') it.y = span('y', it.x)[1] - hh - m;
  app.itemsChanged(false); commit();
}

/* ====================================================================== */
/* inspector UI helpers */
const ICON = {
  image: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8.5" r="1.4" fill="currentColor"/><path d="M4 15l4.5-4 3 2.5L14 11l3 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  text: '<svg viewBox="0 0 20 20"><path d="M4 5h12M10 5v11M7.5 16h5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  shape: '<svg viewBox="0 0 20 20"><rect x="3" y="9" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  eye: '<svg viewBox="0 0 20 20"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  eyeOff: '<svg viewBox="0 0 20 20"><path d="M3 3l14 14M8 5a8 8 0 0110 5s-1 1.8-2.8 3.3M12 15.2A8 8 0 012 10s1-1.9 3-3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  lock: '<svg viewBox="0 0 20 20"><rect x="4.5" y="9" width="11" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 9V6.5a3 3 0 016 0V9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  unlock: '<svg viewBox="0 0 20 20"><rect x="4.5" y="9" width="11" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 9V6.5a3 3 0 015.8-1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  drop: '<svg viewBox="0 0 20 20"><path d="M12.5 3.5l4 4-8 8H4.5v-4z M10.5 5.5l4 4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
};
const alignIcon = (k) => {
  const P = { l: 'M4 3v14M7 7h9M7 13h6', c: 'M10 3v14M5 7h10M7 13h6', r: 'M16 3v14M4 7h9M7 13h6', t: 'M3 4h14M7 7v9M13 7v6', m: 'M3 10h14M7 5v10M13 7v6', b: 'M3 16h14M7 4v9M13 7v6' }[k];
  return `<svg viewBox="0 0 20 20"><path d="${P}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
};
function get(path) { const [scope, ...rest] = path.split('.'); let o = scope === 'item' ? app.selected() : app.doc[scope]; for (const k of rest) o = o?.[k]; return o; }
function set(path, v) {
  const [scope, ...rest] = path.split('.'); let o = scope === 'item' ? app.selected() : app.doc[scope];
  if (!o) return; for (const k of rest.slice(0, -1)) o = o[k] ??= {}; o[rest[rest.length - 1]] = v;
}
const fmt = (v, step) => { const d = String(step).split('.')[1]?.length || 0; return Number(v).toFixed(d); };
function slider(k, label, min, max, step, opts = {}) {
  const v = get(k) ?? opts.def ?? min;
  return `<div class="row"><label>${label}</label><div class="ctl"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="val" data-v="${k}">${opts.pct ? Math.round(v * 100) + '%' : fmt(v, step) + (opts.suf || '')}</span></div></div>`;
}
function colorRow(k, label) { const v = get(k) || '#000000'; return `<div class="row"><label>${label}</label><div class="ctl color"><input type="color" data-k="${k}" value="${v}"><input type="text" data-k="${k}" data-hex value="${v}" maxlength="7"></div></div>`; }
function toggleRow(k, label, def = false) { const v = get(k) ?? def; return `<div class="trow"><span>${label}</span><label class="toggle"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}><span></span></label></div>`; }
function selectRow(k, label, options) { const v = get(k); return `<div class="row"><label>${label}</label><div class="ctl"><select data-k="${k}">${options.map(([val, name]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></div></div>`; }
function lenRow(k, label) { const v = get(k) || 0; return `<div class="row"><label>${label}</label><div class="ctl"><div class="num-u"><input type="number" data-k="${k}" data-len step="${app.unit() === 'mm' ? 1 : 0.1}" value="${app.fmtLen(v)}"><span>${app.unit()}</span></div></div></div>`; }
function segRow(k, label, options) { const v = get(k); return `<div class="row"><label>${label}</label><div class="ctl"><div class="seg small" style="flex:1">${options.map(([val, name]) => `<button data-seg="${k}" data-val="${esc(val)}" class="${String(v) === String(val) ? 'on' : ''}" style="flex:1">${name}</button>`).join('')}</div></div></div>`; }
const sec = (title, body, act = '') => `<div class="sec"><h4>${title}${act}</h4>${body}</div>`;

/* ---------- Design tab ---------- */
function renderDesign() {
  const it = app.selected(), g = app.garment;
  let html = sec('Artwork', `
    <div class="add-grid">
      <button data-add="image">${ICON.image}Image</button>
      <button data-add="text">${ICON.text}Text</button>
      <button data-add="shape">${ICON.shape}Shape</button>
    </div>
    <div class="hintline" style="margin:10px 0 6px">Place ${it ? 'the selected item' : 'new artwork'} at</div>
    <div class="chips">${g.presets.map((p, i) => `<button class="chip ${!it && i === app.presetIdx ? 'on' : ''}" data-preset="${i}">${esc(p.name)}</button>`).join('')}</div>`);
  html += `<div id="selSec">${selectedHTML(it)}</div>`;
  html += `<div class="sec"><h4>Layers <span class="hintline" style="margin:0;text-transform:none;letter-spacing:0;font-weight:400">drag to reorder</span></h4><div class="layers" id="layers"></div></div>`;
  $('#tabDesign').innerHTML = html;
  renderLayers();
}
function selectedHTML(it) {
  if (!it) return sec('Selected item', `<div class="empty">Nothing selected. Add an image or text, or click artwork on the pattern or the 3D garment.</div>`);
  const p = app.garment.pieces.find(p => p.id === it.piece);
  let body = '';
  if (it.type === 'text') {
    const f = FONTS.find(f => f.family === it.font) || FONTS[0];
    body += `<textarea data-k="item.text" rows="2" spellcheck="false">${esc(it.text)}</textarea>`;
    body += selectRow('item.font', 'Font', FONTS.map(f => [f.family, f.family]));
    body += selectRow('item.weight', 'Weight', f.weights.map(w => [w, { 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' }[w] || w]));
    body += `<div class="row"><label>Style</label><div class="ctl ibar">
      <button class="ib ${it.italic ? 'on' : ''}" data-flag="italic" title="Italic"><i style="font-family:serif;font-size:16px">I</i></button>
      <button class="ib ${it.caps ? 'on' : ''}" data-flag="caps" title="All caps" style="font-size:11px;font-weight:700">AA</button>
      <span style="width:8px"></span>
      ${['left', 'center', 'right'].map(a => `<button class="ib ${it.align === a ? 'on' : ''}" data-seg="item.align" data-val="${a}" title="Align ${a}"><svg viewBox="0 0 20 20"><path d="${a === 'left' ? 'M3 5h14M3 9h9M3 13h14M3 17h9' : a === 'center' ? 'M3 5h14M5.5 9h9M3 13h14M5.5 17h9' : 'M3 5h14M8 9h9M3 13h14M8 17h9'}" stroke="currentColor" stroke-width="1.5"/></svg></button>`).join('')}
    </div></div>`;
    body += colorRow('item.color', 'Colour');
    body += slider('item.curve', 'Curve', -100, 100, 1);
    body += slider('item.letter', 'Spacing', -10, 60, 1);
    body += slider('item.lineH', 'Line height', 0.7, 2, 0.05);
    body += slider('item.stroke', 'Outline', 0, 20, 0.5);
    if (it.stroke) body += colorRow('item.strokeColor', 'Outline colour');
  } else if (it.type === 'shape') {
    body += selectRow('item.shape', 'Shape', SHAPES.map(s => [s.id, s.name]));
    body += colorRow('item.color', 'Colour');
    if (it.shape !== 'line') body += toggleRow('item.outline', 'Outline only');
    if (it.shape === 'line' || it.outline) { body += slider('item.thick', 'Thickness', 0.5, 30, 0.5, { suf: ' mm' }); body += toggleRow('item.dashed', 'Dashed'); }
  } else if (it.type === 'image') {
    const [pw, ph] = it.px || [0, 0];
    const dpi = pw ? Math.round(pw / (it.w / 2.54)) : 0;
    const ok = dpi >= 200, warn = dpi < 120;
    body += `<div class="row"><label>Print quality</label><div class="ctl"><span style="font-weight:600;color:${warn ? 'var(--danger)' : ok ? 'var(--accent)' : 'var(--ink)'}" data-dpi>${dpi} DPI</span><span class="hintline" style="margin:0">${pw} × ${ph} px</span></div></div>`;
    body += `<div class="row3"><button class="btn sm" data-act="replace">Replace</button><button class="btn sm" data-act="trim">Trim edges</button><button class="btn sm" data-act="nobg">Remove bg</button></div>`;
  }
  const unit = app.unit();
  const tf = `
    ${lenRow('item.w', 'Width')}
    ${it.type === 'shape' ? lenRow('item.h', 'Height') : `<div class="row"><label>Height</label><div class="ctl"><span class="hintline" style="margin:0" data-h>${app.fmtLen(itemHeight(it, app.assets))} ${unit}</span></div></div>`}
    <div class="row"><label>From centre</label><div class="ctl"><div class="num-u"><input type="number" data-pos="x" step="0.1" value="${app.fmtLen(it.x - p.w / 2)}"><span>${unit}</span></div></div></div>
    <div class="row"><label>From top</label><div class="ctl"><div class="num-u"><input type="number" data-pos="y" step="0.1" value="${app.fmtLen(it.y - itemHeight(it, app.assets) / 2)}"><span>${unit}</span></div></div></div>
    ${slider('item.rot', 'Rotation', -180, 180, 1, { suf: '°' })}
    ${slider('item.opacity', 'Opacity', 0, 1, 0.01, { pct: true })}
    <div class="row"><label>Align</label><div class="ctl ibar">${['l', 'c', 'r', 't', 'm', 'b'].map(k => `<button class="ib" data-align="${k}" title="${{ l: 'Left edge', c: 'Centre', r: 'Right edge', t: 'Top', m: 'Middle', b: 'Bottom' }[k]} of the piece">${alignIcon(k)}</button>`).join('')}</div></div>
    <div class="row"><label>Arrange</label><div class="ctl ibar">
      <button class="ib" data-act="rotL" title="Rotate 90° left">↺</button><button class="ib" data-act="rotR" title="Rotate 90° right">↻</button>
      <button class="ib ${it.flip ? 'on' : ''}" data-act="flip" title="Mirror">⇋</button>
      <button class="ib" data-act="up" title="Bring forward">▲</button><button class="ib" data-act="down" title="Send backward">▼</button>
      <button class="ib" data-act="dup" title="Duplicate (Ctrl+D)">⧉</button>
    </div></div>
    ${segRow('item.blend', 'Print look', [['normal', 'Solid ink'], ['multiply', 'Soft (dyed)']])}
    ${slider('item.distress', 'Distress', 0, 1, 0.01, { pct: true })}
    <div class="row2" style="margin-top:12px"><button class="btn sm" data-act="lock">${it.locked ? 'Unlock' : 'Lock'}</button><button class="btn sm" data-act="del" style="color:var(--danger)">Delete</button></div>
    <div class="hintline">On <b>${esc(p?.label || '')}</b>. Drag it on the pattern or straight on the 3D garment.</div>`;
  return sec(it.type === 'text' ? 'Text' : it.type === 'shape' ? 'Shape' : 'Image', body) + sec('Size & position', tf);
}
function syncSelectedFields() {
  const it = app.selected(); if (!it) return;
  const p = app.garment.pieces.find(p => p.id === it.piece);
  const root = $('#selSec'); if (!root) return;
  const setv = (sel, v) => { const el = root.querySelector(sel); if (el && document.activeElement !== el) el.value = v; };
  setv('[data-k="item.w"]', app.fmtLen(it.w)); setv('[data-k="item.h"]', app.fmtLen(it.h || 0));
  setv('[data-pos="x"]', app.fmtLen(it.x - p.w / 2)); setv('[data-pos="y"]', app.fmtLen(it.y - itemHeight(it, app.assets) / 2));
  setv('[data-k="item.rot"]', it.rot || 0);
  const rv = root.querySelector('[data-v="item.rot"]'); if (rv) rv.textContent = Math.round(it.rot || 0) + '°';
  const hv = root.querySelector('[data-h]'); if (hv) hv.textContent = `${app.fmtLen(itemHeight(it, app.assets))} ${app.unit()}`;
  const dv = root.querySelector('[data-dpi]'); if (dv && it.px) { const dpi = Math.round(it.px[0] / (it.w / 2.54)); dv.textContent = dpi + ' DPI'; dv.style.color = dpi < 120 ? 'var(--danger)' : dpi >= 200 ? 'var(--accent)' : 'var(--ink)'; }
}
function renderLayers() {
  const el = $('#layers'); if (!el) return;
  const items = [...app.doc.items].reverse();
  if (!items.length) { el.innerHTML = `<div class="empty">Nothing here yet — add an image or text.</div>`; return; }
  el.innerHTML = items.map(it => {
    const p = app.garment.pieces.find(p => p.id === it.piece);
    const thumb = it.type === 'image' ? `<img src="${app.assets[it.asset] || ''}" alt="">` : it.type === 'text' ? `<span style="font-family:'${esc(it.font)}';color:${esc(it.color)}">Aa</span>` : `<span style="color:${esc(it.color)}">■</span>`;
    const name = it.type === 'text' ? (it.text || 'Text').split('\n')[0] : it.name || it.type;
    return `<div class="layer ${it.id === app.selId ? 'on' : ''} ${it.hidden ? 'hiddenL' : ''}" draggable="true" data-layer="${it.id}">
      <div class="lt">${thumb}</div><div class="ln"><b>${esc(name)}</b><small>${esc(p?.label || it.piece)}</small></div>
      <button class="ib" data-lact="lock" title="${it.locked ? 'Unlock' : 'Lock'}">${it.locked ? ICON.lock : ICON.unlock}</button>
      <button class="ib" data-lact="vis" title="${it.hidden ? 'Show' : 'Hide'}">${it.hidden ? ICON.eyeOff : ICON.eye}</button></div>`;
  }).join('');
}

/* ---------- Fabric tab ---------- */
function renderFabric() {
  const f = app.doc.fabric, g = app.garment;
  const sw = SWATCHES.map(c => `<button style="background:${c}" data-swatch="${c}" class="${c.toLowerCase() === (f.color || '').toLowerCase() ? 'on' : ''}" title="${c}"></button>`).join('');
  const hasEye = 'EyeDropper' in window;
  let html = sec('Colour', `
    <div class="swatches">${sw}</div>
    <div class="row"><label>Custom</label><div class="ctl color"><input type="color" data-k="fabric.color" value="${f.color}"><input type="text" data-k="fabric.color" data-hex value="${f.color}" maxlength="7">${hasEye ? `<button class="ib" data-act="eyedrop" title="Pick a colour from the screen">${ICON.drop}</button>` : ''}</div></div>
    ${segRow('fabric.mode', 'Fill', [['solid', 'Solid'], ['linear', 'Gradient'], ['radial', 'Radial']])}
    ${f.mode !== 'solid' ? colorRow('fabric.color2', 'Second colour') : ''}
    ${f.mode === 'linear' ? slider('fabric.angle', 'Angle', 0, 360, 1, { suf: '°' }) : ''}`);
  const groups = COLOR_GROUPS.filter(gr => gr.id === 'trim' ? (g.extras.necklines.length || g.extras.handles) : gr.pieces.some(id => g.pieces.some(p => p.id === id)));
  html += sec('Colour blocking', groups.map(gr => {
    const on = gr.pieces.some(id => f.pieceColors?.[id]);
    const col = gr.pieces.map(id => f.pieceColors?.[id]).find(Boolean) || f.color;
    return `<div class="trow"><span>${gr.name}</span><span style="display:flex;gap:8px;align-items:center">${on ? `<input type="color" data-block="${gr.id}" value="${col}" style="width:28px;height:24px;border:1px solid var(--line-strong);border-radius:6px;padding:0;background:none">` : ''}<label class="toggle"><input type="checkbox" data-blockon="${gr.id}" ${on ? 'checked' : ''}><span></span></label></span></div>`;
  }).join('') + `<div class="hintline">Give sleeves, hood or ribs their own colour.</div>`);
  html += sec('Material', `
    ${selectRow('fabric.type', 'Fabric', FABRICS.map(x => [x.id, x.name]))}
    ${slider('fabric.knit', 'Knit size', 0.4, 3, 0.05, { suf: '×' })}
    ${slider('fabric.relief', 'Texture', 0, 1.6, 0.05)}
    ${toggleRow('fabric.heather', 'Heather (melange)')}
    ${g.model ? '' : slider('fabric.wrinkles', 'Wrinkles', 0, 1.5, 0.05)}`);
  html += sec('Wash & dye', `
    ${selectRow('fabric.wash', 'Effect', WASHES.map(w => [w.id, w.name]))}
    ${f.wash !== 'none' ? slider('fabric.washAmt', 'Strength', 0, 1, 0.01, { pct: true }) : ''}
    ${WASHES.find(w => w.id === f.wash)?.tint ? colorRow('fabric.color2', 'Dye colour') : ''}
    ${f.wash !== 'none' || f.heather ? `<button class="btn sm block" data-act="reseed" style="margin-top:6px">Shuffle the pattern</button>` : ''}`);
  const d = app.doc.details;
  let det = '';
  if (g.extras.label) {
    det += toggleRow('details.label', 'Neck label', true);
    if (d.label) det += `<div class="row"><label>Label text</label><div class="ctl"><input type="text" data-k="details.labelText" value="${esc(d.labelText)}" maxlength="24"></div></div>` + colorRow('details.labelColor', 'Label colour') + colorRow('details.labelInk', 'Label ink');
  }
  if (g.extras.strings.length) det += colorRow('details.cord', 'Drawcords');
  if (g.model) det += colorRow('details.buttons', 'Buttons');
  if (det) html += sec('Details', det);
  $('#tabFabric').innerHTML = html;
}

/* ---------- Scene tab ---------- */
function renderScene() {
  const s = app.doc.scene;
  const bgs = ['#ebeae8', '#ffffff', '#f3ede4', '#e4e9ee', '#d9d4cc', '#c9d3cb', '#f1dcd6', '#3a3c40', '#1c1d20'];
  let html = sec('Look', `<div class="row3"><button class="btn sm" data-act="lookSave" title="Use this scene for new designs">Save default</button><button class="btn sm" data-act="lookReset">Saved</button><button class="btn sm" data-act="lookFactory">Factory</button></div>`);
  html += sec('Backdrop', `
    ${toggleRow('scene.backdrop', 'Studio wall', true)}
    <div class="swatches" style="grid-template-columns:repeat(9,1fr)">${bgs.map(c => `<button style="background:${c}" data-bg="${c}" class="${c === s.bgColor ? 'on' : ''}"></button>`).join('')}</div>
    ${colorRow('scene.bgColor', 'Colour')}
    ${slider('scene.bgBright', 'Brightness', 0.5, 1.4, 0.01, { pct: true })}`);
  html += sec('Window light', `
    <div class="gobo-grid">${GOBOS.map(gb => `<button data-gobo="${gb.id}" class="${(s.gobo || 'none') === gb.id ? 'on' : ''}" title="${gb.name}"><img src="${goboThumb(gb.id)}" alt=""><span>${gb.name}</span></button>`).join('')}</div>
    ${toggleRow('scene.goboInvert', 'Invert light & shadow')}`);
  html += sec('Key light', `
    ${slider('scene.lightSide', 'Direction', -80, 80, 1, { suf: '°' })}
    ${slider('scene.lightHeight', 'Height', 5, 80, 1, { suf: '°' })}
    ${slider('scene.lightPower', 'Power', 0.2, 2, 0.01, { pct: true })}
    ${slider('scene.softness', 'Softness', 0, 1, 0.01, { pct: true })}
    ${toggleRow('scene.shadows', 'Shadows', true)}`);
  html += sec('Ambient', `
    ${slider('scene.ambient', 'Ambient', 0, 2, 0.01, { pct: true })}
    ${slider('scene.fill', 'Fill light', 0, 2, 0.01, { pct: true })}
    ${slider('scene.envPower', 'Reflections', 0, 1.5, 0.01, { pct: true })}`);
  const hangers = [['#b08a5c', 'Wood'], ['#f4f4f2', 'White'], ['#1c1d20', 'Black'], ['#c0c4c8', 'Chrome']];
  html += sec(app.garment.tote ? 'Wall peg' : 'Hanger', `
    ${toggleRow('scene.hanger', 'Show', true)}
    <div class="chips">${hangers.map(([c, n]) => `<button class="chip ${s.hangerColor === c ? 'on' : ''}" data-hanger="${c}"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c};border:1px solid rgba(0,0,0,.2);margin-right:5px"></span>${n}</button>`).join('')}</div>`);
  html += sec('Workspace', `
    ${toggleRow('view.marks', 'Pattern markings', true)}
    ${segRow('view.unit', 'Units', [['cm', 'cm'], ['mm', 'mm'], ['in', 'in']])}`);
  $('#tabScene').innerHTML = html;
}
const goboThumbs = {};
function goboThumb(id) { if (goboThumbs[id]) return goboThumbs[id]; const s = goboCanvas(id), t = makeCanvas(96, 96); t.getContext('2d').drawImage(s, 0, 0, 96, 96); return (goboThumbs[id] = t.toDataURL()); }

function renderAll() { renderDesign(); renderFabric(); renderScene(); }
function switchTab(t) { $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $('#tabDesign').hidden = t !== 'design'; $('#tabFabric').hidden = t !== 'fabric'; $('#tabScene').hidden = t !== 'scene'; }

/* ---------- inspector events (delegated) ---------- */
function onValue(path, live) {
  const scope = path.split('.')[0], key = path.split('.')[1];
  if (scope === 'item') {
    const it = app.selected();
    if (it?.type === 'shape' && it.shape === 'line' && key === 'shape') it.h = 0.4;
    app.itemsChanged(live);
    if (!live && ['font', 'shape', 'outline', 'stroke', 'blend'].includes(key)) $('#selSec').innerHTML = selectedHTML(it);
    if (key === 'text' || key === 'color' || key === 'font') renderLayers();
  } else if (scope === 'fabric') {
    if (['wash', 'heather', 'washSeed'].includes(key)) rebuildOverlays();
    if (key === 'color2') prepareOverlayTint(app.overlays, app.doc.fabric.color2);
    if (['type', 'knit', 'relief'].includes(key)) studio.updateFabric(app.doc.fabric);
    else if (key === 'wrinkles') rebuildGeometrySoon();
    else { rebuildBase(); studio.updateFabric(app.doc.fabric); }
    if (!live && ['mode', 'wash', 'heather', 'color'].includes(key)) renderFabric();
  } else if (scope === 'details') {
    updateLabel(); studio.mats.cord.color.set(app.doc.details.cord || '#fff'); studio.mats.button.color.set(app.doc.details.buttons || '#f2f0ea');
    if (key === 'label') { rebuildGeometrySoon(); if (!live) renderFabric(); }
  } else if (scope === 'scene') {
    studio.updateScene(app.doc.scene);
    if (key === 'hanger') rebuildGeometrySoon();
    if (!live && ['bgColor', 'gobo'].includes(key)) renderScene();
    $('#spinBtn').classList.toggle('on', !!app.doc.scene.spin);
  } else if (scope === 'view') { editor.redraw(); if (!live) { renderDesign(); renderScene(); } }
}
function bindInspector() {
  const root = $('#inspector');
  const readVal = (el) => {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') { const v = parseFloat(el.value); return isNaN(v) ? 0 : el.dataset.len !== undefined ? app.toCm(v) : v; }
    if (el.dataset.hex !== undefined) { let v = el.value.trim(); if (!v.startsWith('#')) v = '#' + v; return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null; }
    if (el.tagName === 'SELECT' && /^\d+$/.test(el.value)) return parseInt(el.value, 10);
    return el.value;
  };
  const handle = (e, live) => {
    const el = e.target;
    if (el.dataset.pos) {
      const it = app.selected(); if (!it) return;
      const p = app.garment.pieces.find(p => p.id === it.piece), v = app.toCm(parseFloat(el.value) || 0);
      if (el.dataset.pos === 'x') it.x = p.w / 2 + v; else it.y = v + itemHeight(it, app.assets) / 2;
      app.itemsChanged(live); if (!live) commit(); return;
    }
    if (el.dataset.block) {
      const gr = COLOR_GROUPS.find(g => g.id === el.dataset.block); const pc = { ...app.doc.fabric.pieceColors };
      for (const id of gr.pieces) pc[id] = el.value; app.doc.fabric.pieceColors = pc; onValue('fabric.pieceColors', live); if (!live) commit(); return;
    }
    if (el.dataset.blockon) {
      const gr = COLOR_GROUPS.find(g => g.id === el.dataset.blockon); const pc = { ...app.doc.fabric.pieceColors };
      for (const id of gr.pieces) { if (el.checked) pc[id] = pc[id] || '#22252a'; else delete pc[id]; }
      app.doc.fabric.pieceColors = pc; onValue('fabric.pieceColors', false); renderFabric(); commit(); return;
    }
    const k = el.dataset.k; if (!k) return;
    const v = readVal(el); if (v === null) return;
    set(k, v);
    // mirror twin inputs (colour picker <-> hex field) and value readouts
    $$(`[data-k="${k}"]`, root).forEach(o => { if (o !== el && o.type !== 'checkbox') o.value = o.dataset.len !== undefined ? app.fmtLen(v) : v; });
    const out = root.querySelector(`[data-v="${k}"]`);
    if (out) { const step = parseFloat(el.step) || 1; const isPct = out.textContent.trim().endsWith('%'); out.textContent = isPct ? Math.round(v * 100) + '%' : fmt(v, step) + (out.textContent.replace(/^[-\d.]+/, '').trim() ? out.textContent.replace(/^[-\d.]+/, '') : ''); }
    onValue(k, live);
    if (!live) commit();
  };
  root.addEventListener('input', e => handle(e, true));
  root.addEventListener('change', e => handle(e, false));
  root.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tab) return switchTab(b.dataset.tab);
    if (b.dataset.add) return onAdd(b.dataset.add);
    if (b.dataset.preset !== undefined) {
      const i = +b.dataset.preset, it = app.selected();
      if (it) { placeAt(it, app.garment.presets[i]); app.itemsChanged(false); renderDesign(); commit(); }
      else { app.presetIdx = i; renderDesign(); }
      return;
    }
    if (b.dataset.seg) { set(b.dataset.seg, isNaN(+b.dataset.val) || b.dataset.val === '' ? b.dataset.val : b.dataset.seg.startsWith('item.align') ? b.dataset.val : b.dataset.val); onValue(b.dataset.seg, false); commit(); b.parentElement.querySelectorAll('[data-seg]').forEach(x => x.classList.toggle('on', x === b)); if (b.dataset.seg.startsWith('fabric.mode')) renderFabric(); return; }
    if (b.dataset.flag) { const it = app.selected(); it[b.dataset.flag] = !it[b.dataset.flag]; b.classList.toggle('on'); app.itemsChanged(false); commit(); return; }
    if (b.dataset.align) return alignSel(b.dataset.align);
    if (b.dataset.swatch) { app.doc.fabric.color = b.dataset.swatch; onValue('fabric.color', false); commit(); return; }
    if (b.dataset.bg) { app.doc.scene.bgColor = b.dataset.bg; onValue('scene.bgColor', false); commit(); return; }
    if (b.dataset.gobo) { app.doc.scene.gobo = b.dataset.gobo; onValue('scene.gobo', false); commit(); return; }
    if (b.dataset.hanger) { app.doc.scene.hangerColor = b.dataset.hanger; if (!app.doc.scene.hanger) app.doc.scene.hanger = true; onValue('scene.hanger', false); renderScene(); commit(); return; }
    if (b.dataset.lact) {
      const id = b.closest('[data-layer]').dataset.layer, it = app.doc.items.find(i => i.id === id);
      if (b.dataset.lact === 'vis') it.hidden = !it.hidden; else it.locked = !it.locked;
      app.itemsChanged(false); if (it.id === app.selId) $('#selSec').innerHTML = selectedHTML(it); commit(); e.stopPropagation(); return;
    }
    const it = app.selected();
    switch (b.dataset.act) {
      case 'rotL': it.rot = ((it.rot || 0) - 90 + 540) % 360 - 180; break;
      case 'rotR': it.rot = ((it.rot || 0) + 90 + 540) % 360 - 180; break;
      case 'flip': it.flip = !it.flip; b.classList.toggle('on'); break;
      case 'up': return moveZ(1);
      case 'down': return moveZ(-1);
      case 'dup': return duplicateSel();
      case 'del': return deleteSel();
      case 'lock': it.locked = !it.locked; $('#selSec').innerHTML = selectedHTML(it); app.itemsChanged(false); commit(); return;
      case 'replace': pendingReplace = it.id; $('#fileImage').click(); return;
      case 'trim': case 'nobg': {
        toast(b.dataset.act === 'trim' ? 'Trimming empty edges…' : 'Removing the background…');
        const out = b.dataset.act === 'trim' ? await trimTransparent(app.assets[it.asset]) : await removeBackground(app.assets[it.asset]);
        if (!out) return toast('Nothing to trim.');
        const im = await loadImage(out), a = uid('a'); app.assets[a] = out;
        const oldH = itemHeight(it, app.assets);
        it.asset = a; it.aspect = im.naturalWidth / im.naturalHeight; it.px = [im.naturalWidth, im.naturalHeight];
        if (b.dataset.act === 'trim') it.w = Math.min(it.w, oldH * it.aspect * 1.0) || it.w;
        app.itemsChanged(false); $('#selSec').innerHTML = selectedHTML(it); renderLayers(); commit(); toast('Done.'); return;
      }
      case 'eyedrop': try { const r = await new window.EyeDropper().open(); app.doc.fabric.color = r.sRGBHex; onValue('fabric.color', false); commit(); } catch { } return;
      case 'reseed': app.doc.fabric.washSeed = (app.doc.fabric.washSeed || 0) + 1; onValue('fabric.washSeed', false); commit(); return;
      case 'lookSave': try { localStorage.setItem('dm.look', JSON.stringify(app.doc.scene)); toast('This scene is now the default for new designs.'); } catch { } return;
      case 'lookReset': app.doc.scene = { ...FACTORY_SCENE, ...loadLook() }; studio.updateScene(app.doc.scene); rebuildGeometrySoon(); renderScene(); commit(); toast('Scene reset to your saved default.'); return;
      case 'lookFactory': app.doc.scene = { ...FACTORY_SCENE }; studio.updateScene(app.doc.scene); rebuildGeometrySoon(); renderScene(); commit(); toast('Factory scene restored.'); return;
      default: return;
    }
    app.itemsChanged(false); commit();
  });
  // layer list: select + drag to reorder
  root.addEventListener('click', e => { const l = e.target.closest('[data-layer]'); if (l && !e.target.closest('button')) app.select(l.dataset.layer); });
  let dragId = null;
  root.addEventListener('dragstart', e => { const l = e.target.closest('[data-layer]'); if (!l) return; dragId = l.dataset.layer; l.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  root.addEventListener('dragend', e => { e.target.closest?.('[data-layer]')?.classList.remove('dragging'); dragId = null; });
  root.addEventListener('dragover', e => { if (dragId && e.target.closest('[data-layer]')) e.preventDefault(); });
  root.addEventListener('drop', e => {
    const l = e.target.closest('[data-layer]'); if (!dragId || !l) return; e.preventDefault();
    const a = app.doc.items, from = a.findIndex(i => i.id === dragId), to = a.findIndex(i => i.id === l.dataset.layer);
    const [m] = a.splice(from, 1); a.splice(to, 0, m); app.itemsChanged(false); commit();
  });
}
let pendingReplace = null;
function onAdd(kind) {
  if (kind === 'image') { pendingReplace = null; $('#fileImage').click(); }
  else if (kind === 'text') addText();
  else addShape('star');
}

/* ====================================================================== */
/* 3D: drag artwork directly on the garment */
function hitPiece(hit) {
  if (hit.panel?.piece) return app.garment.pieces.find(p => p.id === hit.panel.piece);
  const sh = app.garment.sheet;
  return editor.pieceAt(hit.uv.x * sh.w, (1 - hit.uv.y) * sh.h) || null;
}
function bind3DDrag() {
  const pane = $('#viewPane'), cv = $('#gl');
  let drag = null;
  const toSheet = (hit) => { const sh = app.garment.sheet; return [hit.uv.x * sh.w, (1 - hit.uv.y) * sh.h]; };
  const itemAtHit = (hit) => {
    const [sx, sy] = toSheet(hit), piece = hitPiece(hit);
    if (!piece) return { it: null };
    const lx = sx - piece.sx, ly = sy - piece.sy;
    for (let i = app.doc.items.length - 1; i >= 0; i--) { const it = app.doc.items[i]; if (it.piece === piece.id && !it.hidden && !it.locked && hitItem(it, app.assets, lx, ly, 0.3)) return { it, lx, ly, piece }; }
    return { it: null, lx, ly, piece };
  };
  pane.addEventListener('pointerdown', e => {
    if (e.target !== cv || e.button !== 0) return;
    const hit = studio.pick(e); if (!hit) return;
    const r = itemAtHit(hit); if (!r.it) return;
    e.stopPropagation(); e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    app.select(r.it.id);
    drag = { it: r.it, dx: r.lx - r.it.x, dy: r.ly - r.it.y, piece: r.piece.id, moved: false };
  }, true);
  pane.addEventListener('pointermove', e => {
    if (!drag) {
      if (e.target !== cv || e.buttons) return;
      const hit = studio.pick(e); cv.style.cursor = hit && itemAtHit(hit).it ? 'move' : 'grab'; return;
    }
    e.stopPropagation();
    const hit = studio.pick(e); if (!hit) return;
    const [sx, sy] = toSheet(hit), piece = hitPiece(hit);
    if (!piece) return;
    const it = drag.it;
    if (piece.id !== drag.piece) { drag.piece = piece.id; drag.dx = 0; drag.dy = 0; it.piece = piece.id; }
    it.x = sx - piece.sx - drag.dx; it.y = sy - piece.sy - drag.dy; drag.moved = true;
    app.itemsChanged(true);
  }, true);
  const end = (e) => { if (!drag) return; e.stopPropagation(); const m = drag.moved; drag = null; if (m) { app.itemsChanged(false); commit(); } };
  pane.addEventListener('pointerup', end, true);
  pane.addEventListener('pointercancel', end, true);
}

/* ====================================================================== */
/* drop / paste files */
function bindFiles() {
  const fi = $('#fileImage');
  fi.addEventListener('change', async () => {
    const files = [...fi.files]; fi.value = '';
    if (pendingReplace && files[0]) {
      const it = app.doc.items.find(i => i.id === pendingReplace); pendingReplace = null;
      const src = await readFileAsDataURL(files[0]), im = await loadImage(src), a = uid('a'); app.assets[a] = src;
      Object.assign(it, { asset: a, aspect: im.naturalWidth / im.naturalHeight, px: [im.naturalWidth, im.naturalHeight], name: files[0].name.replace(/\.[^.]+$/, '') });
      app.itemsChanged(false); renderDesign(); commit(); return;
    }
    for (const f of files) await addImageFile(f);
  });
  const fp = $('#fileProject');
  fp.addEventListener('change', () => { const f = fp.files[0]; fp.value = ''; if (f) openProjectFile(f); });
  const hint = $('#dropHint');
  let depth = 0;
  window.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; hint.classList.add('on'); } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; hint.classList.remove('on'); } });
  window.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); depth = 0; hint.classList.remove('on');
    let at = null;
    if (e.target === $('#pat')) {
      const [x, y] = editor.toSheet(e), p = editor.pieceAt(x, y);
      if (p) at = { piece: p.id, x: x - p.sx, y: y - p.sy };
    } else if (e.target === $('#gl')) {
      const hit = studio.pick(e);
      const p = hit && hitPiece(hit);
      if (p) { const sh = app.garment.sheet; at = { piece: p.id, x: hit.uv.x * sh.w - p.sx, y: (1 - hit.uv.y) * sh.h - p.sy }; }
    }
    for (const f of e.dataTransfer.files) await addImageFile(f, at);
  });
  window.addEventListener('paste', async e => {
    if (isTyping(e)) return;
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); for (const f of files) await addImageFile(f); }
  });
}
const isTyping = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };

/* ====================================================================== */
/* project save / open */
function saveProject() {
  const used = new Set(app.doc.items.filter(i => i.asset).map(i => i.asset));
  const assets = Object.fromEntries(Object.entries(app.assets).filter(([k]) => used.has(k)));
  const data = JSON.stringify({ app: 'design-master', v: 1, doc: app.doc, assets });
  download(new Blob([data], { type: 'application/json' }), slug(app.doc.name) + '.dmproj');
  toast('Project saved.');
}
async function openProjectFile(file) {
  try {
    const data = JSON.parse(await readFileAsText(file));
    if (data.app !== 'design-master' || !data.doc) throw new Error('bad');
    loadDoc(data.doc, data.assets || {});
    toast(`Opened “${app.doc.name}”.`);
  } catch { toast('Could not open the project file.'); }
}
function loadDoc(doc, assets) {
  const base = DEFAULT_DOC();
  app.doc = { ...base, ...doc, fabric: { ...base.fabric, ...doc.fabric }, details: { ...base.details, ...doc.details }, scene: { ...base.scene, ...doc.scene }, view: { ...base.view, ...doc.view } };
  app.assets = { ...assets };
  app.selId = null; app.history = []; app.future = [];
  $('#projName').value = app.doc.name || 'Untitled design';
  applyGarment(app.doc.garment, { reframe: true });
  studio.updateScene(app.doc.scene);
  $('#spinBtn').classList.toggle('on', !!app.doc.scene.spin);
  commit();
}

/* ====================================================================== */
/* exports */
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); }
const fname = (s) => `${slug(app.doc.name)}-${slug(app.garment.name)}${s ? '-' + s : ''}`;
async function encode(cv, fmt = 'png') { return canvasToBlob(cv, fmt === 'png' ? 'image/png' : 'image/' + fmt, 0.94); }

let renderAbort = null, renderCanvas = null;
function openRender() {
  const sel = $('#rSize');
  if (!sel.options.length) {
    sel.innerHTML = RENDER_SIZES.map(([w, h, n], i) => `<option value="${i}">${w} × ${h} · ${n}</option>`).join('') + '<option value="custom">Custom…</option>';
    sel.addEventListener('change', () => { if (sel.value !== 'custom') { const [w, h] = RENDER_SIZES[+sel.value]; $('#rW').value = w; $('#rH').value = h; } });
    $('#rW').value = 2000; $('#rH').value = 2500;
    for (const id of ['rW', 'rH']) $('#' + id).addEventListener('input', () => (sel.value = 'custom'));
  }
  $('#renderDlg').hidden = false;
}
async function doRender() {
  if (renderAbort) { renderAbort.abort(); return; }
  const W = clamp(parseInt($('#rW').value) || 2000, 256, 8192), H = clamp(parseInt($('#rH').value) || 2500, 256, 8192);
  const passes = +$('#rQuality').value, transparent = $('#rTransparent').checked;
  renderAbort = new AbortController();
  $('#rStart').textContent = 'Stop'; $('#rSave').disabled = true;
  const t0 = performance.now();
  try {
    renderCanvas = await withHiResAtlas(() => studio.renderImage({
      width: W, height: H, passes, transparent, keepShadow: $('#rKeepShadow').checked, view: $('#rView').value || null, signal: renderAbort.signal,
      onProgress: (n, t) => { $('#rBar').style.width = (n / t * 100) + '%'; $('#rStatus').textContent = `Pass ${n} of ${t} · ${((performance.now() - t0) / 1000).toFixed(1)} s`; },
    }));
    $('#renderImg').src = renderCanvas.toDataURL('image/png'); $('#renderEmpty').hidden = true;
    $('#rStatus').textContent = renderAbort.signal.aborted ? 'Stopped early — you can still save it.' : `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s. Ready to save.`;
    $('#rSave').disabled = false;
  } catch (err) { console.error(err); $('#rStatus').textContent = 'The render could not finish: ' + err.message; }
  finally { renderAbort = null; $('#rStart').textContent = 'Start render'; }
}
async function saveRender() {
  if (!renderCanvas) return;
  const f = $('#rFormat').value;
  let cv = renderCanvas;
  if (f === 'jpeg') { cv = makeCanvas(renderCanvas.width, renderCanvas.height); const c = cv.getContext('2d'); c.fillStyle = app.doc.scene.bgColor; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(renderCanvas, 0, 0); }
  download(await encode(cv, f), `${fname($('#rView').value || 'render')}.${f === 'jpeg' ? 'jpg' : f}`);
}
async function busy(label, fn) {
  const t = $('#toast'); t.textContent = label; t.classList.add('on'); clearTimeout(t._h);
  try { return await fn((m) => (t.textContent = m)); } catch (e) { console.error(e); toast('Something went wrong: ' + e.message); } finally { t._h = setTimeout(() => t.classList.remove('on'), 1800); }
}
async function exportSheet() {
  await busy('Rendering the mockup sheet…', async (say) => {
    const views = app.garment.tote ? ['front', 'back'] : ['front', 'back', 'side'];
    const shots = [];
    await withHiResAtlas(async () => { for (const v of views) { say(`Rendering ${v}…`); shots.push(await studio.renderImage({ width: 1200, height: 1500, passes: 24, view: v })); } });
    const pad = 60, W = shots.length * 1200 + (shots.length + 1) * pad, H = 1500 + pad * 2 + 90;
    const cv = makeCanvas(W, H), c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    shots.forEach((s, i) => { c.drawImage(s, pad + i * (1200 + pad), pad); });
    c.fillStyle = '#1f2330'; c.font = '700 34px Inter, sans-serif'; c.fillText(app.doc.name, pad, H - 48);
    c.fillStyle = '#6a7080'; c.font = '500 24px Inter, sans-serif'; c.fillText(`${app.garment.name} · ${FABRICS.find(f => f.id === app.doc.fabric.type)?.name || ''} · ${app.doc.fabric.color.toUpperCase()}`, pad, H - 16);
    c.textAlign = 'right'; c.fillText('Design Master', W - pad, H - 16);
    download(await encode(cv), fname('mockup-sheet') + '.png');
  });
}
async function exportViews() {
  await busy('Rendering all views…', async (say) => {
    const zip = new window.JSZip();
    const views = app.garment.tote ? ['front', 'back', 'three'] : ['front', 'back', 'side', 'three'];
    await withHiResAtlas(async () => { for (const v of views) { say(`Rendering ${v}…`); const cv = await studio.renderImage({ width: 1600, height: 2000, passes: 32, view: v }); zip.file(`${fname(v === 'three' ? 'three-quarter' : v)}.png`, await encode(cv)); } });
    say('Zipping…');
    download(await zip.generateAsync({ type: 'blob' }), fname('views') + '.zip');
  });
}
function openColorways() {
  const el = $('#cwSwatches');
  const chosen = new Set([app.doc.fabric.color, '#22252a', '#9ea3a8', '#1d2d4d'].map(c => c.toLowerCase()));
  el.innerHTML = SWATCHES.map(c => `<button style="background:${c}" data-c="${c}" class="${chosen.has(c) ? 'on' : ''}"></button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('button'); if (b) b.classList.toggle('on'); };
  $('#cwStatus').textContent = ''; $('#cwBar').style.width = '0';
  $('#cwDlg').hidden = false;
}
async function doColorways() {
  const cols = $$('#cwSwatches button.on').map(b => b.dataset.c);
  if (!cols.length) return toast('Pick at least one colour.');
  const [W, H] = $('#cwSize').value.split('x').map(Number), passes = +$('#cwQuality').value;
  const zip = new window.JSZip(), orig = app.doc.fabric.color;
  $('#cwStart').disabled = true;
  try {
    for (let i = 0; i < cols.length; i++) {
      $('#cwStatus').textContent = `Rendering ${cols[i].toUpperCase()} (${i + 1} of ${cols.length})…`;
      app.doc.fabric.color = cols[i]; rebuildBase(); studio.updateFabric(app.doc.fabric);
      composeAtlas(app.atlasCanvas, app.baseCanvas, app.baseCanvas._ppc);
      const cv = await withHiResAtlas(() => studio.renderImage({ width: W, height: H, passes, view: 'front', onProgress: (n, t) => ($('#cwBar').style.width = ((i + n / t) / cols.length * 100) + '%') }));
      zip.file(`${fname(cols[i].slice(1))}.png`, await encode(cv));
    }
    $('#cwStatus').textContent = 'Zipping…';
    download(await zip.generateAsync({ type: 'blob' }), fname('colourways') + '.zip');
    $('#cwStatus').textContent = `Done — ${cols.length} colourways.`;
  } finally {
    app.doc.fabric.color = orig; rebuildBase(); studio.updateFabric(app.doc.fabric); $('#cwStart').disabled = false;
  }
}
async function exportPrintFiles() {
  const g = app.garment;
  const withArt = g.pieces.filter(p => app.doc.items.some(i => i.piece === p.id && !i.hidden));
  if (!withArt.length) return toast('Add some artwork first.');
  await busy('Preparing print files…', async (say) => {
    const zip = new window.JSZip(), ppc = 300 / 2.54;
    let spec = `DESIGN MASTER — PRINT SPEC\n${app.doc.name}\nGarment: ${g.name} (${g.cut})\nFabric: ${FABRICS.find(f => f.id === app.doc.fabric.type)?.name}, colour ${app.doc.fabric.color.toUpperCase()}\nAll files: 300 DPI, transparent PNG, 1:1 print size.\n\n`;
    for (const p of withArt) {
      say(`Preparing ${p.label}…`);
      const items = app.doc.items.filter(i => i.piece === p.id && !i.hidden);
      // bounds of the artwork, clipped to the piece
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const it of items) for (const [x, y] of itemCorners(it, app.assets)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(p.w, x1); y1 = Math.min(p.h, y1);
      if (x1 <= x0 || y1 <= y0) continue;
      const k = Math.min(ppc, 12000 / Math.max(x1 - x0, y1 - y0));
      const cv = makeCanvas((x1 - x0) * k, (y1 - y0) * k), c = cv.getContext('2d');
      c.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
      piecePath(c, p); c.clip();
      for (const it of items) drawItem(c, it, app.assets, null, k);
      zip.file(`${fname(slug(p.label))}.png`, await encode(cv));
      spec += `${p.label}\n  print area: ${(x1 - x0).toFixed(1)} × ${(y1 - y0).toFixed(1)} cm (${cv.width} × ${cv.height} px${k < ppc ? `, ${Math.round(k * 2.54)} DPI` : ''})\n  top-left: ${(x0 - p.w / 2).toFixed(1)} cm from the piece centre line, ${y0.toFixed(1)} cm from the top of the piece\n`;
      for (const it of items) spec += `   · ${it.type === 'text' ? '“' + (it.text || '').replace(/\n/g, ' ') + '”' : it.name || it.type}: ${it.w.toFixed(1)} cm wide, centre ${(it.x - p.w / 2).toFixed(1)} cm from centre line, ${it.y.toFixed(1)} cm from top${it.rot ? `, rotated ${Math.round(it.rot)}°` : ''}\n`;
      spec += '\n';
    }
    zip.file('print-spec.txt', spec);
    say('Zipping…');
    download(await zip.generateAsync({ type: 'blob' }), fname('print-files') + '.zip');
  });
}
async function exportPattern() {
  await busy('Exporting the sewing pattern…', async () => {
    const g = app.garment, k = Math.min(150 / 2.54, 12000 / Math.max(g.sheet.w, g.sheet.h));
    const cv = makeCanvas(g.sheet.w * k, g.sheet.h * k), c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    const base = makeCanvas(g.sheet.w * k, g.sheet.h * k), bc = base.getContext('2d');
    bc.setTransform(k, 0, 0, k, 0, 0); drawFabric(bc, g, app.doc.fabric, app.overlays, { fillSheet: true });
    for (const p of g.pieces) {
      c.save(); c.translate(p.sx, p.sy); piecePath(c, p); c.save(); c.clip(); c.drawImage(base, -p.sx, -p.sy, g.sheet.w, g.sheet.h);
      for (const it of app.doc.items) if (it.piece === p.id) drawItem(c, it, app.assets, null, k);
      c.restore(); c.lineWidth = 0.1; c.strokeStyle = '#555'; c.stroke();
      c.fillStyle = '#333'; c.font = '600 1.6px Inter, sans-serif'; c.textAlign = 'center'; c.fillText(p.label, p.w / 2, -0.8);
      c.restore();
    }
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#666'; c.font = `${Math.round(k * 0.9)}px Inter, sans-serif`; c.fillText(`${app.doc.name} · ${g.name} · 150 DPI · 1 cm = ${k.toFixed(1)} px`, k * 2, cv.height - k * 1.5);
    download(await encode(cv), fname('pattern') + '.png');
  });
}
async function snapshot3D() {
  studio.renderer.render(studio.scene, studio.camera);
  const url = studio.renderer.domElement.toDataURL('image/png');
  download(url, fname('snapshot') + '.png');
}

/* ====================================================================== */
/* garment picker */
function openGarments() {
  const groups = [...new Set(GARMENT_LIST.map(g => g.group))];
  $('#garmentGrid').innerHTML = groups.map(gr => `<h5>${gr}</h5>` + GARMENT_LIST.filter(g => g.group === gr).map(g => {
    const built = g.model ? g : buildGarment(g.id);
    return `<button class="gcard ${g.id === app.doc.garment ? 'on' : ''}" data-g="${g.id}"><span class="gimg">${garmentThumbSVG(built, '#ffffff')}</span><b>${g.name}</b><small>${g.cut}</small></button>`;
  }).join('')).join('');
  $('#garmentDlg').hidden = false;
}

/* ====================================================================== */
/* header + keyboard */
function bindChrome() {
  $('#garmentBtn').onclick = openGarments;
  $('#garmentGrid').onclick = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; $('#garmentDlg').hidden = true; if (b.dataset.g !== app.doc.garment) { applyGarment(b.dataset.g, { reframe: true }); commit(); } };
  $$('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) { if (o.id === 'renderDlg' && renderAbort) return; o.hidden = true; } }));
  $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
  $('#saveBtn').onclick = saveProject; $('#openBtn').onclick = () => $('#fileProject').click();
  $('#projName').addEventListener('change', e => { app.doc.name = e.target.value.trim() || 'Untitled design'; commit(); });
  $('#modeSeg').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; setMode(b.dataset.mode); };
  $('#viewSeg').onclick = (e) => { const b = e.target.closest('[data-view]'); if (!b) return; $$('#viewSeg button').forEach(x => x.classList.toggle('on', x === b)); if (app.doc.scene.spin) { app.doc.scene.spin = false; studio.updateScene(app.doc.scene); $('#spinBtn').classList.remove('on'); } studio.setView(b.dataset.view); };
  $('#spinBtn').onclick = () => { app.doc.scene.spin = !app.doc.scene.spin; studio.updateScene(app.doc.scene); studio.applyPixelRatio(); $('#spinBtn').classList.toggle('on', app.doc.scene.spin); };
  $('#resetViewBtn').onclick = () => { studio.setView('front'); studio.frame(); $$('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.view === 'front')); };
  const menu = (btn, m) => { $(btn).onclick = (e) => { e.stopPropagation(); const open = $(m).hidden; $$('.menu').forEach(x => (x.hidden = true)); $(m).hidden = !open; }; };
  menu('#exportBtn', '#exportMenu'); menu('#qualityBtn', '#qualityMenu');
  document.addEventListener('click', () => $$('.menu').forEach(x => (x.hidden = true)));
  $('#qualityMenu').onclick = (e) => { const b = e.target.closest('[data-q]'); if (!b) return; studio.quality = b.dataset.q; studio.applyPixelRatio(); $$('#qualityMenu button').forEach(x => x.classList.toggle('on', x === b)); try { localStorage.setItem('dm.quality', b.dataset.q); } catch { } };
  const q = (() => { try { return localStorage.getItem('dm.quality'); } catch { return null; } })() || 'adaptive';
  studio.quality = q; $$('#qualityMenu button').forEach(x => x.classList.toggle('on', x.dataset.q === q));
  $('#exportMenu').onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    ({ render: openRender, sheet: exportSheet, views: exportViews, colorways: openColorways, print: exportPrintFiles, pattern: exportPattern, snapshot: snapshot3D })[b.dataset.act]?.();
  };
  $('#renderBtn').onclick = openRender;
  $('#rStart').onclick = doRender; $('#rSave').onclick = saveRender;
  $('#cwStart').onclick = doColorways;
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('dm.theme', document.documentElement.dataset.theme); } catch { }
    editor.redraw();
  };
  // pattern toolbar
  $('#patternPane').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) { editor.tool = b.dataset.tool; $$('[data-tool]').forEach(x => x.classList.toggle('on', x === b)); editor.cursor(); }
    if (b.dataset.add) onAdd(b.dataset.add);
  });
  $('#zoomIn').onclick = () => editor.zoom(1.25); $('#zoomOut').onclick = () => editor.zoom(0.8); $('#zoomFit').onclick = () => editor.fit();
  window.addEventListener('keydown', e => {
    if (isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); saveProject(); return; }
    if (mod && k === 'o') { e.preventDefault(); $('#fileProject').click(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod) return;
    const it = app.selected();
    if ((k === 'delete' || k === 'backspace') && it) { e.preventDefault(); deleteSel(); return; }
    if (k === 'escape') { app.select(null); $$('.overlay').forEach(o => { if (o.id !== 'renderDlg' || !renderAbort) o.hidden = true; }); return; }
    if (it && k.startsWith('arrow') && !it.locked) {
      e.preventDefault(); const st = e.shiftKey ? 1 : 0.1;
      if (k === 'arrowleft') it.x -= st; if (k === 'arrowright') it.x += st; if (k === 'arrowup') it.y -= st; if (k === 'arrowdown') it.y += st;
      app.itemsChanged(true); nudgeCommit(); return;
    }
    if (k === 'v') $('[data-tool="select"]').click();
    if (k === 'h') $('[data-tool="hand"]').click();
    if (k === 't') addText();
    if (k === 'i') onAdd('image');
    if (k === 's') addShape('star');
    if (k === 'f') editor.fit();
    if (k === '1') setMode('pattern'); if (k === '2') setMode('split'); if (k === '3') setMode('3d');
  });
}
const nudgeCommit = debounce(() => { app.itemsChanged(false); commit(); }, 400);
function setMode(m) {
  $('#work').className = 'work mode-' + m;
  $$('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.mode === m));
  setTimeout(() => { studio.resize(); studio.frame(); editor.resize(); editor.fit(); }, 30);
}

/* ====================================================================== */
async function boot() {
  bindChrome(); bindInspector(); bind3DDrag(); bindFiles();
  let saved = null;
  try { saved = await store.load('autosave'); } catch { }
  if (saved?.doc) loadDoc(saved.doc, saved.assets || {});
  else { applyGarment(app.doc.garment, { reframe: true }); studio.updateScene(app.doc.scene); commit(); }
  if (window.innerWidth < 820) setMode('3d');
  // fonts arriving late → re-rasterise text
  document.fonts?.ready.then(() => { app.itemsChanged(false); });
  document.fonts?.addEventListener?.('loadingdone', () => app.itemsChanged(false));
  updateUndo();
}
boot();
