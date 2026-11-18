// Design Master — parametric garment generator.
// Every garment is built from measurements (cm). One generator produces both the flat
// sewing-pattern pieces (2D editor + texture atlas) and the 3D "panels" that are inflated
// into the mockup, so the pattern and the 3D model always agree exactly.
//
// Garment space: x right, y up, cm. Front faces look toward +z.
// Piece-local space: cm, y down, as the piece is seen from the outside of the garment.

import { densify, dedupe, polyBounds, rad, affApply, polyLength, coons, fitAffine, cubicPts, clamp } from './util.js';

export const GARMENT_LIST = [
  { id: 'tee', name: 'Classic T-shirt', cut: "Unisex · crew neck", group: 'T-shirts' },
  { id: 'tee-vneck', name: 'V-neck T-shirt', cut: 'Unisex · V-neck', group: 'T-shirts' },
  { id: 'tee-oversize', name: 'Oversized T-shirt', cut: 'Drop shoulder · boxy', group: 'T-shirts' },
  { id: 'tee-women', name: "Women's T-shirt", cut: 'Fitted · crew neck', group: 'T-shirts' },
  { id: 'tee-crop', name: 'Crop top', cut: "Women's · boxy crop", group: 'T-shirts' },
  { id: 'longsleeve', name: 'Long-sleeve tee', cut: 'Relaxed fit', group: 'Long sleeve' },
  { id: 'raglan', name: 'Baseball tee', cut: '¾ contrast sleeves', group: 'Long sleeve' },
  { id: 'tank', name: 'Tank top', cut: 'Scoop armhole', group: 'Sleeveless' },
  { id: 'sweatshirt', name: 'Crewneck sweatshirt', cut: 'Rib cuffs & waistband', group: 'Fleece' },
  { id: 'hoodie', name: 'Pullover hoodie', cut: 'Kangaroo pocket · drawcords', group: 'Fleece' },
  { id: 'tote', name: 'Tote bag', cut: '38 × 42 cm · canvas', group: 'Accessories' },
  { id: 'shirt-ls', name: 'Long-sleeve shirt', cut: 'Button-up · real 3D model', group: 'Real 3D models', model: 'models/shirt-ls/' },
  { id: 'hoodie-zip', name: 'Zip hoodie', cut: 'Full zip · real 3D model', group: 'Real 3D models', model: 'models/hoodie-zip/', fabric: 'fleece' },
];

/* ---------- garments from real 3D models (cloth-sim GLB + pattern traced from its UVs) ---------- */
const modelCache = {};
export const isModelGarment = (id) => !!GARMENT_LIST.find(g => g.id === id)?.model;
export const modelLoaded = (id) => !!modelCache[id];
export async function loadModelGarment(id) {
  if (modelCache[id]) return modelCache[id];
  const meta = GARMENT_LIST.find(g => g.id === id);
  const J = await (await fetch(meta.model + 'pieces.json')).json();
  const pieces = J.pieces.map(p => {
    const b = polyBounds(p.poly);
    // markings drawn on the piece (e.g. where a pocket sits), as dashed lines like folds
    const folds = (p.marks || []).flatMap(m => m.map((q, i) => [q, m[(i + 1) % m.length]]));
    return { id: p.id, label: p.label, poly: p.poly, holes: p.holes || [], sx: p.sx, sy: p.sy, w: b.x1, h: b.y1, bounds: b, kind: p.rib ? 'rib' : 'main', rib: !!p.rib, stitches: [], folds };
  });
  // re-space the pieces into a readable cutting sheet; vertices are shifted with their piece at load time
  for (const p of pieces) { p.sx0 = p.sx; p.sy0 = p.sy; }
  const sheet = shelfLayout(pieces, 14);
  const [mn, mx] = [J.bbox3d.min, J.bbox3d.max];
  const g = {
    id, name: meta.name, cut: meta.cut, model: meta.model, glb: meta.model + 'model.glb', spec: {}, fabric: meta.fabric || 'smooth', trims: J.trims || null,
    pieces, panels: [], sheet, sheet0: J.sheet, presets: J.presets,
    uvMap: { k: J.cmPerUV, u0: J.uvOrigin[0], v1: J.uvOrigin[1], M: J.margin },
    extras: { necklines: [], label: null, hood: null, pocket: null, strings: [], hanger: { hookOnly: true } },
    bounds: { x0: mn[0], x1: mx[0], y0: mn[1], y1: mx[1] + 9, w: mx[0] - mn[0], h: mx[1] - mn[1] + 9, cx: (mn[0] + mx[0]) / 2, cy: (mn[1] + mx[1]) / 2, zc: (mn[2] + mx[2]) / 2 },
    washBounds: { x0: 0, y0: 0, w: sheet.w, h: sheet.h, cx: sheet.w / 2, cy: sheet.h / 2 },
  };
  return (modelCache[id] = g);
}

