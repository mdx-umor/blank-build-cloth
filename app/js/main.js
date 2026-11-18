// Design Master — application controller.
import { buildGarment, GARMENT_LIST, garmentThumbSVG, isModelGarment, modelLoaded, loadModelGarment, LABEL_SHAPES } from './garments.js';
import { Studio, GOBOS, goboCanvas } from './scene.js';
import { PatternEditor, CropSession } from './editor.js';
import { FABRICS, WASHES, SWATCHES, buildOverlays } from './fabric.js';
import { FONTS, SHAPES, isLine, imageSource, itemRaster, drawFabric, drawArtwork, prepareOverlayTint, itemHeight, trimTransparent, removeBackground, itemCorners, hitItem, imageAspect, gradientStops, gradientCss, piecePath } from './atlas.js';
import { uid, clamp, download, readFileAsDataURL, readFileAsText, loadImage, makeCanvas, debounce, slug, luminance, pointInPoly } from './util.js';
import * as store from './store.js';
import { readPicture, sniff, ImportError } from './importer.js';
import { initHalftone, openHalftone, setShirtColour } from './halftone.js';
const usedAssets = (doc) => new Set(doc.items.flatMap(i => [i.asset, i.vec?.asset]).filter(Boolean));
import { initExports, runExport, openRender, snapshot3D, isBusyRendering } from './exports.js';
import { initPanels, saveToFiles, openFiles, toggleModels, startTour } from './panels.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FACTORY_SCENE = { backdrop: true, bgColor: '#ebeae8', bgBright: 1, bgContrast: 1, gobo: 'window', goboInvert: false, lightSide: -32, lightHeight: 38, lightPower: 1, softness: 0.5, hdri: true, hdriPower: 1, hdriRot: 0, envPower: 0.55, ambient: 1, fill: 1, shadows: true, hanger: true, hangerColor: '#f4f4f2', spin: false };
const FACTORY_FABRIC = { color: '#ffffff', mode: 'solid', color2: '#5b5bd6', stops: null, angle: 90, type: 'jersey', knit: 1, relief: 0.6, wash: 'none', washAmt: 0.8, washSeed: 0, heather: false, wrinklesOn: true, wrinkles: 0.8, ao: true, bright: 1, contrast: 1, pieceColors: {} };
const DEFAULT_DOC = () => ({
  v: 2, name: 'Untitled design', garment: 'tee', items: [],
  fabric: { ...FACTORY_FABRIC, ...loadLook().fabric },
  details: { label: true, labelShape: 'woven', labelColor: '#f4f4f2', labelAsFabric: false, cord: '#ffffff', buttons: '#f2f0ea' },
  scene: { ...FACTORY_SCENE, ...loadLook().scene },
  view: { marks: true, unit: 'cm', side: 'out' },
});
function loadLook() { try { const l = JSON.parse(localStorage.getItem('dm.look') || '{}'); return l.scene || l.fabric ? l : { scene: l }; } catch { return {}; } }

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
const BG_SWATCHES = ['#f4f6f8', '#ffffff', '#efe9df', '#e3dcd0', '#dfe5dc', '#dde5ee', '#efe1e1', '#9a9a9a', '#3a3c40', '#e07a2e', '#4a3a6b', '#1c1d20', '#efe6d2', '#8c1d2a', '#1f4d36', '#c9a24b', '#a9c2ab', '#ebeae8'];
const HANGER_SWATCHES = ['#f4f4f2', '#2a2826', '#b58a5c', '#7a5236', '#9aa0a6', '#c8a24a'];
const LABEL_SWATCHES = ['#f4f4f2', '#efe6d2', '#161616'];

/* ====================================================================== */
const app = {
  doc: DEFAULT_DOC(), assets: {}, garment: null, selIds: [], presetIdx: 0, fileId: null,
  baseCanvas: null, atlasCanvas: makeCanvas(4, 4), insideCanvas: makeCanvas(4, 4), overlays: null,
  history: [], future: [], $,
  startCrop: (it) => startCrop(it), endCrop: (keep) => endCrop(keep), runExport: (a) => runExport(a),
  get selId() { return this.selIds[this.selIds.length - 1] || null; },
  selected() { return this.doc.items.find(i => i.id === this.selId) || null; },
  selectedItems() { return this.selIds.map(id => this.doc.items.find(i => i.id === id)).filter(Boolean); },
  select(id) { const ids = id ? [id] : []; if (ids.join() === this.selIds.join()) return; if (editor.crop) endCrop(true); this.selIds = ids; editor.redraw(); renderDesign(); },
  toggleSelect(id) { this.selIds = this.selIds.includes(id) ? this.selIds.filter(x => x !== id) : [...this.selIds, id]; editor.redraw(); renderDesign(); },
  setSelection(ids, live) { if (editor.crop && !live) endCrop(true); this.selIds = ids; editor.redraw(); if (!live) renderDesign(); },
  itemsChanged(live) { scheduleAtlas(); editor.redraw(); if (live) syncSelectedFields(); else { renderLayers(); syncSelectedFields(); } },
  commit, assetReady() { scheduleAtlas(); editor.redraw(); renderLayers(); },
  focusText() { const t = $('#tabDesign textarea'); if (t) { switchTab('design'); t.focus(); t.select(); } },
  unit() { return this.doc.view.unit || 'cm'; },
  fmtLen(cm) { const u = this.unit(); const v = u === 'in' ? cm / 2.54 : u === 'mm' ? cm * 10 : cm; return u === 'mm' ? v.toFixed(0) : v.toFixed(u === 'in' ? 2 : 1); },
  toCm(v) { const u = this.unit(); return u === 'in' ? v * 2.54 : u === 'mm' ? v / 10 : v; },
  duplicateItems(items, off = 1.5) {
    const copies = items.map(it => { const c = JSON.parse(JSON.stringify(it)); c.id = uid('it'); c.x += off; c.y += off; c.name = it.name; return c; });
    for (const c of copies) this.doc.items.push(c);
    this.selIds = copies.map(c => c.id);
    return copies;
  },
  addShapeAt(shape, piece, x, y, w, h, rot) { addItem(makeShape(shape, { w, h, rot }), { piece, x, y, keepSize: true, face: editor.face() }); },
  setTool(t) { setTool(t); },
  toast: (m) => toast(m),
  labelColour() { return this.doc.details.labelAsFabric ? this.doc.fabric.color : this.doc.details.labelColor; },
  onZoom() { const z = $('#zoomPct'); if (z) z.textContent = editor.zoomPct() + '%'; },
};
window.DM = app; // handy for debugging from the console

const studio = new Studio($('#gl'));
const editor = new PatternEditor($('#pat'), app);
app.studio = studio; app.editor = editor;

