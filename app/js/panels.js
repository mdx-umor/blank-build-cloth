// Design Master — side panels and dialogs: Your files, crop, models picker, quick tour.
import * as store from './store.js';
import { GARMENT_LIST, garmentThumbSVG, buildGarment, isModelGarment } from './garments.js';
import { uid, loadImage, clamp } from './util.js';

let E;
export function initPanels(env) { E = env; bindFiles(); bindModels(); bindTour(); }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================================================================ Your files (this browser) */
export async function saveToFiles({ silent = false } = {}) {
  const { app } = E;
  const used = new Set(app.doc.items.flatMap(i => [i.asset, i.vec?.asset]).filter(Boolean));
  const assets = Object.fromEntries(Object.entries(app.assets).filter(([k]) => used.has(k)));
  const id = app.fileId || (app.fileId = uid('f'));
  const prev = await store.getFile(id).catch(() => null);
  await store.putFile({ id, name: app.doc.name || 'Untitled design', garment: app.garment?.name || '', updated: Date.now(), created: prev?.created || Date.now(), thumb: E.thumbnail(), doc: JSON.parse(JSON.stringify(app.doc)), assets });
  if (!silent) E.toast(`Saved: ${app.doc.name} — in Your files`);
}
export async function openFiles() {
  E.$('#filesDlg').hidden = false;
  await renderFiles();
}
async function renderFiles() {
  const grid = E.$('#filesGrid');
  const files = await store.listFiles().catch(() => []);
  if (!files.length) { grid.innerHTML = `<div class="empty">No saved designs yet. Press Save (Ctrl+S) to keep the one you are working on.</div>`; return; }
  grid.innerHTML = files.map(f => `<div class="fcard ${f.id === E.app.fileId ? 'cur' : ''}" data-id="${f.id}">
    <img src="${f.thumb || ''}" alt="" data-fact="open">
    <div class="fmeta"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${esc(f.garment)} · ${new Date(f.updated).toLocaleString()}</small></div>
    <div class="facts"><button data-fact="open">Open</button><button data-fact="rename">Rename</button><button data-fact="dup">Copy</button><button data-fact="dl">Download</button><button data-fact="del">Delete</button></div></div>`).join('');
}
function bindFiles() {
  E.$('#filesGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fact]'); if (!b) return;
    const id = b.closest('[data-id]').dataset.id, f = await store.getFile(id);
    if (!f) return;
    switch (b.dataset.fact) {
      case 'open': E.loadDoc(f.doc, f.assets || {}, id); E.$('#filesDlg').hidden = true; E.toast(`Opened “${f.name}”.`); break;
      case 'rename': { const n = prompt('New name', f.name); if (n && n.trim()) { f.name = n.trim(); f.doc.name = f.name; await store.putFile(f); if (id === E.app.fileId) { E.app.doc.name = f.name; E.$('#projName').value = f.name; } renderFiles(); } break; }
      case 'dup': await store.putFile({ ...f, id: uid('f'), name: f.name + ' copy', updated: Date.now() }); renderFiles(); break;
      case 'dl': E.downloadProject(f.doc, f.assets); break;
      case 'del': if (confirm(`Delete “${f.name}” from Your files?`)) { await store.deleteFile(id); if (id === E.app.fileId) E.app.fileId = null; renderFiles(); } break;
    }
  });
  E.$('#filesImport').onclick = () => E.$('#fileProject').click();
}

/* ================================================================ models picker */
let mFilter = 'All', mView = 'grid';
export function toggleModels(force) {
  const p = E.$('#modelsPanel'), open = force ?? p.hidden;
  p.hidden = !open;
  if (open) { renderModels(); E.$('#modelSearch').focus(); }
}
function renderModels() {
  const groups = ['All', ...new Set(GARMENT_LIST.map(g => g.group))];
  E.$('#modelChips').innerHTML = groups.map(g => `<button class="chip ${g === mFilter ? 'on' : ''}" data-mg="${esc(g)}">${esc(g)}</button>`).join('');
  const q = E.$('#modelSearch').value.trim().toLowerCase();
  const list = GARMENT_LIST.filter(g => (mFilter === 'All' || g.group === mFilter) && (!q || `${g.name} ${g.cut} ${g.group}`.toLowerCase().includes(q)));
  E.$('#modelCount').textContent = GARMENT_LIST.length;
  const grid = E.$('#modelGrid');
  grid.classList.toggle('list', mView === 'list');
  grid.innerHTML = list.map(g => {
    const built = g.model || isModelGarment(g.id) ? g : buildGarment(g.id);
    return `<button class="gcard ${g.id === E.app.doc.garment ? 'on' : ''}" data-g="${g.id}" title="${esc(g.name)} — ${esc(g.cut)}"><span class="gimg">${garmentThumbSVG(built, '#ffffff')}</span><span><b>${esc(g.name)}</b><br><small>${esc(g.cut)}</small></span></button>`;
  }).join('') || `<div class="empty">No models match “${esc(q)}”.</div>`;
}
function bindModels() {
  E.$('#garmentBtn').onclick = (e) => { e.stopPropagation(); toggleModels(); };
  E.$('#modelSearch').addEventListener('input', renderModels);
  E.$('#modelChips').onclick = (e) => { const b = e.target.closest('[data-mg]'); if (!b) return; mFilter = b.dataset.mg; renderModels(); };
  E.$('#modelsPanel').addEventListener('click', (e) => {
    e.stopPropagation();
    const v = e.target.closest('[data-mview]'); if (v) { mView = v.dataset.mview; v.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === v)); renderModels(); return; }
    const b = e.target.closest('[data-g]'); if (!b) return;
    if (b.dataset.g !== E.app.doc.garment) E.switchGarment(b.dataset.g);
    toggleModels(false);
  });
  document.addEventListener('click', (e) => { if (!E.$('#modelsPanel').hidden && !e.target.closest('#modelsPanel, #garmentBtn')) toggleModels(false); });
}