const BASE = {
  W: 26, L: 72, neckW: 8.5, neckF: 9.5, neckB: 2.4, neckType: 'crew',
  shoulderX: 22, drop: 4.5, armDepth: 22, hemW: 26, hemCurve: 0, waist: 0,
  sleeve: { len: 21, cuff: 16.5, angle: 24 }, ribHem: 0, ribCuff: 0,
  depth: 4.2, radius: 10, sleeveDepth: 3.4, neckRib: 1.0,
  fabric: 'jersey', hood: false, pocket: false, strings: false,
};
const SPECS = {
  'tee': {},
  'tee-vneck': { neckType: 'v', neckF: 15, neckW: 8.8 },
  'tee-oversize': { W: 31, hemW: 31, L: 74, shoulderX: 29, drop: 8, armDepth: 26, sleeve: { len: 25, cuff: 19.5, angle: 34 }, radius: 11, depth: 4.6, sleeveDepth: 3.8 },
  'tee-women': { W: 23, hemW: 24, L: 64, shoulderX: 19, drop: 4, neckW: 8, neckF: 9, armDepth: 19.5, waist: 2.2, sleeve: { len: 15, cuff: 14, angle: 22 }, depth: 3.8, radius: 9, sleeveDepth: 3 },
  'tee-crop': { W: 26, hemW: 26, L: 47, shoulderX: 24, drop: 6, neckW: 8, neckF: 8.5, armDepth: 21, sleeve: { len: 20, cuff: 16, angle: 28 }, depth: 4, radius: 9, sleeveDepth: 3.2 },
  'longsleeve': { sleeve: { len: 64, cuff: 10, angle: 60 }, ribCuff: 0, sleeveDepth: 2.6 },
  'raglan': { sleeve: { len: 42, cuff: 11.5, angle: 56 }, sleeveDepth: 2.8, contrast: '#22252a' },
  'tank': { neckW: 11, neckF: 15, neckB: 5, shoulderX: 15.5, drop: 2.5, armDepth: 27, sleeve: null, tank: true, L: 71, neckRib: 0.7 },
  'sweatshirt': { W: 29, hemW: 27.5, L: 70, shoulderX: 25, drop: 6, armDepth: 25, neckW: 9, neckF: 9, neckB: 2.5, sleeve: { len: 56, cuff: 12.5, angle: 60 }, ribHem: 7, ribCuff: 7, depth: 5.2, radius: 12, sleeveDepth: 3.4, neckRib: 1.4, fabric: 'fleece' },
  'hoodie': { W: 29, hemW: 27.5, L: 70, shoulderX: 25, drop: 6, armDepth: 25, neckW: 9.5, neckF: 9, neckB: 2.5, sleeve: { len: 56, cuff: 12.5, angle: 60 }, ribHem: 7, ribCuff: 7, depth: 5.2, radius: 12, sleeveDepth: 3.4, neckRib: 0, hood: true, pocket: true, strings: true, fabric: 'fleece' },
  'tote': { tote: true, fabric: 'canvas' },
};

/* ---------- small path helpers ---------- */
function qbez(p0, p1, p2, n = 16) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); } return o; }
const mirrorX = (pts) => pts.map(([x, y]) => [-x, y]);