/* ---------- garment / fabric pipeline ---------- */
function geoKey() { const d = app.doc; return [d.garment, d.fabric.wrinklesOn === false ? 0 : d.fabric.wrinkles, d.details.label, d.details.labelShape, d.scene.hanger].join('|'); }
let lastGeoKey = '';
async function applyGarment(id, { reframe = false } = {}) {
  if (editor?.crop) endCrop(true);
  app.doc.garment = id;
  if (isModelGarment(id) && !modelLoaded(id)) {
    toast('Loading the garment…', 8000);
    try { await loadModelGarment(id); } catch (e) { console.error(e); toast('Could not load the garment.'); return; }
    if (app.doc.garment !== id) return;
  }
  app.garment = buildGarment(id, { labelShape: app.doc.details.labelShape });
  // keep artwork on matching pieces; anything else lands on the front
  for (const it of app.doc.items) {
    let p = app.garment.pieces.find(p => p.id === it.piece);
    if (!p) { p = app.garment.pieces.find(p => p.id === 'front') || app.garment.pieces[0]; it.piece = p.id; it.x = p.w / 2; it.y = p.h * 0.35; it.face = 'out'; }
    it.x = clamp(it.x, 0, p.w); it.y = clamp(it.y, 0, p.h);
  }
  // garments with built-in contrast parts (baseball tee) set them; leaving such a garment removes them again
  const pc = app.doc.fabric.pieceColors || {};
  if (pc._auto && pc._auto !== id) { const c = pc._autoColor; for (const k of ['sleeveL', 'sleeveR', 'trim', 'neckF', 'neckB']) if (pc[k] === c) delete pc[k]; delete pc._auto; delete pc._autoColor; }
  if (app.garment.contrast && pc._auto !== id && !pc.sleeveL) Object.assign(pc, { sleeveL: app.garment.contrast, sleeveR: app.garment.contrast, trim: app.garment.contrast, neckF: app.garment.contrast, neckB: app.garment.contrast, _auto: id, _autoColor: app.garment.contrast });
  app.doc.fabric.pieceColors = pc;
  app.selIds = app.selIds.filter(sid => app.doc.items.some(i => i.id === sid));
  rebuildOverlays();
  rebuildBase();
  rebuildGeometry(reframe);
  studio.updateFabric(app.doc.fabric);
  editor._fitted = false; editor.fit(); editor._fitted = true;
  for (const [n, c] of [['#garmentName', '#garmentCut'], ['#garmentName2', '#garmentCut2']]) { $(n).textContent = app.garment.name; $(c).textContent = app.garment.cut; }
  $('#garmentThumb').innerHTML = garmentThumbSVG(app.garment, '#fff');
  $('#pieceCount').textContent = `${editor.visiblePieces().length} pieces`;
  renderAll(); syncChrome();
}
function rebuildGeometry(reframe = false) {
  const d = app.doc;
  const r = studio.setGarment(app.garment, { wrinkles: (d.fabric.wrinklesOn === false ? 0 : d.fabric.wrinkles) * 1.6, label: d.details.label, hanger: d.scene.hanger, res: 100, reframe, seed: 3 });
  Promise.resolve(r).then(() => scheduleAtlas()); // wrapped prints need the new 3D surface
  studio.mats.cord.color.set(d.details.cord || '#ffffff'); studio.mats.button.color.set(d.details.buttons || '#f2f0ea');
  lastGeoKey = geoKey();
}
const rebuildGeometrySoon = debounce(() => {
  if (geoKey() === lastGeoKey) return;
  const labelChanged = lastGeoKey.split('|')[3] !== app.doc.details.labelShape;
  if (labelChanged) applyGarment(app.doc.garment); else rebuildGeometry(false);
}, 120);
function rebuildOverlays() { app.overlays = buildOverlays(app.garment, app.doc.fabric); prepareOverlayTint(app.overlays, app.doc.fabric.color2); }
function atlasPpc(hi = false) {
  const max = Math.max(app.garment.sheet.w, app.garment.sheet.h);
  const tex = Math.min(studio.renderer.capabilities.maxTextureSize, hi ? 8192 : 3072);
  return Math.min(hi ? 60 : 14, tex / max);
}
function rebuildBase(ppc = atlasPpc()) {
  setShirtColour(app.doc.fabric.color);
  const g = app.garment;
  const cv = app.baseCanvas && app.baseCanvas._ppc === ppc ? app.baseCanvas : makeCanvas(g.sheet.w * ppc, g.sheet.h * ppc);
  cv.width = Math.round(g.sheet.w * ppc); cv.height = Math.round(g.sheet.h * ppc); cv._ppc = ppc;
  const c = cv.getContext('2d');
  c.setTransform(ppc, 0, 0, ppc, 0, 0);
  drawFabric(c, g, app.doc.fabric, app.overlays, { fillSheet: true });
  app.baseCanvas = cv;
  scheduleAtlas(); editor.redraw();
}
function composeAtlas(target, base, ppc, wrap = app.wrapCanvas) {
  target.width = base.width; target.height = base.height;
  const c = target.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(base, 0, 0);
  c.setTransform(ppc, 0, 0, ppc, 0, 0);
  const f = app.doc.fabric;
  if (f.washPrints && app.overlays && f.wash !== 'none') {
    // "Wash the prints too": the prints go on their own layer, the wash is laid over just them
    const art = makeCanvas(base.width, base.height), a = art.getContext('2d');
    a.setTransform(ppc, 0, 0, ppc, 0, 0);
    drawArtwork(a, app.garment, app.doc.items, app.assets, () => app.assetReady(), ppc, 'out', !!wrap);
    if (wrap) a.drawImage(wrap, 0, 0, app.garment.sheet.w, app.garment.sheet.h);
    a.globalCompositeOperation = 'source-atop';
    drawFabric(a, app.garment, f, app.overlays, { washOnly: true });
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(art, 0, 0);
    return target;
  }
  drawArtwork(c, app.garment, app.doc.items, app.assets, () => app.assetReady(), ppc, 'out', !!wrap);
  if (wrap) c.drawImage(wrap, 0, 0, app.garment.sheet.w, app.garment.sheet.h);
  return target;
}
// wrap over seams: project those prints onto the 3D garment and bake them into the pattern sheet
function bakeWrapLayer(W, H, only = null) {
  const list = only || app.doc.items.filter(i => i.wrap && !i.hidden && (i.face || 'out') === 'out');
  if (!list.length || !studio.panelMeshes?.length || studio.garment !== app.garment) return null;
  const prints = [];
  for (const it of list) {
    const p = app.garment.pieces.find(q => q.id === it.piece); if (!p) continue;
    const f = studio.wrapFrame(p.sx + it.x, p.sy + it.y, it.rot || 0, it.flip); if (!f) continue;
    prints.push({ raster: itemRaster(it, app.assets, 40, () => app.assetReady()), f, w: it.w, h: itemHeight(it, app.assets), opacity: it.opacity ?? 1 });
  }
  return prints.length ? studio.bakeWrap(prints, W, H) : null;
}
// inside of the garment: same fabric, inside prints (mirrored), and the woven label piece
function composeInside(target, base, ppc) {
  target.width = base.width; target.height = base.height;
  const c = target.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(base, 0, 0);
  c.setTransform(ppc, 0, 0, ppc, 0, 0);
  const lp = app.garment.pieces.find(p => p.id === 'label');
  if (lp) { c.fillStyle = app.labelColour(); c.fillRect(lp.sx - 0.3, lp.sy - 0.3, lp.w + 0.6, lp.h + 0.6); }
  drawArtwork(c, app.garment, app.doc.items, app.assets, () => app.assetReady(), ppc, 'in');
  return target;
}
let atlasRaf = 0;
function scheduleAtlas() {
  if (atlasRaf) return;
  atlasRaf = requestAnimationFrame(() => {
    atlasRaf = 0;
    const ppc = app.baseCanvas._ppc;
    try { app.wrapCanvas = bakeWrapLayer(app.baseCanvas.width, app.baseCanvas.height); } catch (e) { console.warn('wrap', e); app.wrapCanvas = null; }
    composeAtlas(app.atlasCanvas, app.baseCanvas, ppc); studio.setAtlas(app.atlasCanvas); editor.redraw();
    composeInside(app.insideCanvas, app.baseCanvas, ppc); studio.setInside(app.insideCanvas);
  });
}
// temporarily switch the 3D textures to high resolution for final renders
async function withHiResAtlas(fn) {
  const ppc = atlasPpc(true), g = app.garment;
  const base = makeCanvas(g.sheet.w * ppc, g.sheet.h * ppc), c = base.getContext('2d');
  c.setTransform(ppc, 0, 0, ppc, 0, 0);
  drawFabric(c, g, app.doc.fabric, app.overlays, { fillSheet: true });
  const k = Math.min(1, 4096 / Math.max(base.width, base.height));
  const wrap = app.wrapCanvas ? bakeWrapLayer(Math.round(base.width * k), Math.round(base.height * k)) : null;
  studio.setAtlas(composeAtlas(makeCanvas(4, 4), base, ppc, wrap));
  studio.setInside(composeInside(makeCanvas(4, 4), base, ppc));
  try { return await fn(); } finally { studio.setAtlas(app.atlasCanvas); studio.setInside(app.insideCanvas); scheduleAtlas(); }
}

/* ---------- history ---------- */
const snapshot = () => JSON.stringify(app.doc);
function commit() {
  const s = snapshot();
  if (app.history[app.history.length - 1] === s) return;
  app.history.push(s); if (app.history.length > 150) app.history.shift();
  app.future = [];
  updateUndo(); autosave();
}
function restore(s) {
  if (editor.crop) { editor.crop = null; $('#cropBar').hidden = true; }
  const prev = app.doc;
  app.doc = JSON.parse(s);
  if (prev.garment !== app.doc.garment || prev.details.labelShape !== app.doc.details.labelShape) applyGarment(app.doc.garment);
  else {
    rebuildOverlays(); rebuildBase(); studio.updateFabric(app.doc.fabric); studio.updateScene(app.doc.scene);
    if (geoKey() !== lastGeoKey) rebuildGeometry(false);
    renderAll(); syncChrome();
  }
  app.selIds = app.selIds.filter(id => app.doc.items.some(i => i.id === id));
  editor.redraw(); scheduleAtlas(); autosave();
}
function undo() { if (app.history.length < 2) return; app.future.push(app.history.pop()); restore(app.history[app.history.length - 1]); updateUndo(); }
function redo() { const s = app.future.pop(); if (!s) return; app.history.push(s); restore(s); updateUndo(); }
function updateUndo() { $('#undoBtn').disabled = app.history.length < 2; $('#redoBtn').disabled = !app.future.length; }
const autosave = debounce(() => {
  const used = usedAssets(app.doc);
  for (const k of Object.keys(app.assets)) if (!used.has(k) && !app.history.some(h => h.includes(k))) delete app.assets[k];
  store.save('autosave', { doc: app.doc, assets: app.assets, fileId: app.fileId }).catch(() => {});
}, 600);

