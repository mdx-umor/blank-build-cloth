// Design Master — everything that leaves the studio: renders, snapshots, print files, spec sheet,
// sublimation panels, turntable video, mockup sheets, colourways, pattern, project files.
import { FABRICS, WASHES, SWATCHES } from './fabric.js';
import { drawFabric, drawItem, piecePath, itemCorners, itemHeight, gradientStops, itemRaster } from './atlas.js';
import { printSvg, printPdf, isVectorPdf, needsRaster, itemSvg } from './vector.js';
import { clamp, download, canvasToBlob, makeCanvas, slug } from './util.js';

let E; // environment: { app, studio, $, $$, toast, busy, withHiResAtlas, rebuildBase, composeAtlas }
export function initExports(env) { E = env; bind(); }

const fname = (s) => `${slug(E.app.doc.name)}-${slug(E.app.garment.name)}${s ? '-' + s : ''}`;
const encode = (cv, fmt = 'png', q = 0.94) => canvasToBlob(cv, fmt === 'png' ? 'image/png' : 'image/' + fmt, q);
const fabricName = () => FABRICS.find(f => f.id === E.app.doc.fabric.type)?.name || '';
const washName = () => WASHES.find(w => w.id === E.app.doc.fabric.wash)?.name || 'None';
const visibleItems = () => E.app.doc.items.filter(i => !i.hidden);

export const RENDER_SIZES = [
  [2000, 2500, '4:5 · catalogue'], [1600, 2000, '4:5'], [3000, 3750, '4:5 · large'], [1200, 1500, '4:5 · web'],
  [2000, 2000, '1:1'], [3000, 3000, '1:1 · large'], [1500, 2000, '3:4'], [2250, 3000, '3:4'],
  [1080, 1920, '9:16 · stories'], [2160, 3840, '9:16 · 4K'], [1920, 1080, '16:9'], [3840, 2160, '16:9 · 4K'], [2000, 1500, '4:3'], [3000, 2250, '4:3 · large'],
];

/* ---------------------------------------------------------------- catalogue render */
let renderAbort = null, renderCanvas = null;
export function openRender() {
  const { $ } = E, sel = $('#rSize');
  if (!sel.options.length) {
    sel.innerHTML = RENDER_SIZES.map(([w, h, n], i) => `<option value="${i}">${w} × ${h} · ${n}</option>`).join('') + '<option value="custom">Custom…</option>';
    sel.addEventListener('change', () => { if (sel.value !== 'custom') { const [w, h] = RENDER_SIZES[+sel.value]; $('#rW').value = w; $('#rH').value = h; } markReco(); });
    $('#rW').value = 2000; $('#rH').value = 2500;
    for (const id of ['rW', 'rH']) $('#' + id).addEventListener('input', () => { sel.value = 'custom'; markReco(); });
    $('#rQuality').addEventListener('change', markReco);
    $('#rReco').onclick = () => { sel.value = '0'; $('#rW').value = 2000; $('#rH').value = 2500; $('#rQuality').value = '32'; markReco(); };
  }
  markReco();
  $('#renderDlg').hidden = false;
  showPreview();
}
/* frame preview: a quick one-pass picture of exactly what will be rendered; drag to turn, scroll to zoom */
let prevBusy = false, prevAgain = false;
function showPreview() {
  const { $ } = E;
  $('#renderImg').hidden = true; $('#rPrevCv').hidden = false; $('#rPrevCap').textContent = 'Frame preview · drag to turn it, scroll to zoom';
  drawPreview();
}
async function drawPreview() {
  const { $, studio } = E;
  if (renderAbort || $('#renderDlg').hidden) return;
  if (prevBusy) { prevAgain = true; return; }
  prevBusy = true;
  try {
    const W = clamp(parseInt($('#rW').value) || 2000, 256, 8192), H = clamp(parseInt($('#rH').value) || 2500, 256, 8192);
    const k = 520 / Math.max(W, H), pw = Math.round(W * k), ph = Math.round(H * k);
    const shot = await studio.renderImage({ width: pw, height: ph, passes: 1, transparent: $('#rTransparent').checked, keepShadow: $('#rKeepShadow').checked, view: $('#rView').value || null });
    const cv = $('#rPrevCv'); cv.width = pw; cv.height = ph;
    const c = cv.getContext('2d'); c.clearRect(0, 0, pw, ph); c.drawImage(shot, 0, 0);
  } catch (e) { console.warn('preview', e); }
  finally { prevBusy = false; if (prevAgain) { prevAgain = false; requestAnimationFrame(drawPreview); } }
}
function bindPreview() {
  const { $, studio } = E, stage = $('#rStage');
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { if (renderAbort) return; drag = { x: e.clientX }; stage.setPointerCapture(e.pointerId); stage.classList.add('drag'); if (!$('#renderImg').hidden) showPreview(); });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x; drag.x = e.clientX;
    if ($('#rView').value) { studio.viewYaw = { front: 0, back: Math.PI, side: Math.PI / 2, three: -Math.PI / 5 }[$('#rView').value]; $('#rView').value = ''; }
    studio.viewYaw += dx * 0.012; studio.targetYaw = studio.viewYaw; studio.turntable.rotation.y = studio.viewYaw; studio.dirty = true;
    drawPreview();
  });
  const end = () => { drag = null; stage.classList.remove('drag'); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault(); if (renderAbort) return;
    const t = studio.controls.target, p = studio.camera.position;
    const d = clamp(p.distanceTo(t) * Math.exp(e.deltaY * 0.0012), studio.controls.minDistance || 20, studio.controls.maxDistance || 2000);
    p.sub(t).setLength(d).add(t); studio.controls.update(); studio.dirty = true;
    if (!$('#renderImg').hidden) showPreview(); else drawPreview();
  }, { passive: false });
  $('.rp-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rv]'); if (!b || renderAbort) return;
    if (b.dataset.rv === 'reset') { $('#rView').value = ''; studio.viewYaw = studio.targetYaw = 0; studio.turntable.rotation.y = 0; studio.frame(); }
    else $('#rView').value = b.dataset.rv;
    showPreview();
  });
  for (const id of ['#rView', '#rSize', '#rTransparent', '#rKeepShadow']) $(id).addEventListener('change', showPreview);
  for (const id of ['#rW', '#rH']) $(id).addEventListener('change', showPreview);
}
function markReco() {
  const { $ } = E;
  const on = +$('#rW').value === 2000 && +$('#rH').value === 2500 && $('#rQuality').value === '32';
  $('#rReco').classList.toggle('on', on);
  $('#rReco').querySelector('small').textContent = `2000 × 2500 · Good${on ? ' · selected' : ''}`;
}
async function doRender() {
  const { $, studio, withHiResAtlas } = E;
  if (renderAbort) { renderAbort.abort(); return; }
  const W = clamp(parseInt($('#rW').value) || 2000, 256, 8192), H = clamp(parseInt($('#rH').value) || 2500, 256, 8192);
  const passes = +$('#rQuality').value, transparent = $('#rTransparent').checked;
  renderAbort = new AbortController();
  $('#rStart').textContent = 'Stop';
  for (const b of ['#rSavePng', '#rSaveWebp', '#rSaveJpg']) $(b).disabled = true;
  $('#rStatus').textContent = 'Preparing the scene…';
  const t0 = performance.now();
  try {
    renderCanvas = await withHiResAtlas(() => studio.renderImage({
      width: W, height: H, passes, transparent, keepShadow: $('#rKeepShadow').checked, view: $('#rView').value || null, signal: renderAbort.signal,
      onProgress: (n, t) => { $('#rBar').style.width = (n / t * 100) + '%'; $('#rStatus').textContent = `Pass ${n} of ${t} · ${((performance.now() - t0) / 1000).toFixed(1)} s`; },
    }));
    $('#renderImg').src = renderCanvas.toDataURL('image/png'); $('#renderImg').hidden = false; $('#rPrevCv').hidden = true;
    $('#rPrevCap').textContent = 'Your render · drag or scroll to go back to the frame preview';
    $('#rStatus').textContent = renderAbort.signal.aborted ? 'Stopped early. You can save it as is.' : `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s. Ready to save.`;
    for (const b of ['#rSavePng', '#rSaveWebp', '#rSaveJpg']) $(b).disabled = false;
  } catch (err) { console.error(err); $('#rStatus').textContent = 'The render could not start: ' + err.message; }
  finally { renderAbort = null; $('#rStart').textContent = 'Start render'; }
}
async function saveRender(f) {
  if (!renderCanvas) return;
  const { $ } = E;
  let cv = renderCanvas;
  if (f === 'jpeg') { cv = makeCanvas(renderCanvas.width, renderCanvas.height); const c = cv.getContext('2d'); c.fillStyle = E.app.doc.scene.bgColor; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(renderCanvas, 0, 0); }
  if (f === 'webp') $('#rStatus').textContent = 'Saving WebP…';
  download(await encode(cv, f, f === 'webp' ? 0.9 : 0.94), `${fname($('#rView').value || 'render')}.${f === 'jpeg' ? 'jpg' : f}`);
  if (f === 'webp') $('#rStatus').textContent = 'Saved.';
}

