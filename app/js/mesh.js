// Design Master — inflates the flat pattern panels into a soft 3D garment.
// Each panel is gridded, clipped to its outline, and pushed out along z with a rounded
// "pillow" profile (vertical at the seam, flat in the middle) plus optional fabric wrinkles.
// UVs come straight from the panel's piece-local mapping, so the texture atlas IS the pattern.

import * as THREE from 'three';
import { pointInPoly, nearestOnPoly, polyBounds, affApply, fbm, smooth } from './util.js';

export function wrinkleZ(x, y, amt, seed = 3) {
  if (!amt) return 0;
  const n = fbm(x * 0.055, y * 0.055, 3, seed) * 1.1;
  const r1 = Math.sin((x * 0.55 + y * 0.35) * 0.3 + fbm(x * 0.03, y * 0.03, 2, seed + 5) * 6) * 0.38;
  const r2 = Math.sin((-x * 0.4 + y * 0.62) * 0.42 + fbm(x * 0.05, y * 0.05, 2, seed + 9) * 5) * 0.22;
  const r3 = Math.sin(y * 0.9 + fbm(x * 0.1, y * 0.02, 2, seed + 11) * 4) * 0.08;
  return amt * (n + r1 + r2 + r3);
}

function profile(d, depth, radius) {
  const t = Math.min(1, d / radius);
  return { h: depth * Math.sqrt(1 - (1 - t) * (1 - t)), t };
}

// height of a panel surface at (x, y) in garment space (used to lay pockets, cords and labels on top)
export function surfaceZ(panel, x, y, wr, seed) {
  if (!pointInPoly(x, y, panel.outline)) return panel.zBase || 0;
  const [, , d] = nearestOnPoly(x, y, panel.outline);
  const { h, t } = profile(d, panel.depth, panel.radius);
  return (panel.zBase || 0) + panel.side * (h + wrinkleZ(x, y, wr, seed + (panel.side > 0 ? 0 : 40)) * smooth(t));
}

export function buildPanelGeometry(panel, garment, opts) {
  const piece = garment.pieces.find(p => p.id === panel.piece);
  const sheet = garment.sheet;
  const ol = panel.outline;
  const b = polyBounds(ol);
  const step = Math.max(0.55, Math.max(b.w, b.h) / (opts.res || 96));
  const nx = Math.ceil(b.w / step) + 3, ny = Math.ceil(b.h / step) + 3;
  const ox = b.x0 - step, oy = b.y0 - step;
  const N = nx * ny;
  const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), inside = new Uint8Array(N), tval = new Float32Array(N);
  const base = panel.base === 'front' ? garment.panels.find(p => p.role === 'front') : null;
  const wr = opts.wrinkles || 0, seed = opts.seed || 3;
  const pSeed = seed + (panel.side > 0 ? 0 : 40) + (panel.role === 'sleeve' ? 90 : 0);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let x = ox + i * step, y = oy + j * step;
    const isIn = pointInPoly(x, y, ol);
    const [px, py, d] = nearestOnPoly(x, y, ol);
    let dd = d;
    if (!isIn) { x = px; y = py; dd = 0; }
    inside[k] = isIn ? 1 : 0;
    const { h, t } = profile(dd, panel.depth, panel.radius);
    tval[k] = t;
    let z0 = panel.zBase || 0;
    if (base) z0 = surfaceZ(base, x, y, wr, seed) + 0.04;
    const w = panel.role === 'pocket' ? 0 : wrinkleZ(x, y, wr * (panel.role === 'sleeve' ? 0.8 : 1), pSeed) * smooth(t);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z0 + panel.side * (h + w);
  }
  // pull the closest outside grid vertex onto each sharp outline corner so corners stay crisp
  for (let c = 0; c < ol.length; c++) {
    const p0 = ol[(c - 1 + ol.length) % ol.length], p1 = ol[c], p2 = ol[(c + 1) % ol.length];
    const ax = p0[0] - p1[0], ay = p0[1] - p1[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
    if (cos < -0.82) continue; // nearly straight
    const ci = Math.floor((p1[0] - ox) / step), cj = Math.floor((p1[1] - oy) / step);
    let best = -1, bd = Infinity;
    for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const k = j * nx + i; if (inside[k]) continue;
      const gx = ox + i * step, gy = oy + j * step, dist = Math.hypot(gx - p1[0], gy - p1[1]);
      if (dist < bd) { bd = dist; best = k; }
    }
    if (best >= 0 && bd < step * 1.6) {
      pos[best * 3] = p1[0]; pos[best * 3 + 1] = p1[1];
      pos[best * 3 + 2] = base ? surfaceZ(base, p1[0], p1[1], wr, seed) + 0.04 : (panel.zBase || 0);
    }
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
    const geo = buildPanelGeometry(pn, garment, opts);
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
  for (const nl of ex.necklines) {
    const pts = nl.pts.map(([x, y]) => [x, y - nl.r * 0.55, nl.side * (nl.r * 0.35)]);
    const m = new THREE.Mesh(tube(pts, nl.r, 80), mats.trim);
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  }
  if (ex.label && opts.label && backP) {
    const L = ex.label;
    const zl = surfaceZ(backP, L.x, L.y - L.h / 2, wr, seed) + 0.06;
    const geo = new THREE.PlaneGeometry(L.w, L.h, 4, 2);
    const m = new THREE.Mesh(geo, mats.label);
    m.position.set(L.x, L.y - L.h / 2, zl); m.rotation.x = -0.12;
    m.receiveShadow = true; group.add(m);
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