/* ---------- items ---------- */
function currentPreset() { return app.garment.presets[app.presetIdx] || app.garment.presets[0]; }
function placeAt(it, preset, keepSize = false) {
  const p = app.garment.pieces.find(p => p.id === preset.piece) || app.garment.pieces[0];
  it.piece = p.id; it.x = p.w * preset.fx; it.y = p.h * preset.fy; it.face = preset.face || 'out';
  if (!keepSize) {
    it.w = Math.min(preset.w, p.w * 0.9);
    if (it.type === 'shape' && !isLine(it.shape)) it.h = it.w;
    const h = itemHeight(it, app.assets);
    if (h > p.h * 0.85) it.w *= (p.h * 0.85) / h;
    if (it.type === 'shape' && !isLine(it.shape)) it.h = Math.min(it.h, it.w);
  }
}
function addItem(it, at) {
  it.id = it.id || uid('it');
  Object.assign(it, { rot: 0, opacity: 1, flip: false, hidden: false, locked: false, blend: 'normal', distress: 0, face: 'out', ...it });
  if (at) {
    it.piece = at.piece; it.x = at.x; it.y = at.y; it.face = at.face || editor.face();
    if (!at.keepSize) { it.w = Math.min(it.w || 20, (app.garment.pieces.find(p => p.id === at.piece)?.w || 40) * 0.7); if (it.type === 'shape' && !isLine(it.shape)) it.h = it.w; }
  } else {
    const pre = currentPreset();
    placeAt(it, (pre.face || 'out') === editor.face() ? pre : app.garment.presets.find(p => (p.face || 'out') === editor.face()) || pre);
  }
  app.doc.items.push(it);
  app.selIds = [it.id];
  app.itemsChanged(false); renderDesign(); commit();
  return it;
}
async function addImageFile(file, at) {
  const kind = await sniff(file);
  if (kind === 'project') return openProjectFile(file);
  let pic;
  toast('Preparing image…', 60000);
  try { pic = await readPicture(file); }
  catch (e) { toast(e instanceof ImportError ? e.message : 'This picture couldn’t be opened.', 6000); return; }
  toast(pic.note || 'Tip: paste a picture with Ctrl+V.', pic.note ? 5000 : 2600);
  addItem(pictureItem(pic, { w: 26 }), at);
}
// a picture item from a read file (keeps the vector original alongside the picture that is shown)
function pictureItem(pic, extra = {}) {
  const asset = uid('a'); app.assets[asset] = pic.src;
  const it = { type: 'image', asset, aspect: pic.w / pic.h, px: [pic.w, pic.h], name: pic.name, ...extra };
  if (pic.vec) { const va = uid('v'); app.assets[va] = pic.vec.data; it.vec = { kind: pic.vec.kind, asset: va, size: pic.vec.size, page: pic.vec.page }; }
  return it;
}
async function replaceImage(it, file) {
  let pic;
  try { pic = await readPicture(file); } catch (e) { toast(e instanceof ImportError ? e.message : 'This picture couldn’t be opened.', 6000); return; }
  const n = pictureItem(pic);
  Object.assign(it, { asset: n.asset, px: n.px, name: n.name }); delete it.crop; delete it.vec;
  if (n.vec) it.vec = n.vec;
  it.aspect = imageAspect(it);
  app.itemsChanged(false); renderDesign(); commit();
}
function addText(at) {
  const dark = luminance(app.doc.fabric.color) > 0.5;
  addItem({ type: 'text', text: 'Text', font: 'Inter', weight: 700, italic: false, caps: false, color: dark ? '#1f2330' : '#ffffff', align: 'center', lineH: 1.12, letter: 0, curve: 0, stroke: 0, strokeColor: dark ? '#ffffff' : '#1f2330', name: 'Text', w: 26 }, at);
  setTimeout(() => app.focusText(), 30);
}
function makeShape(shape, extra = {}) {
  const line = isLine(shape);
  return { type: 'shape', shape, color: luminance(app.doc.fabric.color) > 0.5 ? '#1f2330' : '#ffffff', outline: false, thick: line ? 4 : 3, dashed: shape === 'dashed', name: SHAPES.find(s => s.id === shape)?.name || 'Shape', w: 10, h: line ? 0.4 : 10, ...extra };
}
function addShape(shape = 'rect') { addItem(makeShape(shape)); }
function deleteSel() { const ids = new Set(app.selIds); if (!ids.size) return; app.doc.items = app.doc.items.filter(i => !ids.has(i.id)); app.selIds = []; app.itemsChanged(false); renderDesign(); commit(); }
function duplicateSel() { const items = app.selectedItems(); if (!items.length) return; app.duplicateItems(items); app.itemsChanged(false); renderDesign(); commit(); }
function moveZ(dir) { const it = app.selected(); if (!it) return; const a = app.doc.items, i = a.indexOf(it), j = clamp(i + dir, 0, a.length - 1); a.splice(i, 1); a.splice(j, 0, it); app.itemsChanged(false); commit(); }
function alignOne(it, how) {
  const p = app.garment.pieces.find(p => p.id === it.piece);
  const cs = itemCorners(it, app.assets);
  const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
  const hw = (Math.max(...xs) - Math.min(...xs)) / 2, hh = (Math.max(...ys) - Math.min(...ys)) / 2;
  const poly = (it.face || 'out') === 'in' && !p.noMirror ? p.poly.map(([x, y]) => [p.w - x, y]) : p.poly;
  // pieces aren't rectangles: find the inside span at the item's row/column
  const span = (axis, at) => { const pts = []; for (let t = 0; t <= 1; t += 0.005) { const q = axis === 'x' ? [t * p.w, at] : [at, t * p.h]; if (pointInPoly(q[0], q[1], poly)) pts.push(axis === 'x' ? q[0] : q[1]); } return pts.length ? [Math.min(...pts), Math.max(...pts)] : [0, axis === 'x' ? p.w : p.h]; };
  const m = 1.5;
  if (how === 'l') it.x = span('x', it.y)[0] + hw + m;
  if (how === 'c') { const s = span('x', it.y); it.x = (s[0] + s[1]) / 2; }
  if (how === 'r') it.x = span('x', it.y)[1] - hw - m;
  if (how === 't') it.y = span('y', it.x)[0] + hh + m;
  if (how === 'm') { const s = span('y', it.x); it.y = (s[0] + s[1]) / 2; }
  if (how === 'b') it.y = span('y', it.x)[1] - hh - m;
}
function alignSel(how) { for (const it of app.selectedItems()) alignOne(it, how); app.itemsChanged(false); commit(); }
function newDesign() {
  app.doc.items = []; app.selIds = []; app.doc.name = 'Untitled design'; app.fileId = null;
  $('#projName').value = app.doc.name;
  app.itemsChanged(false); renderDesign(); commit();
  toast('New design — undo (Ctrl+Z) brings the old one back.');
}
/* crop in place on the pattern (the picture file stays as it is) */
function startCrop(it) {
  if (!it || it.type !== 'image') return;
  if (editor.crop) endCrop(true);
  if ($('#work').classList.contains('mode-3d')) setMode('split');
  if ((it.face || 'out') !== editor.face()) setSide(it.face || 'out');
  app.selIds = [it.id];
  editor.crop = new CropSession(editor, it);
  $('#cropBar').hidden = false;
  editor.redraw(); renderDesign();
}
function endCrop(keep) {
  const s = editor.crop; if (!s) return;
  if (!keep) s.cancel();
  editor.crop = null; $('#cropBar').hidden = true;
  app.itemsChanged(false); editor.cursor(); renderDesign();
  if (keep) commit();
}
function cropAction(act) {
  const s = editor.crop; if (!s) return;
  if (act === 'trim') { if (!s.trim()) toast('No empty edges to trim.'); }
  if (act === 'reset') s.reset();
  if (act === 'cancel') endCrop(false);
  if (act === 'done') endCrop(true);
}
function setTool(t) {
  editor.tool = t;
  $$('[data-tool]').forEach(x => x.classList.toggle('on', x.dataset.tool === t));
  $('#shapesBtn').classList.toggle('on', t.startsWith('shape:'));
  editor.cursor();
  if (t.startsWith('shape:')) toast('Press on the pattern and drag to draw the shape. Shift keeps it even. Esc cancels.', 3500);
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
const SHAPE_ICON = {
  rect: '<rect x="3" y="6" width="14" height="9" rx="1"/>', square: '<rect x="4.5" y="4.5" width="11" height="11" rx="1"/>', circle: '<circle cx="10" cy="10" r="6.5"/>',
  triangle: '<path d="M10 3.5l7 12.5H3z"/>', star: '<path d="M10 2.8l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L10 13.6l-4.4 2.5 1.1-4.9L2.9 7.9l5-.5z"/>', diamond: '<path d="M10 2.5L17.5 10 10 17.5 2.5 10z"/>',
  line: '<path d="M3 16L17 4"/>', dashed: '<path d="M3 16L17 4" stroke-dasharray="2.5 2"/>', round: '<rect x="3" y="5" width="14" height="10" rx="3.5"/>',
  heart: '<path d="M10 16s-6-3.6-6-8a3.3 3.3 0 016-1.9A3.3 3.3 0 0116 8c0 4.4-6 8-6 8z"/>', badge: '<circle cx="10" cy="10" r="6.5" stroke-dasharray="2 1"/>',
};
const shapeSvg = (id) => `<svg viewBox="0 0 20 20"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">${SHAPE_ICON[id] || SHAPE_ICON.rect}</g></svg>`;
const alignIcon = (k) => {
  const P = { l: 'M4 3v14M7 7h9M7 13h6', c: 'M10 3v14M5 7h10M7 13h6', r: 'M16 3v14M4 7h9M7 13h6', t: 'M3 4h14M7 7v9M13 7v6', m: 'M3 10h14M7 5v10M13 7v6', b: 'M3 16h14M7 4v9M13 7v6' }[k];
  return `<svg viewBox="0 0 20 20"><path d="${P}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
};
const ALIGN_NAMES = { l: 'Align to the piece’s left edge', c: 'Centre on the piece', r: 'Align to the piece’s right edge', t: 'Align to the piece’s top', m: 'Middle of the piece', b: 'Align to the piece’s bottom' };
function get(path) { const [scope, ...rest] = path.split('.'); let o = scope === 'item' ? app.selected() : app.doc[scope]; for (const k of rest) o = o?.[k]; return o; }
function set(path, v) {
  const [scope, ...rest] = path.split('.'); let o = scope === 'item' ? app.selected() : app.doc[scope];
  if (!o) return; for (const k of rest.slice(0, -1)) o = o[k] ??= {}; o[rest[rest.length - 1]] = v;
}
const fmt = (v, step) => { const d = String(step).split('.')[1]?.length || 0; return Number(v).toFixed(d); };
function slider(k, label, min, max, step, opts = {}) {
  const v = get(k) ?? opts.def ?? min;
  const shown = opts.pct ? Math.round(v * 100) + '%' : opts.x ? '×' + fmt(v, step) : fmt(v, step) + (opts.suf || '');
  return `<div class="row"><label>${label}</label><div class="ctl"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}" ${opts.pct ? 'data-pct' : ''} ${opts.x ? 'data-x' : ''} data-suf="${opts.suf || ''}" aria-label="${label}"><span class="val" data-v="${k}">${shown}</span></div></div>`;
}
const eyeBtn = (k) => 'EyeDropper' in window ? `<button class="ib" data-eye="${k}" title="Eyedropper: pick a colour from the screen">${ICON.drop}</button>` : '';
function colorRow(k, label) { const v = get(k) || '#000000'; return `<div class="row"><label>${label}</label><div class="ctl color"><input type="color" data-k="${k}" value="${v}" aria-label="${label}"><input type="text" data-k="${k}" data-hex value="${v}" maxlength="7" aria-label="${label}">${eyeBtn(k)}</div></div>`; }
function swatchRow(k, list, title = 'Colour') {
  const v = (get(k) || '').toLowerCase();
  return `<div class="swatches">${list.map(c => `<button style="background:${c}" data-setk="${k}" data-val="${c}" class="${c.toLowerCase() === v ? 'on' : ''}" title="${title} ${c}" aria-label="${title} ${c}"></button>`).join('')}</div>
    <div class="row"><label>Custom</label><div class="ctl color"><input type="color" data-k="${k}" value="${v || '#000000'}" aria-label="Custom colour"><input type="text" data-k="${k}" data-hex value="${v}" maxlength="7" aria-label="Custom colour">${eyeBtn(k)}</div></div>`;
}
function toggleRow(k, label, def = false) { const v = get(k) ?? def; return `<div class="trow"><span>${label}</span><label class="toggle"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''} aria-label="${label}"><span></span></label></div>`; }
function selectRow(k, label, options) { const v = get(k); return `<div class="row"><label>${label}</label><div class="ctl"><select data-k="${k}" aria-label="${label}">${options.map(([val, name]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></div></div>`; }
function segRow(k, label, options) { const v = get(k); return `<div class="row"><label>${label}</label><div class="ctl"><div class="seg small" style="flex:1">${options.map(([val, name]) => `<button data-seg="${k}" data-val="${esc(val)}" class="${String(v) === String(val) ? 'on' : ''}" style="flex:1">${name}</button>`).join('')}</div></div></div>`; }
const sec = (title, body, act = '') => `<div class="sec"><h4>${title}${act}</h4>${body}</div>`;