/* ---------------------------------------------------------------- 3D snapshot */
export function snapshot3D() {
  const { studio } = E;
  studio.renderer.render(studio.scene, studio.camera);
  download(studio.renderer.domElement.toDataURL('image/png'), fname('3d-snapshot') + '.png');
  E.toast('3D snapshot saved.');
}

/* ---------------------------------------------------------------- mockup sheet / views / colourways */
async function exportSheet() {
  const { studio, withHiResAtlas, busy, app } = E;
  await busy('Rendering the mockup sheet…', async (say) => {
    const views = app.garment.tote ? ['front', 'back'] : ['front', 'back', 'side'];
    const shots = [];
    await withHiResAtlas(async () => { for (const v of views) { say(`Rendering ${v}…`); shots.push(await studio.renderImage({ width: 1200, height: 1500, passes: 24, view: v })); } });
    const pad = 60, W = shots.length * 1200 + (shots.length + 1) * pad, H = 1500 + pad * 2 + 90;
    const cv = makeCanvas(W, H), c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    shots.forEach((s, i) => c.drawImage(s, pad + i * (1200 + pad), pad));
    c.fillStyle = '#1f2330'; c.font = '700 34px Inter, sans-serif'; c.fillText(app.doc.name, pad, H - 48);
    c.fillStyle = '#6a7080'; c.font = '500 24px Inter, sans-serif'; c.fillText(`${app.garment.name} · ${fabricName()} · ${app.doc.fabric.color.toUpperCase()}`, pad, H - 16);
    c.textAlign = 'right'; c.fillText('Design Master', W - pad, H - 16);
    download(await encode(cv), fname('mockup-sheet') + '.png');
  });
}
async function exportViews() {
  const { studio, withHiResAtlas, busy, app } = E;
  await busy('Rendering all views…', async (say) => {
    const zip = new window.JSZip();
    const views = app.garment.tote ? ['front', 'back', 'three'] : ['front', 'back', 'side', 'three'];
    await withHiResAtlas(async () => { for (const v of views) { say(`Rendering ${v}…`); const cv = await studio.renderImage({ width: 1600, height: 2000, passes: 32, view: v }); zip.file(`${fname(v === 'three' ? 'three-quarter' : v)}.png`, await encode(cv)); } });
    say('Zipping…');
    download(await zip.generateAsync({ type: 'blob' }), fname('views') + '.zip');
  });
}
function openColorways() {
  const { $ } = E, el = $('#cwSwatches');
  const chosen = new Set([E.app.doc.fabric.color, '#22252a', '#9ea3a8', '#1d2d4d'].map(c => c.toLowerCase()));
  el.innerHTML = SWATCHES.map(c => `<button style="background:${c}" data-c="${c}" class="${chosen.has(c) ? 'on' : ''}" title="${c}"></button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('button'); if (b) b.classList.toggle('on'); };
  $('#cwStatus').textContent = ''; $('#cwBar').style.width = '0';
  $('#cwDlg').hidden = false;
}
async function doColorways() {
  const { $, $$, app, studio, withHiResAtlas, rebuildBase } = E;
  const cols = $$('#cwSwatches button.on').map(b => b.dataset.c);
  if (!cols.length) return E.toast('Pick at least one colour.');
  const [W, H] = $('#cwSize').value.split('x').map(Number), passes = +$('#cwQuality').value;
  const zip = new window.JSZip(), orig = app.doc.fabric.color;
  $('#cwStart').disabled = true;
  try {
    for (let i = 0; i < cols.length; i++) {
      $('#cwStatus').textContent = `Rendering ${cols[i].toUpperCase()} (${i + 1} of ${cols.length})…`;
      app.doc.fabric.color = cols[i]; rebuildBase(); studio.updateFabric(app.doc.fabric);
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

/* ---------------------------------------------------------------- shared print helpers */
const LOW_DPI = 150;   // below this a picture is listed as "will print blurry"
const SHARP_DPI = 300; // what a sharp print needs
// pieces that carry visible artwork, per face
function printedPieces() {
  const g = E.app.garment, out = [];
  for (const face of ['out', 'in']) for (const p of g.pieces) {
    const items = visibleItems().filter(i => i.piece === p.id && (i.face || 'out') === face && !(face === 'out' && i.wrap));
    if (items.length) out.push({ p, face, items });
  }
  return out;
}
const pieceTitle = (p, face) => face === 'in' && !p.insideOnly ? `${p.label} · inside` : p.label;
const whereName = (p, face) => face === 'in' && !p.insideOnly ? `${p.label} (inside of the garment)` : p.label;
// draw a piece's artwork (as seen from that face) into ctx already in piece-local cm
function drawPieceArt(c, p, items, face, k) {
  c.save(); piecePath(c, mirrorPiece(p, face)); c.clip();
  for (const it of items) drawItem(c, it, E.app.assets, null, k);
  c.restore();
}
// inside prints are stored as seen from inside: show/print the piece mirrored the same way
function mirrorPiece(p, face) {
  if (face !== 'in' || p.noMirror) return p;
  return { ...p, poly: p.poly.map(([x, y]) => [p.w - x, y]), holes: (p.holes || []).map(h => h.map(([x, y]) => [p.w - x, y])) };
}
const itemName = (it) => it.type === 'text' ? `“${(it.text || '').replace(/\n/g, ' ').slice(0, 40)}”` : it.type === 'shape' ? (it.name || it.shape) : (it.name || 'image');
const U = () => E.app.unit();
const L = (cm) => `${E.app.fmtLen(cm)} ${U()}`;
const pieceTop = (p) => Math.min(...p.poly.map(q => q[1]));
/** print resolution of a picture at its printed size (× k for a different shirt size), or null for vectors */
function pictureDpi(it, k = 1) {
  if (it.type !== 'image' || (it.vec && !it.halftone)) return null;
  const pw = (it.px?.[0] || 0) * (it.crop?.w || 1);
  return pw ? Math.round(pw / (it.w * k / 2.54)) : null;
}
function lowPictures(k, outsideOnly) {
  const out = [];
  for (const { p, face, items } of printedPieces()) {
    if (outsideOnly && face === 'in') continue;
    for (const it of items) { const dpi = pictureDpi(it, k); if (dpi != null && dpi < LOW_DPI) out.push({ where: whereName(p, face), dpi, w: it.w * k, h: itemHeight(it, E.app.assets) * k }); }
  }
  for (const it of visibleItems().filter(i => i.wrap && (i.face || 'out') === 'out')) {
    const dpi = pictureDpi(it, k), p = E.app.garment.pieces.find(q => q.id === it.piece);
    if (dpi != null && dpi < LOW_DPI && p) out.push({ where: p.label, dpi, w: it.w * k, h: itemHeight(it, E.app.assets) * k });
  }
  return out;
}
const runsPastEdge = (it, p, face) => { const mp = mirrorPiece(p, face); return itemCorners(it, E.app.assets).some(([x, y]) => !pointInPoly(x, y, mp.poly)); };
function pointInPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
// front width of the model (the measure "My shirt is a different size" compares against)
function modelFrontWidth() {
  const ps = E.app.garment.pieces;
  const f = ps.find(p => p.id === 'front') || ps.find(p => /^front/i.test(p.id));
  if (!f) return ps[0]?.w || 50;
  if (f.id !== 'front') { const halves = ps.filter(p => /^front/i.test(p.id)); if (halves.length === 2) return halves[0].w + halves[1].w - 2; }
  return f.w;
}

/* ---------------------------------------------------------------- export options dialog (print files, spec sheet, sublimation) */
const XOPTS_KEY = 'dm.exportOptions';
const xopts = (() => { try { return { fmt: 'orig', bleed: 10, cut: false, mirror: false, sizeOn: false, ...JSON.parse(localStorage.getItem(XOPTS_KEY) || '{}') }; } catch { return { fmt: 'orig', bleed: 10, cut: false, mirror: false, sizeOn: false }; } })();
const saveOpts = () => { try { localStorage.setItem(XOPTS_KEY, JSON.stringify(xopts)); } catch { /* private window */ } };
let xKind = null;
function openExportDlg(kind) {
  const { $, app } = E;
  if (kind !== 'subl' && !visibleItems().length) return E.toast('Nothing to export yet: add a picture or text to the garment first.', 4000);
  xKind = kind;
  const title = { print: 'Print files (ZIP)', spec: 'Spec sheet (PDF)', subl: 'Sublimation panels (ZIP)' }[kind];
  const sub = { print: 'Each pattern piece as a layered SVG and a PNG, named as on the pattern, plus each print separately and the spec sheet, for a print shop', spec: 'Print sizes and positions, for sewing and production', subl: 'Each pattern piece as one full file with bleed, for sublimation and all-over print' }[kind];
  const m = modelFrontWidth();
  if (!xopts.sizeCm) xopts.sizeCm = m;
  let html = `<div class="dlg-head"><b>${title}</b><button class="ib" data-close title="Close">✕</button></div><p class="dlg-note">${sub}</p>
    <label class="chk"><input type="checkbox" id="xSizeOn" ${xopts.sizeOn ? 'checked' : ''}> My shirt is a different size</label>
    <div id="xSizeBox" class="xsize" ${xopts.sizeOn ? '' : 'hidden'}>
      <label class="fld">Front width of your shirt<span class="num-u"><input type="number" id="xSizeW" step="0.1" value="${app.fmtLen(xopts.sizeCm)}" aria-label="Front width of your shirt"><span>${U()}</span></span></label>
      <p class="dlg-note">Lay your shirt flat and measure straight across the front at its widest point. Prints and their positions are scaled to match. This model: ${L(m)}.</p>
      <p class="xerr" id="xSizeErr" hidden></p>
    </div>`;
  if (kind === 'print') html += `<div class="fld" style="margin-top:12px">Files</div>
    <div class="seg" id="xFmt"><button data-v="orig" class="${xopts.fmt === 'orig' ? 'on' : ''}">Original</button><button data-v="png" class="${xopts.fmt === 'png' ? 'on' : ''}">PNG only</button></div>
    <p class="dlg-note" id="xFmtHint"></p>`;
  if (kind === 'subl') html += `<div class="fld" style="margin-top:12px">Bleed</div>
    <div class="seg" id="xBleed">${[5, 10, 15].map(v => `<button data-v="${v}" class="${xopts.bleed === v ? 'on' : ''}">${v} mm</button>`).join('')}</div>
    <label class="chk"><input type="checkbox" id="xCut" ${xopts.cut ? 'checked' : ''}> Dashed cut line on the panels</label>
    <label class="chk"><input type="checkbox" id="xMirror" ${xopts.mirror ? 'checked' : ''}> Mirror for transfer printing (sublimation, DTF, heat transfer)</label>
    <p class="dlg-note" id="xAuto"></p>`;
  html += `<div id="xLow"></div><div class="render-status" id="xStatus"></div>
    <div class="row2"><button class="btn" data-close>Cancel</button><button class="btn primary" id="xGo">${kind === 'spec' ? 'Download PDF' : 'Download ZIP'}</button></div>`;
  $('#xDlgBox').innerHTML = html;
  $('#xDlg').hidden = false;
  refreshExportDlg();
}
function sizeFactor(showErr = false) {
  const { $, app } = E, m = modelFrontWidth();
  if (!$('#xSizeOn')?.checked) return 1;
  const cm = app.toCm(parseFloat($('#xSizeW').value));
  const a = Math.round(m * 0.5), b = Math.round(m * 1.6);
  const bad = !(cm >= a && cm <= b);
  const err = $('#xSizeErr');
  if (err) { err.hidden = !(bad && showErr); err.textContent = `Enter a width between ${L(a)} and ${L(b)}.`; }
  if (bad) return null;
  xopts.sizeCm = cm;
  return cm / m;
}
function refreshExportDlg() {
  const { $ } = E;
  const k = sizeFactor() || 1;
  if ($('#xFmtHint')) $('#xFmtHint').textContent = xopts.fmt === 'png' ? 'Everything as PNG at 300 DPI.' : 'Vector layers as vector (SVG, PDF); builder text and shapes as SVG with outlined letters; pictures as PNG.';
  if ($('#xAuto')) $('#xAuto').textContent = `This browser will make the panels at ${sublDpi(k)} DPI.`;
  const low = lowPictures(k, xKind === 'subl');
  $('#xLow').innerHTML = low.length ? `<div class="xlow"><b>Some pictures will print blurry</b><ul>${low.map(l => `<li>${esc(l.where)} picture: <em>${l.dpi} DPI</em> at <em>${E.app.fmtLen(l.w)} × ${E.app.fmtLen(l.h)} ${U()}</em>.${xKind === 'subl' ? '' : ' Too low for a sharp print: use a bigger picture or make it smaller.'}</li>`).join('')}</ul>
    <p class="dlg-note">${xKind === 'subl' ? `For a sharp print, upload a larger file (at least ${SHARP_DPI} DPI at its printed size) or make the picture smaller.` : `For a sharp print, a picture needs ${SHARP_DPI} DPI at its printed size.`}</p></div>` : '';
}
function bindExportDlg() {
  const { $ } = E, box = $('#xDlgBox');
  box.addEventListener('change', (e) => {
    if (e.target.id === 'xSizeOn') { xopts.sizeOn = e.target.checked; $('#xSizeBox').hidden = !xopts.sizeOn; }
    if (e.target.id === 'xCut') xopts.cut = e.target.checked;
    if (e.target.id === 'xMirror') xopts.mirror = e.target.checked;
    if (e.target.id === 'xSizeW') sizeFactor(true);
    saveOpts(); refreshExportDlg();
  });
  box.addEventListener('input', (e) => { if (e.target.id === 'xSizeW') { sizeFactor(false); refreshExportDlg(); } });
  box.addEventListener('click', async (e) => {
    const seg = e.target.closest('#xFmt button, #xBleed button');
    if (seg) { const g = seg.parentElement; [...g.children].forEach(x => x.classList.toggle('on', x === seg)); if (g.id === 'xFmt') xopts.fmt = seg.dataset.v; else xopts.bleed = +seg.dataset.v; saveOpts(); refreshExportDlg(); return; }
    if (e.target.id !== 'xGo') return;
    const k = sizeFactor(true); if (k == null) return;
    saveOpts();
    const go = e.target; go.disabled = true;
    try {
      if (xKind === 'print') await exportPrintFiles({ k, fmt: xopts.fmt });
      if (xKind === 'spec') await exportSpec({ k });
      if (xKind === 'subl') await exportSublimation({ k, bleed: xopts.bleed / 10, cut: xopts.cut, mirror: xopts.mirror });
      $('#xDlg').hidden = true;
    } catch (err) { console.error(err); $('#xStatus').textContent = 'Could not make the files. Please try again.'; }
    finally { go.disabled = false; }
  });
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const scaledNote = (k) => k !== 1 ? `Scaled for a ${L(modelFrontWidth() * k)} wide front (model: ${L(modelFrontWidth())})` : '';

/* ---------------------------------------------------------------- spec sheet (PDF) */
const centreText = (cx) => Math.abs(cx) < 0.05 ? 'centred' : `${L(Math.abs(cx))} to the ${cx < 0 ? 'left' : 'right'}`;
async function buildSpecPdf(say = () => {}, k = 1) {
  const { app, studio, withHiResAtlas } = E;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;
  const g = app.garment, f = app.doc.fabric;
  say('Rendering the views…');
  const shots = [];
  await withHiResAtlas(async () => { for (const v of ['front', 'back']) shots.push(await studio.renderImage({ width: 800, height: 1000, passes: 6, view: v })); });
  const head = (title, more = false) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(20); pdf.text(title + (more ? ' (continued)' : ''), M, 18);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(110); pdf.text(`${app.doc.name || 'Untitled design'} · ${g.name}`, W - M, 18, { align: 'right' });
  };
  // page 1: the garment
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.setTextColor(20); pdf.text('Spec sheet', M, 22);
  const colour = f.mode === 'solid' ? f.color.toUpperCase() : gradientStops(f).map(s => s.c.toUpperCase()).join(' → ');
  const info = [['Project', app.doc.name || 'Untitled design'], ['Garment', `${g.name} — ${g.cut}`], ['Colour', `${colour} · ${fabricName()}${f.wash && f.wash !== 'none' ? ' · ' + washName() : ''}`], ['Date', new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })], ['Units', { cm: 'centimetres', mm: 'millimetres', in: 'inches' }[U()]]];
  if (k !== 1) info.push(['Size', scaledNote(k)]);
  let y = 34;
  pdf.setFontSize(10);
  for (const [a, v] of info) { pdf.setTextColor(110); pdf.text(a, M, y); pdf.setTextColor(20); pdf.text(String(v), M + 28, y); y += 6.2; }
  pdf.setFillColor(f.color); pdf.rect(W - M - 18, 28, 18, 18, 'F'); pdf.setDrawColor(200); pdf.rect(W - M - 18, 28, 18, 18);
  const iw = (W - 2 * M - 8) / 2, ih = iw * 1.25;
  shots.forEach((s, i) => pdf.addImage(s.toDataURL('image/jpeg', 0.88), 'JPEG', M + i * (iw + 8), y + 2, iw, ih));
  pdf.setFontSize(8); pdf.setTextColor(120); pdf.text('Front', M, y + ih + 6); pdf.text('Back', M + iw + 8, y + ih + 6);
  // one page per printed piece: drawing at scale with numbered prints, then the table
  const pieces = printedPieces();
  const wrapItems = visibleItems().filter(i => i.wrap && (i.face || 'out') === 'out');
  for (const it of wrapItems) { const p = g.pieces.find(q => q.id === it.piece); if (p && !pieces.some(x => x.p === p && x.face === 'out')) pieces.push({ p, face: 'out', items: [] }); }
  for (const { p, face, items: own } of pieces) {
    const items = face === 'out' ? [...own, ...wrapItems.filter(i => i.piece === p.id)] : own;
    if (!items.length) continue;
    say(`Drawing ${p.label}…`);
    pdf.addPage(); head(pieceTitle(p, face));
    pdf.setFontSize(9); pdf.setTextColor(110);
    const boxW = W - 2 * M, boxH = 150, s = Math.min(boxW / (p.w * k), boxH / (p.h * k));
    pdf.text(`${L(p.w * k)} × ${L(p.h * k)} · cut 1 · scale 1:${Math.max(1, Math.round(10 / s))}`, M, 25);
    const kk = Math.min(30, 1600 / Math.max(p.w, p.h));
    const cv = makeCanvas(p.w * kk + 2, p.h * kk + 2), c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(kk, 0, 0, kk, 1, 1);
    const mp = mirrorPiece(p, face);
    piecePath(c, mp); c.fillStyle = face === 'in' ? '#e9e9e9' : (f.pieceColors?.[p.id] || f.color); c.fill();
    drawPieceArt(c, p, items, face, kk);
    piecePath(c, mp); c.lineWidth = 2 / kk; c.strokeStyle = '#555'; c.stroke();
    const S = s * k, ox = M + (boxW - p.w * S) / 2, oy = 31, top = pieceTop(mp);
    pdf.addImage(cv.toDataURL('image/jpeg', 0.86), 'JPEG', ox, oy, p.w * S, p.h * S);
    pdf.setDrawColor(180); pdf.setLineDashPattern([1, 1], 0); pdf.line(ox + p.w * S / 2, oy - 2, ox + p.w * S / 2, oy + p.h * S + 2); pdf.setLineDashPattern([], 0);
    items.forEach((it, i) => {
      const cs = itemCorners(it, E.app.assets);
      const bx0 = Math.min(...cs.map(q => q[0])), by0 = Math.min(...cs.map(q => q[1])), bx1 = Math.max(...cs.map(q => q[0])), by1 = Math.max(...cs.map(q => q[1]));
      pdf.setDrawColor(91, 91, 214); pdf.setLineWidth(0.3); pdf.rect(ox + bx0 * S, oy + by0 * S, (bx1 - bx0) * S, (by1 - by0) * S);
      pdf.setFontSize(8); pdf.setTextColor(91, 91, 214); pdf.text(String(i + 1), ox + bx0 * S + 1, oy + by0 * S - 1);
      pdf.line(ox + (bx0 + bx1) / 2 * S, oy + top * S, ox + (bx0 + bx1) / 2 * S, oy + by0 * S);
    });
    // table
    let ty = oy + p.h * S + 10;
    const cols = [['#', 7], ['', 16], ['Print', 46], ['Size', 32], ['From top', 22], ['Centre line', 32], ['Quality', 27]];
    const row = (vals, bold) => { let x = M; pdf.setFont('helvetica', bold ? 'bold' : 'normal'); vals.forEach((v, j) => { pdf.text(pdf.splitTextToSize(String(v), cols[j][1] - 1.5)[0] || '', x, ty); x += cols[j][1]; }); ty += 6; };
    pdf.setFontSize(8.5); pdf.setTextColor(20);
    row(cols.map(c => c[0]), true);
    items.forEach((it, i) => {
      if (ty > 270) { pdf.addPage(); head(pieceTitle(p, face), true); ty = 30; pdf.setFontSize(8.5); pdf.setTextColor(20); row(cols.map(c => c[0]), true); }
      const h = itemHeight(it, E.app.assets), cs = itemCorners(it, E.app.assets);
      const dpi = pictureDpi(it, k);
      row([i + 1, it.type === 'text' ? 'Text' : 'Picture', itemName(it) + (it.rot ? ` · turned ${Math.round(it.rot)}°` : '') + (it.wrap ? ' · wraps over seams' : ''), `${E.app.fmtLen(it.w * k)} × ${E.app.fmtLen(h * k)} ${U()}`, L((Math.min(...cs.map(q => q[1])) - top) * k), centreText((it.x - p.w / 2) * k), dpi == null ? 'vector' : `${dpi} DPI${dpi < LOW_DPI ? ' (low)' : ''}`]);
    });
    pdf.setFontSize(7.5); pdf.setTextColor(120);
    pdf.text(pdf.splitTextToSize('From top: from the highest point of the piece to the top of the print. Centre line: from the piece’s vertical centre line to the middle of the print, looking at the printed side.' + (k !== 1 ? ' ' + scaledNote(k) + '.' : ''), W - 2 * M), M, Math.min(ty + 4, 285));
  }
  // page numbers
  const N = pdf.getNumberOfPages();
  for (let i = 1; i <= N; i++) { pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(140); pdf.text(`page ${i} of ${N}`, W - M, 292, { align: 'right' }); pdf.text('Design Master', M, 292); }
  return pdf;
}
async function exportSpec({ k = 1 } = {}) {
  if (!window.jspdf) return E.toast('The PDF tool did not load. Check your connection and reload.');
  await E.busy('Preparing the files…', async (say) => {
    const pdf = await buildSpecPdf(say, k);
    download(pdf.output('blob'), fname('spec-sheet') + '.pdf');
  });
}

/* ---------------------------------------------------------------- print files (ZIP) */
// one print alone, unturned, at its printed size (× k), as PNG at `dpi`
async function printPng(it, k, dpi = SHARP_DPI) {
  const h = itemHeight(it, E.app.assets), ppc = dpi / 2.54 * k;
  const s = Math.min(ppc, 12000 / Math.max(it.w, h));
  const r = itemRaster(it, E.app.assets, s, null, 12000);
  const cv = makeCanvas(r.width, r.height), c = cv.getContext('2d');
  c.globalAlpha = it.opacity ?? 1;
  if (it.flip) { c.translate(cv.width, 0); c.scale(-1, 1); }
  c.drawImage(r, 0, 0);
  return encode(cv);
}
// a piece as a layered SVG at real size: Artwork (vector where it can be), Wrapped prints, Cut line, Markings
async function pieceSvg(p, face, items, k, wrapPng) {
  const mp = mirrorPiece(p, face);
  const path = (pl) => 'M' + pl.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';
  let art = '';
  for (const it of items) art += (await itemSvg(it, E.app.assets)).svg;
  const clip = `pc-${slug(p.id)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${(p.w * k).toFixed(2)}cm" height="${(p.h * k).toFixed(2)}cm" viewBox="0 0 ${p.w.toFixed(3)} ${p.h.toFixed(3)}">
  <title>${esc(pieceTitle(p, face))} — ${esc(E.app.garment.name)}</title>
  <defs><clipPath id="${clip}"><path d="${path(mp.poly)}${(mp.holes || []).map(path).join('')}" clip-rule="evenodd"/></clipPath></defs>
  <g id="artwork" inkscape:groupmode="layer" inkscape:label="Artwork" clip-path="url(#${clip})">${art}</g>
  ${wrapPng ? `<g id="wrapped" inkscape:groupmode="layer" inkscape:label="Wrapped prints"><image x="0" y="0" width="${p.w.toFixed(3)}" height="${p.h.toFixed(3)}" preserveAspectRatio="none" href="${wrapPng}"/></g>` : ''}
  <g id="cut-line" inkscape:groupmode="layer" inkscape:label="Cut line" fill="none" stroke="#ff0000" stroke-width="0.05"><path d="${path(mp.poly)}${(mp.holes || []).map(path).join('')}"/></g>
  <g id="markings" inkscape:groupmode="layer" inkscape:label="Markings" fill="none" stroke="#999" stroke-width="0.03" stroke-dasharray="0.4 0.3">${(p.folds || []).map(fl => `<line x1="${fl[0][0]}" y1="${fl[0][1]}" x2="${fl[1][0]}" y2="${fl[1][1]}"/>`).join('')}</g>
</svg>`;
}
// grow coloured pixels outwards by `px` (so a print reaches past the cut line without a white edge)
function dilate(cv, px) {
  const out = makeCanvas(cv.width, cv.height), c = out.getContext('2d');
  c.drawImage(cv, 0, 0);
  const steps = Math.max(1, Math.ceil(px / 2));
  for (let i = 1; i <= steps; i++) {
    const d = (px * i) / steps;
    c.globalCompositeOperation = 'destination-over';
    for (let a = 0; a < 8; a++) c.drawImage(cv, Math.cos(a * Math.PI / 4) * d, Math.sin(a * Math.PI / 4) * d);
  }
  return out;
}
// prints that wrap over seams: one file per piece they reach, cut from the 3D bake, reaching `bleed` past the cut line
async function wrapFiles(it, k, bleedCm) {
  const g = E.app.garment, max = Math.min(E.studio.renderer.capabilities.maxTextureSize, 8192);
  const ppc = Math.min(SHARP_DPI / 2.54, max / Math.max(g.sheet.w, g.sheet.h));
  const layer = E.bakeWrapItem(it, Math.round(g.sheet.w * ppc), Math.round(g.sheet.h * ppc));
  if (!layer) return [];
  const out = [];
  for (const p of g.pieces.filter(q => !q.insideOnly)) {
    const b = bleedCm, W = (p.w + 2 * b) * ppc, H = (p.h + 2 * b) * ppc;
    const cv = makeCanvas(W, H), c = cv.getContext('2d');
    c.setTransform(ppc, 0, 0, ppc, b * ppc, b * ppc);
    c.save(); piecePath(c, p); c.clip(); c.drawImage(layer, -p.sx, -p.sy, g.sheet.w, g.sheet.h); c.restore();
    const d = c.getImageData(0, 0, cv.width, cv.height).data; let any = false;
    for (let i = 3; i < d.length; i += 4 * 64) if (d[i] > 8) { any = true; break; }
    if (!any) continue;
    const grown = dilate(cv, b * ppc), m = grown.getContext('2d');
    // keep only the piece grown by the bleed
    m.globalCompositeOperation = 'destination-in'; m.setTransform(ppc, 0, 0, ppc, b * ppc, b * ppc);
    piecePath(m, p); m.lineWidth = b * 2; m.lineJoin = 'round'; m.strokeStyle = '#000'; m.stroke(); m.fill();
    out.push({ p, png: await encode(grown), dpi: Math.round(ppc * 2.54 / k) });
  }
  return out;
}
async function exportPrintFiles({ k = 1, fmt = 'orig' } = {}) {
  const { app, busy } = E;
  const list = printedPieces(), wraps = visibleItems().filter(i => i.wrap && (i.face || 'out') === 'out');
  if (!list.length && !wraps.length) return E.toast('Nothing to export yet: add a picture or text to the garment first.', 4000);
  await busy('Preparing the files…', async (say) => {
    const zip = new window.JSZip(), lines = [];
    const kind = (it) => it.type === 'text' ? 'Text' : it.type === 'shape' ? 'Shape' : 'Picture';
    for (const { p, face, items } of list) {
      const name = slug(pieceTitle(p, face));
      say(`Preparing ${pieceTitle(p, face)}…`);
      // the piece: PNG (150 DPI with Original files, 300 DPI with PNG only) and, with Original files, a layered SVG
      const dpi = fmt === 'png' ? SHARP_DPI : 150, kp = Math.min(dpi / 2.54 * k, 12000 / Math.max(p.w, p.h));
      const cv = makeCanvas(p.w * kp, p.h * kp), c = cv.getContext('2d');
      c.setTransform(kp, 0, 0, kp, 0, 0); drawPieceArt(c, p, items, face, kp);
      zip.file(`pieces/${name}.png`, await encode(cv));
      const files = [`pieces/${name}.png`];
      if (fmt === 'orig') { zip.file(`pieces/${name}.svg`, await pieceSvg(p, face, items, k)); files.push(`pieces/${name}.svg`); }
      lines.push(`${pieceTitle(p, face)} — ${L(p.w * k)} × ${L(p.h * k)}`, `  ${files.join(', ')}`);
      const top = pieceTop(mirrorPiece(p, face));
      for (const [i, it] of items.entries()) {
        const base = `prints/${name}-${i + 1}-${slug(itemName(it))}`;
        let file;
        if (fmt === 'orig' && isVectorPdf(it)) { file = base + '.pdf'; zip.file(file, await printPdf(it, app.assets, k)); }
        else if (fmt === 'orig' && !needsRaster(it)) { file = base + '.svg'; zip.file(file, (await printSvg(it, app.assets, k, itemName(it))).text); }
        else { file = base + '.png'; zip.file(file, await printPng(it, k)); }
        const h = itemHeight(it, app.assets), cs = itemCorners(it, app.assets), dpiIt = pictureDpi(it, k);
        const notes = [];
        if (it.rot) notes.push(`turned ${Math.round(it.rot)}°`);
        if (runsPastEdge(it, p, face)) notes.push('runs past the edge of the piece: the part outside is left out, as on the garment');
        if (dpiIt != null && dpiIt < LOW_DPI) notes.push(`below ${LOW_DPI} DPI, may print blurry`);
        if (face === 'in' && !p.insideOnly) notes.push('inside of the garment');
        lines.push(`  ${i + 1}. ${kind(it)} ${itemName(it)} — ${E.app.fmtLen(it.w * k)} × ${E.app.fmtLen(h * k)} ${U()}, from top ${L((Math.min(...cs.map(q => q[1])) - top) * k)}, centre line ${centreText((it.x - p.w / 2) * k)}${dpiIt != null ? `, ${dpiIt} DPI` : ''}`, `     Files: ${file}${notes.length ? `\n     ${notes.join('; ')}` : ''}`);
      }
      lines.push('');
    }
    for (const it of wraps) {
      say(`Preparing ${itemName(it)}…`);
      const bleed = (it.wrapBleed ?? 5) / 10;
      const parts = await wrapFiles(it, k, bleed);
      if (!parts.length) continue;
      const files = [];
      for (const part of parts) { const f = `prints/wrap-${slug(itemName(it))}-${slug(part.p.label)}.png`; zip.file(f, part.png); files.push(f); }
      lines.push(`${kind(it)} ${itemName(it)} (wraps over seams)`, `  One print over ${parts.length} pieces: ${parts.map(x => x.p.label).join(', ')}. The parts meet at the green seams. Each file reaches ${L(bleed * k)} past the cut line.`, `  Files: ${files.join(', ')}`, '');
    }
    if (window.jspdf) { say('Adding the spec sheet…'); zip.file('spec-sheet.pdf', (await buildSpecPdf(say, k)).output('arraybuffer')); }
    zip.file('README.txt', [`Print files — ${app.doc.name || 'Untitled design'}`, `${app.garment.name} (${app.garment.cut})`, scaledNote(k), '',
      fmt === 'png' ? 'Files: everything as PNG at 300 DPI.' : 'Files: vector layers as vector (SVG, PDF); builder text and shapes as SVG with outlined letters; pictures as PNG (300 DPI).',
      'pieces/  each pattern piece, named as on the pattern' + (fmt === 'orig' ? ' (PNG at 150 DPI and a layered SVG at real size: Artwork, Cut line, Markings)' : ''),
      'prints/  each print on its own at its printed size, not turned (see "turned" below)', 'spec-sheet.pdf  print sizes and positions', 'Inside pieces are drawn as seen from the inside of the garment.', '', ...lines].filter(l => l !== null).join('\n'));
    say('Zipping…');
    download(await zip.generateAsync({ type: 'blob' }), fname('print-files') + '.zip');
  });
}

/* ---------------------------------------------------------------- sublimation panels (ZIP) */
// the biggest canvas this browser will make (Safari and phones allow far less than desktop Chrome)
let maxArea = 0;
function canvasMaxArea() {
  if (maxArea) return maxArea;
  for (const a of [120e6, 64e6, 32e6, 16.7e6, 8e6]) {
    const s = Math.floor(Math.sqrt(a));
    try { const cv = makeCanvas(s, s), c = cv.getContext('2d'); c.fillRect(s - 1, s - 1, 1, 1); if (c.getImageData(s - 1, s - 1, 1, 1).data[3] === 255) { maxArea = a; break; } } catch { /* smaller */ }
  }
  return (maxArea = maxArea || 4e6);
}
function sublDpi(k = 1, bleedCm = (xopts.bleed || 10) / 10) {
  const ps = E.app.garment.pieces.filter(q => !q.insideOnly);
  const big = Math.max(...ps.map(p => (p.w * k + 2 * bleedCm) * (p.h * k + 2 * bleedCm))) / (2.54 * 2.54); // in²
  const fit = Math.sqrt(canvasMaxArea() / big), side = 16000 / (Math.max(...ps.map(p => Math.max(p.w, p.h))) * k / 2.54);
  return Math.max(72, Math.min(SHARP_DPI, Math.floor(Math.min(fit, side) / 10) * 10));
}
async function exportSublimation({ k = 1, bleed = 1, cut = false, mirror = false } = {}) {
  const { app, busy } = E;
  const g = app.garment, dpi = sublDpi(k, bleed);
  await busy('Preparing the files…', async (say) => {
    const zip = new window.JSZip(), ppcm = dpi / 2.54; // pixels per printed cm
    const kb = Math.min(ppcm * k, 8192 / Math.max(g.sheet.w, g.sheet.h)); // fabric + wrap layer resolution (model cm)
    const base = makeCanvas(g.sheet.w * kb, g.sheet.h * kb), bc = base.getContext('2d');
    bc.setTransform(kb, 0, 0, kb, 0, 0); drawFabric(bc, g, app.doc.fabric, app.overlays, { fillSheet: true });
    let wrap = null; // prints that wrap over seams, baked from 3D, grown past the seams by the bleed
    for (const it of visibleItems().filter(i => i.wrap && (i.face || 'out') === 'out')) { const l = E.bakeWrapItem(it, base.width, base.height); if (l) { wrap = wrap || makeCanvas(base.width, base.height); wrap.getContext('2d').drawImage(l, 0, 0); } }
    if (wrap) wrap = dilate(wrap, bleed * kb);
    const ps = g.pieces.filter(q => !q.insideOnly), lines = [];
    for (const [n, p] of ps.entries()) {
      say(`Preparing panel ${n + 1} of ${ps.length}…`);
      const W = p.w * k + 2 * bleed, H = p.h * k + 2 * bleed; // printed cm
      const cv = makeCanvas(W * ppcm, H * ppcm), c = cv.getContext('2d');
      const s = ppcm * k; // pixels per model cm
      c.setTransform(s, 0, 0, s, bleed * ppcm, bleed * ppcm);
      // the piece grown by the bleed, filled with fabric, prints and wrapped prints
      c.save(); piecePath(c, p); c.lineWidth = bleed * 2 / k; c.lineJoin = 'round'; c.strokeStyle = '#000'; c.stroke(); c.fillStyle = '#000'; c.fill();
      c.globalCompositeOperation = 'source-in';
      c.drawImage(base, -p.sx, -p.sy, g.sheet.w, g.sheet.h);
      c.globalCompositeOperation = 'source-atop';
      for (const it of visibleItems().filter(i => i.piece === p.id && (i.face || 'out') === 'out' && !i.wrap)) drawItem(c, it, app.assets, null, s);
      if (wrap) c.drawImage(wrap, -p.sx, -p.sy, g.sheet.w, g.sheet.h);
      c.restore();
      if (cut) { c.save(); piecePath(c, p); c.lineWidth = 0.6 / s * (dpi / 150); c.setLineDash([0.5 / k, 0.35 / k]); c.strokeStyle = '#000000'; c.stroke(); c.setLineDash([]); c.restore(); }
      let out = cv;
      if (mirror) { out = makeCanvas(cv.width, cv.height); const m = out.getContext('2d'); m.translate(cv.width, 0); m.scale(-1, 1); m.drawImage(cv, 0, 0); }
      zip.file(`${slug(p.label)}.png`, await encode(out));
      const pts = p.poly.map(([x, y]) => [x * k + bleed, y * k + bleed]).map(([x, y]) => [mirror ? W - x : x, y]);
      zip.file(`${slug(p.label)}-cutline.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}cm" height="${H.toFixed(2)}cm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}"><path d="M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z" fill="none" stroke="#ff0000" stroke-width="0.05"/></svg>`);
      lines.push(`${p.label}: ${slug(p.label)}.png (${(W).toFixed(1)} × ${(H).toFixed(1)} cm with bleed) and ${slug(p.label)}-cutline.svg`);
    }
    zip.file('README.txt', [`Sublimation panels — ${app.doc.name || 'Untitled design'}`, g.name, `Sublimation panels: ${Math.round(bleed * 10)} mm bleed, ${dpi} DPI`, mirror ? 'Files are mirrored' : 'Files are not mirrored', scaledNote(k), '', ...lines].filter(Boolean).join('\n') + '\n');
    say('Zipping…');
    download(await zip.generateAsync({ type: 'blob' }), fname('sublimation-panels') + '.zip');
  });
}