// right half of a body outline, from centre-neck to centre-hem (garment space)
function halfBody(s, back) {
  const top = s.L, nd = back ? s.neckB : s.neckF;
  const pts = [];
  if (s.neckType === 'v' && !back) { pts.push([0, top - nd], [s.neckW * 0.55, top - nd * 0.45], [s.neckW, top]); }
  else for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI / 2; pts.push([s.neckW * Math.sin(a), top - nd * Math.cos(a)]); }
  const S = [s.shoulderX, top - s.drop];
  const U = [s.W, top - s.drop - s.armDepth];
  if (s.tank) {
    pts.push(S);
    pts.push(...qbez(S, [S[0] + 1.2, U[1] + 3], U, 14).slice(1));
  } else if (s.raglan) {
    // raglan: diagonal seam from neck to underarm
    pts.length = 0;
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; pts.push([s.neckW * 0.8 * Math.sin(a), top - (nd + 1.5) * Math.cos(a) - 1.5]); }
    pts.push(U);
  } else { pts.push(S, ...qbez(S, [S[0] + 0.3, U[1] + 1.2], U, 12).slice(1)); } // scooped armhole
  const arm = pts.slice(pts.indexOf(S) >= 0 ? pts.indexOf(S) : pts.length - 1);
  const neckN = s.raglan ? 11 : (s.neckType === 'v' && !back ? 3 : 15);
  const hemY = s.ribHem ? s.ribHem - 0.6 : 0;
  if (s.waist) pts.push([s.W - s.waist, (U[1] + hemY) * 0.5]);
  pts.push([s.hemW, hemY + (s.hemCurve || 0)]);
  pts.push([0, hemY]);
  return { pts, S, U, hemY, neckN, arm };
}
function fullFromHalf(half) {
  const right = half;
  const left = mirrorX(half.slice(1, -1)).reverse();
  return dedupe(densify([...right, ...left], 1.2, true));
}

/* ---------- rigid frame for sleeves/cuffs: origin O, x-axis d, y-axis n (local y down) ---------- */
function frame(O, d, n) {
  // garment→local:  lx = (p-O)·d,  ly = (p-O)·n
  return [d[0], n[0], d[1], n[1], -(O[0] * d[0] + O[1] * d[1]), -(O[0] * n[0] + O[1] * n[1])];
}

/**
 * Build the full description of one garment.
 * pieces: { id, label, poly (local, y-down), stitches, folds, kind }
 * panels: { piece, outline (garment), side ±1, depth, radius, toLocal (affine garment→local), kind, base?: 'front' }
 */