/* ---------- Design tab ---------- */
function renderDesign() {
  const it = app.selected(), items = app.selectedItems(), g = app.garment;
  const sub = items.length > 1 ? `${items.length} designs selected` : it ? (it.type === 'text' ? `«${(it.text || '').split('\n')[0]}»` : it.name || it.type) : 'Add an image or text';
  let html = sec('Artwork', `
    <div class="hintline" style="margin:-4px 0 8px">${esc(sub)}</div>
    <div class="add-grid">
      <button data-add="image">${ICON.image}Image</button>
      <button data-add="text">${ICON.text}Text</button>
      <button data-add="shapes">${ICON.shape}Shape</button>
    </div>
    <div class="hintline" style="margin-top:8px">You can drag a PNG/JPG/SVG straight onto the pattern or the 3D garment, or paste one with Ctrl+V. Anything past the edge of a piece is trimmed, just like cut-and-sew printing.</div>`);
  html += `<div id="selSec">${selectedHTML()}</div>`;
  html += `<div class="sec"><h4>Layers <button class="act" data-add="image" title="Add an image">＋ Image</button></h4><div class="hintline" style="margin:-6px 0 6px">Drag to change the layer order</div><div class="layers" id="layers"></div></div>`;
  $('#tabDesign').innerHTML = html;
  renderLayers();
}
function placeChips(cur) {
  return `<div class="subhead">Place at</div><div class="chips">${app.garment.presets.map((p, i) => `<button class="chip ${!cur && i === app.presetIdx ? 'on' : ''}" data-preset="${i}" title="${p.face === 'in' ? 'Inside of the garment' : ''}">${esc(p.name)}</button>`).join('')}</div>`;
}
function selectedHTML() {
  const items = app.selectedItems(), it = app.selected();
  if (items.length > 1) {
    return sec(`${items.length} designs selected`, `
      <div class="multi-note">Drag any of them on the pattern to move them together. Shift-click adds or removes a design.</div>
      <div class="row"><label>Align</label><div class="ctl ibar">${['l', 'c', 'r', 't', 'm', 'b'].map(k => `<button class="ib" data-align="${k}" title="${ALIGN_NAMES[k]}">${alignIcon(k)}</button>`).join('')}</div></div>
      <div class="btngrid"><button class="btn" data-act="flip">Mirror</button><button class="btn" data-act="dup">Copy</button><button class="btn danger" data-act="del">Delete</button></div>`);
  }
  if (!it) return sec('Selected item', `<div class="empty">Nothing selected. Click artwork on the pattern or on the 3D garment, or add an image or text.</div>${placeChips(false)}`);
  const p = app.garment.pieces.find(p => p.id === it.piece);
  const unit = app.unit();
  const num = (key, label, val, suf, step = 0.1, extra = '') => `<label class="numf">${label}<span class="num-u"><input type="number" data-num="${key}" step="${step}" value="${val}" ${extra} aria-label="${label}"><span>${suf}</span></span></label>`;
  const hcm = itemHeight(it, app.assets);
  let html = sec('Transform', `
    <div class="numrow">${num('w', 'Width', app.fmtLen(it.w), unit)}${num('h', 'Height', app.fmtLen(hcm), unit)}</div>
    <div class="numrow">${num('rot', 'Rotation', Math.round(it.rot || 0), '°', 1)}${num('opacity', 'Opacity', Math.round((it.opacity ?? 1) * 100), '%', 1, 'min="0" max="100"')}</div>
    <div class="numrow">${num('x', 'From centre', app.fmtLen(it.x - p.w / 2), unit)}${num('y', 'From top', app.fmtLen(it.y - hcm / 2), unit)}</div>
    <div class="row"><div class="ctl ibar"><button class="btn sm" data-act="rotL" title="Rotate 90° left">↺ 90°</button><button class="btn sm" data-act="rotR" title="Rotate 90° right">↻ 90°</button><span class="hintline" style="margin:0">Or drag outside a corner</span></div></div>
    <div class="row"><div class="ctl ibar" role="group" aria-label="Align to the piece">${['l', 'c', 'r', 't', 'm', 'b'].map(k => `<button class="ib" data-align="${k}" title="${ALIGN_NAMES[k]}">${alignIcon(k)}</button>`).join('')}</div></div>
    <div class="hintline">On <b>${esc(p?.label || '')}${(it.face || 'out') === 'in' && !p?.insideOnly ? ' · inside' : ''}</b>. Drag it on the pattern or straight on the 3D garment.</div>`);
  let tools = '';
  if (it.type === 'text') {
    const f = FONTS.find(f => f.family === it.font) || FONTS[0];
    const WN = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
    tools += `<textarea data-k="item.text" rows="2" spellcheck="false" aria-label="Text">${esc(it.text)}</textarea>`;
    tools += selectRow('item.font', 'Font', FONTS.map(f => [f.family, f.family]));
    tools += colorRow('item.color', 'Text colour');
    tools += selectRow('item.weight', 'Font weight', f.weights.map(w => [w, `${w} · ${WN[w] || w}`]));
    tools += `<div class="row"><label>Style</label><div class="ctl ibar">
      <button class="ib ${it.weight >= 700 ? 'on' : ''}" data-act="bold" title="Bold" style="font-weight:800">B</button>
      <button class="ib ${it.italic ? 'on' : ''}" data-flag="italic" title="Italic"><i style="font-family:serif;font-size:16px">I</i></button>
      <button class="ib ${it.caps ? 'on' : ''}" data-flag="caps" title="ALL CAPS" style="font-size:11px;font-weight:700">AA</button></div></div>
    <div class="row"><label>Paragraph</label><div class="ctl ibar">
      ${['left', 'center', 'right'].map(a => `<button class="ib ${it.align === a ? 'on' : ''}" data-seg="item.align" data-val="${a}" title="${{ left: 'Align left', center: 'Centre', right: 'Align right' }[a]}"><svg viewBox="0 0 20 20"><path d="${a === 'left' ? 'M3 5h14M3 9h9M3 13h14M3 17h9' : a === 'center' ? 'M3 5h14M5.5 9h9M3 13h14M5.5 17h9' : 'M3 5h14M8 9h9M3 13h14M8 17h9'}" stroke="currentColor" stroke-width="1.5"/></svg></button>`).join('')}</div></div>`;
    tools += slider('item.lineH', 'Line height', 0.7, 2.2, 0.01);
    tools += slider('item.letter', 'Letter spacing', -10, 60, 0.5);
    tools += slider('item.curve', 'Curve', -100, 100, 1);
    tools += slider('item.stroke', 'Outline', 0, 20, 0.5);
    if (it.stroke) tools += colorRow('item.strokeColor', 'Outline colour');
    tools += `<div class="btngrid"><button class="btn ${it.flip ? 'on' : ''}" data-act="flip">Mirror</button><button class="btn" data-act="dup">Copy</button><button class="btn danger" data-act="del">Delete</button></div>`;
  } else if (it.type === 'shape') {
    tools += `<div class="btngrid" style="grid-template-columns:repeat(4,1fr)">${SHAPES.map(s => `<button class="btn ${it.shape === s.id ? 'on' : ''}" data-shape="${s.id}" title="${s.name}">${shapeSvg(s.id)}</button>`).join('')}</div>`;
    tools += colorRow('item.color', 'Shape colour');
    if (!isLine(it.shape)) tools += toggleRow('item.outline', 'Outline only');
    if (isLine(it.shape) || it.outline) { tools += slider('item.thick', 'Thickness, mm', 0.5, 30, 0.5, { suf: ' mm' }); tools += toggleRow('item.dashed', 'Dashed'); }
    tools += `<div class="btngrid"><button class="btn ${it.flip ? 'on' : ''}" data-act="flip">Mirror</button><button class="btn" data-act="dup">Copy</button><button class="btn danger" data-act="del">Delete</button></div>`;
  } else if (it.type === 'image') {
    const [pw, ph] = it.px || [0, 0], cr = it.crop || { w: 1 };
    const dpi = pw ? Math.round(pw * cr.w / (it.w / 2.54)) : 0;
    tools += `<div class="btngrid"><button class="btn ${it.flip ? 'on' : ''}" data-act="flip">Mirror</button><button class="btn ${it.invert ? 'on' : ''}" data-act="invert">Invert</button><button class="btn ${it.crop ? 'on' : ''}" data-act="crop">Crop</button><button class="btn" data-act="dup">Copy</button><button class="btn danger" data-act="del">Delete</button><button class="btn" data-act="replace">Replace</button></div>`;
    tools += slider('item.hue', 'Hue', -180, 180, 1, { suf: '°', def: 0 });
    tools += slider('item.sat', 'Saturation', 0, 2, 0.01, { pct: true, def: 1 });
    tools += `<div class="trow"><span>Fill with colour</span><span style="display:flex;gap:6px;align-items:center"><input type="color" data-k="item.fillColor" value="${it.fillColor || '#ffffff'}" style="width:28px;height:24px;border:1px solid var(--line-strong);border-radius:6px;padding:0;background:none" aria-label="Fill colour">${eyeBtn('item.fillColor')}<label class="toggle"><input type="checkbox" data-k="item.fill" ${it.fill ? 'checked' : ''} aria-label="Fill with colour"><span></span></label></span></div>`;
    tools += `<button class="btn sm block" data-act="resetColours" ${it.invert || it.hue || (it.sat ?? 1) !== 1 || it.fill ? '' : 'disabled'}>Reset colours</button>`;
    tools += `<button class="btn block ${it.halftone ? 'on' : ''}" data-act="halftone" title="Turn your image into dots for a screen-print finish">Halftone${it.halftone ? ' · on' : '…'}</button>`;
    tools += `<div class="row3" style="margin-top:10px"><button class="btn sm" data-act="trim">Trim empty edges</button><button class="btn sm" data-act="nobg">Remove background</button><span></span></div>`;
    if (it.vec && !it.halftone) tools += `<div class="row"><label>Print quality</label><div class="ctl"><span style="font-weight:600;color:var(--accent)">Vector</span><span class="hintline" style="margin:0">${it.vec.kind === 'pdf' ? 'PDF' : 'SVG'} · sharp at any size</span></div></div>`;
    else tools += `<div class="row"><label>Print quality</label><div class="ctl"><span style="font-weight:600;color:${dpi < 120 ? 'var(--danger)' : dpi >= 200 ? 'var(--accent)' : 'var(--ink)'}" data-dpi>${dpi} DPI</span><span class="hintline" style="margin:0">${pw} × ${ph} px</span></div></div>`;
  }
  if ((it.face || 'out') === 'out') {
    const tip = 'The part of the design that runs past the edge of its piece goes on across the seam onto the next piece: from the front to the back over the shoulders and sides, onto the sleeves and the hood. Once sewn, the picture meets at the seam. Each piece gets its own print file, with a little extra past the seam so no white line shows.';
    tools += `<div class="trow"><span title="${tip}">Wrap over seams <span class="hintline" style="margin:0">ⓘ</span></span><label class="toggle"><input type="checkbox" data-k="item.wrap" ${it.wrap ? 'checked' : ''} aria-label="Wrap over seams"><span></span></label></div>`;
    if (it.wrap) {
      const okPiece = /^(front|back|sleeve|hood|pocket)/i.test(it.piece) || app.garment.model;
      if (!okPiece) tools += `<div class="hintline" style="color:var(--danger)">Works on the front, back, sleeves, hood and pocket. Move the design onto one of them.</div>`;
      tools += slider('item.wrapBleed', 'Extra past the seams', 0, 20, 1, { suf: ' mm', def: 5 });
    }
  }
  tools += segRow('item.blend', 'Print look', [['normal', 'Solid ink'], ['multiply', 'Soft (dyed)']]);
  tools += slider('item.distress', 'Distress', 0, 1, 0.01, { pct: true });
  tools += `<div class="row2" style="margin-top:8px"><button class="btn sm" data-act="up" title="Forward">▲ Forward</button><button class="btn sm" data-act="down" title="Backward">▼ Backward</button></div>`;
  tools += `<div class="row2"><button class="btn sm" data-act="lock">${it.locked ? 'Unlock' : 'Lock'}</button><button class="btn sm" data-act="toggleFace">${(it.face || 'out') === 'in' ? 'Move to outside' : 'Move to inside'}</button></div>`;
  tools += placeChips(true);
  html += sec(it.type === 'text' ? 'Text' : it.type === 'shape' ? 'Shape' : 'Image', tools);
  return html;
}
function syncSelectedFields() {
  const it = app.selected(); if (!it || app.selIds.length > 1) return;
  const p = app.garment.pieces.find(p => p.id === it.piece);
  const root = $('#selSec'); if (!root || !p) return;
  const setv = (sel, v) => { const el = root.querySelector(sel); if (el && document.activeElement !== el) el.value = v; };
  const hcm = itemHeight(it, app.assets);
  setv('[data-num="w"]', app.fmtLen(it.w)); setv('[data-num="h"]', app.fmtLen(hcm));
  setv('[data-num="rot"]', Math.round(it.rot || 0)); setv('[data-num="opacity"]', Math.round((it.opacity ?? 1) * 100));
  setv('[data-num="x"]', app.fmtLen(it.x - p.w / 2)); setv('[data-num="y"]', app.fmtLen(it.y - hcm / 2));
  const dv = root.querySelector('[data-dpi]'); if (dv && it.px) { const dpi = Math.round(it.px[0] * (it.crop?.w || 1) / (it.w / 2.54)); dv.textContent = dpi + ' DPI'; dv.style.color = dpi < 120 ? 'var(--danger)' : dpi >= 200 ? 'var(--accent)' : 'var(--ink)'; }
}
function renderLayers() {
  const el = $('#layers'); if (!el) return;
  const items = [...app.doc.items].reverse();
  if (!items.length) { el.innerHTML = `<div class="empty">Nothing here yet — add an image or text. Tip: paste a picture with Ctrl+V.</div>`; return; }
  el.innerHTML = items.map(it => {
    const thumb = it.type === 'image' ? `<img src="${app.assets[it.asset] || ''}" alt="">` : it.type === 'text' ? `<span style="font-family:'${esc(it.font)}';color:${esc(it.color)}">Aa</span>` : `<span style="color:${esc(it.color)}">${shapeSvg(it.shape)}</span>`;
    const name = it.type === 'text' ? (it.text || 'Text').split('\n')[0] : it.name || it.type;
    const p = app.garment.pieces.find(p => p.id === it.piece);
    const kind = (it.type === 'shape' ? 'shape' : it.type) + ((it.face || 'out') === 'in' ? ' · inside' : '') + (p ? ` · ${p.label}` : '');
    return `<div class="layer ${app.selIds.includes(it.id) ? 'on' : ''} ${it.hidden ? 'hiddenL' : ''}" draggable="true" data-layer="${it.id}" title="Drag to change the layer order">
      <button class="ib" data-lact="vis" title="${it.hidden ? 'Show layer' : 'Hide layer'}">${it.hidden ? ICON.eyeOff : ICON.eye}</button>
      <div class="lt">${thumb}</div><div class="ln"><b>${esc(name)}</b><small>${esc(kind)}</small></div>
      <button class="ib" data-lact="lock" title="${it.locked ? 'Unlock' : 'Lock'}">${it.locked ? ICON.lock : ICON.unlock}</button></div>`;
  }).join('');
}