/* ---------------------------------------------------------------- sewing pattern PNG */
async function exportPattern() {
  const { app, busy } = E;
  await busy('Exporting the sewing pattern…', async () => {
    const g = app.garment, k = Math.min(150 / 2.54, 12000 / Math.max(g.sheet.w, g.sheet.h));
    const cv = makeCanvas(g.sheet.w * k, g.sheet.h * k), c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    const base = makeCanvas(g.sheet.w * k, g.sheet.h * k), bc = base.getContext('2d');
    bc.setTransform(k, 0, 0, k, 0, 0); drawFabric(bc, g, app.doc.fabric, app.overlays, { fillSheet: true });
    for (const p of g.pieces.filter(q => !q.insideOnly)) {
      c.save(); c.translate(p.sx, p.sy); piecePath(c, p); c.save(); c.clip(); c.drawImage(base, -p.sx, -p.sy, g.sheet.w, g.sheet.h);
      for (const it of app.doc.items) if (it.piece === p.id && (it.face || 'out') === 'out') drawItem(c, it, app.assets, null, k);
      c.restore(); c.lineWidth = 0.1; c.strokeStyle = '#555'; c.stroke();
      c.fillStyle = '#333'; c.font = '600 1.6px Inter, sans-serif'; c.textAlign = 'center'; c.fillText(`${p.label} · ${L(p.w)} × ${L(p.h)}`, p.w / 2, p.h + 2.2);
      c.restore();
    }
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#666'; c.font = `${Math.round(k * 0.9)}px Inter, sans-serif`; c.fillText(`${app.doc.name} · ${g.name} · 150 DPI · 1 cm = ${k.toFixed(1)} px`, k * 2, cv.height - k * 1.5);
    download(await encode(cv), fname('pattern') + '.png');
  });
}

