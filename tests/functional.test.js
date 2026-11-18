// End-to-end functional tests for Design Master (every function from docs/feature-parity.md).
//
// Run (from the repo root):
//   python3 -m http.server 8765 --bind 127.0.0.1        (in one terminal)
//   npm i -D playwright && npx playwright install chromium   (once)
//   node tests/functional.test.js                         (in another terminal)
// Downloads and screenshots go to tests/output/. Each test prints PASS/FAIL as it runs.
// On a machine with a real GPU you can drop the swiftshader launch flags below.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname + '/output';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [], results = [], downloads = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  p.on('dialog', d => d.type() === 'prompt' ? d.accept('Renamed design') : d.accept());
  p.on('download', async d => { const f = OUT + '/' + d.suggestedFilename(); await d.saveAs(f).catch(() => {}); downloads.push(d.suggestedFilename()); });
  await p.goto('http://127.0.0.1:8765/app/', { waitUntil: 'load' });
  await p.evaluate(() => { localStorage.setItem('dm.tourDone', '1'); localStorage.setItem('dm.hint3d', '1'); });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(4000);
  const ev = (fn, arg) => p.evaluate(fn, arg);
  const wait = (ms) => p.waitForTimeout(ms);
  let errMark = 0;
  async function t(name, fn) {
    const e0 = errs.length;
    try { const r = await fn(); const ok = r !== false && errs.length === e0; results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${r && r !== true ? '  — ' + r : ''}${errs.length > e0 ? '  — ' + errs.slice(e0).join(' | ') : ''}`); }
    catch (e) { results.push(`FAIL  ${name}  — ${e.message.split('\n')[0]}`); }
    console.log(results[results.length - 1]);
    // close anything a failed step left open
    await p.evaluate(() => { document.querySelectorAll('.overlay').forEach(o => { if (!o.hidden) o.hidden = true; }); document.querySelectorAll('.menu').forEach(m => (m.hidden = true)); }).catch(() => {});
  }
  const click = (sel) => p.click(sel, { timeout: 30000 }); // the software 3D renderer is slow while the view turns
  const waitDl = async (pred, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (downloads.some(pred)) return true; await wait(300); } return false; };
  // screen point of a sheet coordinate in the pattern editor
  const patPt = (x, y) => ev(([x, y]) => { const e = DM.editor, r = e.cv.getBoundingClientRect(); return [r.left + x * e.view.s + e.view.ox, r.top + y * e.view.s + e.view.oy]; }, [x, y]);
  const pieceCentre = (id, fx = 0.5, fy = 0.5) => ev(([id, fx, fy]) => { const pc = DM.garment.pieces.find(q => q.id === id); return [pc.sx + pc.w * fx, pc.sy + pc.h * fy]; }, [id, fx, fy]);

  // a test image
  const png = await ev(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#e0702f'; x.beginPath(); x.arc(200, 150, 120, 0, 7); x.fill(); x.fillStyle = '#1d2d4d'; x.font = 'bold 80px sans-serif'; x.textAlign = 'center'; x.fillText('DM', 200, 180); return c.toDataURL('image/png'); });
  fs.writeFileSync(OUT + '/test.png', Buffer.from(png.split(',')[1], 'base64'));

  /* ---------------- artwork ---------------- */
  await t('Add image (file picker)', async () => { await p.setInputFiles('#fileImage', OUT + '/test.png'); await wait(800); return ev(() => DM.doc.items.length === 1 && DM.selected()?.type === 'image') || 'no image item'; });
  await t('Image panel shows Mirror/Invert/Crop/Copy/Delete/Hue/Saturation/Fill/Reset/Halftone', async () => ev(() => ['flip', 'invert', 'crop', 'dup', 'del', 'resetColours'].every(a => document.querySelector(`[data-act="${a}"]`)) && !!document.querySelector('[data-k="item.hue"]') && !!document.querySelector('[data-k="item.sat"]') && !!document.querySelector('[data-k="item.fill"]') && !!document.querySelector('[data-act="halftone"]')));
  await t('Invert colours', async () => { await click('[data-act="invert"]'); await wait(300); return ev(() => DM.selected().invert === true); });
  await t('Hue + saturation', async () => { await p.fill('[data-k="item.hue"]', '90'); await p.dispatchEvent('[data-k="item.hue"]', 'change'); await p.fill('[data-k="item.sat"]', '1.5'); await p.dispatchEvent('[data-k="item.sat"]', 'change'); return ev(() => DM.selected().hue === 90 && DM.selected().sat === 1.5); });
  await t('Fill with colour', async () => { await click('[data-k="item.fill"] + span'); await wait(300); return ev(() => DM.selected().fill === true); });
  await t('Reset colours', async () => { await click('[data-act="resetColours"]'); await wait(300); return ev(() => { const i = DM.selected(); return !i.invert && !i.hue && (i.sat ?? 1) === 1 && !i.fill; }); });
  await t('Halftone dialog: every style and dot shape previews, Apply and Remove', async () => {
    await click('[data-act="halftone"]'); await wait(800);
    if (await ev(() => document.querySelector('#htDlg').hidden)) return 'dialog did not open';
    for (const v of ['classic', 'dots', 'pal', 'ink', 'cmyk', 'fade']) { await click(`#htSide [data-ht="style"][data-v="${v}"]`); await wait(250); }
    await click('#htSide [data-ht="style"][data-v="ink"]');
    for (const v of ['dot', 'line', 'engrave', 'cross', 'diamond', 'square', 'ring', 'grain']) { await click(`#htSide [data-ht="shape"][data-v="${v}"]`); await wait(200); }
    for (const v of ['L', 'M', 'S']) await click(`#htSide [data-ht="size"][data-v="${v}"]`);
    await click('#htSide [data-ht="ko"][data-v="none"]'); await wait(400);
    const painted = await ev(() => { const c = document.querySelector('#htCv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 4 * 97) set.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); return set.size; });
    if (painted < 2) return 'preview is blank';
    await click('#htSide [data-ht="apply"]'); await wait(800);
    const on = await ev(() => { const h = DM.selected().halftone; return !!h && h.style === 'ink' && h.shape === 'grain' && h.size === 'S' && h.ko === 'none'; });
    if (!on) return 'not applied';
    await click('[data-act="halftone"]'); await wait(500); await click('#htSide [data-ht="remove"]'); await wait(400);
    return ev(() => !DM.selected().halftone) || 'not removed';
  });
  await t('Crop in place: drag an edge, reset, cancel and done', async () => {
    await click('[data-act="crop"]'); await wait(500);
    if (await ev(() => document.querySelector('#cropBar').hidden)) return 'crop bar did not show';
    const hs = await ev(() => DM.editor.crop.handles().find(h => h.h === 'e').pt);
    const r = await p.locator('#pat').boundingBox();
    await p.mouse.move(r.x + hs[0], r.y + hs[1]); await p.mouse.down(); await p.mouse.move(r.x + hs[0] - 60, r.y + hs[1], { steps: 5 }); await p.mouse.up();
    const c1 = await ev(() => DM.selected().crop);
    if (!c1 || c1.w > 0.95) return 'edge drag did not crop';
    await click('[data-crop="reset"]'); if (await ev(() => !!DM.selected().crop)) return 'reset kept a crop';
    await click('[data-crop="cancel"]'); await wait(300);
    if (await ev(() => !document.querySelector('#cropBar').hidden)) return 'cancel did not close';
    await click('[data-act="crop"]'); await wait(400);
    await ev(() => { const s = DM.editor.crop; s.f.x1 -= 4; s.apply(); });
    await click('[data-crop="done"]'); await wait(300);
    return ev(() => { const c = DM.selected().crop; return !!c && c.w < 0.95 && Math.abs(DM.selected().aspect - (400 * c.w) / (300 * c.h)) < 0.01; }) || 'crop not stored';
  });
  await t('Import SVG and PDF stay vector; EPS and old AI files get a clear message', async () => {
    fs.writeFileSync(OUT + '/test.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" rx="40" fill="#e0702f"/><circle cx="150" cy="150" r="90" fill="#1d2d4d"/></svg>');
    const body = '0.88 0.44 0.18 rg 40 40 520 220 re f 0.11 0.18 0.3 rg 100 100 100 100 re f';
    fs.writeFileSync(OUT + '/test.pdf', `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 600 300]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
    fs.writeFileSync(OUT + '/test.eps', '%!PS-Adobe-3.0 EPSF-3.0\n');
    fs.writeFileSync(OUT + '/old.ai', 'not a pdf');
    const n0 = await ev(() => DM.doc.items.length);
    await p.setInputFiles('#fileImage', OUT + '/test.svg'); await wait(1500);
    const s1 = await ev(() => DM.selected()?.vec?.kind);
    await p.setInputFiles('#fileImage', OUT + '/test.pdf'); await wait(5000);
    const s2 = await ev(() => DM.selected()?.vec?.kind);
    await p.setInputFiles('#fileImage', OUT + '/test.eps'); await wait(800);
    const m1 = await ev(() => document.querySelector('#toast').textContent);
    await p.setInputFiles('#fileImage', OUT + '/old.ai'); await wait(800);
    const m2 = await ev(() => document.querySelector('#toast').textContent);
    const n1 = await ev(() => DM.doc.items.length);
    await ev(() => { DM.doc.items = DM.doc.items.filter(i => !i.vec); DM.selIds = [DM.doc.items[0].id]; DM.itemsChanged(false); });
    if (s1 !== 'svg') return 'svg not vector: ' + s1;
    if (s2 !== 'pdf') return 'pdf not vector: ' + s2;
    if (!/EPS files can’t be opened/.test(m1)) return 'eps message: ' + m1;
    if (!/no PDF inside/.test(m2)) return 'ai message: ' + m2;
    return n1 - n0 === 2 || `items added: ${n1 - n0}`;
  });
  await t('Mirror', async () => { await click('[data-act="flip"]'); return ev(() => DM.selected().flip === true); });
  await t('Transform: width/height linked, rotation, opacity numbers', async () => {
    const h0 = await ev(() => document.querySelector('[data-num="h"]').value);
    await p.fill('[data-num="w"]', '20'); await p.dispatchEvent('[data-num="w"]', 'change');
    await p.fill('[data-num="rot"]', '15'); await p.dispatchEvent('[data-num="rot"]', 'change');
    await p.fill('[data-num="opacity"]', '60'); await p.dispatchEvent('[data-num="opacity"]', 'change');
    return ev((h0) => { const i = DM.selected(); return Math.abs(i.w - 20) < 0.01 && i.rot === 15 && Math.abs(i.opacity - 0.6) < 0.001 && document.querySelector('[data-num="h"]').value !== h0; }, h0);
  });
  await t('Rotate 90° buttons', async () => { await click('[data-act="rotR"]'); return ev(() => DM.selected().rot === 105); });
  await t('Align to the piece (centre + top)', async () => { await click('[data-align="c"]'); await click('[data-align="t"]'); return ev(() => { const i = DM.selected(), pc = DM.garment.pieces.find(q => q.id === i.piece); return Math.abs(i.x - pc.w / 2) < 1.5; }); });
  await t('Place at: Back neck', async () => { await p.click('[data-preset]:text("Back neck")'); return ev(() => DM.selected().piece === 'back'); });
  await t('Copy (button) and Delete', async () => { await click('[data-act="dup"]'); const n = await ev(() => DM.doc.items.length); await click('[data-act="del"]'); return n === 2 && await ev(() => DM.doc.items.length === 1); });
  await t('Add text + edit + font/weight/style/paragraph/line/spacing', async () => {
    await click('#tabDesign [data-add="text"]'); await wait(400);
    await p.fill('#tabDesign textarea', 'BUILD IT.\nDESIGN IT.'); await p.dispatchEvent('#tabDesign textarea', 'input');
    await p.selectOption('[data-k="item.font"]', 'Bebas Neue'); await wait(200);
    await click('[data-flag="italic"]'); await click('[data-flag="caps"]');
    await click('[data-seg="item.align"][data-val="left"]');
    await p.fill('[data-k="item.lineH"]', '0.9'); await p.dispatchEvent('[data-k="item.lineH"]', 'change');
    await p.fill('[data-k="item.letter"]', '5'); await p.dispatchEvent('[data-k="item.letter"]', 'change');
    return ev(() => { const i = DM.selected(); return i.type === 'text' && i.text.startsWith('BUILD') && i.font === 'Bebas Neue' && i.italic && i.caps && i.align === 'left' && i.lineH === 0.9 && i.letter === 5; });
  });
  await t('Text weight menu (Inter 100–900) + Bold toggle', async () => {
    await p.selectOption('[data-k="item.font"]', 'Inter'); await wait(300);
    const n = await ev(() => document.querySelectorAll('[data-k="item.weight"] option').length);
    await click('[data-act="bold"]'); const w = await ev(() => DM.selected().weight);
    return n === 9 && (w === 400 || w === 700) || `options=${n} weight=${w}`;
  });
  await t('Shapes menu: draw a rectangle by dragging on the front', async () => {
    await click('#shapesBtn'); await wait(200); await click('#shapesMenu [data-drawshape="rect"]');
    const [x, y] = await pieceCentre('front', 0.35, 0.6), [x2, y2] = await pieceCentre('front', 0.6, 0.75);
    const a = await patPt(x, y), c = await patPt(x2, y2);
    await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move(c[0], c[1], { steps: 6 }); await p.mouse.up(); await wait(300);
    return ev(() => { const i = DM.selected(); return i?.type === 'shape' && i.shape === 'rect' && i.w > 5 && i.h > 3 && DM.editor.tool === 'select'; }) || 'no shape';
  });
  await t('Draw a square with Shift and a dashed line', async () => {
    await click('#shapesBtn'); await click('#shapesMenu [data-drawshape="square"]');
    const [x, y] = await pieceCentre('back', 0.3, 0.5), [x2, y2] = await pieceCentre('back', 0.5, 0.58);
    const a = await patPt(x, y), c = await patPt(x2, y2);
    await p.keyboard.down('Shift'); await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move(c[0], c[1], { steps: 6 }); await p.mouse.up(); await p.keyboard.up('Shift');
    const sq = await ev(() => { const i = DM.selected(); return Math.abs(i.w - i.h) < 0.05; });
    await click('#shapesBtn'); await click('#shapesMenu [data-drawshape="dashed"]');
    const d1 = await patPt(...(await pieceCentre('back', 0.2, 0.8))), d2 = await patPt(...(await pieceCentre('back', 0.8, 0.8)));
    await p.mouse.move(d1[0], d1[1]); await p.mouse.down(); await p.mouse.move(d2[0], d2[1], { steps: 5 }); await p.mouse.up();
    return sq && await ev(() => DM.selected().shape === 'dashed');
  });
  await t('Shape panel: shape dropdown, gradient colour, swap, outline only, thickness', async () => {
    await p.selectOption('[data-shapesel]', 'star'); await wait(200);
    await click('[data-seg="item.paint"][data-val="grad"]'); await wait(200);
    await click('[data-seg="item.gtype"][data-val="radial"]'); await wait(200);
    const c1 = await ev(() => DM.selected().color); await click('[data-act="shapeSwap"]');
    const swapped = await ev((c) => DM.selected().color2 === c, c1);
    await click('[data-k="item.outline"] + span');
    await p.fill('[data-k="item.thick"]', '6'); await p.dispatchEvent('[data-k="item.thick"]', 'change');
    const r = await ev(() => { const i = DM.selected(); return i.shape === 'star' && i.paint === 'grad' && i.gtype === 'radial' && i.outline === true && i.thick === 6; });
    await click('[data-seg="item.paint"][data-val="solid"]'); await click('[data-k="item.outline"] + span');
    return (r && swapped) || `panel=${r} swapped=${swapped}`;
  });
  await t('Shape drawn from outside a thin piece lands on it (cover the neck rib)', async () => {
    const id = await ev(() => DM.garment.pieces.find(q => /neck/i.test(q.id) && !q.insideOnly).id);
    await click('#shapesBtn'); await click('#shapesMenu [data-drawshape="rect"]');
    const r = await ev((id) => { const pc = DM.garment.pieces.find(q => q.id === id); return [pc.sx - 4, pc.sy - 6, pc.sx + pc.w + 4, pc.sy + pc.h + 6]; }, id);
    const a = await patPt(r[0], r[1]), c = await patPt(r[2], r[3]);
    await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move(c[0], c[1], { steps: 6 }); await p.mouse.up(); await wait(300);
    return ev((id) => { const i = DM.selected(); return i?.type === 'shape' && i.piece === id; }, id) || 'shape not on the neck rib';
  });
  await t('3D preview is view-only: dragging on it never moves or selects prints', async () => {
    const before = await ev(() => JSON.stringify([DM.selIds, DM.doc.items.map(i => [i.piece, i.x, i.y])]));
    const g = await p.locator('#gl').boundingBox();
    for (const [fx, fy] of [[0.5, 0.42], [0.45, 0.55]]) { await p.mouse.move(g.x + g.width * fx, g.y + g.height * fy); await p.mouse.down(); await p.mouse.move(g.x + g.width * fx + 90, g.y + g.height * fy + 20, { steps: 5 }); await p.mouse.up(); await wait(300); }
    const after = await ev(() => JSON.stringify([DM.selIds, DM.doc.items.map(i => [i.piece, i.x, i.y])]));
    await click('#resetViewBtn');
    return before === after || 'a print moved or the selection changed';
  });
  await t('Esc cancels a shape tool', async () => { await click('#shapesBtn'); await click('#shapesMenu [data-drawshape="circle"]'); await p.keyboard.press('Escape'); return ev(() => DM.editor.tool === 'select'); });
  /* ---------------- pattern interactions ---------------- */
  await t('Select by click, Shift-click adds, drag moves both', async () => {
    const ids = await ev(() => DM.doc.items.filter(i => i.piece === 'back' && i.type === 'shape').map(i => i.id));
    await ev((ids) => DM.setSelection([]), ids);
    const pos = await ev((ids) => ids.map(id => { const i = DM.doc.items.find(q => q.id === id), pc = DM.garment.pieces.find(q => q.id === i.piece); return [pc.sx + i.x, pc.sy + i.y]; }), ids);
    const a = await patPt(...pos[0]), c = await patPt(...pos[1]);
    await p.mouse.click(a[0], a[1]); await p.keyboard.down('Shift'); await p.mouse.click(c[0], c[1]); await p.keyboard.up('Shift');
    const n = await ev(() => DM.selIds.length);
    const before = await ev((ids) => ids.map(id => DM.doc.items.find(q => q.id === id).x), ids);
    await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move(a[0] + 30, a[1] + 10, { steps: 5 }); await p.mouse.up();
    const after = await ev((ids) => ids.map(id => DM.doc.items.find(q => q.id === id).x), ids);
    return n === 2 && after[0] > before[0] && after[1] > before[1] || `sel=${n} moved=${after.map((v, i) => (v - before[i]).toFixed(2))}`;
  });
  await t('Multi-select panel shows "n designs selected"', async () => ev(() => document.querySelector('#selSec h4')?.textContent.includes('designs selected')));
  await t('Selection box (drag on empty sheet)', async () => {
    await ev(() => DM.setSelection([]));
    const pc = await ev(() => { const q = DM.garment.pieces.find(x => x.id === 'back'); return [q.sx, q.sy, q.w, q.h]; });
    const a = await patPt(pc[0] - 3, pc[1] + pc[3] * 0.4), c = await patPt(pc[0] + pc[2] + 3, pc[1] + pc[3] * 0.95);
    await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move(c[0], c[1], { steps: 6 }); await p.mouse.up();
    return ev(() => DM.selIds.length >= 2) || 'nothing boxed';
  });
  await t('Ctrl+D duplicates the selection, Delete removes it', async () => {
    const n0 = await ev(() => DM.doc.items.length), k = await ev(() => DM.selIds.length);
    await p.keyboard.press('Control+d'); const n1 = await ev(() => DM.doc.items.length);
    await p.keyboard.press('Delete'); const n2 = await ev(() => DM.doc.items.length);
    return n1 === n0 + k && n2 === n0 || `${n0}→${n1}→${n2}`;
  });
  await t('Alt+drag copies', async () => {
    const it = await ev(() => { const i = DM.doc.items.find(q => q.type === 'text'); DM.select(i.id); const pc = DM.garment.pieces.find(q => q.id === i.piece); return [pc.sx + i.x, pc.sy + i.y]; });
    const a = await patPt(...it), n0 = await ev(() => DM.doc.items.length);
    await p.keyboard.down('Alt'); await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move(a[0] + 25, a[1] + 25, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Alt');
    return ev((n0) => DM.doc.items.length === n0 + 1, n0);
  });
  await t('Arrow keys nudge', async () => { const x0 = await ev(() => DM.selected().x); await p.keyboard.press('Shift+ArrowRight'); return ev((x0) => Math.abs(DM.selected().x - x0 - 1) < 0.01, x0); });
  await t('Ctrl+A selects all on this side', async () => { await p.mouse.click(300, 600); await p.keyboard.press('Control+a'); return ev(() => DM.selIds.length === DM.doc.items.filter(i => (i.face || 'out') === 'out' && !i.hidden && !i.locked).length); });
  await t('Rotate by dragging outside a corner', async () => {
    const it = await ev(() => { const i = DM.doc.items.find(q => q.type === 'image'); DM.select(i.id); i.rot = 0; DM.itemsChanged(false); return i.id; });
    await wait(200);
    const corner = await ev(() => { const h = DM.editor.handlesFor(DM.selected()); const r = DM.editor.cv.getBoundingClientRect(); const c = h.corners[1], o = h.corners[3]; const dx = c[0] - o[0], dy = c[1] - o[1], L = Math.hypot(dx, dy); return [r.left + c[0] + dx / L * 16, r.top + c[1] + dy / L * 16]; });
    await p.mouse.move(corner[0], corner[1]); await p.mouse.down(); await p.mouse.move(corner[0] + 10, corner[1] + 60, { steps: 6 }); await p.mouse.up();
    return ev(() => Math.abs(DM.selected().rot) > 5) || 'not rotated';
  });
  await t('Units mm / in / cm change readouts and rulers', async () => { await click('.units [data-unit="mm"]'); const u1 = await ev(() => DM.unit()); await click('.units [data-unit="in"]'); const u2 = await ev(() => DM.unit()); await click('.units [data-unit="cm"]'); return u1 === 'mm' && u2 === 'in'; });
  await t('Zoom in / out / Fit and % readout', async () => { await click('#zoomIn'); const z1 = await ev(() => DM.editor.zoomPct()); await click('#zoomOut'); await click('#zoomOut'); await click('#zoomFit'); const z2 = await ev(() => DM.editor.zoomPct()); return z1 > 100 && z2 === 100 && (await ev(() => document.querySelector('#zoomPct').textContent)) === '100%'; });
  await t('Trackpad swipe moves the sheet without zooming; wheel and pinch zoom', async () => {
    const send = (evs) => ev(async (evs) => {
      const cv = document.querySelector('#pat'), r = cv.getBoundingClientRect();
      for (const e of evs) { cv.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaX: e[0], deltaY: e[1], ctrlKey: !!e[2] })); await new Promise(res => setTimeout(res, 16)); }
      await new Promise(res => setTimeout(res, 320));
      return DM.editor.view.s;
    }, evs);
    const s0 = await ev(() => DM.editor.view.s);
    const s1 = await send([[0, 2.5], [0.4, 8], [0, 20], [0, 45], [0, 70], [0, 100], [0, 90], [0, 60], [0, 30], [0, 10], [0, 3]]); // speeds up, then momentum
    const s2 = await send([[0, 100], [0, 100]]); // mouse wheel notches
    const s3 = await send([[0, -8, true], [0, -8, true]]); // pinch
    await click('#zoomFit');
    return (s1 === s0 && s2 < s1 && s3 > s2) || `swipe ${s0}→${s1}, wheel →${s2}, pinch →${s3}`;
  });
  await t('Double-click empty sheet fits', async () => { await click('#zoomIn'); await click('#zoomIn'); await p.mouse.dblclick(120, 830); return ev(() => DM.editor.zoomPct() === 100); });
  await t('Right-drag moves the sheet', async () => { const o = await ev(() => DM.editor.view.ox); await p.mouse.move(300, 500); await p.mouse.down({ button: 'right' }); await p.mouse.move(360, 520, { steps: 4 }); await p.mouse.up({ button: 'right' }); return ev((o) => DM.editor.view.ox > o + 30, o); });
  await t('Hand tool', async () => { await click('[data-tool="hand"]'); const ok = await ev(() => DM.editor.tool === 'hand'); await click('[data-tool="select"]'); return ok; });
  await t('Pattern markings toggle', async () => { await click('#marksBtn'); const off = await ev(() => DM.doc.view.marks === false); await click('#marksBtn'); return off && await ev(() => DM.doc.view.marks !== false); });
  /* ---------------- inside / label ---------------- */
  await t('Inside view shows inside pieces incl. Label (piece count changes)', async () => { await click('#sideSeg [data-side="in"]'); await wait(300); return ev(() => DM.editor.visiblePieces().some(q => q.id === 'label') && document.querySelector('#pieceCount').textContent.startsWith('7')); });
  await t('Place at: Label (inside) and Printed label', async () => {
    await ev(() => DM.select(null)); await p.click('[data-preset]:text("Label")'); await click('#tabDesign [data-add="text"]'); await wait(300);
    await p.fill('#tabDesign textarea', 'DM'); await p.dispatchEvent('#tabDesign textarea', 'input');
    const onLabel = await ev(() => DM.selected().piece === 'label' && DM.selected().face === 'in');
    await ev(() => DM.select(null)); await p.click('[data-preset]:text("Printed label")'); await click('#tabDesign [data-add="text"]'); await wait(300);
    return onLabel && await ev(() => DM.selected().piece === 'back' && DM.selected().face === 'in');
  });
  await t('Move to outside / inside', async () => { await click('[data-act="toggleFace"]'); const out = await ev(() => DM.selected().face === 'out' && DM.doc.view.side === 'out'); await click('[data-act="toggleFace"]'); return out && await ev(() => DM.selected().face === 'in'); });
  await p.screenshot({ path: OUT + '/inside.png' });
  await t('Back to Outside view', async () => { await click('#sideSeg [data-side="out"]'); return ev(() => DM.doc.view.side === 'out' && !DM.editor.visiblePieces().some(q => q.id === 'label')); });
  /* ---------------- layers ---------------- */
  await t('Layers: hide/show, lock, select by click', async () => {
    const first = p.locator('#layers .layer').first();
    await first.locator('[data-lact="vis"]').click(); const hid = await ev(() => DM.doc.items[DM.doc.items.length - 1].hidden === true);
    await first.locator('[data-lact="vis"]').click();
    await first.locator('[data-lact="lock"]').click(); const lk = await ev(() => DM.doc.items[DM.doc.items.length - 1].locked === true);
    await first.locator('[data-lact="lock"]').click();
    await first.locator('.ln').click();
    return hid && lk && await ev(() => DM.selId === DM.doc.items[DM.doc.items.length - 1].id);
  });
  /* ---------------- undo / redo ---------------- */
  await t('Undo / redo', async () => { const n = await ev(() => DM.doc.items.length); await p.keyboard.press('Control+z'); await wait(300); await p.keyboard.press('Control+Shift+z'); await wait(300); return ev((n) => DM.doc.items.length === n, n); });
  /* ---------------- fabric ---------------- */
  await click('[data-tab="fabric"]');
  await t('Fabric swatch + custom hex', async () => { await p.click('#tabFabric [data-setk="fabric.color"][data-val="#557f69"]'); const a = await ev(() => DM.doc.fabric.color === '#557f69'); await p.fill('#tabFabric [data-k="fabric.color"][data-hex]', '#2b3a55'); await p.dispatchEvent('#tabFabric [data-k="fabric.color"][data-hex]', 'change'); return a && await ev(() => DM.doc.fabric.color === '#2b3a55'); });
  await t('Gradient: switch, add stop, swap, remove', async () => {
    await p.click('#tabFabric [data-seg="fabric.mode"][data-val="gradient"]'); await wait(300);
    await click('[data-act="gradAdd"]'); const n3 = await ev(() => DM.doc.fabric.stops.length);
    const first = await ev(() => DM.doc.fabric.stops[0].c); await click('[data-act="gradSwap"]'); const swapped = await ev((f) => DM.doc.fabric.stops[DM.doc.fabric.stops.length - 1].c === f, first);
    await click('[data-act="gradDel"]');
    const n2 = await ev(() => DM.doc.fabric.stops.length);
    await p.click('#tabFabric [data-seg="fabric.mode"][data-val="solid"]');
    return n3 === 3 && swapped && n2 === 2 || `stops=${n3} swapped=${swapped} after=${n2}`;
  });
  await t('Gradient midpoint: drag moves where the blend is half-way', async () => {
    await p.click('#tabFabric [data-seg="fabric.mode"][data-val="gradient"]'); await wait(300);
    const m = await p.locator('#gradBar .mid').first().boundingBox();
    if (!m) return 'no midpoint marker';
    await p.mouse.move(m.x + m.width / 2, m.y + m.height / 2); await p.mouse.down(); await p.mouse.move(m.x + m.width / 2 + 50, m.y + m.height / 2, { steps: 4 }); await p.mouse.up(); await wait(300);
    const mid = await ev(() => DM.doc.fabric.stops[0].m);
    await p.click('#tabFabric [data-seg="fabric.mode"][data-val="solid"]');
    return mid > 0.55 || 'midpoint ' + mid;
  });
  await t('Wash: spot size, wash the prints too, another pattern', async () => {
    await p.selectOption('[data-k="fabric.wash"]', 'acid'); await wait(300);
    await p.fill('[data-k="fabric.washSize"]', '2'); await p.dispatchEvent('[data-k="fabric.washSize"]', 'change'); await wait(300);
    await click('[data-k="fabric.washPrints"] + span'); await wait(300);
    const seed0 = await ev(() => DM.doc.fabric.washSeed || 0);
    await click('[data-act="reseed"]'); await wait(300);
    const ok = await ev((s0) => DM.doc.fabric.washSize === 2 && DM.doc.fabric.washPrints === true && (DM.doc.fabric.washSeed || 0) === s0 + 1, seed0);
    await click('[data-k="fabric.washPrints"] + span');
    await p.selectOption('[data-k="fabric.wash"]', 'none');
    return ok || 'wash options not stored';
  });
  await t('Every wash renders', async () => {
    const ids = await ev(() => [...document.querySelectorAll('[data-k="fabric.wash"] option')].map(o => o.value));
    for (const id of ids) { await p.selectOption('[data-k="fabric.wash"]', id); await wait(150); }
    await p.selectOption('[data-k="fabric.wash"]', 'none');
    return ids.length >= 12 || `only ${ids.length}`;
  });
  await t('Material list + Fold shadows (AO) + wrinkles toggles', async () => {
    await p.selectOption('[data-k="fabric.type"]', 'fleece'); await wait(200);
    await click('[data-k="fabric.ao"] + span'); const ao = await ev(() => DM.doc.fabric.ao === false && DM.studio.mats.main.vertexColors === false);
    await click('[data-k="fabric.ao"] + span');
    await click('[data-k="fabric.wrinklesOn"] + span'); await wait(400); const wr = await ev(() => DM.doc.fabric.wrinklesOn === false);
    await click('[data-k="fabric.wrinklesOn"] + span'); await wait(400);
    return ao && wr && await ev(() => DM.doc.fabric.type === 'fleece');
  });
  await t('Texture, knit size, brightness, contrast sliders', async () => {
    for (const [k, v] of [['relief', '1.2'], ['knit', '2'], ['bright', '1.2'], ['contrast', '0.8']]) { await p.fill(`[data-k="fabric.${k}"]`, v); await p.dispatchEvent(`[data-k="fabric.${k}"]`, 'change'); }
    return ev(() => DM.doc.fabric.bright === 1.2 && DM.studio.fabUniforms.uBright.value === 1.2 && DM.studio.fabUniforms.uContrast.value === 0.8);
  });
  await t('Colour blocking (sleeves)', async () => { await click('[data-blockon="sleeves"] + span'); return ev(() => !!DM.doc.fabric.pieceColors.sleeveL); });
  /* ---------------- scene ---------------- */
  await click('[data-tab="scene"]');
  await t('Studio HDRI toggle, intensity, rotation', async () => {
    await p.fill('[data-k="scene.hdriPower"]', '1.5'); await p.dispatchEvent('[data-k="scene.hdriPower"]', 'change');
    await p.fill('[data-k="scene.hdriRot"]', '90'); await p.dispatchEvent('[data-k="scene.hdriRot"]', 'change');
    const rot = await ev(() => Math.abs(DM.studio.scene.environmentRotation.y - Math.PI / 2) < 0.01);
    await click('[data-k="scene.hdri"] + span'); const off = await ev(() => DM.doc.scene.hdri === false);
    await click('[data-k="scene.hdri"] + span');
    return rot && off;
  });
  await t('Backdrop on/off, shadow, colour, brightness, contrast', async () => {
    await click('[data-k="scene.backdrop"] + span'); const off = await ev(() => DM.studio.wall.visible === false); await click('[data-k="scene.backdrop"] + span');
    await click('[data-k="scene.shadows"] + span'); const sh = await ev(() => DM.studio.key.castShadow === false); await click('[data-k="scene.shadows"] + span');
    await p.click('#tabScene [data-setk="scene.bgColor"][data-val="#d3dccf"]');
    await p.fill('[data-k="scene.bgContrast"]', '1.4'); await p.dispatchEvent('[data-k="scene.bgContrast"]', 'change');
    return off && sh && await ev(() => DM.doc.scene.bgColor === '#d3dccf' && DM.doc.scene.bgContrast === 1.4);
  });
  await t('Backdrop light presets (everyday, Halloween, Christmas) + invert', async () => {
    const ids = await ev(() => [...document.querySelectorAll('[data-k="scene.gobo"] option')].map(o => o.value));
    const groups = await ev(() => [...document.querySelectorAll('[data-k="scene.gobo"] optgroup')].map(g => g.label));
    for (const id of ids) { await p.selectOption('[data-k="scene.gobo"]', id); await wait(60); }
    await p.selectOption('[data-k="scene.gobo"]', 'leaves'); await click('[data-k="scene.goboInvert"] + span'); await click('[data-k="scene.goboInvert"] + span');
    return (ids.length >= 31 && groups.length === 2 && await ev(() => DM.doc.scene.gobo === 'leaves')) || `presets=${ids.length} groups=${groups}`;
  });
  await t('Backdrop stays still while the garment is turned, zoomed and moved', async () => {
    // the backdrop near the top corners must look the same before and after (the garment never reaches there)
    const shot = () => ev(() => { DM.studio.renderFrame(); const src = DM.studio.renderer.domElement, c = document.createElement('canvas'); c.width = 40; c.height = 40; const x = c.getContext('2d'); const out = []; for (const [fx, fy] of [[0.03, 0.03], [0.97, 0.03], [0.03, 0.2], [0.97, 0.2]]) { x.drawImage(src, src.width * fx - 20, src.height * fy - 20, 40, 40, 0, 0, 40, 40); const d = x.getImageData(0, 0, 40, 40).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } out.push([r, g, b].map(v => Math.round(v / 1600))); } return out; });
    const a = await shot();
    await ev(() => { const st = DM.studio, t = st.controls.target, cam = st.camera; st.viewYaw = st.targetYaw = 1.1; st.turntable.rotation.y = 1.1; cam.position.sub(t).setLength(cam.position.distanceTo(t) * 0.55).add(t); cam.position.x += 18; t.x += 18; st.controls.update(); });
    const b = await shot();
    await click('#resetViewBtn');
    const diff = Math.max(...a.flatMap((q, i) => q.map((v, k) => Math.abs(v - b[i][k]))));
    return diff <= 3 || `backdrop moved (largest change ${diff})`;
  });
  await t('Key light side/height/power', async () => { await p.fill('[data-k="scene.lightSide"]', '40'); await p.dispatchEvent('[data-k="scene.lightSide"]', 'change'); return ev(() => DM.doc.scene.lightSide === 40 && DM.studio.key.position.x > 0); });
  await t('Hanger toggle + colour', async () => { await p.click('#tabScene [data-setk="scene.hangerColor"][data-val="#7a5236"]'); await click('#hangerBtn'); const off = await ev(() => DM.doc.scene.hanger === false); await click('#hangerBtn'); return off && await ev(() => DM.doc.scene.hangerColor === '#7a5236'); });
  await t('Neck label toggle (3D bar) + label shape + label colour', async () => {
    await click('#labelBtn'); const off = await ev(() => DM.doc.details.label === false); await click('#labelBtn');
    await p.selectOption('[data-k="details.labelShape"]', 'satin'); await wait(700);
    const shp = await ev(() => { const l = DM.garment.pieces.find(q => q.id === 'label'); return l && l.h > l.w; });
    await click('[data-k="details.labelAsFabric"] + span');
    return off && shp && await ev(() => DM.doc.details.labelAsFabric === true);
  });
  await t('Auto-rotate', async () => { await click('#spinBtn'); const on = await ev(() => DM.studio.autoRotate); await click('#spinBtn'); return on; });
  await t('Default settings: save / reset / factory', async () => { await p.click('#tabScene [data-act="lookSave"]'); await p.click('#tabScene [data-act="lookFactory"]'); const f = await ev(() => DM.doc.scene.bgColor === '#ebeae8'); await p.click('#tabScene [data-act="lookReset"]'); return f && await ev(() => DM.doc.scene.bgColor === '#d3dccf'); });
  /* ---------------- 3D view ---------------- */
  await t('Views Front/Back/Side/¾ + quality menu + reset view', async () => {
    for (const v of ['back', 'side', 'three', 'front']) { await p.click(`#viewSeg [data-view="${v}"]`); await wait(250); }
    await click('#qualityBtn'); await p.click('#qualityMenu [data-q="half"]'); const q = await ev(() => DM.studio.quality === 'half' && document.querySelector('#qualityName').textContent === 'Half');
    await click('#qualityBtn'); await p.click('#qualityMenu [data-q="adaptive"]');
    await click('#resetViewBtn');
    return q;
  });
  await p.screenshot({ path: OUT + '/scene.png' });
  /* ---------------- models ---------------- */
  await t('Models panel: search, filter, list view, switch model', async () => {
    await click('#garmentBtn'); await wait(300);
    await p.fill('#modelSearch', 'hood'); await wait(200); const n = await ev(() => document.querySelectorAll('#modelGrid [data-g]').length);
    await p.fill('#modelSearch', ''); await p.click('#modelChips [data-mg="Fleece"]'); const nf = await ev(() => document.querySelectorAll('#modelGrid [data-g]').length);
    await p.click('[data-mview="list"]'); const list = await ev(() => document.querySelector('#modelGrid').classList.contains('list'));
    await p.click('#modelGrid [data-g="hoodie"]'); await wait(1500);
    return n === 1 && nf === 2 && list && await ev(() => DM.doc.garment === 'hoodie' && DM.doc.items.length > 0) || `search=${n} fleece=${nf}`;
  });
  await t('Switch to the real 3D shirt model and back', async () => {
    await click('#garmentBtn'); await p.click('#modelChips [data-mg="All"]'); await p.click('#modelGrid [data-g="shirt-ls"]'); await wait(8000);
    const ok = await ev(() => DM.doc.garment === 'shirt-ls' && DM.garment.model && DM.studio.panelMeshes?.length > 0);
    await click('#garmentBtn'); await p.click('#modelGrid [data-g="tee"]'); await wait(1500);
    return ok;
  });
  /* ---------------- files ---------------- */
  await t('Save to Your files (Ctrl+S), list, rename, copy, open, delete', async () => {
    await p.keyboard.press('Control+s'); await wait(800);
    await click('#filesBtn'); await wait(500);
    const n = await ev(() => document.querySelectorAll('#filesGrid .fcard').length);
    await p.click('#filesGrid .fcard [data-fact="rename"]'); await wait(500);
    const renamed = await ev(() => document.querySelector('#filesGrid .fcard b')?.textContent === 'Renamed design');
    await p.click('#filesGrid .fcard [data-fact="dup"]'); await wait(500);
    const n2 = await ev(() => document.querySelectorAll('#filesGrid .fcard').length);
    await p.click('#filesGrid .fcard:last-child [data-fact="del"]'); await wait(500);
    const n3 = await ev(() => document.querySelectorAll('#filesGrid .fcard').length);
    await p.click('#filesGrid .fcard [data-fact="open"]'); await wait(1500);
    return n === 1 && renamed && n2 === 2 && n3 === 1 && await ev(() => document.querySelector('#filesDlg').hidden) || `n=${n} renamed=${renamed} dup=${n2} del=${n3}`;
  });
  await t('Download project file + open it again', async () => {
    await click('#exportMoreBtn'); await p.click('#exportMenu [data-act="download"]');
    if (!await waitDl(f => f.endsWith('.dmproj'), 10000)) return 'no .dmproj';
    const f = downloads.find(f => f.endsWith('.dmproj'));
    const n = await ev(() => DM.doc.items.length);
    await p.setInputFiles('#fileProject', OUT + '/' + f); await wait(1500);
    return ev((n) => DM.doc.items.length === n, n);
  });
  /* ---------------- exports ---------------- */
  await t('3D snapshot (header button)', async () => { await click('#shotBtn'); return waitDl(f => f.includes('3d-snapshot'), 10000); });
  await t('Export → Catalogue render: recommended, start, save PNG/WebP/JPEG', async () => {
    await click('#exportBtn'); await wait(300); await click('#rReco');
    const reco = await ev(() => document.querySelector('#rReco').classList.contains('on'));
    await p.selectOption('#rSize', 'custom'); await p.fill('#rW', '500'); await p.fill('#rH', '600'); await p.selectOption('#rQuality', '8');
    for (const v of ['back', 'side', 'front']) { await click(`.rp-bar [data-rv="${v}"]`); await wait(600); }
    const prevOk = await ev(() => { const c = document.querySelector('#rPrevCv'); if (c.hidden || c.width < 50) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 400) if (d[i]) n++; return n > 20; });
    if (!prevOk) return 'frame preview is empty';
    if (await ev(() => document.querySelector('#rView').value !== 'front')) return 'Front button did not set the frame';
    await click('.rp-bar [data-rv="reset"]'); await wait(400);
    await click('#rStart');
    await p.waitForFunction(() => !document.querySelector('#rSavePng').disabled, null, { timeout: 120000 });
    await click('#rSavePng'); await click('#rSaveWebp'); await click('#rSaveJpg');
    const ok = await waitDl(f => f.endsWith('.jpg'), 20000) && downloads.some(f => /render\.png$/.test(f)) && downloads.some(f => f.endsWith('.webp'));
    await p.click('#renderDlg [data-close]');
    return reco && ok || `reco=${reco}`;
  });
  // put a print on the front for the export tests
  await t('Wrap over seams: wide chest print reaches the sleeves', async () => {
    await p.click('[data-tab="design"]'); await ev(() => DM.select(null)); await p.click('[data-preset]:text("Chest")'); await p.setInputFiles('#fileImage', OUT + '/test.png'); await wait(800);
    await ev(() => { const it = DM.selected(); it.w = 62; it.y = 16; DM.itemsChanged(false); });
    await click('[data-k="item.wrap"] + span'); await wait(2500);
    return ev(() => { const wc = DM.wrapCanvas; if (!wc) return 'no wrap layer'; const c = wc.getContext('2d'), k = wc.width / DM.garment.sheet.w; const sl = DM.garment.pieces.find(q => q.id === 'sleeveL'); const d = c.getImageData(sl.sx * k, sl.sy * k, sl.w * k, sl.h * k).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n > 500 || 'sleeve empty'; });
  });
  for (const [name, act, pred, setup] of [
    ['Print files (ZIP) · Original files, different shirt size', 'print', f => f.includes('print-files'), async () => { if (!(await ev(() => document.querySelector('#xSizeOn').checked))) await click('#xSizeOn'); await p.fill('#xSizeW', '60'); await p.dispatchEvent('#xSizeW', 'change'); await click('#xFmt [data-v="orig"]'); }],
    ['Print files (ZIP) · PNG only', 'print', () => downloads.filter(x => x.includes('print-files')).length >= 2, async () => { await click('#xSizeOn'); await click('#xFmt [data-v="png"]'); }],
    ['Spec sheet (PDF)', 'spec', f => f.endsWith('spec-sheet.pdf'), null],
    ['Sublimation panels (ZIP) · 15 mm bleed, cut line, mirrored', 'subl', f => f.includes('sublimation'), async () => { await click('#xBleed [data-v="15"]'); await click('#xCut'); await click('#xMirror'); }],
  ]) {
    await t(name, async () => {
      await click('#exportMoreBtn'); await p.click(`#exportMenu [data-act="${act}"]`); await wait(400);
      if (await ev(() => document.querySelector('#xDlg').hidden)) return 'options dialog did not open';
      if (setup) await setup();
      await click('#xGo');
      return waitDl(pred, 300000);
    });
  }
  await t('Shirt size outside the range is refused', async () => {
    await click('#exportMoreBtn'); await p.click('#exportMenu [data-act="spec"]'); await wait(300);
    if (!(await ev(() => document.querySelector('#xSizeOn').checked))) await click('#xSizeOn');
    await p.fill('#xSizeW', '5'); await p.dispatchEvent('#xSizeW', 'change'); await click('#xGo'); await wait(300);
    const msg = await ev(() => !document.querySelector('#xSizeErr').hidden && document.querySelector('#xSizeErr').textContent);
    await click('#xSizeOn');
    return /Enter a width between/.test(msg || '') || 'no range message';
  });
  await t('Sewing pattern PNG', async () => { await click('#exportMoreBtn'); await p.click('#exportMenu [data-act="pattern"]'); return waitDl(f => f.includes('pattern.png'), 180000); });

  await t('Turntable video (9:16, 6 s)', async () => {
    await click('#exportMoreBtn'); await p.click('#exportMenu [data-act="video"]'); await p.click('#vDur [data-d="6"]');
    await click('#vStart');
    const ok = await waitDl(f => /turntable.*\.(mp4|webm)$/.test(f), 600000);
    if (ok) { const f = downloads.find(x => /turntable/.test(x)); const head = fs.readFileSync(OUT + '/' + f).subarray(4, 8).toString(); if (f.endsWith('.mp4') && head !== 'ftyp') return 'not an MP4: ' + head; }
    await p.click('#videoDlg [data-close]').catch(() => {});
    return ok || await ev(() => document.querySelector('#vStatus').textContent);
  });
  /* ---------------- new design + tour ---------------- */
  await t('New design clears artwork (undo brings it back)', async () => { const n = await ev(() => DM.doc.items.length); await click('#newBtn'); const z = await ev(() => DM.doc.items.length === 0); await p.keyboard.press('Control+z'); await wait(500); return z && await ev((n) => DM.doc.items.length === n, n); });
  await t('Quick tour: 6 steps, next/back/skip', async () => {
    await click('#tourBtn'); await wait(300);
    for (let i = 0; i < 5; i++) await click('#tourNext');
    const last = await ev(() => document.querySelector('#tourStep').textContent === '6 of 6' && document.querySelector('#tourNext').textContent === 'Done');
    await click('#tourBack'); await click('#tourSkip');
    return last && await ev(() => document.querySelector('#tour').hidden);
  });
  await t('Theme toggle', async () => { await click('#themeBtn'); const d = await ev(() => document.documentElement.dataset.theme); await click('#themeBtn'); return !!d; });
  await t('Layout modes 1/2/3', async () => { await p.mouse.click(700, 500); for (const k of ['1', '3', '2']) { await p.keyboard.press(k); await wait(200); } return ev(() => document.querySelector('#work').classList.contains('mode-split')); });
  await p.screenshot({ path: OUT + '/final.png' });
    console.log(`\n${results.filter(r => r.startsWith('PASS')).length}/${results.length} passed`);
  console.log('downloads:', downloads.join(', '));
  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
  await b.close();
})();