export function buildGarment(id, opts = {}) {
  const meta = GARMENT_LIST.find(g => g.id === id) || GARMENT_LIST[0];
  if (meta.model) { if (!modelCache[meta.id]) throw new Error('model garment not loaded: ' + meta.id); return modelCache[meta.id]; }
  const s = { ...BASE, ...(SPECS[meta.id] || {}) };
  if (s.tote) return buildTote(meta, s);
  const pieces = [], panels = [], extras = { necklines: [], label: null, hood: null, pocket: null, strings: [], hanger: null };

  /* body front & back */
  const hf = halfBody(s, false), hb = halfBody(s, true);
  const front = fullFromHalf(hf.pts), back = fullFromHalf(hb.pts);
  const top = s.L, hw = Math.max(s.W, s.hemW);
  const toFront = [1, 0, 0, -1, hw, top];      // lx = x + hw, ly = top - y
  const toBack = [-1, 0, 0, -1, hw, top];      // seen from behind: mirrored x
  const hemStitch = (hy) => [[-s.hemW + 0.8, hy + 2], [s.hemW - 0.8, hy + 2]];
  const stitchLocal = (pl, m) => pl.map(p => affApply(m, p[0], p[1]));
  const centre = [[[hw, -1.5], [hw, top - hf.hemY + 1.5]]];
  pieces.push({ id: 'front', label: 'Front', poly: front.map(p => affApply(toFront, ...p)), kind: 'main', stitches: s.ribHem ? [] : [stitchLocal(hemStitch(hf.hemY), toFront)], folds: centre });
  pieces.push({ id: 'back', label: 'Back', poly: back.map(p => affApply(toBack, ...p)), kind: 'main', stitches: s.ribHem ? [] : [stitchLocal(hemStitch(hb.hemY), toBack)], folds: centre });
  // open edges (hem, neck, armholes) stay apart so the garment is a hollow shell, not a pillow
  const openBody = (h) => {
    const neck = h.pts.slice(0, h.neckN);
    const o = [[...mirrorX(neck).reverse(), ...neck.slice(1)], [[-s.hemW, h.hemY], [s.hemW, h.hemY]]];
    o.push(h.arm, mirrorX(h.arm));
    return o;
  };
  panels.push({ piece: 'front', outline: front, side: 1, depth: s.depth, radius: s.radius, toLocal: toFront, kind: 'main', role: 'front', open: openBody(hf), top });
  panels.push({ piece: 'back', outline: back, side: -1, depth: s.depth, radius: s.radius, toLocal: toBack, kind: 'main', role: 'back', open: openBody(hb), top });

  /* neck rib (tube in 3D) */
  if (s.neckRib) {
    const fl = hf.pts.slice(0, hf.neckN), bl = hb.pts.slice(0, hb.neckN);
    const lines = [[[...mirrorX(fl).reverse(), ...fl.slice(1)], 1, 'neckF', 'Neck rib · front'], [[...mirrorX(bl).reverse(), ...bl.slice(1)], -1, 'neckB', 'Neck rib · back']];
    for (const [pts, side, id, label] of lines) {
      const len = polyLength(pts), h = 2 * Math.PI * s.neckRib * 0.5;
      pieces.push({ id, label, poly: [[0, 0], [len, 0], [len, h], [0, h]], kind: 'rib', folds: [[[len / 2, -1], [len / 2, h + 1]]] });
      extras.necklines.push({ pts, side, r: s.neckRib, piece: id, len, h });
    }
  }
  // woven neck label: an inside-only pattern piece (printable), shown on the inside of the back neck
  const ls = LABEL_SHAPES.find(l => l.id === opts.labelShape) || LABEL_SHAPES[0];
  extras.label = { x: 0, y: top - s.neckB - 0.9, w: ls.w, h: ls.h, shape: ls.id };
  pieces.push({ id: 'label', label: 'Label', poly: [[0, 0], [ls.w, 0], [ls.w, ls.h], [0, ls.h]], kind: 'label', insideOnly: true, noMirror: true });
  extras.hanger = { top, neckW: s.neckW, shoulderX: s.shoulderX || s.neckW + 4, drop: s.drop };

  /* sleeves */
  if (s.sleeve) {
    const sl = s.sleeve;
    const a = rad(sl.angle);
    for (const sideX of [1, -1]) {
      let S = [hf.S[0] * sideX, hf.S[1]], U = [hf.U[0] * sideX, hf.U[1]];
      if (s.raglan) S = [s.neckW * 0.8 * sideX, top - 1.5];
      const d = [Math.cos(a) * sideX, -Math.sin(a)];
      const n = sideX > 0 ? [d[1], -d[0]] : [-d[1], d[0]]; // perpendicular, pointing down/inward
      const T = [S[0] + d[0] * sl.len, S[1] + d[1] * sl.len];
      const B = [T[0] + n[0] * sl.cuff, T[1] + n[1] * sl.cuff];
      const pid = sideX > 0 ? 'sleeveL' : 'sleeveR'; // named by the wearer
      const root = sideX > 0 ? hf.arm : mirrorX(hf.arm);          // armhole curve S → U
      // the sleeve pattern: a bell — cap on top (sewn into the armhole), hem at the bottom
      const under = Math.hypot(B[0] - U[0], B[1] - U[1]);
      const armLen = polyLength(root);
      const capH = clamp(sl.len - under, 8, Math.min(15, sl.len * 0.7));
      const halfW = Math.max(Math.sqrt(Math.max(1, (armLen * 1.02) ** 2 - capH * capH)), sl.cuff + 1);
      const P0 = [0, 0], A = [halfW, capH], H0 = [0, sl.len], H1 = [sl.cuff, sl.len];
      const cap = cubicPts(P0, [halfW * 0.42, 0], [halfW * 0.58, capH], A, 24);
      const fullPoly = dedupe([...cap, H1, [-H1[0], H1[1]], ...cap.slice(1).reverse().map(([x, y]) => [-x, y])]);
      const halfPat = (mx) => ({ c0: cap.map(([x, y]) => [x * mx, y]), c1: [H0, [H1[0] * mx, H1[1]]], d0: [P0, H0], d1: [[A[0] * mx, A[1]], [H1[0] * mx, H1[1]]] });
      const geo = { c0: root, c1: [T, B], d0: [S, T], d1: [U, B] };
      const outline = dedupe(densify([...root, B, T], 1.0, true));
      pieces.push({ id: pid, label: sideX > 0 ? 'Left sleeve' : 'Right sleeve', poly: dedupe(densify(fullPoly, 1.2, true)), kind: 'main',
        stitches: s.ribCuff ? [] : [[[-sl.cuff + 0.7, sl.len - 2], [sl.cuff - 0.7, sl.len - 2]]], folds: [[[0, -1.5], [0, sl.len + 1.5]]] });
      for (const side of [1, -1]) {
        // pick the half of the bell that keeps artwork readable (not mirrored) on this face
        const mx = (sideX > 0) === (side > 0) ? -1 : 1;
        const pat = halfPat(mx);
        const gs = [], ls = [];
        for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) { gs.push(coons(geo, i / 6, j / 6)); ls.push(coons(pat, i / 6, j / 6)); }
        const localPoly = dedupe([...pat.c0, pat.d1[1], pat.c1[0]]);
        panels.push({ piece: pid, outline, side, depth: s.sleeveDepth, radius: 6, kind: 'main', role: 'sleeve', top, coons: { geo, pat }, localPoly, fit: fitAffine(gs, ls) });
      }
      if (s.ribCuff) {
        const cw = sl.cuff - 1.2;
        const C0 = [T[0] - d[0] * 0.6 + n[0] * 0.6, T[1] - d[1] * 0.6 + n[1] * 0.6];
        const C1 = [C0[0] + d[0] * s.ribCuff, C0[1] + d[1] * s.ribCuff];
        const C2 = [C1[0] + n[0] * cw, C1[1] + n[1] * cw];
        const C3 = [C0[0] + n[0] * cw, C0[1] + n[1] * cw];
        let mc = frame(C0, d, n);
        if (sideX < 0) mc = [-mc[0], mc[1], -mc[2], mc[3], -mc[4], mc[5]];
        const mcB = [mc[0], -mc[1], mc[2], -mc[3], mc[4], -mc[5]];
        const ch = [C0, C1, C2, C3];
        const cl = ch.map(p => affApply(mc, ...p));
        const cid = sideX > 0 ? 'cuffL' : 'cuffR';
        pieces.push({ id: cid, label: sideX > 0 ? 'Left cuff · rib' : 'Right cuff · rib', poly: dedupe([cl[0], cl[3], cl[2], cl[1], [cl[2][0], -cl[2][1]], [cl[3][0], -cl[3][1]]]), kind: 'rib', folds: [[[cl[0][0], 0], [cl[1][0], 0]]] });
        const co = dedupe(densify(ch, 0.8, true));
        const cOpen = [[C0, C3], [C1, C2]];
        panels.push({ piece: cid, outline: co, side: 1, depth: s.sleeveDepth * 0.85, radius: 4, toLocal: mc, kind: 'rib', role: 'cuff', open: cOpen, top });
        panels.push({ piece: cid, outline: co, side: -1, depth: s.sleeveDepth * 0.85, radius: 4, toLocal: mcB, kind: 'rib', role: 'cuff', open: cOpen, top });
      }
    }
  }

  /* waistband rib */
  if (s.ribHem) {
    const rw = s.hemW - 1.2;
    const rect = dedupe(densify([[-rw, s.ribHem], [rw, s.ribHem], [rw, 0], [-rw, 0]], 1.0, true));
    const mF = [1, 0, 0, -1, rw, s.ribHem], mB = [-1, 0, 0, -1, rw, s.ribHem];
    pieces.push({ id: 'ribF', label: 'Waistband · front', poly: rect.map(p => affApply(mF, ...p)), kind: 'rib' });
    pieces.push({ id: 'ribB', label: 'Waistband · back', poly: rect.map(p => affApply(mB, ...p)), kind: 'rib' });
    const rOpen = [[[-rw, s.ribHem], [rw, s.ribHem]], [[-rw, 0], [rw, 0]]];
    panels.push({ piece: 'ribF', outline: rect, side: 1, depth: s.depth * 0.85, radius: s.radius * 0.9, toLocal: mF, kind: 'rib', role: 'rib', open: rOpen, top });
    panels.push({ piece: 'ribB', outline: rect, side: -1, depth: s.depth * 0.85, radius: s.radius * 0.9, toLocal: mB, kind: 'rib', role: 'rib', open: rOpen, top });
  }

  /* hood: lies flat behind the back, peeking above the shoulders */
  if (s.hood) {
    const hwid = 17, yTop = top + 9, yBot = top - 26;
    const hood = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24 * Math.PI; hood.push([-Math.cos(t) * hwid, yBot + 16 + Math.sin(t) * (yTop - yBot - 16)]); }
    hood.push([hwid * 0.92, yBot + 6], ...qbez([hwid * 0.78, yBot + 1], [0, yBot - 3], [-hwid * 0.78, yBot + 1], 12), [-hwid * 0.92, yBot + 6]);
    const ho = dedupe(densify(hood, 1.2, true));
    const mH = [-1, 0, 0, -1, hwid, yTop], mL = [1, 0, 0, -1, hwid, yTop];
    pieces.push({ id: 'hood', label: 'Hood · outside', poly: ho.map(p => affApply(mH, ...p)), kind: 'main' });
    pieces.push({ id: 'hoodIn', label: 'Hood · lining', poly: ho.map(p => affApply(mL, ...p)), kind: 'main' });
    extras.hood = { outline: ho, z: -(s.depth + 2.6) };
    panels.push({ piece: 'hood', outline: ho, side: -1, depth: 1.4, radius: 5, toLocal: mH, kind: 'main', role: 'hood', zBase: extras.hood.z });
    panels.push({ piece: 'hoodIn', outline: ho, side: 1, depth: 1.0, radius: 5, toLocal: mL, kind: 'main', role: 'hood', zBase: extras.hood.z });
  }

  /* kangaroo pocket on the front */
  if (s.pocket) {
    const y0 = s.ribHem + 0.5, y1 = y0 + 22, wT = 13, wB = 19;
    const pk = dedupe(densify([[-wT, y1], [wT, y1], [wT + 3.5, y1 - 5], [wB, y0 + 9], [wB, y0], [-wB, y0], [-wB, y0 + 9], [-wT - 3.5, y1 - 5]], 1.0, true));
    const mP = [1, 0, 0, -1, wB, y1];
    pieces.push({ id: 'pocket', label: 'Pocket', poly: pk.map(p => affApply(mP, ...p)), kind: 'main' });
    panels.push({ piece: 'pocket', outline: pk, side: 1, depth: 0.55, radius: 2, toLocal: mP, kind: 'main', role: 'pocket', base: 'front' });
  }
  if (s.strings) {
    for (const sx of [-1, 1]) extras.strings.push({ x: sx * (s.neckW - 3.2), yTop: top - s.neckF - 0.6, len: 30 });
  }

  return finish(meta, s, pieces, panels, extras);
}

