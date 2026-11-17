// Design Master — everything that leaves the studio: renders, snapshots, print files, spec sheet,
// sublimation panels, turntable video, mockup sheets, colourways, pattern, project files.
import { FABRICS, WASHES, SWATCHES } from './fabric.js';
import { drawFabric, drawItem, piecePath, itemCorners, itemHeight, gradientStops } from './atlas.js';
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
    $('#renderImg').src = renderCanvas.toDataURL('image/png'); $('#renderEmpty').hidden = true;
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
// pieces that carry visible artwork, per face
function printedPieces() {
  const g = E.app.garment, out = [];
  for (const face of ['out', 'in']) for (const p of g.pieces) {
    const items = visibleItems().filter(i => i.piece === p.id && (i.face || 'out') === face);
    if (items.length) out.push({ p, face, items });
  }
  return out;
}
const pieceTitle = (p, face) => face === 'in' && !p.insideOnly ? `${p.label} · inside` : p.label;
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
function artBounds(p, items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) for (const [x, y] of itemCorners(it, E.app.assets)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(p.w, x1), y1: Math.min(p.h, y1) };
}
const itemName = (it) => it.type === 'text' ? `“${(it.text || '').replace(/\n/g, ' ').slice(0, 40)}”` : it.type === 'shape' ? (it.name || it.shape) : (it.name || 'image');
const U = () => E.app.unit();
const L = (cm) => `${E.app.fmtLen(cm)} ${U()}`;
function rows() {
  const out = [];
  for (const { p, face, items } of printedPieces()) for (const it of items) {
    const h = itemHeight(it, E.app.assets);
    out.push({ piece: pieceTitle(p, face), name: itemName(it), type: it.type, w: it.w, h, cx: it.x - p.w / 2, top: it.y - h / 2, rot: Math.round(it.rot || 0), it, p, face });
  }
  return out;
}

