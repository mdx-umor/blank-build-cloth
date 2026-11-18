// Design Master — 2D sewing-pattern editor (canvas). Works in sheet centimetres.
//
// Mouse:  scroll = zoom · right-drag / middle-drag / Space-drag / Hand tool = move the sheet
//         double-click empty sheet = fit · double-click text = edit it
//         drag artwork = move (Ctrl/⌘ held = no snapping, Alt held = drag a copy)
//         drag a corner square = scale · drag just outside a corner (or the top knob) = rotate
//         Shift-click = add/remove from the selection · drag on empty sheet = selection box
//         Shape tools: press on a piece and drag to draw (Shift = even), Esc cancels.
import { drawItem, piecePath, itemCorners, hitItem, itemHeight, imageAspect, getImage } from './atlas.js';
import { pointInPoly, clamp, deg, rad, uid } from './util.js';

const HANDLE = 7, RULER = 22;

export class PatternEditor {
  constructor(canvas, app) {
    this.cv = canvas; this.app = app; this.ctx = canvas.getContext('2d');
    this.view = { s: 4, ox: 0, oy: 0 };
    this.tool = 'select'; this.space = false; this.guides = [];
    this.drag = null; this.hover = null;
    new ResizeObserver(() => { this.resize(); }).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', e => this.dbl(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      if (isTyping(e)) return;
      if (e.code === 'Space') { this.space = true; this.cursor(); }
      if (e.key === 'Escape' && this.drag?.mode === 'draw') { this.drag = null; this.redraw(); }
    });
    window.addEventListener('keyup', e => { if (e.code === 'Space') { this.space = false; this.cursor(); } });
    this.raf = 0;
  }
  get g() { return this.app.garment; }
  get inside() { return this.app.doc.view?.side === 'in'; }
  resize() {
    const p = this.cv.parentElement, dpr = window.devicePixelRatio || 1;
    this.w = p.clientWidth; this.h = p.clientHeight;
    this.cv.width = Math.max(1, this.w * dpr); this.cv.height = Math.max(1, this.h * dpr);
    this.dpr = dpr;
    if (!this._fitted && this.g) { this.fit(); this._fitted = true; }
    this.redraw();
  }
  // pieces shown in the current view: outside view hides inside-only pieces (label, facings)
  visiblePieces() { return this.g.pieces.filter(p => this.inside ? true : !p.insideOnly); }
  fit() {
    if (!this.g || !this.w) return;
    const ps = this.visiblePieces();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of ps) { x0 = Math.min(x0, p.sx); y0 = Math.min(y0, p.sy); x1 = Math.max(x1, p.sx + p.w); y1 = Math.max(y1, p.sy + p.h); }
    if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = this.g.sheet.w; y1 = this.g.sheet.h; }
    x0 -= 4; y0 -= 6; x1 += 4; y1 += 10;
    const padL = RULER + 64, padR = 20, padT = RULER + 20, padB = 70;
    const s = Math.min((this.w - padL - padR) / (x1 - x0), (this.h - padT - padB) / (y1 - y0));
    this.view.s = s; this.fitS = s;
    this.view.ox = padL + ((this.w - padL - padR) - (x1 - x0) * s) / 2 - x0 * s;
    this.view.oy = padT + ((this.h - padT - padB) - (y1 - y0) * s) / 2 - y0 * s;
    this.redraw(); this.app.onZoom?.();
  }
  zoom(f, cx = this.w / 2, cy = this.h / 2) {
    const v = this.view, ns = clamp(v.s * f, 0.6, 140);
    v.ox = cx - (cx - v.ox) * ns / v.s; v.oy = cy - (cy - v.oy) * ns / v.s; v.s = ns;
    this.redraw(); this.app.onZoom?.();
  }
  // 100 % = the whole pattern fitted in the pane
  zoomPct() { return Math.round(this.view.s / (this.fitS || this.view.s) * 100); }
  toSheet(e) { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left - this.view.ox) / this.view.s, (e.clientY - r.top - this.view.oy) / this.view.s]; }
  toScreen(x, y) { return [x * this.view.s + this.view.ox, y * this.view.s + this.view.oy]; }
  // piece-local "display" coordinates: in the inside view pieces are mirrored (seen from inside)
  mirrorOf(p) { return this.inside && !p.noMirror; }
  localPoly(p) { return this.mirrorOf(p) ? p.poly.map(([x, y]) => [p.w - x, y]) : p.poly; }
  // the piece a drawn shape belongs to: the one under its middle, else the one it covers most (a rectangle drawn
  // over a thin neck rib starts and ends off the rib), else none
  pieceUnder(x0, y0, x1, y1, line = false) {
    const mid = this.pieceAt((x0 + x1) / 2, (y0 + y1) / 2);
    if (mid) return mid;
    let best = null, bestN = 0;
    for (const p of this.visiblePieces()) {
      const poly = this.localPoly(p); let n = 0;
      for (let i = 0; i <= 16; i++) for (let j = 0; j <= (line ? 0 : 16); j++) {
        const x = line ? x0 + (x1 - x0) * i / 16 : Math.min(x0, x1) + Math.abs(x1 - x0) * i / 16;
        const y = line ? y0 + (y1 - y0) * i / 16 : Math.min(y0, y1) + Math.abs(y1 - y0) * j / 16;
        if (pointInPoly(x - p.sx, y - p.sy, poly)) n++;
      }
      if (n > bestN) { bestN = n; best = p; }
    }
    return best;
  }
  pieceAt(x, y) { return this.visiblePieces().find(p => pointInPoly(x - p.sx, y - p.sy, this.localPoly(p))); }
  piece(id) { return this.g.pieces.find(p => p.id === id); }
  face() { return this.inside ? 'in' : 'out'; }
  itemsHere() { const f = this.face(); return this.app.doc.items.filter(i => (i.face || 'out') === f); }
  cursor() {
    const t = this.drag?.mode;
    const c = t === 'pan' ? 'grabbing' : (this.space || this.tool === 'hand') ? 'grab' : this.tool.startsWith('shape:') ? 'crosshair'
      : this.hover === 'rot' ? 'grab' : this.hover === 'scale' ? 'nwse-resize' : this.hover === 'w' ? 'ew-resize' : this.hover === 'h' ? 'ns-resize' : this.hover === 'item' ? 'move' : 'default';
    this.cv.style.cursor = c;
  }

  /* ---------- hit testing ---------- */
  itemAt(x, y) {
    const items = this.itemsHere();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]; if (it.hidden || it.locked) continue;
      const p = this.piece(it.piece); if (!p) continue;
      if (hitItem(it, this.app.assets, x - p.sx, y - p.sy, 0.2)) return it;
    }
    return null;
  }
  handlesFor(it) {
    const p = this.piece(it.piece); if (!p) return {};
    const c = itemCorners(it, this.app.assets).map(([x, y]) => this.toScreen(x + p.sx, y + p.sy));
    const a = rad(it.rot || 0);
    const topMid = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
    const rot = [topMid[0] + Math.sin(a) * 26, topMid[1] - Math.cos(a) * 26];
    const hs = c.map((pt, i) => ({ type: 'scale', pt, i }));
    hs.push({ type: 'rot', pt: rot, from: topMid });
    if (it.type === 'shape' && it.shape !== 'line') {
      hs.push({ type: 'w', pt: [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2] });
      hs.push({ type: 'h', pt: [(c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2] });
    }
    return { hs, corners: c };
  }
  handleAt(e) {
    const it = this.app.selected();
    if (!it || it.locked || this.app.selIds.length > 1 || (it.face || 'out') !== this.face()) return null;
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const { hs, corners } = this.handlesFor(it);
    for (const h of hs || []) if (Math.hypot(h.pt[0] - mx, h.pt[1] - my) <= HANDLE + 3) return h;
    // just outside a corner → rotate
    if (corners) {
      const cx = corners.reduce((s, p) => s + p[0], 0) / 4, cy = corners.reduce((s, p) => s + p[1], 0) / 4;
      for (const p of corners) {
        const d = Math.hypot(p[0] - mx, p[1] - my);
        const out = Math.hypot(mx - cx, my - cy) > Math.hypot(p[0] - cx, p[1] - cy);
        if (d > HANDLE + 2 && d < 26 && out) return { type: 'rot', pt: p };
      }
    }
    return null;
  }

  /* ---------- pointer ---------- */
  down(e) {
    if (!this.g) return;
    this.cv.setPointerCapture?.(e.pointerId);
    const [x, y] = this.toSheet(e);
    if (e.button === 1 || e.button === 2 || this.space || this.tool === 'hand') { this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: this.view.ox, oy: this.view.oy }; this.cursor(); return; }
    if (e.button !== 0) return;
    if (this.crop) { if (!this.crop.down(e)) this.app.endCrop(true); this.redraw(); return; }
    if (this.tool.startsWith('shape:')) { // draw anywhere: the shape goes on the piece it covers most
      this.drag = { mode: 'draw', shape: this.tool.slice(6), x0: x, y0: y, x1: x, y1: y };
      return;
    }
    const h = this.handleAt(e);
    const sel = this.app.selected();
    if (h && sel) {
      const p = this.piece(sel.piece);
      const cx = sel.x + p.sx, cy = sel.y + p.sy;
      this.drag = { mode: h.type, it: sel, cx, cy, w0: sel.w, h0: sel.h, rot0: sel.rot || 0, d0: Math.hypot(x - cx, y - cy), a0: Math.atan2(y - cy, x - cx), moved: false };
      return;
    }
    let it = this.itemAt(x, y);
    if (it) {
      if (e.shiftKey) { this.app.toggleSelect(it.id); this.redraw(); return; }
      if (!this.app.selIds.includes(it.id)) this.app.select(it.id);
      let group = this.app.selectedItems().filter(i => !i.locked);
      if (e.altKey) { group = this.app.duplicateItems(group, 0); it = group.find(Boolean); } // Alt-drag = copy
      this.drag = { mode: 'move', it, group: group.map(g => ({ it: g, x: g.x, y: g.y, px: this.piece(g.piece).sx, py: this.piece(g.piece).sy })), x0: x, y0: y, moved: false };
    } else {
      if (!e.shiftKey) this.app.select(null);
      this.drag = { mode: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, base: [...this.app.selIds] };
    }
    this.redraw();
  }
  move(e) {
    if (!this.g) return;
    const d = this.drag;
    if (this.crop && !d) {
      if (this.crop.drag) { this.crop.move(e); return; }
      if (e.target === this.cv) this.cv.style.cursor = this.crop.hover(e);
      return;
    }
    if (!d) {
      if (e.target !== this.cv) return;
      const h = this.handleAt(e);
      const [x, y] = this.toSheet(e);
      this.hover = h ? h.type : this.itemAt(x, y) ? 'item' : null;
      this.cursor();
      return;
    }
    if (d.mode === 'pan') { this.view.ox = d.ox + e.clientX - d.sx; this.view.oy = d.oy + e.clientY - d.sy; this.cv.style.cursor = 'grabbing'; this.redraw(); return; }
    const [x, y] = this.toSheet(e);
    if (d.mode === 'draw') {
      d.x1 = x; d.y1 = y;
      if (e.shiftKey && d.shape !== 'line') { const s = Math.max(Math.abs(x - d.x0), Math.abs(y - d.y0)); d.x1 = d.x0 + Math.sign(x - d.x0 || 1) * s; d.y1 = d.y0 + Math.sign(y - d.y0 || 1) * s; }
      if (e.shiftKey && d.shape === 'line') { const a = Math.round(Math.atan2(y - d.y0, x - d.x0) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(x - d.x0, y - d.y0); d.x1 = d.x0 + Math.cos(a) * L; d.y1 = d.y0 + Math.sin(a) * L; }
      this.redraw(); return;
    }
    if (d.mode === 'box') {
      d.x1 = x; d.y1 = y;
      const bx0 = Math.min(d.x0, x), bx1 = Math.max(d.x0, x), by0 = Math.min(d.y0, y), by1 = Math.max(d.y0, y);
      const hits = this.itemsHere().filter(it => {
        if (it.hidden || it.locked) return false;
        const p = this.piece(it.piece); if (!p) return false;
        return itemCorners(it, this.app.assets).some(([cx, cy]) => cx + p.sx >= bx0 && cx + p.sx <= bx1 && cy + p.sy >= by0 && cy + p.sy <= by1);
      }).map(i => i.id);
      this.app.setSelection(d.add ? [...new Set([...d.base, ...hits])] : hits, true);
      this.redraw(); return;
    }
    const it = d.it, p = this.piece(it.piece);
    d.moved = true;
    this.guides = [];
    this.readout = null;
    if (d.mode === 'move') {
      let dx = x - d.x0, dy = y - d.y0;
      const lead = d.group[0];
      if (!(e.ctrlKey || e.metaKey) && lead) { // snap the lead item to its piece's centre lines
        const lp = this.piece(lead.it.piece), tol = 8 / this.view.s, pcx = lp.w / 2, pcy = lp.h / 2;
        const nx = lead.x + dx + lead.px - lp.sx, ny = lead.y + dy + lead.py - lp.sy;
        if (Math.abs(nx - pcx) < tol) { dx += pcx - nx; this.guides.push(['v', lp.sx + pcx, lp]); }
        if (Math.abs(ny - pcy) < tol) { dy += pcy - ny; this.guides.push(['h', lp.sy + pcy, lp]); }
      }
      for (const gi of d.group) { const gp = this.piece(gi.it.piece); gi.it.x = gi.x + dx + gi.px - gp.sx; gi.it.y = gi.y + dy + gi.py - gp.sy; }
      // position readout from the piece's top-left corner
      const lp = this.piece(it.piece), cs = itemCorners(it, this.app.assets);
      this.readout = { it, text: `${this.app.fmtLen(Math.min(...cs.map(c => c[0])))} × ${this.app.fmtLen(Math.min(...cs.map(c => c[1])))} ${this.app.unit()} from corner` };
    } else if (d.mode === 'scale') {
      const k = Math.hypot(x - d.cx, y - d.cy) / (d.d0 || 1);
      it.w = clamp(d.w0 * k, 0.3, 400);
      if (it.type === 'shape') it.h = clamp(d.h0 * k, 0.05, 400);
    } else if (d.mode === 'w' || d.mode === 'h') {
      const a = rad(it.rot || 0), dx = x - d.cx, dy = y - d.cy;
      const lx = dx * Math.cos(-a) - dy * Math.sin(-a), ly = dx * Math.sin(-a) + dy * Math.cos(-a);
      if (d.mode === 'w') it.w = clamp(Math.abs(lx) * 2, 0.3, 400); else it.h = clamp(Math.abs(ly) * 2, 0.05, 400);
    } else if (d.mode === 'rot') {
      let r = d.rot0 + deg(Math.atan2(y - d.cy, x - d.cx) - d.a0);
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      else for (const s of [0, 90, 180, -90, -180, 270]) if (Math.abs(r - s) < 2.5) r = s;
      it.rot = ((r + 540) % 360) - 180;
    }
    this.app.itemsChanged(true);
  }
  up(e) {
    if (this.crop?.drag) { this.crop.up(); this.redraw(); return; }
    const d = this.drag; this.drag = null; this.guides = []; this.readout = null;
    if (!d) return;
    if (d.mode === 'pan') { this.cursor(); this.redraw(); return; }
    if (d.mode === 'box') { this.app.setSelection(this.app.selIds); this.redraw(); return; }
    if (d.mode === 'draw') {
      const line = d.shape === 'line' || d.shape === 'dashed';
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0), L = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
      const big = line ? L > 0.4 : w > 0.4 && h > 0.4;
      const p = big && this.pieceUnder(d.x0, d.y0, d.x1, d.y1, line);
      if (big && !p) this.app.toast?.('Draw the shape over a pattern piece.');
      else if (p && line) this.app.addShapeAt(d.shape, p.id, (d.x0 + d.x1) / 2 - p.sx, (d.y0 + d.y1) / 2 - p.sy, L, 0.4, deg(Math.atan2(d.y1 - d.y0, d.x1 - d.x0)));
      else if (p) this.app.addShapeAt(d.shape, p.id, (d.x0 + d.x1) / 2 - p.sx, (d.y0 + d.y1) / 2 - p.sy, w, h, 0); // positions are in display space (mirrored inside)
      this.app.setTool('select');
      this.redraw(); return;
    }
    if (d.moved && d.mode === 'move') {
      // re-home each item onto whichever piece its centre landed on
      for (const gi of d.group) {
        const it = gi.it, p = this.piece(it.piece);
        const sx = it.x + p.sx, sy = it.y + p.sy;
        const np = this.pieceAt(sx, sy);
        if (np && np.id !== p.id) { it.piece = np.id; it.x = sx - np.sx; it.y = sy - np.sy; }
      }
    }
    if (d.moved || d.copied) { this.app.itemsChanged(false); this.app.commit(); }
    this.redraw();
  }
  // Scroll wheel or pinch = zoom; two-finger swipe on a trackpad = move. A gesture (wheel events with no pause of
  // 250 ms) is classified once, from its first event, and keeps that meaning to the end: a faster swipe or its
  // momentum never flips into zooming half-way.
  wheel(e) {
    e.preventDefault();
    const r = this.cv.getBoundingClientRect(), now = performance.now();
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1; // lines / pages → pixels
    const dx = e.deltaX * k, dy = e.deltaY * k;
    if (!this.wheelG || now - this.wheelG.t > 250) {
      const mouse = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      this.wheelG = { mode: mouse && !e.shiftKey ? 'zoom' : 'pan' };
    }
    this.wheelG.t = now;
    if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-dy * 0.01), e.clientX - r.left, e.clientY - r.top); // pinch, or Ctrl + wheel
    else if (this.wheelG.mode === 'zoom') this.zoom(Math.exp(-dy * 0.0018), e.clientX - r.left, e.clientY - r.top);
    else { const sx = e.shiftKey && !dx ? dy : dx, sy = e.shiftKey && !dx ? 0 : dy; this.view.ox -= sx; this.view.oy -= sy; this.redraw(); this.app.onZoom?.(); }
  }
  dbl(e) {
    const [x, y] = this.toSheet(e);
    const it = this.itemAt(x, y);
    if (this.crop) return;
    if (it?.type === 'text') this.app.focusText();
    else if (it?.type === 'image') this.app.startCrop(it);
    else if (!it) this.fit();
  }

  /* ---------- drawing ---------- */
  redraw() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  draw() {
    const c = this.ctx, g = this.g; if (!g) return;
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = col('--mat-bg'); c.fillRect(0, 0, this.w, this.h);
    const v = this.view;
    // dot grid every 5 cm (1 cm when zoomed in)
    const step = v.s > 14 ? 1 : 5;
    const gx0 = Math.floor(-v.ox / v.s / step) * step, gy0 = Math.floor(-v.oy / v.s / step) * step;
    c.fillStyle = col('--dot');
    for (let gx = gx0; gx * v.s + v.ox < this.w; gx += step) for (let gy = gy0; gy * v.s + v.oy < this.h; gy += step) {
      const big = gx % 10 === 0 && gy % 10 === 0;
      c.fillRect(gx * v.s + v.ox - (big ? 1 : 0.5), gy * v.s + v.oy - (big ? 1 : 0.5), big ? 2 : 1, big ? 2 : 1);
    }
    c.save();
    c.translate(v.ox, v.oy); c.scale(v.s, v.s);
    const base = this.inside ? this.app.insideBase || this.app.baseCanvas : this.app.baseCanvas;
    const marks = this.app.doc.view?.marks !== false;
    const selIds = this.app.selIds;
    const face = this.face();
    const pieces = this.visiblePieces();
    for (const p of pieces) {
      const mx = this.mirrorOf(p);
      c.save(); c.translate(p.sx, p.sy);
      const lp = { ...p, poly: this.localPoly(p), holes: mx ? (p.holes || []).map(h => h.map(([x, y]) => [p.w - x, y])) : p.holes };
      c.save(); c.shadowColor = 'rgba(16,24,40,.12)'; c.shadowBlur = 10; c.shadowOffsetY = 2;
      piecePath(c, lp); c.fillStyle = this.app.doc.fabric.color; c.fill(); c.restore();
      c.save(); piecePath(c, lp); c.clip();
      if (base) { c.save(); if (mx) { c.translate(p.w, 0); c.scale(-1, 1); } c.drawImage(base, -p.sx, -p.sy, g.sheet.w, g.sheet.h); c.restore(); }
      if (p.id === 'label') { c.fillStyle = this.app.labelColour(); c.fillRect(0, 0, p.w, p.h); }
      if (this.inside && !p.insideOnly) { c.fillStyle = 'rgba(0,0,0,.06)'; c.fillRect(0, 0, p.w, p.h); }
      const wrap = !this.inside && this.app.wrapCanvas;
      for (const it of this.app.doc.items) if (it.piece === p.id && (it.face || 'out') === face && !(wrap && it.wrap)) drawItem(c, it, this.app.assets, () => this.app.assetReady(), v.s * this.dpr);
      if (wrap) c.drawImage(wrap, -p.sx, -p.sy, g.sheet.w, g.sheet.h); // prints wrapped over seams, as baked from 3D
      c.restore();
      c.restore();
    }
    // ghosts of selected items outside their piece, so nothing "disappears" while placing
    for (const sel of this.app.selectedItems()) {
      if (sel.hidden || (sel.face || 'out') !== face) continue;
      const p = this.piece(sel.piece); if (!p) continue;
      c.save(); c.translate(p.sx, p.sy); c.globalAlpha = 0.28;
      c.beginPath(); c.rect(-1e4, -1e4, 2e4, 2e4); piecePath(c, { poly: this.localPoly(p) }); c.clip('evenodd');
      drawItem(c, sel, this.app.assets, null, v.s * this.dpr); c.restore();
    }
    // outlines & markings
    for (const p of pieces) {
      const lp = { poly: this.localPoly(p), holes: this.mirrorOf(p) ? (p.holes || []).map(h => h.map(([x, y]) => [p.w - x, y])) : p.holes };
      c.save(); c.translate(p.sx, p.sy);
      piecePath(c, lp);
      c.lineWidth = 1.3 / v.s; c.strokeStyle = col('--piece-line'); c.stroke();
      if (marks) {
        c.setLineDash([6 / v.s, 4 / v.s]); c.lineWidth = 1 / v.s; c.strokeStyle = col('--faint');
        for (const f of p.folds || []) { c.beginPath(); const a = this.mirrorOf(p) ? f.map(([x, y]) => [p.w - x, y]) : f; c.moveTo(...a[0]); c.lineTo(...a[1]); c.stroke(); }
        c.setLineDash([]);
      }
      // name + size under the piece, like a printed cutting sheet
      const fs = clamp(12 / v.s, 0.7, 3.4);
      c.textAlign = 'center'; c.fillStyle = col('--piece-ink');
      c.font = `500 ${fs}px Inter, system-ui, sans-serif`; c.globalAlpha = 0.9;
      const name = this.inside && !p.insideOnly ? `${p.label} · inside` : p.label;
      c.fillText(name, p.w / 2, p.h + fs * 1.45);
      c.font = `400 ${fs * 0.85}px Inter, system-ui, sans-serif`; c.globalAlpha = 0.55;
      c.fillText(`${this.app.fmtLen(p.w)} × ${this.app.fmtLen(p.h)} ${this.app.unit()} · cut 1`, p.w / 2, p.h + fs * 2.7);
      c.globalAlpha = 1;
      c.restore();
    }
    // snap guides
    for (const [t, val, p] of this.guides) {
      c.beginPath(); c.strokeStyle = col('--accent'); c.lineWidth = 1 / v.s; c.setLineDash([4 / v.s, 3 / v.s]);
      if (t === 'v') { c.moveTo(val, p.sy - 2); c.lineTo(val, p.sy + p.h + 2); } else { c.moveTo(p.sx - 2, val); c.lineTo(p.sx + p.w + 2, val); }
      c.stroke(); c.setLineDash([]);
    }
    // shape being drawn
    const d = this.drag;
    if (d?.mode === 'draw') {
      c.strokeStyle = col('--accent'); c.lineWidth = 1.5 / v.s; c.setLineDash([5 / v.s, 3 / v.s]);
      if (d.shape === 'line' || d.shape === 'dashed') { c.beginPath(); c.moveTo(d.x0, d.y0); c.lineTo(d.x1, d.y1); c.stroke(); }
      else c.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      c.setLineDash([]);
    }
    c.restore();
    // selection box (marquee)
    if (d?.mode === 'box') {
      const [ax, ay] = this.toScreen(d.x0, d.y0), [bx, by] = this.toScreen(d.x1, d.y1);
      c.fillStyle = col('--accent-soft'); c.globalAlpha = 0.35; c.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); c.globalAlpha = 1;
      c.strokeStyle = col('--accent'); c.lineWidth = 1; c.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax), Math.abs(by - ay));
    }
    // selection frames
    const single = selIds.length === 1;
    for (const sel of this.app.selectedItems()) {
      if (sel.hidden || (sel.face || 'out') !== face || this.crop?.it === sel) continue;
      const hd = this.handlesFor(sel);
      if (!hd.corners) continue;
      c.beginPath(); hd.corners.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath();
      c.strokeStyle = col('--accent'); c.lineWidth = 1.5; c.stroke();
      if (single && !sel.locked) for (const h of hd.hs) {
        if (h.type === 'rot') { c.beginPath(); c.moveTo(...h.from); c.lineTo(...h.pt); c.stroke(); c.beginPath(); c.arc(h.pt[0], h.pt[1], HANDLE - 1, 0, Math.PI * 2); c.fillStyle = col('--accent'); c.fill(); continue; }
        c.beginPath(); c.rect(h.pt[0] - HANDLE / 2 - 1, h.pt[1] - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2);
        c.fillStyle = '#fff'; c.fill(); c.strokeStyle = col('--accent'); c.stroke();
      }
      if (single) {
        const u = this.app.unit(), hcm = itemHeight(sel, this.app.assets);
        const txt = this.readout?.it === sel ? this.readout.text : `${this.app.fmtLen(sel.w)} × ${this.app.fmtLen(hcm)} ${u}`;
        const bx = (Math.min(...hd.corners.map(p => p[0])) + Math.max(...hd.corners.map(p => p[0]))) / 2, by = Math.max(...hd.corners.map(p => p[1]));
        c.font = '600 11px Inter, system-ui, sans-serif'; const tw = c.measureText(txt).width + 12;
        c.fillStyle = col('--accent'); c.beginPath(); c.roundRect(bx - tw / 2, by + 8, tw, 20, 5); c.fill();
        c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(txt, bx, by + 22);
      }
    }
    if (this.crop) this.crop.draw(c);
    this.drawRulers(c, col);
    this.app.onZoom?.();
  }
  drawRulers(c, col) {
    const v = this.view, u = this.app.unit();
    const unitCm = u === 'in' ? 2.54 : u === 'mm' ? 0.1 : 1;
    // pick a major step (in units) that gives ~70 px between labels
    const pxPerUnit = v.s * unitCm;
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const major = steps.find(s => s * pxPerUnit >= 60) || 1000;
    const minor = major / (major % 5 === 0 ? 5 : 2);
    c.fillStyle = col('--panel'); c.fillRect(0, 0, this.w, RULER); c.fillRect(0, 0, RULER, this.h);
    c.strokeStyle = col('--line-strong'); c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, RULER - 0.5); c.lineTo(this.w, RULER - 0.5); c.moveTo(RULER - 0.5, 0); c.lineTo(RULER - 0.5, this.h); c.stroke();
    c.fillStyle = col('--muted'); c.font = '9.5px Inter, system-ui, sans-serif';
    c.strokeStyle = col('--faint');
    const x0 = Math.floor(-v.ox / pxPerUnit / minor) * minor;
    for (let t = x0; t * pxPerUnit + v.ox < this.w; t += minor) {
      const X = Math.round(t * pxPerUnit + v.ox) + 0.5; if (X < RULER) continue;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      c.beginPath(); c.moveTo(X, RULER); c.lineTo(X, RULER - (isMajor ? 9 : 4)); c.stroke();
      if (isMajor) { c.textAlign = 'left'; c.fillText(String(Math.round(t * 100) / 100), X + 2, 10); }
    }
    const y0 = Math.floor(-v.oy / pxPerUnit / minor) * minor;
    for (let t = y0; t * pxPerUnit + v.oy < this.h; t += minor) {
      const Y = Math.round(t * pxPerUnit + v.oy) + 0.5; if (Y < RULER) continue;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      c.beginPath(); c.moveTo(RULER, Y); c.lineTo(RULER - (isMajor ? 9 : 4), Y); c.stroke();
      if (isMajor) { c.save(); c.translate(10, Y + 2); c.rotate(-Math.PI / 2); c.textAlign = 'right'; c.fillText(String(Math.round(t * 100) / 100), 0, 0); c.restore(); }
    }
    c.fillStyle = col('--panel'); c.fillRect(0, 0, RULER, RULER);
    c.fillStyle = col('--muted'); c.textAlign = 'center'; c.fillText(u, RULER / 2, 14);
  }
}