function buildTote(meta, s) {
  const w = 19, h = 42;
  const body = [];
  body.push([-w, h], [w, h], [w, 3]);
  for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; body.push([w - 3 + 3 * Math.cos(a), 3 - 3 * Math.sin(a)]); }
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 2 + i / 6 * Math.PI / 2; body.push([-w + 3 + 3 * Math.cos(a), 3 - 3 * Math.sin(a)]); }
  const o = dedupe(densify(body, 1.0, true));
  const mF = [1, 0, 0, -1, w, h], mB = [-1, 0, 0, -1, w, h];
  const pieces = [
    { id: 'front', label: 'Front', poly: o.map(p => affApply(mF, ...p)), kind: 'main', stitches: [[[0.6, 3], [2 * w - 0.6, 3]]], folds: [[[w, -1.5], [w, h + 1.5]]] },
    { id: 'back', label: 'Back', poly: o.map(p => affApply(mB, ...p)), kind: 'main', stitches: [[[0.6, 3], [2 * w - 0.6, 3]]], folds: [[[w, -1.5], [w, h + 1.5]]] },
  ];
  const panels = [
    { piece: 'front', outline: o, side: 1, depth: 2.6, radius: 8, toLocal: mF, kind: 'main', role: 'front', open: [[[-w, h], [w, h]]], top: h },
    { piece: 'back', outline: o, side: -1, depth: 2.6, radius: 8, toLocal: mB, kind: 'main', role: 'back', open: [[[-w, h], [w, h]]], top: h },
  ];
  const extras = { necklines: [], label: null, hood: null, pocket: null, strings: [], hanger: null, handles: { w, h, x: 9, rise: 30 } };
  return finish(meta, { ...s, L: h }, pieces, panels, extras);
}