/* ---------- Fabric tab ---------- */
function gradientEditor() {
  const f = app.doc.fabric, st = gradientStops(f), cur = clamp(f._stop ?? 0, 0, st.length - 1);
  const css = gradientCss(st);
  const mids = st.slice(0, -1).map((s, i) => `<span class="mid" data-mid="${i}" style="left:${(s.p + (s.m ?? 0.5) * (st[i + 1].p - s.p)) * 100}%" title="Midpoint: drag to move where the blend is half-way"></span>`).join('');
  return `<div class="grad-bar" id="gradBar" style="background:${css}" title="Click under the bar to add a colour (up to 5). Drag a marker away from the bar to remove it.">${mids}${st.map((s, i) => `<span class="stop ${i === cur ? 'on' : ''}" data-stop="${i}" style="left:${s.p * 100}%;background:${s.c}" title="Colour stop ${i + 1}, at ${Math.round(s.p * 100)}%"></span>`).join('')}</div>
    <div class="hintline" style="margin:-8px 0 6px;display:flex;justify-content:space-between"><span>Top</span><span>Bottom</span></div>
    <div class="row"><label>Stop ${cur + 1}</label><div class="ctl color"><input type="color" data-stopc="${cur}" value="${st[cur].c}" aria-label="Colour of this stop"><input type="number" data-stopp="${cur}" min="0" max="100" step="1" value="${Math.round(st[cur].p * 100)}" style="width:70px" aria-label="Location"><span class="hintline" style="margin:0">%</span></div></div>
    <div class="row3"><button class="btn sm" data-act="gradAdd" ${st.length >= 5 ? 'disabled' : ''}>Add colour</button><button class="btn sm" data-act="gradDel" ${st.length <= 2 ? 'disabled' : ''}>Remove this colour</button><button class="btn sm" data-act="gradSwap">Swap colours</button></div>
    ${slider('fabric.angle', 'Direction', 0, 360, 1, { suf: '°' })}`;
}
function renderFabric() {
  const f = app.doc.fabric, g = app.garment;
  let html = sec('Fabric', `<div class="hintline" style="margin:-4px 0 8px">${esc(g.name)} · ${esc(g.cut)}</div>
    ${swatchRow('fabric.color', SWATCHES)}
    ${segRow('fabric.mode', 'Colour', [['solid', 'Solid'], ['gradient', 'Gradient'], ['radial', 'Radial']])}
    ${f.mode !== 'solid' ? gradientEditor() : ''}
    ${selectRow('fabric.wash', 'Wash', WASHES.map(w => [w.id, w.name]))}
    ${f.wash !== 'none' ? slider('fabric.washAmt', 'Strength', 0, 1, 0.01, { pct: true }) : ''}
    ${WASHES.find(w => w.id === f.wash)?.tint ? colorRow('fabric.color2', 'Dye colour') : ''}
    ${f.wash !== 'none' ? slider('fabric.washSize', 'Spot size', 0.4, 2.5, 0.05, { x: true, def: 1 }) + toggleRow('fabric.washPrints', 'Wash the prints too') : ''}
    ${f.wash !== 'none' || f.heather ? `<button class="btn sm block" data-act="reseed" style="margin-top:6px">Another pattern</button>` : ''}`);
  html += sec('Appearance', `
    ${selectRow('fabric.type', 'Material', FABRICS.map(x => [x.id, x.name]))}
    ${toggleRow('fabric.ao', 'Fold shadows (AO)', true)}
    ${g.model ? '' : toggleRow('fabric.wrinklesOn', 'Fabric wrinkles', true)}
    ${g.model || f.wrinklesOn === false ? '' : slider('fabric.wrinkles', 'Wrinkles', 0, 1.5, 0.05)}
    ${slider('fabric.relief', 'Texture', 0, 1.6, 0.05)}
    ${slider('fabric.knit', 'Knit size', 0.4, 3, 0.05, { x: true })}
    ${slider('fabric.bright', 'Brightness', 0.5, 1.5, 0.01)}
    ${slider('fabric.contrast', 'Contrast', 0.5, 1.5, 0.01)}
    ${toggleRow('fabric.heather', 'Heather (melange)')}`);
  const groups = COLOR_GROUPS.filter(gr => gr.id === 'trim' ? (g.extras.necklines.length || g.extras.handles) : gr.pieces.some(id => g.pieces.some(p => p.id === id)));
  if (groups.length) html += sec('Colour blocking', groups.map(gr => {
    const on = gr.pieces.some(id => f.pieceColors?.[id]);
    const col = gr.pieces.map(id => f.pieceColors?.[id]).find(Boolean) || f.color;
    return `<div class="trow"><span>${gr.name}</span><span style="display:flex;gap:8px;align-items:center">${on ? `<input type="color" data-block="${gr.id}" value="${col}" style="width:28px;height:24px;border:1px solid var(--line-strong);border-radius:6px;padding:0;background:none" aria-label="${gr.name} colour">` : ''}<label class="toggle"><input type="checkbox" data-blockon="${gr.id}" ${on ? 'checked' : ''} aria-label="${gr.name}"><span></span></label></span></div>`;
  }).join('') + `<div class="hintline">Give sleeves, hood, collar or ribs their own colour.</div>`);
  if (g.extras.strings.length || g.model) html += sec('Trims', `${g.extras.strings.length ? colorRow('details.cord', 'Drawcords') : ''}${g.model ? colorRow('details.buttons', 'Buttons') : ''}`);
  html += defaultsSec();
  $('#tabFabric').innerHTML = html;
}
const defaultsSec = () => sec('Default settings', `<div class="row3"><button class="btn sm" data-act="lookReset" title="Reset to saved defaults">Reset to saved</button><button class="btn sm" data-act="lookSave" title="Save the current fabric and scene as the default for new designs">Save as default</button><button class="btn sm" data-act="lookFactory" title="Restore factory settings">Factory</button></div>`);

/* ---------- Scene tab ---------- */
function renderScene() {
  const s = app.doc.scene, d = app.doc.details, g = app.garment;
  let html = sec('Backdrop', `
    ${toggleRow('scene.hdri', 'Studio HDRI', true)}
    ${s.hdri !== false ? slider('scene.hdriPower', 'HDRI intensity', 0, 3, 0.05) + slider('scene.hdriRot', 'HDRI rotation', 0, 360, 1, { suf: '°' }) : slider('scene.envPower', 'Reflections', 0, 1.5, 0.01, { pct: true })}
    ${toggleRow('scene.backdrop', 'Studio backdrop', true)}
    ${toggleRow('scene.shadows', 'Shadow on the backdrop', true)}
    ${swatchRow('scene.bgColor', BG_SWATCHES, 'Backdrop colour')}
    <div class="subhead">Backdrop light</div>
    <div class="gobo-grid">${GOBOS.map(gb => `<button data-gobo="${gb.id}" class="${(s.gobo || 'none') === gb.id ? 'on' : ''}" title="${gb.name}"><img src="${goboThumb(gb.id)}" alt=""><span>${gb.name}</span></button>`).join('')}</div>
    ${toggleRow('scene.goboInvert', 'Invert light')}
    ${slider('scene.bgBright', 'Backdrop brightness', 0.5, 1.5, 0.01)}
    ${slider('scene.bgContrast', 'Backdrop contrast', 0.5, 1.6, 0.01)}`);
  html += sec('Key light', `
    ${slider('scene.lightSide', 'Side', -80, 80, 1, { suf: '°' })}
    ${slider('scene.lightHeight', 'Height', 5, 80, 1, { suf: '°' })}
    ${slider('scene.lightPower', 'Power', 0.2, 2.5, 0.01)}
    ${slider('scene.softness', 'Softness', 0, 1, 0.01, { pct: true })}
    ${slider('scene.ambient', 'Ambient', 0, 2, 0.01, { pct: true })}`);
  html += sec(g.tote ? 'Wall peg' : 'Hanger', `${toggleRow('scene.hanger', g.tote ? 'Show peg' : 'Show hanger', true)}${swatchRow('scene.hangerColor', HANGER_SWATCHES, 'Hanger colour')}`);
  let det = '';
  if (g.extras.label) {
    det += toggleRow('details.label', 'Neck label', true);
    det += selectRow('details.labelShape', 'Label shape', LABEL_SHAPES.map(l => [l.id, l.name]));
    det += `<div class="trow"><span>Label colour</span></div>${toggleRow('details.labelAsFabric', 'Same as the shirt')}${d.labelAsFabric ? '' : swatchRow('details.labelColor', LABEL_SWATCHES, 'Label colour')}`;
    det += `<button class="btn sm block" data-act="designLabel">Design the label (Inside view)</button>`;
  }
  det += toggleRow('scene.spin', 'Auto-rotate 3D');
  det += toggleRow('view.marks', 'Pattern markings', true);
  html += sec('Details', det);
  html += defaultsSec();
  $('#tabScene').innerHTML = html;
}
const goboThumbs = {};
function goboThumb(id) { if (goboThumbs[id]) return goboThumbs[id]; const s = goboCanvas(id), t = makeCanvas(96, 96); t.getContext('2d').drawImage(s, 0, 0, 96, 96); return (goboThumbs[id] = t.toDataURL()); }

function renderAll() { renderDesign(); renderFabric(); renderScene(); }
function switchTab(t) { $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $('#tabDesign').hidden = t !== 'design'; $('#tabFabric').hidden = t !== 'fabric'; $('#tabScene').hidden = t !== 'scene'; }
// header / toolbar state that mirrors the document
function syncChrome() {
  const v = app.doc.view, s = app.doc.scene;
  $$('#sideSeg button').forEach(b => b.classList.toggle('on', b.dataset.side === (v.side || 'out')));
  $$('.units button').forEach(b => b.classList.toggle('on', b.dataset.unit === app.unit()));
  $('#marksBtn').classList.toggle('on', v.marks !== false);
  $('#spinBtn').classList.toggle('on', !!s.spin);
  $('#hangerBtn').classList.toggle('on', s.hanger !== false);
  $('#labelBtn').classList.toggle('on', !!app.doc.details.label);
  $('#labelBtn').hidden = !app.garment?.extras?.label;
  if (app.garment) $('#pieceCount').textContent = `${editor.visiblePieces().length} pieces`;
}

