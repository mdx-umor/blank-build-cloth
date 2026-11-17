// Design Master — 2D sewing-pattern editor (canvas). Works in sheet centimetres.
import { drawItem, piecePath, itemCorners, hitItem, itemHeight } from './atlas.js';
import { pointInPoly, clamp, deg, rad } from './util.js';

const HANDLE = 7;

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
    window.addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e)) { this.space = true; this.cursor(); } });
    window.addEventListener('keyup', e => { if (e.code === 'Space') { this.space = false; this.cursor(); } });
    this.raf = 0;
  }
  get g() { return this.app.garment; }
  resize() {
    const p = this.cv.parentElement, dpr = window.devicePixelRatio || 1;
    this.w = p.clientWidth; this.h = p.clientHeight;
    this.cv.width = Math.max(1, this.w * dpr); this.cv.height = Math.max(1, this.h * dpr);
    this.dpr = dpr;
    if (!this._fitted && this.g) { this.fit(); this._fitted = true; }
    this.redraw();
  }
  fit() {
    if (!this.g || !this.w) return;
    const sh = this.g.sheet, pad = 28;
    const s = Math.min((this.w - pad * 2) / sh.w, (this.h - pad * 2 - 40) / sh.h);
    this.view.s = s; this.view.ox = (this.w - sh.w * s) / 2; this.view.oy = (this.h - sh.h * s) / 2 + 14;
    this.redraw();
  }
  zoom(f, cx = this.w / 2, cy = this.h / 2) {
    const v = this.view, ns = clamp(v.s * f, 0.8, 120);
    v.ox = cx - (cx - v.ox) * ns / v.s; v.oy = cy - (cy - v.oy) * ns / v.s; v.s = ns;
    this.redraw();
  }
  toSheet(e) { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left - this.view.ox) / this.view.s, (e.clientY - r.top - this.view.oy) / this.view.s]; }
  toScreen(x, y) { return [x * this.view.s + this.view.ox, y * this.view.s + this.view.oy]; }
  pieceAt(x, y) { return this.g.pieces.find(p => pointInPoly(x - p.sx, y - p.sy, p.poly)); }
  piece(id) { return this.g.pieces.find(p => p.id === id); }
  cursor() {
    const c = this.drag?.mode === 'pan' ? 'grabbing' : (this.space || this.tool === 'hand') ? 'grab' : this.hover === 'rot' ? 'crosshair' : this.hover === 'scale' ? 'nwse-resize' : this.hover === 'w' ? 'ew-resize' : this.hover === 'h' ? 'ns-resize' : this.hover === 'item' ? 'move' : 'default';
    this.cv.style.cursor = c;
  }

  /* ---------- hit testing ---------- */
  itemAt(x, y) {
    const items = this.app.doc.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]; if (it.hidden || it.locked) continue;
      const p = this.piece(it.piece); if (!p) continue;
      if (hitItem(it, this.app.assets, x - p.sx, y - p.sy, 0.2)) return it;
    }
    return null;
  }
  handlesFor(it) {
    const p = this.piece(it.piece); if (!p) return [];
    const c = itemCorners(it, this.app.assets).map(([x, y]) => this.toScreen(x + p.sx, y + p.sy));
    const a = rad(it.rot || 0);
    const topMid = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
    const rot = [topMid[0] + Math.sin(a) * 26, topMid[1] - Math.cos(a) * 26];
    const hs = c.map((pt, i) => ({ type: 'scale', pt, i }));
    hs.push({ type: 'rot', pt: rot, from: topMid });
    if (it.type === 'shape') {
      hs.push({ type: 'w', pt: [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2] });
      hs.push({ type: 'h', pt: [(c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2] });
    }
    return { hs, corners: c };
  }
  handleAt(e) {
    const it = this.app.selected(); if (!it || it.locked) return null;
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const { hs } = this.handlesFor(it) || {};
    for (const h of hs || []) if (Math.hypot(h.pt[0] - mx, h.pt[1] - my) <= HANDLE + 3) return h;
    return null;
  }

  /* ---------- pointer ---------- */
  down(e) {
    if (!this.g) return;
    this.cv.setPointerCapture?.(e.pointerId);
    const [x, y] = this.toSheet(e);
    if (e.button === 1 || this.space || this.tool === 'hand') { this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: this.view.ox, oy: this.view.oy }; this.cursor(); return; }
    if (e.button !== 0) return;
    const h = this.handleAt(e);
    const sel = this.app.selected();
    if (h && sel) {
      const p = this.piece(sel.piece);
      const cx = sel.x + p.sx, cy = sel.y + p.sy;
      this.drag = { mode: h.type, it: sel, cx, cy, w0: sel.w, h0: sel.h, rot0: sel.rot || 0, d0: Math.hypot(x - cx, y - cy), a0: Math.atan2(y - cy, x - cx), moved: false };
      return;
    }
    const it = this.itemAt(x, y);
    if (it) {
      this.app.select(it.id);
      const p = this.piece(it.piece);
      this.drag = { mode: 'move', it, dx: x - (it.x + p.sx), dy: y - (it.y + p.sy), moved: false };
    } else {
      this.app.select(null);
      this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: this.view.ox, oy: this.view.oy, soft: true };
    }
    this.redraw();
  }
  move(e) {
    if (!this.g) return;
    const d = this.drag;
    if (!d) {
      if (e.target !== this.cv) return;
      const h = this.handleAt(e);
      const [x, y] = this.toSheet(e);
      this.hover = h ? h.type : this.itemAt(x, y) ? 'item' : null;
      this.cursor();
      return;
    }
    if (d.mode === 'pan') { this.view.ox = d.ox + e.clientX - d.sx; this.view.oy = d.oy + e.clientY - d.sy; if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.panned = true; this.cv.style.cursor = 'grabbing'; this.redraw(); return; }
    const [x, y] = this.toSheet(e);
    const it = d.it, p = this.piece(it.piece);
    d.moved = true;
    this.guides = [];
    if (d.mode === 'move') {
      let nx = x - d.dx - p.sx, ny = y - d.dy - p.sy;
      if (!e.altKey) { // snap to the piece's centre lines
        const tol = 8 / this.view.s, pcx = p.w / 2, pcy = p.h / 2;
        if (Math.abs(nx - pcx) < tol) { nx = pcx; this.guides.push(['v', p.sx + pcx, p]); }
        if (Math.abs(ny - pcy) < tol) { ny = pcy; this.guides.push(['h', p.sy + pcy, p]); }
      }
      it.x = nx; it.y = ny;
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
    const d = this.drag; this.drag = null; this.guides = [];
    if (!d) return;
    if (d.mode === 'pan') { if (d.soft && !d.panned) this.app.select(null); this.cursor(); this.redraw(); return; }
    if (d.moved && d.mode === 'move') {
      // re-home the item onto whichever piece its centre landed on
      const it = d.it, p = this.piece(it.piece);
      const sx = it.x + p.sx, sy = it.y + p.sy;
      const np = this.pieceAt(sx, sy);
      if (np && np.id !== p.id) { it.piece = np.id; it.x = sx - np.sx; it.y = sy - np.sy; }
    }
    if (d.moved) { this.app.itemsChanged(false); this.app.commit(); }
    this.redraw();
  }
  wheel(e) {
    e.preventDefault();
    const r = this.cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 && !e.shiftKey && Math.abs(e.deltaX) < 2) this.zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
    else { this.view.ox -= e.deltaX; this.view.oy -= e.deltaY; this.redraw(); }
  }
  dbl(e) {
    const [x, y] = this.toSheet(e);
    const it = this.itemAt(x, y);
    if (it?.type === 'text') this.app.focusText();
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
    const base = this.app.baseCanvas;
    const marks = this.app.doc.view?.marks !== false;
    const sel = this.app.selected();
    for (const p of g.pieces) {
      c.save(); c.translate(p.sx, p.sy);
      c.save(); c.shadowColor = 'rgba(16,24,40,.12)'; c.shadowBlur = 10; c.shadowOffsetY = 2;
      piecePath(c, p); c.fillStyle = this.app.doc.fabric.color; c.fill(); c.restore();
      c.save(); piecePath(c, p); c.clip();
      if (base) c.drawImage(base, -p.sx, -p.sy, g.sheet.w, g.sheet.h);
      for (const it of this.app.doc.items) if (it.piece === p.id) drawItem(c, it, this.app.assets, () => this.app.assetReady(), v.s * this.dpr);
      c.restore();
      c.restore();
    }
    // ghost of the selected item outside its piece, so nothing "disappears" while placing
    if (sel && !sel.hidden) {
      const p = this.piece(sel.piece);
      if (p) {
        c.save(); c.translate(p.sx, p.sy); c.globalAlpha = 0.28;
        c.beginPath(); c.rect(-1e4, -1e4, 2e4, 2e4); piecePath(c, p); c.clip('evenodd');
        drawItem(c, sel, this.app.assets, null, v.s * this.dpr); c.restore();
      }
    }
    // outlines & markings
    for (const p of g.pieces) {
      c.save(); c.translate(p.sx, p.sy);
      piecePath(c, p);
      c.lineWidth = 1.3 / v.s; c.strokeStyle = col('--piece-line'); c.stroke();
      if (marks) {
        c.setLineDash([6 / v.s, 4 / v.s]); c.lineWidth = 1 / v.s; c.strokeStyle = col('--faint');
        for (const f of p.folds || []) { c.beginPath(); c.moveTo(...f[0]); c.lineTo(...f[1]); c.stroke(); }
        c.setLineDash([]);
        if (p.grain && p.h > 20) { // grainline arrow
          const gx = p.w * 0.16, y0 = p.h * 0.3, y1 = p.h * 0.7, a = 1.2;
          c.beginPath(); c.moveTo(gx, y0); c.lineTo(gx, y1); c.moveTo(gx - a * 0.6, y0 + a); c.lineTo(gx, y0); c.lineTo(gx + a * 0.6, y0 + a); c.moveTo(gx - a * 0.6, y1 - a); c.lineTo(gx, y1); c.lineTo(gx + a * 0.6, y1 - a);
          c.strokeStyle = col('--faint'); c.lineWidth = 1 / v.s; c.stroke();
        }
      }
      // label
      const fs = clamp(11 / v.s, 0.6, 3.2);
      c.font = `600 ${fs}px Inter, system-ui, sans-serif`; c.textAlign = 'center'; c.fillStyle = col('--piece-ink');
      c.globalAlpha = 0.75; c.fillText(p.label, p.w / 2, -fs * 0.6);
      c.font = `400 ${fs * 0.9}px Inter, system-ui, sans-serif`; c.globalAlpha = 0.55;
      c.fillText(`${this.app.fmtLen(p.w)} × ${this.app.fmtLen(p.h)} ${this.app.unit()}`, p.w / 2, p.h + fs * 1.3);
      c.globalAlpha = 1;
      c.restore();
    }
    // snap guides
    for (const [t, val, p] of this.guides) {
      c.beginPath(); c.strokeStyle = col('--accent'); c.lineWidth = 1 / v.s; c.setLineDash([4 / v.s, 3 / v.s]);
      if (t === 'v') { c.moveTo(val, p.sy - 2); c.lineTo(val, p.sy + p.h + 2); } else { c.moveTo(p.sx - 2, val); c.lineTo(p.sx + p.w + 2, val); }
      c.stroke(); c.setLineDash([]);
    }
    c.restore();
    // selection
    if (sel && !sel.hidden) {
      const hd = this.handlesFor(sel);
      if (hd.corners) {
        c.beginPath(); hd.corners.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath();
        c.strokeStyle = col('--accent'); c.lineWidth = 1.5; c.stroke();
        if (!sel.locked) for (const h of hd.hs) {
          if (h.type === 'rot') { c.beginPath(); c.moveTo(...h.from); c.lineTo(...h.pt); c.stroke(); c.beginPath(); c.arc(h.pt[0], h.pt[1], HANDLE - 1, 0, Math.PI * 2); c.fillStyle = col('--accent'); c.fill(); continue; }
          c.beginPath(); c.rect(h.pt[0] - HANDLE / 2 - 1, h.pt[1] - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2);
          c.fillStyle = '#fff'; c.fill(); c.strokeStyle = col('--accent'); c.stroke();
        }
        // size readout
        const u = this.app.unit(), hcm = itemHeight(sel, this.app.assets);
        const txt = `${this.app.fmtLen(sel.w)} × ${this.app.fmtLen(hcm)} ${u}`;
        const bx = Math.max(...hd.corners.map(p => p[0])), by = Math.max(...hd.corners.map(p => p[1]));
        c.font = '600 11px Inter, system-ui, sans-serif'; const tw = c.measureText(txt).width + 12;
        c.fillStyle = col('--accent'); c.beginPath(); c.roundRect(bx - tw, by + 8, tw, 20, 5); c.fill();
        c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(txt, bx - tw + 6, by + 22);
      }
    }
    // scale readout
    const sc = this.app.$('#patScale'); if (sc) sc.textContent = `1 cm = ${v.s.toFixed(1)} px · ${Math.round(v.s / 3.78 * 100)}%`;
  }
}

function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