/* ---------- placement presets (piece-local centre & width, cm) ---------- */
export const LABEL_SHAPES = [
  { id: 'woven', name: 'Small woven', w: 5, h: 2.6 },
  { id: 'wide', name: 'Wide', w: 7.5, h: 2.6 },
  { id: 'square', name: 'Square', w: 4, h: 4 },
  { id: 'satin', name: 'Tall satin', w: 3.4, h: 6.5 },
  { id: 'loop', name: 'Loop fold', w: 4.6, h: 3.4 },
];
// "Place at" presets: piece, centre as a fraction of the piece, width in cm; face 'in' = inside of the garment
function presetsFor(g) {
  const P = (piece, fx, fy, w, name, face = 'out') => ({ name, piece, fx, fy, w, face });
  const has = (id) => g.pieces.some(p => p.id === id);
  if (g.tote) return [P('front', 0.5, 0.5, 26, 'Front'), P('back', 0.5, 0.5, 26, 'Back')];
  const list = [P('front', 0.5, 0.33, 26, 'Chest'), P('front', 0.66, 0.24, 9, 'Left chest logo'), P('front', 0.5, 0.8, 20, 'Front bottom'),
    P('back', 0.5, 0.36, 28, 'Back'), P('back', 0.5, 0.1, 7, 'Back neck')];
  if (has('sleeveR')) list.push(P('sleeveR', 0.5, 0.75, 7, 'Right sleeve'));
  if (has('sleeveL')) list.push(P('sleeveL', 0.5, 0.75, 7, 'Left sleeve'));
  if (has('label')) list.push(P('label', 0.5, 0.5, 3.6, 'Label', 'in'));
  list.push(P('back', 0.5, 0.075, 7, 'Printed label', 'in'));
  if (has('hood')) list.push(P('hood', 0.5, 0.4, 16, 'Hood'));
  if (has('pocket')) list.push(P('pocket', 0.5, 0.55, 18, 'Pocket'));
  return list;
}

