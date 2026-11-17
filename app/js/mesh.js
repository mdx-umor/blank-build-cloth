// Design Master — inflates the flat pattern panels into a soft 3D garment.
// Each panel is gridded, clipped to its outline, and pushed out along z with a rounded
// "pillow" profile (vertical at the seam, flat in the middle) plus optional fabric wrinkles.
// UVs come straight from the panel's piece-local mapping, so the texture atlas IS the pattern.

import * as THREE from 'three';
import { pointInPoly, nearestOnPoly, polyBounds, affApply, fbm, smooth, coons } from './util.js';

export function wrinkleZ(x, y, amt, seed = 3, top = 70) {
  if (!amt) return 0;
  const n = fbm(x * 0.055, y * 0.055, 3, seed) * 0.9;
  const r1 = Math.sin((x * 0.55 + y * 0.35) * 0.3 + fbm(x * 0.03, y * 0.03, 2, seed + 5) * 6) * 0.3;
  const r2 = Math.sin((-x * 0.4 + y * 0.62) * 0.42 + fbm(x * 0.05, y * 0.05, 2, seed + 9) * 5) * 0.18;
  // gravity drape: soft vertical folds that grow towards the hem
  const hang = Math.min(1, Math.max(0, (top * 0.82 - y) / (top * 0.82)));
  const folds = Math.sin(x * 0.42 + fbm(x * 0.04, y * 0.015, 3, seed + 21) * 4.5) * 0.9 * hang * hang;
  const ripple = fbm(x * 0.25, y * 0.25, 2, seed + 13) * 0.12;
  return amt * (n + r1 + r2 + folds + ripple);
}

function profile(d, depth, radius) {
  const t = Math.min(1, d / radius);
  return { h: depth * Math.sqrt(1 - (1 - t) * (1 - t)), t };
}