/* ---------------------------------------------------------------- spec sheet (PDF) */
async function buildSpecPdf(say = () => {}) {
  const { app, studio, withHiResAtlas } = E;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;
  const g = app.garment, f = app.doc.fabric;
  say('Rendering the views…');
  const shots = [];
  await withHiResAtlas(async () => { for (const v of g.tote ? ['front', 'back'] : ['front', 'back']) shots.push(await studio.renderImage({ width: 800, height: 1000, passes: 6, view: v })); });
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text('Spec sheet', M, 20);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(100);
  pdf.text(`${app.doc.name}  ·  ${new Date().toLocaleDateString()}  ·  Design Master`, M, 26);
  pdf.setTextColor(20);
  const info = [['Garment', `${g.name} — ${g.cut}`], ['Material', fabricName()], ['Fabric colour', f.mode === 'solid' ? f.color.toUpperCase() : gradientStops(f).map(s => s.c.toUpperCase()).join(' → ')], ['Wash', washName()], ['Neck label', g.extras?.label ? (app.doc.details.label ? 'Yes' : 'No') : '—'], ['Units', U()]];
  let y = 36;
  pdf.setFontSize(10);
  for (const [k, v] of info) { pdf.setTextColor(110); pdf.text(k, M, y); pdf.setTextColor(20); pdf.text(String(v), M + 32, y); y += 6; }
  // colour chip
  pdf.setFillColor(f.color); pdf.rect(W - M - 18, 32, 18, 18, 'F'); pdf.setDrawColor(200); pdf.rect(W - M - 18, 32, 18, 18);
  // views
  const iw = (W - 2 * M - 8) / 2, ih = iw * 1.25;
  shots.forEach((s, i) => pdf.addImage(s.toDataURL('image/jpeg', 0.88), 'JPEG', M + i * (iw + 8), y + 2, iw, ih));
  pdf.setFontSize(8); pdf.setTextColor(120); pdf.text('Front', M, y + ih + 6); pdf.text('Back', M + iw + 8, y + ih + 6);
  // print table
  const R = rows();
  pdf.addPage();
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(20); pdf.text('Prints', M, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(110);
  pdf.text('Position: horizontal = from the piece centre line (− left, + right), vertical = from the top of the piece to the top of the print.', M, 24);
  const cols = [['#', 8], ['Piece', 40], ['Artwork', 46], ['Width × height', 32], ['From centre', 22], ['From top', 20], ['Rot.', 12]];
  y = 32; let x = M;
  pdf.setFont('helvetica', 'bold'); pdf.setTextColor(20);
  for (const [h, w] of cols) { pdf.text(h, x, y); x += w; }
  pdf.setFont('helvetica', 'normal');
  R.forEach((r, i) => {
    y += 7; if (y > 280) { pdf.addPage(); y = 20; }
    x = M;
    const vals = [String(i + 1), r.piece, r.name, `${E.app.fmtLen(r.w)} × ${E.app.fmtLen(r.h)} ${U()}`, `${r.cx >= 0 ? '+' : ''}${E.app.fmtLen(r.cx)}`, E.app.fmtLen(r.top), `${r.rot}°`];
    vals.forEach((v, k) => { pdf.text(pdf.splitTextToSize(v, cols[k][1] - 2)[0], x, y); x += cols[k][1]; });
  });
  if (!R.length) { y += 8; pdf.setTextColor(120); pdf.text('No prints yet.', M, y); }
  // one page per printed piece: drawing with the print boxes and their measurements
  for (const { p, face, items } of printedPieces()) {
    say(`Drawing ${p.label}…`);
    pdf.addPage();
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(20); pdf.text(pieceTitle(p, face), M, 18);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(110); pdf.text(`${L(p.w)} × ${L(p.h)} · cut 1`, M, 24);
    const boxW = W - 2 * M, boxH = 200, s = Math.min(boxW / p.w, boxH / p.h);
    const k = Math.min(40, 2400 / Math.max(p.w, p.h));
    const cv = makeCanvas(p.w * k + 2, p.h * k + 2), c = cv.getContext('2d');
    c.setTransform(k, 0, 0, k, 1, 1);
    const mp = mirrorPiece(p, face);
    piecePath(c, mp); c.fillStyle = face === 'in' ? '#e9e9e9' : (f.pieceColors?.[p.id] || f.color); c.fill();
    drawPieceArt(c, p, items, face, k);
    piecePath(c, mp); c.lineWidth = 2 / k; c.strokeStyle = '#555'; c.stroke();
    const ox = M + (boxW - p.w * s) / 2, oy = 30;
    pdf.addImage(cv.toDataURL('image/png'), 'PNG', ox, oy, p.w * s, p.h * s);
    pdf.setDrawColor(180); pdf.setLineDashPattern([1, 1], 0); pdf.line(ox + p.w * s / 2, oy - 2, ox + p.w * s / 2, oy + p.h * s + 2); pdf.setLineDashPattern([], 0);
    items.forEach((it, i) => {
      const h = itemHeight(it, E.app.assets), cs = itemCorners(it, E.app.assets);
      const bx0 = Math.min(...cs.map(q => q[0])), by0 = Math.min(...cs.map(q => q[1])), bx1 = Math.max(...cs.map(q => q[0])), by1 = Math.max(...cs.map(q => q[1]));
      pdf.setDrawColor(91, 91, 214); pdf.setLineWidth(0.3); pdf.rect(ox + bx0 * s, oy + by0 * s, (bx1 - bx0) * s, (by1 - by0) * s);
      pdf.setFontSize(8); pdf.setTextColor(91, 91, 214); pdf.text(String(i + 1), ox + bx0 * s + 1, oy + by0 * s - 1);
      // distance from the top of the piece to the print
      pdf.setDrawColor(91, 91, 214); pdf.line(ox + (bx0 + bx1) / 2 * s, oy, ox + (bx0 + bx1) / 2 * s, oy + by0 * s);
      pdf.text(E.app.fmtLen(by0), ox + (bx0 + bx1) / 2 * s + 1, oy + by0 * s / 2);
      void h;
    });
    let ty = oy + p.h * s + 10;
    pdf.setFontSize(9); pdf.setTextColor(20);
    items.forEach((it, i) => {
      const h = itemHeight(it, E.app.assets);
      pdf.text(`${i + 1}. ${itemName(it)} — ${L(it.w)} × ${L(h)}, centre ${it.x - p.w / 2 >= 0 ? '+' : ''}${L(it.x - p.w / 2)} from the centre line, top ${L(it.y - h / 2)} from the top${it.rot ? `, rotated ${Math.round(it.rot)}°` : ''}`, M, ty);
      ty += 5.5; if (ty > 285) { pdf.addPage(); ty = 20; }
    });
  }
  return pdf;
}
async function exportSpec() {
  if (!window.jspdf) return E.toast('The PDF tool did not load. Check your connection and reload.');
  await E.busy('Building the spec sheet…', async (say) => {
    const pdf = await buildSpecPdf(say);
    download(pdf.output('blob'), fname('spec-sheet') + '.pdf');
  });
}

/* ---------------------------------------------------------------- print files (ZIP) */
async function exportPrintFiles() {
  const { app, busy } = E;
  const list = printedPieces();
  if (!list.length) return E.toast('Add some artwork first.');
  await busy('Preparing print files…', async (say) => {
    const zip = new window.JSZip(), DPI = 300, k300 = DPI / 2.54;
    for (const { p, face, items } of list) {
      const name = slug(pieceTitle(p, face));
      say(`Preparing ${pieceTitle(p, face)}…`);
      // 1) piece PNG: the whole piece, artwork only (transparent), 150 DPI
      const k = Math.min(150 / 2.54, 9000 / Math.max(p.w, p.h));
      const cv = makeCanvas(p.w * k, p.h * k), c = cv.getContext('2d');
      c.setTransform(k, 0, 0, k, 0, 0); drawPieceArt(c, p, items, face, k);
      zip.file(`pieces/${name}.png`, await encode(cv));
      // 2) layered SVG at real size (cm): cut line, artwork, markings
      const b = artBounds(p, items);
      let art = '';
      if (b.x1 > b.x0 && b.y1 > b.y0) {
        const ka = Math.min(k300, 12000 / Math.max(b.x1 - b.x0, b.y1 - b.y0));
        const ac = makeCanvas((b.x1 - b.x0) * ka, (b.y1 - b.y0) * ka), x = ac.getContext('2d');
        x.setTransform(ka, 0, 0, ka, -b.x0 * ka, -b.y0 * ka); drawPieceArt(x, p, items, face, ka);
        art = `<image x="${b.x0.toFixed(3)}" y="${b.y0.toFixed(3)}" width="${(b.x1 - b.x0).toFixed(3)}" height="${(b.y1 - b.y0).toFixed(3)}" href="${ac.toDataURL('image/png')}"/>`;
      }
      const mp = mirrorPiece(p, face);
      const path = (pl) => 'M' + pl.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${p.w.toFixed(2)}cm" height="${p.h.toFixed(2)}cm" viewBox="0 0 ${p.w.toFixed(3)} ${p.h.toFixed(3)}">
  <title>${pieceTitle(p, face)} — ${app.garment.name}</title>
  <g id="artwork" inkscape:groupmode="layer" inkscape:label="Artwork">${art}</g>
  <g id="cut-line" inkscape:groupmode="layer" inkscape:label="Cut line" fill="none" stroke="#ff0000" stroke-width="0.05"><path d="${path(mp.poly)}${(mp.holes || []).map(path).join('')}"/></g>
  <g id="markings" inkscape:groupmode="layer" inkscape:label="Markings" fill="none" stroke="#999" stroke-width="0.03" stroke-dasharray="0.4 0.3">${(p.folds || []).map(fl => `<line x1="${fl[0][0]}" y1="${fl[0][1]}" x2="${fl[1][0]}" y2="${fl[1][1]}"/>`).join('')}</g>
</svg>`;
      zip.file(`pieces/${name}.svg`, svg);
      // 3) each print on its own, at print size, 300 DPI
      for (const [i, it] of items.entries()) {
        const h = itemHeight(it, app.assets), cs = itemCorners(it, app.assets);
        const bx0 = Math.min(...cs.map(q => q[0])), by0 = Math.min(...cs.map(q => q[1])), bw = Math.max(...cs.map(q => q[0])) - bx0, bh = Math.max(...cs.map(q => q[1])) - by0;
        const kk = Math.min(k300, 12000 / Math.max(bw, bh));
        const pc = makeCanvas(bw * kk, bh * kk), x = pc.getContext('2d');
        x.setTransform(kk, 0, 0, kk, -bx0 * kk, -by0 * kk); drawItem(x, it, app.assets, null, kk);
        zip.file(`prints/${name}-${i + 1}-${slug(itemName(it))}.png`, await encode(pc));
        void h;
      }
    }
    if (window.jspdf) { say('Adding the spec sheet…'); zip.file('spec-sheet.pdf', (await buildSpecPdf(say)).output('arraybuffer')); }
    zip.file('README.txt', `Print files — ${app.doc.name}\n${app.garment.name} (${app.garment.cut})\n\npieces/  each pattern piece: PNG (150 DPI, artwork only) and a layered SVG at real size (Artwork, Cut line, Markings)\nprints/  each print on its own at print size, 300 DPI, transparent\nspec-sheet.pdf  print sizes and positions\n\nInside pieces are drawn as seen from the inside of the garment.\n`);
    say('Zipping…');
    download(await zip.generateAsync({ type: 'blob' }), fname('print-files') + '.zip');
  });
}

/* ---------------------------------------------------------------- sublimation panels (ZIP) */
async function exportSublimation() {
  const { app, busy } = E;
  const g = app.garment;
  await busy('Preparing sublimation panels…', async (say) => {
    const zip = new window.JSZip(), DPI = 150, BLEED = 1.5; // cm
    const k = DPI / 2.54;
    // full-colour fabric layer for the whole sheet at this resolution
    const base = makeCanvas(g.sheet.w * k, g.sheet.h * k), bc = base.getContext('2d');
    bc.setTransform(k, 0, 0, k, 0, 0); drawFabric(bc, g, app.doc.fabric, app.overlays, { fillSheet: true });
    for (const p of g.pieces.filter(q => !q.insideOnly)) {
      say(`Preparing ${p.label}…`);
      const W = p.w + 2 * BLEED, H = p.h + 2 * BLEED;
      const kk = Math.min(k, 12000 / Math.max(W, H));
      const cv = makeCanvas(W * kk, H * kk), c = cv.getContext('2d');
      c.setTransform(kk, 0, 0, kk, BLEED * kk, BLEED * kk);
      // bleed: the piece outline grown by BLEED on every side
      c.save(); piecePath(c, p); c.lineWidth = BLEED * 2; c.lineJoin = 'round'; c.strokeStyle = '#000'; c.stroke(); c.fillStyle = '#000'; c.fill();
      c.globalCompositeOperation = 'source-in';
      c.drawImage(base, -p.sx, -p.sy, g.sheet.w, g.sheet.h);
      // artwork may run into the bleed too
      for (const it of visibleItems().filter(i => i.piece === p.id && (i.face || 'out') === 'out')) { c.globalCompositeOperation = 'source-atop'; drawItem(c, it, app.assets, null, kk); }
      c.restore();
      zip.file(`${slug(p.label)}.png`, await encode(cv));
      // cut line on its own (SVG, real size, bleed included in the frame)
      const path = 'M' + p.poly.map(([x, y]) => `${(x + BLEED).toFixed(2)},${(y + BLEED).toFixed(2)}`).join('L') + 'Z';
      zip.file(`${slug(p.label)}-cutline.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}cm" height="${H.toFixed(2)}cm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}"><path d="${path}" fill="none" stroke="#ff0000" stroke-width="0.05"/></svg>`);
    }
    zip.file('README.txt', `Sublimation panels — ${app.doc.name}\n${g.name}\n\nEach piece as one full-colour file at ${DPI} DPI with ${BLEED} cm bleed on every side, plus its cut line as SVG (same frame).\n`);
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
let videoAbort = null;
function openVideo() { E.$('#vStatus').textContent = 'Keep this tab open while it records.'; E.$('#vBar').style.width = '0'; E.$('#videoDlg').hidden = false; }
async function doVideo() {
  const { $, studio, withHiResAtlas } = E;
  if (videoAbort) { videoAbort.abort(); return; }
  const [W, H] = $('#vFormat .on').dataset.f.split('x').map(Number), secs = +$('#vDur .on').dataset.d;
  videoAbort = new AbortController();
  $('#vStart').textContent = 'Stop';
  try {
    const blob = await withHiResAtlas(() => studio.recordTurntable({ width: W, height: H, seconds: secs, signal: videoAbort.signal, onProgress: (f, t) => { $('#vBar').style.width = (f / t * 100) + '%'; $('#vStatus').textContent = `Recording… ${Math.round(f / t * 100)}%`; } }));
    if (videoAbort.signal.aborted) { $('#vStatus').textContent = 'Stopped.'; return; }
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    download(blob, fname(`turntable-${W}x${H}`) + '.' + ext);
    $('#vStatus').textContent = `Saved as ${ext.toUpperCase()}.`;
  } catch (e) { console.error(e); $('#vStatus').textContent = 'The video could not be recorded: ' + e.message; }
  finally { videoAbort = null; $('#vStart').textContent = 'Start'; }
}

/* ---------------------------------------------------------------- wiring */
export function runExport(act) {
  ({ render: openRender, print: exportPrintFiles, spec: exportSpec, subl: exportSublimation, video: openVideo, sheet: exportSheet, views: exportViews, colorways: openColorways, pattern: exportPattern, snapshot: snapshot3D, download: E.downloadProject, import: E.importProject })[act]?.();
}
function bind() {
  const { $ } = E;
  $('#rStart').onclick = doRender;
  $('#rSavePng').onclick = () => saveRender('png'); $('#rSaveWebp').onclick = () => saveRender('webp'); $('#rSaveJpg').onclick = () => saveRender('jpeg');
  $('#cwStart').onclick = doColorways;
  $('#vStart').onclick = doVideo;
  for (const id of ['#vFormat', '#vDur']) $(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; [...$(id).children].forEach(x => x.classList.toggle('on', x === b)); };
}
export const isBusyRendering = () => !!(renderAbort || videoAbort);