function finish(meta, s, pieces, panels, extras) {
  for (const p of pieces) { p.bounds = polyBounds(p.poly); }
  // normalise each piece so its bounds start at (0,0) — panels' toLocal get the same shift
  for (const p of pieces) {
    const { x0, y0 } = p.bounds;
    p.poly = p.poly.map(([x, y]) => [x - x0, y - y0]);
    p.stitches = (p.stitches || []).map(pl => pl.map(([x, y]) => [x - x0, y - y0]));
    p.folds = (p.folds || []).map(pl => pl.map(([x, y]) => [x - x0, y - y0]));
    for (const pn of panels) {
      if (pn.piece !== p.id) continue;
      if (pn.toLocal) pn.toLocal = [pn.toLocal[0], pn.toLocal[1], pn.toLocal[2], pn.toLocal[3], pn.toLocal[4] - x0, pn.toLocal[5] - y0];
      if (pn.coons) { pn.coons.off = [x0, y0]; pn.localPoly = pn.localPoly.map(([x, y]) => [x - x0, y - y0]); pn.fit = [pn.fit[0], pn.fit[1], pn.fit[2], pn.fit[3], pn.fit[4] - x0, pn.fit[5] - y0]; }
    }
    p.bounds = polyBounds(p.poly);
    p.w = p.bounds.w; p.h = p.bounds.h;
  }
  const layout = layoutPieces(pieces);
  const g = { id: meta.id, name: meta.name, cut: meta.cut, spec: s, contrast: s.contrast || null, fabric: s.fabric, pieces, panels, extras, sheet: layout, tote: !!s.tote };
  g.presets = presetsFor(g);
  // garment-space bounds for the camera
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pn of panels) for (const [x, y] of pn.outline) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (extras.handles) y1 += extras.handles.rise;
  if (extras.hanger) y1 += 9;
  g.bounds = { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  return g;
}