/* ================================================================ quick tour */
const TOUR = [
  { el: '[data-tab="design"]', alt: '#tabDesign .add-grid', title: 'Add your artwork', text: 'Upload an image or type text. It lands on the pattern, ready to place. Tip: copy a picture anywhere and paste it here with Ctrl+V.' },
  { el: '#patternPane', title: 'Place it on the pattern', text: 'Drag, scale and rotate your design right on the cut pieces. Outside or inside: print anywhere, even on the label.' },
  { el: '#viewPane', title: 'Check it in 3D', text: 'Drag to turn the garment, scroll to zoom. Every change shows up live — and you can drag prints right on the 3D garment.' },
  { el: '#qualityBtn', title: 'Adjust the 3D quality', text: 'Adaptive keeps the 3D smooth on any computer: lighter while it turns, sharp as soon as it stops. You can also pick Full, Half or Quarter. Renders and exports are always full quality.' },
  { el: '#garmentBtn', title: 'Switch the model', text: 'T-shirts, long sleeves, hoodies, sweatshirts, totes and real 3D models. Your design comes along.' },
  { el: '.split-btn', title: 'Export your work', text: 'Download 3D snapshots, photoreal studio renders, print files, sublimation panels, a spec sheet of your design and turntable videos.' },
];
let tourI = 0, ring = null;
export function startTour() { tourI = 0; E.$('#tour').hidden = false; showTour(); }
function endTour() { E.$('#tour').hidden = true; ring?.remove(); ring = null; try { localStorage.setItem('dm.tourDone', '1'); } catch { } }
function showTour() {
  const s = TOUR[tourI];
  E.$('#tourStep').textContent = `${tourI + 1} of ${TOUR.length}`;
  E.$('#tourTitle').textContent = s.title; E.$('#tourText').textContent = s.text;
  E.$('#tourDots').innerHTML = TOUR.map((_, i) => `<i class="${i === tourI ? 'on' : ''}"></i>`).join('');
  E.$('#tourBack').disabled = tourI === 0;
  E.$('#tourNext').textContent = tourI === TOUR.length - 1 ? 'Done' : 'Next';
  const el = document.querySelector(s.el);
  if (!ring) { ring = document.createElement('div'); ring.className = 'tour-ring'; document.body.appendChild(ring); }
  const card = E.$('.tour-card');
  if (el && el.offsetParent) {
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px', display: 'block' });
    // put the card beside the target, inside the window
    let x = r.right + 14, y = r.top;
    if (x + 330 > innerWidth) x = r.left - 334;
    if (x < 8) { x = clamp(r.left, 8, innerWidth - 330); y = r.bottom + 12; }
    y = clamp(y, 8, innerHeight - 220);
    Object.assign(card.style, { left: x + 'px', top: y + 'px' });
  } else { ring.style.display = 'none'; Object.assign(card.style, { left: (innerWidth - 320) / 2 + 'px', top: '30%' }); }
}
function bindTour() {
  E.$('#tourNext').onclick = () => { if (tourI === TOUR.length - 1) endTour(); else { tourI++; showTour(); } };
  E.$('#tourBack').onclick = () => { if (tourI > 0) { tourI--; showTour(); } };
  E.$('#tourSkip').onclick = endTour;
  E.$('#tourDots').onclick = (e) => { const i = [...E.$('#tourDots').children].indexOf(e.target); if (i >= 0) { tourI = i; showTour(); } };
  window.addEventListener('resize', () => { if (!E.$('#tour').hidden) showTour(); });
  window.addEventListener('keydown', (e) => { if (!E.$('#tour').hidden && e.key === 'Escape') endTour(); });
}