function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

/* ---------- crop in place: drag the edges to crop, drag inside to move the picture under the frame ----------
   The full picture keeps its place on the piece; the frame (in the picture's own unrotated cm, centred on the
   full picture) decides what shows. The file itself is never changed. */
export class CropSession {
  constructor(ed, it) {
    this.ed = ed; this.it = it; this.drag = null;
    this.orig = { crop: it.crop ? { ...it.crop } : null, x: it.x, y: it.y, w: it.w, aspect: it.aspect };
    const c = it.crop || { x: 0, y: 0, w: 1, h: 1 }, h = itemHeight(it, ed.app.assets);
    const s = this.s = it.flip ? -1 : 1, fw = this.fw = it.w / c.w, fh = this.fh = h / c.h;
    const u0 = c.x, u1 = c.x + c.w;
    this.f = { x0: s > 0 ? (u0 - 0.5) * fw : (0.5 - u1) * fw, x1: s > 0 ? (u1 - 0.5) * fw : (0.5 - u0) * fw, y0: (c.y - 0.5) * fh, y1: (c.y + c.h - 0.5) * fh };
    const [mx, my] = this.rot((this.f.x0 + this.f.x1) / 2, (this.f.y0 + this.f.y1) / 2);
    this.cx = it.x - mx; this.cy = it.y - my;
  }
  rot(x, y, inv = false) { const a = rad(this.it.rot || 0) * (inv ? -1 : 1), c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }
  get p() { return this.ed.piece(this.it.piece); }
  // pointer → full-picture local cm (unrotated, from the full picture's centre)
  local(e) { const [x, y] = this.ed.toSheet(e), p = this.p; return this.rot(x - p.sx - this.cx, y - p.sy - this.cy, true); }
  screen(lx, ly) { const [x, y] = this.rot(lx, ly), p = this.p; return this.ed.toScreen(p.sx + this.cx + x, p.sy + this.cy + y); }
  handles() {
    const f = this.f, mx = (f.x0 + f.x1) / 2, my = (f.y0 + f.y1) / 2;
    return [['nw', f.x0, f.y0], ['n', mx, f.y0], ['ne', f.x1, f.y0], ['e', f.x1, my], ['se', f.x1, f.y1], ['s', mx, f.y1], ['sw', f.x0, f.y1], ['w', f.x0, my]].map(([h, x, y]) => ({ h, pt: this.screen(x, y) }));
  }
  handleAt(e) {
    const r = this.ed.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    return this.handles().find(h => Math.hypot(h.pt[0] - mx, h.pt[1] - my) <= 10)?.h || null;
  }
  inside(e) { const [lx, ly] = this.local(e), f = this.f; return lx >= f.x0 && lx <= f.x1 && ly >= f.y0 && ly <= f.y1; }
  hover(e) { const h = this.handleAt(e); return h ? ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h]) : this.inside(e) ? 'move' : 'default'; }
  /** returns false when the press was outside the frame (the caller then finishes cropping) */
  down(e) {
    const h = this.handleAt(e);
    if (h) { this.drag = { h }; return true; }
    if (this.inside(e)) { const [x, y] = this.ed.toSheet(e); this.drag = { h: 'move', x, y, cx: this.cx, cy: this.cy, f: { ...this.f } }; return true; }
    return false;
  }
  move(e) {
    const d = this.drag; if (!d) return;
    const f = this.f, m = 0.3, W = this.fw / 2, H = this.fh / 2;
    if (d.h === 'move') {
      const [x, y] = this.ed.toSheet(e);
      let [lx, ly] = this.rot(x - d.x, y - d.y, true);
      lx = clamp(lx, d.f.x1 - W, d.f.x0 + W); ly = clamp(ly, d.f.y1 - H, d.f.y0 + H);
      const [gx, gy] = this.rot(lx, ly);
      this.cx = d.cx + gx; this.cy = d.cy + gy;
      Object.assign(f, { x0: d.f.x0 - lx, x1: d.f.x1 - lx, y0: d.f.y0 - ly, y1: d.f.y1 - ly });
    } else {
      const [lx, ly] = this.local(e);
      if (d.h.includes('w')) f.x0 = clamp(lx, -W, f.x1 - m);
      if (d.h.includes('e')) f.x1 = clamp(lx, f.x0 + m, W);
      if (d.h.includes('n')) f.y0 = clamp(ly, -H, f.y1 - m);
      if (d.h.includes('s')) f.y1 = clamp(ly, f.y0 + m, H);
    }
    this.apply();
  }
  up() { this.drag = null; }
  apply() {
    const { f, s, fw, fh, it } = this;
    const u0 = s > 0 ? 0.5 + f.x0 / fw : 0.5 - f.x1 / fw, u1 = s > 0 ? 0.5 + f.x1 / fw : 0.5 - f.x0 / fw;
    const v0 = 0.5 + f.y0 / fh, v1 = 0.5 + f.y1 / fh, e = 1e-4;
    if (u0 <= e && v0 <= e && u1 >= 1 - e && v1 >= 1 - e) delete it.crop;
    else it.crop = { x: clamp(u0, 0, 1), y: clamp(v0, 0, 1), w: clamp(u1 - u0, 0.001, 1), h: clamp(v1 - v0, 0.001, 1) };
    it.aspect = imageAspect(it); it.w = f.x1 - f.x0;
    const [mx, my] = this.rot((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2);
    it.x = this.cx + mx; it.y = this.cy + my;
    this.ed.app.itemsChanged(true); this.ed.redraw();
  }
  reset() { Object.assign(this.f, { x0: -this.fw / 2, x1: this.fw / 2, y0: -this.fh / 2, y1: this.fh / 2 }); this.apply(); }
  /** shrink the frame to the visible (non-transparent) part of the picture; false if nothing to trim */
  trim() {
    const img = getImage(this.ed.app.assets, this.it.asset); if (!img) return false;
    const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0, cv.width, cv.height);
    const W = cv.width, H = cv.height, d = c.getImageData(0, 0, W, H).data;
    // only look inside the current frame
    const { f, s, fw, fh } = this;
    const fu0 = s > 0 ? 0.5 + f.x0 / fw : 0.5 - f.x1 / fw, fu1 = s > 0 ? 0.5 + f.x1 / fw : 0.5 - f.x0 / fw;
    const X0 = Math.floor(fu0 * W), X1 = Math.ceil(fu1 * W), Y0 = Math.floor((0.5 + f.y0 / fh) * H), Y1 = Math.ceil((0.5 + f.y1 / fh) * H);
    let x0 = X1, y0 = Y1, x1 = X0 - 1, y1 = Y0 - 1;
    for (let y = Math.max(0, Y0); y < Math.min(H, Y1); y++) for (let x = Math.max(0, X0); x < Math.min(W, X1); x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) return false;
    x1++; y1++;
    if (x0 - X0 <= 1 && y0 - Y0 <= 1 && X1 - x1 <= 1 && Y1 - y1 <= 1) return false;
    const u0 = x0 / W, u1 = x1 / W;
    Object.assign(f, { x0: s > 0 ? (u0 - 0.5) * fw : (0.5 - u1) * fw, x1: s > 0 ? (u1 - 0.5) * fw : (0.5 - u0) * fw, y0: (y0 / H - 0.5) * fh, y1: (y1 / H - 0.5) * fh });
    this.apply();
    return true;
  }
  cancel() {
    const o = this.orig, it = this.it;
    if (o.crop) it.crop = o.crop; else delete it.crop;
    Object.assign(it, { x: o.x, y: o.y, w: o.w, aspect: o.aspect });
    this.ed.app.itemsChanged(true);
  }
  draw(c) {
    const ed = this.ed, it = this.it, p = this.p; if (!p) return;
    const css = getComputedStyle(document.documentElement), accent = css.getPropertyValue('--accent').trim();
    const img = getImage(ed.app.assets, it.asset);
    if (img) { // the whole picture, faint, so you can see what is cropped away
      const [sx, sy] = ed.toScreen(p.sx + this.cx, p.sy + this.cy);
      c.save(); c.translate(sx, sy); c.rotate(rad(it.rot || 0)); c.scale(ed.view.s * this.s, ed.view.s);
      c.globalAlpha = 0.32 * (it.opacity ?? 1); c.drawImage(img, -this.fw / 2, -this.fh / 2, this.fw, this.fh); c.restore();
    }
    const f = this.f, pts = [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]].map(([x, y]) => this.screen(x, y));
    c.save();
    c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(...q) : c.moveTo(...q)); c.closePath();
    c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke(); c.setLineDash([5, 4]); c.strokeStyle = accent; c.stroke(); c.setLineDash([]);
    for (const h of this.handles()) { c.beginPath(); c.rect(h.pt[0] - 5, h.pt[1] - 5, 10, 10); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = accent; c.lineWidth = 1.5; c.stroke(); }
    c.restore();
  }
}