// cutting-sheet layout: one column per side (neck rib, sleeve, body, ribs), extras in a third column
function layoutPieces(pieces) {
  const M = 12;
  const cols = [['neckF', 'sleeveR', 'front', 'ribF', 'cuffR'], ['neckB', 'sleeveL', 'back', 'ribB', 'cuffL'], ['hood', 'hoodIn', 'pocket']];
  const placed = new Set();
  const columns = cols.map(ids => ids.map(id => pieces.find(p => p.id === id)).filter(Boolean)).filter(c => c.length);
  const rest = pieces.filter(p => !cols.flat().includes(p.id));
  if (rest.length) columns.push(rest);
  let x = M, sheetH = 0;
  for (const col of columns) {
    const cw = Math.max(...col.map(p => p.w));
    let y = M;
    for (const p of col) { p.sx = x + (cw - p.w) / 2; p.sy = y; y += p.h + M; placed.add(p.id); }
    sheetH = Math.max(sheetH, y);
    x += cw + M;
  }
  return { w: Math.ceil(x), h: Math.ceil(sheetH) };
}

function shelfLayout(pieces, M) {
  const order = [...pieces].sort((a, b) => b.h - a.h || b.w - a.w);
  const area = pieces.reduce((s, p) => s + (p.w + M) * (p.h + M), 0);
  const maxW = Math.max(Math.sqrt(area) * 1.45, ...pieces.map(p => p.w + 2 * M));
  let x = M, y = M, rowH = 0, W = 0;
  for (const p of order) {
    if (x + p.w + M > maxW && x > M) { x = M; y += rowH + M; rowH = 0; }
    p.sx = x; p.sy = y; x += p.w + M; rowH = Math.max(rowH, p.h); W = Math.max(W, x);
  }
  return { w: Math.ceil(W), h: Math.ceil(y + rowH + M) };
}

/* SVG thumbnail from the 3D outlines (front view) */
export function garmentThumbSVG(g, fill = 'currentColor') {
  if (g.model) return `<img src="${g.model}thumb.png" alt="" style="width:92%;height:92%;object-fit:contain">`;
  const b = g.bounds, pad = 4;
  const vb = `${b.x0 - pad} ${-b.y1 - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`;
  const order = [...g.panels].filter(p => p.side === 1 || p.role === 'hood').sort((a, b) => (a.role === 'hood' ? -1 : 0) - (b.role === 'hood' ? -1 : 0));
  const paths = order.map(pn => `<path d="M${pn.outline.map(([x, y]) => `${x.toFixed(1)},${(-y).toFixed(1)}`).join('L')}Z" fill="${fill}" stroke="rgba(0,0,0,.28)" stroke-width="0.6"/>`).join('');
  let extra = '';
  if (g.extras.handles) { const h = g.extras.handles; extra = `<path d="M${-h.x},${-h.h} C${-h.x},${-h.h - h.rise * 1.3} ${h.x},${-h.h - h.rise * 1.3} ${h.x},${-h.h}" fill="none" stroke="${fill}" stroke-width="2.6"/>`; }
  return `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${extra}${paths}</svg>`;
}