/* ---------- inspector events (delegated) ---------- */
function onValue(path, live) {
  const scope = path.split('.')[0], key = path.split('.')[1];
  if (scope === 'item') {
    const it = app.selected();
    app.itemsChanged(live);
    if (!live && ['font', 'shape', 'outline', 'stroke', 'blend', 'fill', 'halftone', 'wrap'].includes(key)) $('#selSec').innerHTML = selectedHTML();
    if (['text', 'color', 'font'].includes(key)) { renderLayers(); if (key === 'text') $('#tabDesign .hintline').textContent = `«${(it?.text || '').split('\n')[0]}»`; }
  } else if (scope === 'fabric') {
    if (['wash', 'heather', 'washSeed', 'washSize'].includes(key)) rebuildOverlays();
    if (key === 'color2') prepareOverlayTint(app.overlays, app.doc.fabric.color2);
    if (['type', 'knit', 'relief', 'ao', 'bright', 'contrast'].includes(key)) studio.updateFabric(app.doc.fabric);
    else if (key === 'wrinkles' || key === 'wrinklesOn') { rebuildGeometrySoon(); if (!live) renderFabric(); }
    else { rebuildBase(); studio.updateFabric(app.doc.fabric); if (key === 'color' && app.doc.details.labelAsFabric) scheduleAtlas(); }
    if (!live && ['mode', 'wash', 'heather', 'color', 'stops'].includes(key)) renderFabric();
  } else if (scope === 'details') {
    studio.mats.cord.color.set(app.doc.details.cord || '#fff'); studio.mats.button.color.set(app.doc.details.buttons || '#f2f0ea');
    if (['labelColor', 'labelAsFabric'].includes(key)) { scheduleAtlas(); editor.redraw(); }
    if (key === 'label' || key === 'labelShape') rebuildGeometrySoon();
    if (!live) { renderScene(); syncChrome(); }
  } else if (scope === 'scene') {
    studio.updateScene(app.doc.scene);
    if (key === 'hanger') rebuildGeometrySoon();
    if (key === 'spin') studio.applyPixelRatio();
    if (!live && ['bgColor', 'gobo', 'hdri', 'hangerColor'].includes(key)) renderScene();
    syncChrome();
  } else if (scope === 'view') { editor.redraw(); if (!live) { renderDesign(); syncChrome(); } }
}
function bindInspector() {
  const root = $('#inspector');
  const readVal = (el) => {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') { const v = parseFloat(el.value); return isNaN(v) ? 0 : v; }
    if (el.dataset.hex !== undefined) { let v = el.value.trim(); if (!v.startsWith('#')) v = '#' + v; return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null; }
    if (el.tagName === 'SELECT' && /^\d+$/.test(el.value)) return parseInt(el.value, 10);
    return el.value;
  };
  const handle = (e, live) => {
    const el = e.target;
    if (el.dataset.num) {
      const items = app.selectedItems(); const it = app.selected(); if (!it) return;
      const p = app.garment.pieces.find(p => p.id === it.piece), v = parseFloat(el.value); if (isNaN(v)) return;
      const k = el.dataset.num, hcm = itemHeight(it, app.assets);
      if (k === 'w') { const nw = clamp(app.toCm(v), 0.3, 400); if (it.type === 'shape' && !isLine(it.shape)) it.h *= nw / it.w; it.w = nw; }
      if (k === 'h') { const nh = clamp(app.toCm(v), 0.05, 400); if (it.type === 'shape') it.h = nh; else it.w = nh * (it.w / hcm); }
      if (k === 'rot') it.rot = ((v + 540) % 360) - 180;
      if (k === 'opacity') it.opacity = clamp(v / 100, 0, 1);
      if (k === 'x') it.x = p.w / 2 + app.toCm(v);
      if (k === 'y') it.y = app.toCm(v) + hcm / 2;
      void items;
      app.itemsChanged(live); if (!live) commit(); return;
    }
    if (el.dataset.stopc !== undefined || el.dataset.stopp !== undefined) {
      const f = app.doc.fabric, st = gradientStops(f).map(s => ({ ...s }));
      const i = +(el.dataset.stopc ?? el.dataset.stopp);
      if (el.dataset.stopc !== undefined) st[i].c = el.value; else st[i].p = clamp((parseFloat(el.value) || 0) / 100, 0, 1);
      f.stops = st; f.color = st[0].c; f._stop = i;
      rebuildBase(); studio.updateFabric(f);
      if (!live) { renderFabric(); commit(); } else { const bar = $('#gradBar'); if (bar) bar.style.background = gradientCss(gradientStops(f)); }
      return;
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
    if (k === 'fabric.color' && app.doc.fabric.stops) { app.doc.fabric.stops = gradientStops(app.doc.fabric).map((s, i) => i === 0 ? { ...s, c: v } : s); }
    // mirror twin inputs (colour picker <-> hex field) and value readouts
    $$(`[data-k="${k}"]`, root).forEach(o => { if (o !== el && o.type !== 'checkbox') o.value = v; });
    const out = root.querySelector(`[data-v="${k}"]`);
    if (out) { const step = parseFloat(el.step) || 1; out.textContent = el.dataset.pct !== undefined ? Math.round(v * 100) + '%' : el.dataset.x !== undefined ? '×' + fmt(v, step) : fmt(v, step) + (el.dataset.suf || ''); }
    $$(`[data-setk="${k}"]`, root).forEach(b => b.classList.toggle('on', b.dataset.val.toLowerCase() === String(v).toLowerCase()));
    onValue(k, live);
    if (!live) commit();
  };
  root.addEventListener('input', e => handle(e, true));
  root.addEventListener('change', e => handle(e, false));
  root.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tab) return switchTab(b.dataset.tab);
    if (b.dataset.add) { if (b.dataset.add === 'shapes') { e.stopPropagation(); return openShapes(b); } return onAdd(b.dataset.add); }
    if (b.dataset.preset !== undefined) {
      const i = +b.dataset.preset, sel = app.selectedItems();
      if (sel.length) { for (const it of sel) placeAt(it, app.garment.presets[i], it.type !== 'text' && it.type !== 'image' ? false : false); if ((app.garment.presets[i].face || 'out') !== editor.face()) setSide(app.garment.presets[i].face || 'out'); app.itemsChanged(false); renderDesign(); commit(); }
      else { app.presetIdx = i; renderDesign(); }
      return;
    }
    if (b.dataset.seg) {
      const k = b.dataset.seg; set(k, b.dataset.val);
      if (k === 'fabric.mode' && b.dataset.val !== 'solid' && !app.doc.fabric.stops) app.doc.fabric.stops = gradientStops(app.doc.fabric);
      onValue(k, false); commit();
      b.parentElement.querySelectorAll('[data-seg]').forEach(x => x.classList.toggle('on', x === b));
      if (k === 'fabric.mode') { rebuildBase(); renderFabric(); }
      return;
    }
    if (b.dataset.setk) { set(b.dataset.setk, b.dataset.val); onValue(b.dataset.setk, false); commit(); return; }
    if (b.dataset.eye) {
      try { const r = await new window.EyeDropper().open(); set(b.dataset.eye, r.sRGBHex); onValue(b.dataset.eye, false); commit(); if (b.dataset.eye.startsWith('item.')) $('#selSec').innerHTML = selectedHTML(); } catch { }
      return;
    }
    if (b.dataset.flag) { const it = app.selected(); it[b.dataset.flag] = !it[b.dataset.flag]; b.classList.toggle('on'); app.itemsChanged(false); commit(); return; }
    if (b.dataset.shape) { const it = app.selected(); const wasLine = isLine(it.shape); it.shape = b.dataset.shape; if (isLine(it.shape)) { it.h = 0.4; it.dashed = it.shape === 'dashed'; } else if (wasLine) it.h = it.w * 0.6; it.name = SHAPES.find(s => s.id === it.shape)?.name; app.itemsChanged(false); $('#selSec').innerHTML = selectedHTML(); commit(); return; }
    if (b.dataset.align) return alignSel(b.dataset.align);
    if (b.dataset.gobo) { app.doc.scene.gobo = b.dataset.gobo; onValue('scene.gobo', false); commit(); return; }
    if (b.dataset.lact) {
      const id = b.closest('[data-layer]').dataset.layer, it = app.doc.items.find(i => i.id === id);
      if (b.dataset.lact === 'vis') it.hidden = !it.hidden; else it.locked = !it.locked;
      app.itemsChanged(false); if (app.selIds.includes(it.id)) $('#selSec').innerHTML = selectedHTML(); commit(); e.stopPropagation(); return;
    }
    const it = app.selected(), sel = app.selectedItems();
    switch (b.dataset.act) {
      case 'rotL': it.rot = ((it.rot || 0) - 90 + 540) % 360 - 180; break;
      case 'rotR': it.rot = ((it.rot || 0) + 90 + 540) % 360 - 180; break;
      case 'flip': for (const s of sel) s.flip = !s.flip; b.classList.toggle('on'); break;
      case 'bold': it.weight = it.weight >= 700 ? 400 : 700; { const f = FONTS.find(f => f.family === it.font); if (f && !f.weights.includes(it.weight)) it.weight = f.weights.reduce((a, w) => Math.abs(w - it.weight) < Math.abs(a - it.weight) ? w : a, f.weights[0]); } app.itemsChanged(false); $('#selSec').innerHTML = selectedHTML(); commit(); return;
      case 'invert': it.invert = !it.invert; b.classList.toggle('on'); app.itemsChanged(false); $('#selSec').innerHTML = selectedHTML(); commit(); return;
      case 'resetColours': delete it.invert; delete it.hue; delete it.sat; it.fill = false; app.itemsChanged(false); $('#selSec').innerHTML = selectedHTML(); commit(); return;
      case 'crop': return app.startCrop(it);
      case 'halftone': return openHalftone(it);
      case 'up': return moveZ(1);
      case 'down': return moveZ(-1);
      case 'dup': return duplicateSel();
      case 'del': return deleteSel();
      case 'lock': it.locked = !it.locked; $('#selSec').innerHTML = selectedHTML(); app.itemsChanged(false); commit(); return;
      case 'toggleFace': { it.face = (it.face || 'out') === 'in' ? 'out' : 'in'; const p = app.garment.pieces.find(p => p.id === it.piece); if (p && !p.noMirror) it.x = p.w - it.x; if (p?.insideOnly && it.face === 'out') { const f = app.garment.pieces.find(q => q.id === 'front'); it.piece = f.id; it.x = f.w / 2; it.y = f.h / 3; } setSide(it.face); app.itemsChanged(false); renderDesign(); commit(); return; }
      case 'replace': pendingReplace = it.id; $('#fileImage').click(); return;
      case 'trim': case 'nobg': {
        toast(b.dataset.act === 'trim' ? 'Trimming empty edges…' : 'Removing the background…');
        const out = b.dataset.act === 'trim' ? await trimTransparent(app.assets[it.asset]) : await removeBackground(app.assets[it.asset]);
        if (!out) return toast('Nothing to trim.');
        const im = await loadImage(out), a = uid('a'); app.assets[a] = out;
        it.asset = a; it.px = [im.naturalWidth, im.naturalHeight]; delete it.crop; it.aspect = imageAspect(it);
        app.itemsChanged(false); $('#selSec').innerHTML = selectedHTML(); renderLayers(); commit(); toast('Done.'); return;
      }
      case 'reseed': app.doc.fabric.washSeed = (app.doc.fabric.washSeed || 0) + 1; onValue('fabric.washSeed', false); commit(); return;
      case 'gradAdd': { const f = app.doc.fabric, st = gradientStops(f); if (st.length >= 5) return; let gi = 0, gap = 0; for (let i = 0; i < st.length - 1; i++) if (st[i + 1].p - st[i].p > gap) { gap = st[i + 1].p - st[i].p; gi = i; } st.splice(gi + 1, 0, { p: (st[gi].p + st[gi + 1].p) / 2, c: st[gi].c }); f.stops = st; f._stop = gi + 1; rebuildBase(); renderFabric(); commit(); return; }
      case 'gradDel': { const f = app.doc.fabric, st = gradientStops(f); if (st.length <= 2) return; st.splice(clamp(f._stop ?? 0, 0, st.length - 1), 1); f.stops = st; f._stop = 0; f.color = st[0].c; rebuildBase(); studio.updateFabric(f); renderFabric(); commit(); return; }
      case 'gradSwap': { const f = app.doc.fabric; f.stops = gradientStops(f).map(s => ({ p: 1 - s.p, c: s.c })).reverse(); f.color = f.stops[0].c; rebuildBase(); studio.updateFabric(f); renderFabric(); commit(); return; }
      case 'designLabel': setSide('in'); switchTab('design'); app.presetIdx = app.garment.presets.findIndex(p => p.name === 'Label'); renderDesign(); toast('Inside view: add text or an image — choose “Label” in Place at.'); return;
      case 'lookSave': try { localStorage.setItem('dm.look', JSON.stringify({ scene: app.doc.scene, fabric: { ...app.doc.fabric, pieceColors: {} } })); toast('Current look saved as default'); } catch { } return;
      case 'lookReset': { const l = loadLook(); app.doc.scene = { ...FACTORY_SCENE, ...l.scene }; app.doc.fabric = { ...FACTORY_FABRIC, ...l.fabric, pieceColors: app.doc.fabric.pieceColors }; afterLook(); toast('Look reset to default'); return; }
      case 'lookFactory': app.doc.scene = { ...FACTORY_SCENE }; app.doc.fabric = { ...FACTORY_FABRIC, pieceColors: app.doc.fabric.pieceColors }; afterLook(); toast('Factory look restored'); return;
      default: return;
    }
    app.itemsChanged(false); commit();
  });
  // gradient bar: click under the bar to add a stop, drag a stop to move it, drag it away to remove it
  root.addEventListener('pointerdown', e => {
    const bar = e.target.closest('#gradBar'); if (!bar) return;
    const f = app.doc.fabric, r = bar.getBoundingClientRect();
    const stopEl = e.target.closest('[data-stop]');
    let st = gradientStops(f);
    const midEl = e.target.closest('[data-mid]');
    if (midEl) { // midpoint: where the blend between two colours is half-way
      const j = +midEl.dataset.mid; e.preventDefault();
      const mv = (ev) => {
        const s0 = st[j], s1 = st[j + 1]; if (!s0 || !s1 || s1.p <= s0.p) return;
        s0.m = clamp(((ev.clientX - r.left) / r.width - s0.p) / (s1.p - s0.p), 0.05, 0.95);
        f.stops = st; rebuildBase(); studio.updateFabric(f);
        bar.style.background = gradientCss(st); midEl.style.left = (s0.p + s0.m * (s1.p - s0.p)) * 100 + '%';
      };
      const upm = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upm); renderFabric(); commit(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upm);
      return;
    }
    let i;
    if (stopEl) i = +stopEl.dataset.stop;
    else { if (st.length >= 5) return; const p = clamp((e.clientX - r.left) / r.width, 0, 1); st.push({ p, c: st.reduce((a, s) => Math.abs(s.p - p) < Math.abs(a.p - p) ? s : a).c }); st.sort((a, b) => a.p - b.p); i = st.findIndex(s => s.p === p); }
    f.stops = st; f._stop = i; rebuildBase();
    const move = (ev) => {
      const away = Math.abs(ev.clientY - (r.top + r.height / 2)) > 60 && st.length > 2;
      st = gradientStops(f); const cur = st[i]; if (!cur) return;
      cur.p = clamp((ev.clientX - r.left) / r.width, 0, 1); cur._away = away;
      f.stops = st; rebuildBase(); studio.updateFabric(f);
      const bars = $('#gradBar'); if (bars) { bars.style.background = gradientCss(st); const m = bars.querySelector(`[data-stop="${i}"]`); if (m) { m.style.left = cur.p * 100 + '%'; m.style.opacity = away ? 0.3 : 1; } }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      st = gradientStops(f);
      if (Math.abs(ev.clientY - (r.top + r.height / 2)) > 60 && st.length > 2) { st.splice(i, 1); f._stop = 0; }
      f.stops = st.map(s => ({ p: s.p, c: s.c, ...(s.m != null ? { m: s.m } : {}) })); f.color = f.stops[0].c;
      rebuildBase(); studio.updateFabric(f); renderFabric(); commit();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  // layer list: select (Shift = add) + drag to reorder
  root.addEventListener('click', e => { const l = e.target.closest('[data-layer]'); if (l && !e.target.closest('button')) { if (e.shiftKey) app.toggleSelect(l.dataset.layer); else app.select(l.dataset.layer); const it = app.selected(); if (it && (it.face || 'out') !== editor.face()) setSide(it.face || 'out'); } });
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
function afterLook() { rebuildOverlays(); rebuildBase(); studio.updateFabric(app.doc.fabric); studio.updateScene(app.doc.scene); rebuildGeometrySoon(); renderAll(); syncChrome(); commit(); }
let pendingReplace = null;
function onAdd(kind) {
  if (kind === 'image') { pendingReplace = null; $('#fileImage').click(); }
  else if (kind === 'text') addText();
  else addShape('rect');
}
// shapes menu (toolbar and Artwork section): pick a shape, then draw it on the pattern
function openShapes(anchor) {
  const m = $('#shapesMenu');
  m.innerHTML = SHAPES.slice(0, 8).map(s => `<button data-drawshape="${s.id}">${shapeSvg(s.id)}<span>${s.name}</span></button>`).join('') + `<hr>` + SHAPES.slice(8).map(s => `<button data-drawshape="${s.id}">${shapeSvg(s.id)}<span>${s.name}</span></button>`).join('');
  $$('.menu').forEach(x => { if (x !== m) x.hidden = true; });
  m.hidden = !m.hidden;
  if (anchor && anchor.closest('#inspector')) { // opened from the inspector: just add the shape at the chosen place
    m.hidden = true;
    const pick = document.createElement('div'); pick.className = 'menu'; pick.style.cssText = 'position:fixed;z-index:60';
    const r = anchor.getBoundingClientRect(); pick.style.left = Math.max(8, r.left - 60) + 'px'; pick.style.top = r.bottom + 6 + 'px';
    pick.innerHTML = SHAPES.map(s => `<button data-addshape="${s.id}" style="flex-direction:row;align-items:center;gap:10px">${shapeSvg(s.id)}<span>${s.name}</span></button>`).join('');
    document.body.appendChild(pick);
    const close = (ev) => { const bb = ev.target.closest('[data-addshape]'); if (bb) addShape(bb.dataset.addshape); pick.remove(); document.removeEventListener('click', close, true); };
    setTimeout(() => document.addEventListener('click', close, true));
  }
}
function setSide(side) {
  app.doc.view.side = side;
  editor._fitted = false; editor.fit(); editor._fitted = true;
  app.selIds = app.selIds.filter(id => (app.doc.items.find(i => i.id === id)?.face || 'out') === side);
  syncChrome(); renderDesign(); editor.redraw();
}

/* ====================================================================== */
/* 3D: drag artwork directly on the garment */
function hitPiece(hit) {
  if (hit.panel?.piece) return app.garment.pieces.find(p => p.id === hit.panel.piece);
  const sh = app.garment.sheet;
  const x = hit.uv.x * sh.w, y = (1 - hit.uv.y) * sh.h;
  return app.garment.pieces.find(p => !p.insideOnly && pointInPoly(x - p.sx, y - p.sy, p.poly)) || null;
}
function bind3DDrag() {
  const pane = $('#viewPane'), cv = $('#gl');
  let drag = null;
  const toSheet = (hit) => { const sh = app.garment.sheet; return [hit.uv.x * sh.w, (1 - hit.uv.y) * sh.h]; };
  const faceOf = (hit) => hit.panel?.role === 'label' ? 'in' : 'out';
  const itemAtHit = (hit) => {
    const [sx, sy] = toSheet(hit), piece = hitPiece(hit);
    if (!piece) return { it: null };
    const face = faceOf(hit);
    let lx = sx - piece.sx, ly = sy - piece.sy;
    if (face === 'in' && !piece.noMirror) lx = piece.w - lx;
    for (let i = app.doc.items.length - 1; i >= 0; i--) { const it = app.doc.items[i]; if (it.piece === piece.id && (it.face || 'out') === face && !it.hidden && !it.locked && hitItem(it, app.assets, lx, ly, 0.3)) return { it, lx, ly, piece }; }
    return { it: null, lx, ly, piece };
  };
  pane.addEventListener('pointerdown', e => {
    if (e.target !== cv || e.button !== 0) return;
    const hit = studio.pick(e); if (!hit) return;
    const r = itemAtHit(hit); if (!r.it) return;
    e.stopPropagation(); e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    app.select(r.it.id);
    if ((r.it.face || 'out') !== editor.face()) setSide(r.it.face || 'out');
    drag = { it: r.it, dx: r.lx - r.it.x, dy: r.ly - r.it.y, piece: r.piece.id, moved: false };
  }, true);
  pane.addEventListener('pointermove', e => {
    if (!drag) {
      if (e.target !== cv || e.buttons) return;
      const hit = studio.pick(e); cv.style.cursor = hit && itemAtHit(hit).it ? 'move' : 'grab'; return;
    }
    e.stopPropagation();
    const hit = studio.pick(e); if (!hit || faceOf(hit) !== (drag.it.face || 'out')) return;
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
  cv.addEventListener('dblclick', () => { studio.frame(true); });
}

/* ====================================================================== */
/* drop / paste files */
function bindFiles() {
  const fi = $('#fileImage');
  fi.addEventListener('change', async () => {
    const files = [...fi.files]; fi.value = '';
    if (pendingReplace && files[0]) {
      const it = app.doc.items.find(i => i.id === pendingReplace); pendingReplace = null;
      if (it) await replaceImage(it, files[0]);
      return;
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
      if (p) at = { piece: p.id, x: x - p.sx, y: y - p.sy, face: editor.face() };
    } else if (e.target === $('#gl')) {
      const hit = studio.pick(e), p = hit && hitPiece(hit);
      if (p) { const sh = app.garment.sheet; at = { piece: p.id, x: hit.uv.x * sh.w - p.sx, y: (1 - hit.uv.y) * sh.h - p.sy, face: 'out' }; }
    }
    for (const f of e.dataTransfer.files) await addImageFile(f, at);
  });
  window.addEventListener('paste', async e => {
    if (isTyping(e)) return;
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (files.length) { e.preventDefault(); for (const f of files) await addImageFile(f); }
  });
}
const isTyping = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };

/* ====================================================================== */
/* project files */
function downloadProject(doc = app.doc, assets) {
  const used = usedAssets(doc);
  const src = assets || app.assets;
  const data = JSON.stringify({ app: 'design-master', v: 2, doc, assets: Object.fromEntries(Object.entries(src).filter(([k]) => used.has(k))) });
  download(new Blob([data], { type: 'application/json' }), slug(doc.name) + '.dmproj');
}
async function openProjectFile(file) {
  try {
    const data = JSON.parse(await readFileAsText(file));
    if (data.app !== 'design-master' || !data.doc) throw new Error('bad');
    loadDoc(data.doc, data.assets || {}, null);
    toast(`Opened “${app.doc.name}”.`);
  } catch { toast('Could not open the project file.'); }
}
function loadDoc(doc, assets, fileId = null) {
  const base = DEFAULT_DOC();
  app.doc = { ...base, ...doc, fabric: { ...base.fabric, ...doc.fabric }, details: { ...base.details, ...doc.details }, scene: { ...base.scene, ...doc.scene }, view: { ...base.view, ...doc.view } };
  app.assets = { ...assets }; app.fileId = fileId;
  app.selIds = []; app.history = []; app.future = [];
  $('#projName').value = app.doc.name || 'Untitled design';
  applyGarment(app.doc.garment, { reframe: true });
  studio.updateScene(app.doc.scene);
  syncChrome();
  commit();
}
function thumbnail() {
  try {
    studio.renderer.render(studio.scene, studio.camera);
    const src = studio.renderer.domElement, t = makeCanvas(240, 300), c = t.getContext('2d');
    const k = Math.max(240 / src.width, 300 / src.height);
    c.fillStyle = app.doc.scene.bgColor; c.fillRect(0, 0, 240, 300);
    c.drawImage(src, (240 - src.width * k) / 2, (300 - src.height * k) / 2, src.width * k, src.height * k);
    return t.toDataURL('image/jpeg', 0.8);
  } catch { return ''; }
}

/* ====================================================================== */
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); }
async function busy(label, fn) {
  const t = $('#toast'); t.textContent = label; t.classList.add('on'); clearTimeout(t._h);
  try { return await fn((m) => (t.textContent = m)); } catch (e) { console.error(e); toast('Something went wrong: ' + e.message); } finally { t._h = setTimeout(() => t.classList.remove('on'), 1800); }
}

/* ====================================================================== */
/* header, toolbars, keyboard */
function bindChrome() {
  $$('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) { if (isBusyRendering() && (o.id === 'renderDlg' || o.id === 'videoDlg')) return; o.hidden = true; } }));
  $('#undoBtn').onclick = () => { if (editor.crop) return endCrop(false); undo(); }; $('#redoBtn').onclick = redo;
  $('#cropBar').addEventListener('click', (e) => { const b = e.target.closest('[data-crop]'); if (b) cropAction(b.dataset.crop); });
  $('#newBtn').onclick = newDesign;
  $('#filesBtn').onclick = openFiles;
  $('#saveBtn').onclick = () => saveToFiles();
  $('#shotBtn').onclick = snapshot3D;
  $('#exportBtn').onclick = openRender;
  $('#projName').addEventListener('change', e => { app.doc.name = e.target.value.trim() || 'Untitled design'; commit(); });
  $('#modeSeg').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); };
  $('#sideSeg').onclick = (e) => { const b = e.target.closest('[data-side]'); if (b) setSide(b.dataset.side); };
  $('.units').onclick = (e) => { const b = e.target.closest('[data-unit]'); if (!b) return; app.doc.view.unit = b.dataset.unit; syncChrome(); editor.redraw(); renderDesign(); commit(); };
  $('#marksBtn').onclick = () => { app.doc.view.marks = app.doc.view.marks === false; syncChrome(); editor.redraw(); renderScene(); commit(); };
  $('#viewSeg').onclick = (e) => { const b = e.target.closest('[data-view]'); if (!b) return; $$('#viewSeg button').forEach(x => x.classList.toggle('on', x === b)); if (app.doc.scene.spin) { app.doc.scene.spin = false; studio.updateScene(app.doc.scene); syncChrome(); } studio.setView(b.dataset.view); };
  $('#spinBtn').onclick = () => { app.doc.scene.spin = !app.doc.scene.spin; studio.updateScene(app.doc.scene); studio.applyPixelRatio(); syncChrome(); renderScene(); commit(); };
  $('#hangerBtn').onclick = () => { app.doc.scene.hanger = app.doc.scene.hanger === false; onValue('scene.hanger', false); renderScene(); commit(); };
  $('#labelBtn').onclick = () => { app.doc.details.label = !app.doc.details.label; onValue('details.label', false); commit(); };
  $('#resetViewBtn').onclick = () => { studio.setView('front'); studio.frame(); $$('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.view === 'front')); };
  $('#tourBtn').onclick = startTour;
  $('#hint3dOff').onclick = () => { $('#hint3d').hidden = true; try { localStorage.setItem('dm.hint3d', '1'); } catch { } };
  const menu = (btn, m) => { $(btn).onclick = (e) => { e.stopPropagation(); const open = $(m).hidden; $$('.menu').forEach(x => (x.hidden = true)); $(m).hidden = !open; }; };
  menu('#exportMoreBtn', '#exportMenu'); menu('#qualityBtn', '#qualityMenu');
  $('#shapesBtn').onclick = (e) => { e.stopPropagation(); openShapes($('#shapesBtn')); };
  $('#shapesMenu').onclick = (e) => { const b = e.target.closest('[data-drawshape]'); if (!b) return; $('#shapesMenu').hidden = true; setTool('shape:' + b.dataset.drawshape); };
  // any click closes open menus, including choosing an item in one (menu buttons stop the event themselves)
  document.addEventListener('click', () => $$('.menu').forEach(x => (x.hidden = true)));
  $('#qualityMenu').onclick = (e) => { const b = e.target.closest('[data-q]'); if (!b) return; setQuality(b.dataset.q); };
  setQuality((() => { try { return localStorage.getItem('dm.quality'); } catch { return null; } })() || 'adaptive');
  $('#exportMenu').onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) runExport(b.dataset.act); };
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('dm.theme', document.documentElement.dataset.theme); } catch { }
    editor.redraw();
  };
  $('#patternPane').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    if (b.dataset.add) onAdd(b.dataset.add);
  });
  $('#zoomIn').onclick = () => editor.zoom(1.25); $('#zoomOut').onclick = () => editor.zoom(0.8); $('#zoomFit').onclick = () => editor.fit();
  window.addEventListener('keydown', e => {
    if (isTyping(e) || !$('#tour').hidden) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (editor.crop) { // while cropping: Esc cancels, Enter keeps it; other shortcuts wait
      if (k === 'escape') { e.preventDefault(); endCrop(false); } else if (k === 'enter') { e.preventDefault(); endCrop(true); }
      else if (mod && k === 'z') { e.preventDefault(); endCrop(false); }
      return;
    }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); saveToFiles(); return; }
    if (mod && k === 'o') { e.preventDefault(); openFiles(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && k === 'a') { e.preventDefault(); app.setSelection(editor.itemsHere().filter(i => !i.hidden && !i.locked).map(i => i.id)); return; }
    if (mod) return;
    const sel = app.selectedItems().filter(i => !i.locked);
    if ((k === 'delete' || k === 'backspace') && sel.length) { e.preventDefault(); deleteSel(); return; }
    if (k === 'escape') { if (editor.tool.startsWith('shape:')) setTool('select'); else app.select(null); $$('.overlay').forEach(o => { if (!isBusyRendering()) o.hidden = true; }); toggleModels(false); return; }
    if (sel.length && k.startsWith('arrow')) {
      e.preventDefault(); const st = e.shiftKey ? 1 : 0.1;
      for (const it of sel) { if (k === 'arrowleft') it.x -= st; if (k === 'arrowright') it.x += st; if (k === 'arrowup') it.y -= st; if (k === 'arrowdown') it.y += st; }
      app.itemsChanged(true); nudgeCommit(); return;
    }
    if (k === 'v') setTool('select');
    if (k === 'h') setTool('hand');
    if (k === 't') addText();
    if (k === 'i') onAdd('image');
    if (k === 's') openShapes($('#shapesBtn'));
    if (k === 'f') editor.fit();
    if (k === '1') setMode('pattern'); if (k === '2') setMode('split'); if (k === '3') setMode('3d');
  });
}
function setQuality(q) {
  studio.quality = q; studio.applyPixelRatio();
  $$('#qualityMenu button').forEach(x => x.classList.toggle('on', x.dataset.q === q));
  $('#qualityName').textContent = { adaptive: 'Adaptive', full: 'Full', half: 'Half', quarter: 'Quarter' }[q];
  try { localStorage.setItem('dm.quality', q); } catch { }
}
const nudgeCommit = debounce(() => { app.itemsChanged(false); commit(); }, 400);
function setMode(m) {
  $('#work').className = 'work mode-' + m;
  $$('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.mode === m));
  setTimeout(() => { studio.resize(); studio.frame(); editor.resize(); editor.fit(); }, 30);
}
function switchGarment(id) { applyGarment(id, { reframe: true }).then(() => commit()); }

/* ====================================================================== */
async function boot() {
  bindChrome(); bindInspector(); bind3DDrag(); bindFiles();
  const env = { app, studio, $, $$, toast, busy, withHiResAtlas, rebuildBase, composeAtlas, downloadProject, importProject: () => $('#fileProject').click(), loadDoc, thumbnail, switchGarment, bakeWrapItem: (it, W, H) => bakeWrapLayer(W, H, [it]) };
  initExports(env);
  initHalftone({ app, $, toast, imageSource: (it) => imageSource(it, app.assets, () => app.assetReady()), changed: () => { app.itemsChanged(false); renderDesign(); commit(); } }); initPanels(env);
  let saved = null;
  try { saved = await store.load('autosave'); } catch { }
  if (saved?.doc) loadDoc(saved.doc, saved.assets || {}, saved.fileId || null);
  else { await applyGarment(app.doc.garment, { reframe: true }); studio.updateScene(app.doc.scene); commit(); }
  if (window.innerWidth < 820) setMode('3d');
  document.fonts?.ready.then(() => app.itemsChanged(false));
  document.fonts?.addEventListener?.('loadingdone', () => app.itemsChanged(false));
  updateUndo(); syncChrome();
  let tourDone = false, hintOff = false;
  try { tourDone = !!localStorage.getItem('dm.tourDone'); hintOff = !!localStorage.getItem('dm.hint3d'); } catch { }
  if (!hintOff) { $('#hint3d').hidden = false; $('#gl').addEventListener('pointerdown', () => ($('#hint3d').hidden = true), { once: true }); }
  if (!tourDone && !saved?.doc) setTimeout(startTour, 900);
}
boot();