/* ---------------------------------------------------------------- turntable video */
let videoAbort = null, videoBlob = null;
function openVideo() {
  const { $ } = E;
  $('#vStatus').textContent = 'Keep this tab open while it records.'; $('#vBar').style.width = '0';
  $('#vSave').hidden = true; videoBlob = null;
  $('#videoDlg').hidden = false;
}
async function doVideo() {
  const { $, studio, withHiResAtlas } = E;
  if (videoAbort) { videoAbort.abort(); return; }
  const [W, H] = $('#vFormat .on').dataset.f.split('x').map(Number), secs = +$('#vDur .on').dataset.d;
  videoAbort = new AbortController(); videoBlob = null;
  $('#vStart').textContent = 'Stop'; $('#vSave').hidden = true;
  try {
    const res = await withHiResAtlas(() => studio.recordTurntable({ width: W, height: H, seconds: secs, signal: videoAbort.signal, onProgress: (f, t) => { $('#vBar').style.width = (f / t * 100) + '%'; $('#vStatus').textContent = `Recording… ${Math.round(f / t * 100)}%`; } }));
    if (videoAbort.signal.aborted) { $('#vStatus').textContent = 'Stopped.'; $('#vBar').style.width = '0'; return; }
    videoBlob = res; videoBlob.name = fname(`turntable-${W}x${H}`) + '.' + res.format;
    $('#vStatus').textContent = res.format === 'webm'
      ? 'Your video is ready. This browser can only record WebM. It plays in Chrome and most apps; for Instagram, convert it to MP4 or record in Safari.'
      : 'Your video is ready.';
    $('#vSave').hidden = false;
    saveVideo();
  } catch (e) { console.error(e); $('#vStatus').textContent = 'Could not record a video in this browser.'; }
  finally { videoAbort = null; $('#vStart').textContent = 'Start'; }
}
const saveVideo = () => { if (videoBlob) download(videoBlob.blob, videoBlob.name); };

/* ---------------------------------------------------------------- wiring */
export function runExport(act) {
  ({ render: openRender, print: () => openExportDlg('print'), spec: () => openExportDlg('spec'), subl: () => openExportDlg('subl'), video: openVideo, sheet: exportSheet, views: exportViews, colorways: openColorways, pattern: exportPattern, snapshot: snapshot3D, download: E.downloadProject, import: E.importProject })[act]?.();
}
function bind() {
  const { $ } = E;
  $('#rStart').onclick = doRender; bindPreview();
  $('#rSavePng').onclick = () => saveRender('png'); $('#rSaveWebp').onclick = () => saveRender('webp'); $('#rSaveJpg').onclick = () => saveRender('jpeg');
  $('#cwStart').onclick = doColorways; bindExportDlg();
  $('#vStart').onclick = doVideo; $('#vSave').onclick = saveVideo;
  for (const id of ['#vFormat', '#vDur']) $(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; [...$(id).children].forEach(x => x.classList.toggle('on', x === b)); };
}
export const isBusyRendering = () => !!(renderAbort || videoAbort);