// seam segments = outline segments that are not on an open edge (hem, cuffs, neck, armhole)
function seamSegments(panel) {
  if (panel._seams) return panel._seams;
  const ol = panel.outline, open = panel.open || [];
  const onOpen = (x, y) => open.some(pl => { for (let i = 0; i < pl.length - 1; i++) if (nearestOnPoly(x, y, [pl[i], pl[i + 1]])[2] < 0.06) return true; return false; });
  const seams = [], flags = [];
  for (let i = 0; i < ol.length; i++) {
    const a = ol[i], b = ol[(i + 1) % ol.length];
    const isOpen = onOpen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    flags.push(isOpen);
    if (!isOpen) seams.push([a, b]);
  }
  panel._seams = seams; panel._openFlags = flags;
  return seams;
}
function distSeams(x, y, segs) {
  let best = Infinity;
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = a[0] + dx * t - x, ey = a[1] + dy * t - y, d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// z of a panel surface at (x, y) — also valid on the outline itself
export function surfaceZ(panel, x, y, wr, seed) {
  const segs = seamSegments(panel);
  const d = segs.length ? distSeams(x, y, segs) : panel.radius;
  const { h, t } = profile(d, panel.depth, panel.radius);
  const ps = seed + (panel.side > 0 ? 0 : 40) + (panel.role === 'sleeve' ? 90 : 0);
  const w = panel.role === 'pocket' || panel.role === 'hood' ? 0 : wrinkleZ(x, y, wr * (panel.role === 'sleeve' ? 0.7 : 1), ps, panel.top || 70) * smooth(t);
  return (panel.zBase || 0) + panel.side * (h + w);
}

// sleeves: a (u, v) grid stretched between four curved edges, both in 3D and on the bell-shaped pattern
function coonsGrid(panel, opts) {
  const nu = 56, nv = 30, { geo, pat } = panel.coons;
  const wr = opts.wrinkles || 0, seed = (opts.seed || 3) + (panel.side > 0 ? 0 : 40) + 90;
  const P = [], L = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv;
    const [x, y] = coons(geo, u, v);
    const a = coons(geo, u, 0), b = coons(geo, u, 1);
    const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = Math.min(v, 1 - v) * width;               // closed along the fold and the underarm seam
    const { h, t } = profile(d, panel.depth, panel.radius);
    const z = panel.side * (h + wrinkleZ(x, y, wr * 0.7, seed, panel.top || 70) * smooth(t));
    P.push([x, y, z]); L.push(coons(pat, u, v));
  }
  return { nu, nv, P, L };
}
export function buildPanelGeometry(panel, garment, opts) {
  if (panel.coons) {
    const piece = garment.pieces.find(p => p.id === panel.piece), sheet = garment.sheet;
    const { nu, nv, P, L } = coonsGrid(panel, opts);
    const off = panel.coons.off || [0, 0];
    const pos = new Float32Array(P.length * 3), uv = new Float32Array(P.length * 2);
    P.forEach((p, k) => { pos.set(p, k * 3); uv[k * 2] = (piece.sx + L[k][0] - off[0]) / sheet.w; uv[k * 2 + 1] = 1 - (piece.sy + L[k][1] - off[1]) / sheet.h; });
    const idx = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1, c = a + 1, d = b + 1;
      // orientation depends on the sleeve's handedness; fix it from the actual geometry
      idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // make the outward normal point to the panel's side
    const p0 = P[0], p1 = P[nv + 1], p2 = P[1];
    const cz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    if (Math.sign(cz) !== Math.sign(panel.side)) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    g.userData.cuff = Array.from({ length: nv + 1 }, (_, j) => P[nu * (nv + 1) + j]);
    return g;
  }
  const piece = garment.pieces.find(p => p.id === panel.piece);
  const sheet = garment.sheet;
  const ol = panel.outline;
  const b = polyBounds(ol);
  const step = Math.max(0.5, Math.max(b.w, b.h) / (opts.res || 110));
  const nx = Math.ceil(b.w / step) + 3, ny = Math.ceil(b.h / step) + 3;
  const ox = b.x0 - step, oy = b.y0 - step;
  const N = nx * ny;
  const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), inside = new Uint8Array(N);
  const base = panel.base === 'front' ? garment.panels.find(p => p.role === 'front') : null;
  const wr = opts.wrinkles || 0, seed = opts.seed || 3;
  const zAt = (x, y) => base ? surfaceZ(base, x, y, wr, seed) + 0.04 + profile(distSeams(x, y, seamSegments(panel)), panel.depth, panel.radius).h : surfaceZ(panel, x, y, wr, seed);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let x = ox + i * step, y = oy + j * step;
    const isIn = pointInPoly(x, y, ol);
    if (!isIn) { const [px, py] = nearestOnPoly(x, y, ol); x = px; y = py; }
    inside[k] = isIn ? 1 : 0;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = zAt(x, y);
  }
  // pull the closest outside grid vertex onto each sharp outline corner so corners stay crisp
  for (let c = 0; c < ol.length; c++) {
    const p0 = ol[(c - 1 + ol.length) % ol.length], p1 = ol[c], p2 = ol[(c + 1) % ol.length];
    const ax = p0[0] - p1[0], ay = p0[1] - p1[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
    if (cos < -0.82) continue;
    const ci = Math.floor((p1[0] - ox) / step), cj = Math.floor((p1[1] - oy) / step);
    let best = -1, bd = Infinity;
    for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const k = j * nx + i; if (inside[k]) continue;
      const dist = Math.hypot(ox + i * step - p1[0], oy + j * step - p1[1]);
      if (dist < bd) { bd = dist; best = k; }
    }
    if (best >= 0 && bd < step * 1.6) { pos[best * 3] = p1[0]; pos[best * 3 + 1] = p1[1]; pos[best * 3 + 2] = zAt(p1[0], p1[1]); }
  }
  for (let k = 0; k < N; k++) {
    const [lx, ly] = affApply(panel.toLocal, pos[k * 3], pos[k * 3 + 1]);
    uv[k * 2] = (piece.sx + lx) / sheet.w;
    uv[k * 2 + 1] = 1 - (piece.sy + ly) / sheet.h;
  }
  const idx = [];
  const area = (a, b, c) => Math.abs((pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 1] - pos[a * 3 + 1]) - (pos[c * 3] - pos[a * 3]) * (pos[b * 3 + 1] - pos[a * 3 + 1]));
  const tri = (a, b, c) => {
    if (!(inside[a] || inside[b] || inside[c])) return;
    if (area(a, b, c) < 1e-5) return;
    if (panel.side > 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b2 = a + 1, c = a + nx, d = c + 1;
    tri(a, b2, d); tri(a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// runs of open outline edges, as 3D polylines (for the folded hem / cuff edge)
export function openEdgeRuns(panel, wr, seed) {
  seamSegments(panel);
  const ol = panel.outline, f = panel._openFlags, n = ol.length, runs = [];
  if (!f.some(Boolean)) return runs;
  let start = f.findIndex((v, i) => v && !f[(i - 1 + n) % n]);
  if (start < 0) start = 0;
  let cur = null;
  for (let s = 0; s <= n; s++) {
    const i = (start + s) % n;
    if (f[i]) { if (!cur) { cur = [ol[i]]; runs.push(cur); } cur.push(ol[(i + 1) % n]); }
    else cur = null;
  }
  return runs.map(r => r.map(([x, y]) => [x, y, surfaceZ(panel, x, y, wr, seed)]));
}

/** Fold shadows: darken creases and concave folds (cavity) — stored as vertex colours. */
export function cavityAO(geo, strength = 1) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index;
  const n = pos.count;
  const sum = new Float32Array(n * 3), cnt = new Uint16Array(n);
  const add = (a, b) => { sum[a * 3] += pos.getX(b); sum[a * 3 + 1] += pos.getY(b); sum[a * 3 + 2] += pos.getZ(b); cnt[a]++; };
  const tri = idx ? idx.array : null, tcount = idx ? idx.count : n;
  for (let i = 0; i < tcount; i += 3) {
    const a = tri ? tri[i] : i, b = tri ? tri[i + 1] : i + 1, c = tri ? tri[i + 2] : i + 2;
    add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b);
  }
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let ao = 1;
    if (cnt[i]) {
      const dx = sum[i * 3] / cnt[i] - pos.getX(i), dy = sum[i * 3 + 1] / cnt[i] - pos.getY(i), dz = sum[i * 3 + 2] / cnt[i] - pos.getZ(i);
      const cav = dx * nrm.getX(i) + dy * nrm.getY(i) + dz * nrm.getZ(i); // > 0: neighbours stand above → crease
      ao = 1 - Math.max(0, Math.min(0.5, cav * 2.2 * strength));
    }
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  // soften once so the shading is smooth
  const sm = new Float32Array(n);
  for (let i = 0; i < tcount; i += 3) {
    const a = tri ? tri[i] : i, b = tri ? tri[i + 1] : i + 1, c = tri ? tri[i + 2] : i + 2;
    const m = (col[a * 3] + col[b * 3] + col[c * 3]) / 3; sm[a] += m; sm[b] += m; sm[c] += m;
  }
  for (let i = 0; i < n; i++) if (cnt[i]) { const v = 0.5 * col[i * 3] + 0.5 * sm[i] / (cnt[i] / 2); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = Math.max(0.55, Math.min(1, v)); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function tube(pts3, r, seg = 64, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts3.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, seg, r, 10, closed);
}

/**
 * Builds the whole garment group. Returns { group, panelMeshes, materialsUsed }.
 * mats: { main, rib, inner, trim, label, hanger, cord, aglet }
 */
export function buildGarmentGroup(garment, mats, opts) {
  const group = new THREE.Group();
  const panelMeshes = [];
  for (const pn of garment.panels) {
    const geo = cavityAO(buildPanelGeometry(pn, garment, opts));
    const outer = new THREE.Mesh(geo, pn.kind === 'rib' ? mats.rib : mats.main);
    outer.castShadow = true; outer.receiveShadow = true;
    outer.userData = { panel: pn, pick: true };
    group.add(outer); panelMeshes.push(outer);
    const inner = new THREE.Mesh(geo, mats.inner);
    inner.receiveShadow = true; inner.castShadow = false;
    group.add(inner);
  }
  const ex = garment.extras, wr = opts.wrinkles || 0, seed = opts.seed || 3;
  const front = garment.panels.find(p => p.role === 'front');
  const backP = garment.panels.find(p => p.role === 'back');
  // folded edge at every opening: gives the fabric visible thickness
  for (const m of panelMeshes) {
    const pn = m.userData.panel;
    if (!pn.coons) continue;
    const pts = m.geometry.userData.cuff.map(([x, y, z]) => [x, y, z - pn.side * 0.12]);
    const e = new THREE.Mesh(tube(pts, 0.24, 30), mats.edge(pn.piece)); e.castShadow = true; group.add(e);
  }
  for (const pn of garment.panels) {
    if (!pn.open || pn.role === 'hood') continue;
    const mat = mats.edge(pn.piece);
    for (const run of openEdgeRuns(pn, wr, seed)) {
      if (run.length < 2) continue;
      const len = run.reduce((s, p, i) => i ? s + Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1]) : 0, 0);
      const pts = run.map(([x, y, z]) => [x, y, z - pn.side * 0.12]);
      const m = new THREE.Mesh(tube(pts, pn.kind === 'rib' ? 0.32 : 0.22, Math.max(8, Math.round(len * 1.5))), mat);
      m.castShadow = true; m.receiveShadow = true; group.add(m);
    }
  }
  for (const nl of ex.necklines) {
    const pnl = nl.side > 0 ? front : backP;
    const pts = nl.pts.map(([x, y]) => [x, y - nl.r * 0.55, (pnl ? surfaceZ(pnl, x, y - nl.r * 0.55, wr, seed) : 0) - nl.side * nl.r * 0.45]);
    const geo = cavityAO(tube(pts, nl.r, 80), 0); // plain white AO so the shared rib material works
    const piece = garment.pieces.find(p => p.id === nl.piece);
    if (piece) { // the rib band is printable: map the tube onto its pattern strip
      const uv = geo.attributes.uv, sh = garment.sheet;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (piece.sx + uv.getX(k) * nl.len) / sh.w, 1 - (piece.sy + uv.getY(k) * nl.h) / sh.h);
    }
    const m = new THREE.Mesh(geo, piece ? mats.rib : mats.trim);
    m.castShadow = true; m.receiveShadow = true; m.userData = piece ? { panel: { piece: piece.id, role: 'neck' }, pick: true } : {};
    group.add(m); if (piece) panelMeshes.push(m);
  }
  if (ex.label && opts.label && backP) {
    const L = ex.label;
    const zl = Math.max(surfaceZ(backP, L.x, L.y, wr, seed), surfaceZ(backP, L.x, L.y - L.h, wr, seed), surfaceZ(backP, L.x - L.w / 2, L.y - L.h / 2, wr, seed), surfaceZ(backP, L.x + L.w / 2, L.y - L.h / 2, wr, seed)) + 0.18;
    const geo = new THREE.PlaneGeometry(L.w, L.h, 4, 2);
    // the label is a printable pattern piece: map the plane onto it in the inside atlas
    const lp = garment.pieces.find(p => p.id === 'label');
    if (lp) {
      const uv = geo.attributes.uv, sh = garment.sheet;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (lp.sx + uv.getX(k) * lp.w) / sh.w, 1 - (lp.sy + (1 - uv.getY(k)) * lp.h) / sh.h);
    }
    const m = new THREE.Mesh(geo, mats.label);
    m.position.set(L.x, L.y - L.h / 2, zl);
    if (L.shape === 'loop') m.rotation.x = -0.35; // loop-fold label stands away from the neck a little
    m.receiveShadow = true; m.userData = { panel: { piece: 'label', role: 'label' }, pick: true }; group.add(m);
  }
  if (ex.hanger && opts.hanger) {
    const H = ex.hanger;
    const hook = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4.2, 12), mats.hanger);
    stem.position.set(0, H.top + 1.6, -0.2); hook.add(stem);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.3, 10, 40, Math.PI * 1.35), mats.hanger);
    arc.position.set(-2.6, H.top + 3.7, -0.2); arc.rotation.z = -0.1; hook.add(arc);
    const yy = (x) => H.top - 3.4 - Math.max(0, Math.abs(x) - H.neckW) * (H.drop / Math.max(1, H.shoulderX - H.neckW));
    const xs = Math.max(H.neckW + 2, H.shoulderX - 3.5);
    const barPts = [];
    for (let i = 0; i <= 10; i++) { const x = -xs + (2 * xs) * i / 10; barPts.push([x, yy(x), 0]); }
    const bar = new THREE.Mesh(tube(barPts, 0.75, 40), mats.hanger);
    hook.add(bar);
    hook.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(hook);
  }
  for (const s of ex.strings) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, y = s.yTop - t * s.len;
      const x = s.x + Math.sin(t * 2.4 + (s.x > 0 ? 0.6 : 0)) * 0.9 * t;
      pts.push([x, y, (front ? surfaceZ(front, x, y, wr, seed) : 2) + 0.5]);
    }
    const m = new THREE.Mesh(tube(pts, 0.42, 48), mats.cord); m.castShadow = true; group.add(m);
    const e = pts[pts.length - 1];
    const ag = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 3.2, 12), mats.aglet);
    ag.position.set(e[0], e[1] - 1.4, e[2]); ag.castShadow = true; group.add(ag);
  }
  if (ex.handles) {
    const H = ex.handles;
    for (const side of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, a = Math.PI * t;
        pts.push([-H.x * Math.cos(a), H.h - 2 + Math.sin(a) * H.rise, side * (0.9 + Math.sin(a) * 0.6)]);
      }
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 60, 1.2, 6, false);
      geo.scale(1, 1, 0.42); // flat webbing strap
      const m = new THREE.Mesh(geo, mats.trim); m.castShadow = true; m.receiveShadow = true; group.add(m);
    }
    if (opts.hanger) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 5, 16), mats.hanger);
      peg.rotation.x = Math.PI / 2; peg.position.set(0, H.h + H.rise - 2.6, -2); peg.castShadow = true; group.add(peg);
    }
  }
  return { group, panelMeshes };
}
