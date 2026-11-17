// Design Master — parametric garment generator.
// Every garment is built from measurements (cm). One generator produces both the flat
// sewing-pattern pieces (2D editor + texture atlas) and the 3D "panels" that are inflated
// into the mockup, so the pattern and the 3D model always agree exactly.
//
// Garment space: x right, y up, cm. Front faces look toward +z.
// Piece-local space: cm, y down, as the piece is seen from the outside of the garment.

import { densify, dedupe, polyBounds, rad, affApply } from './util.js';

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
];

const BASE = {
  W: 26, L: 72, neckW: 8.5, neckF: 9.5, neckB: 2.4, neckType: 'crew',
  shoulderX: 22, drop: 4.5, armDepth: 22, hemW: 26, hemCurve: 0, waist: 0,
  sleeve: { len: 21, cuff: 16.5, angle: 24 }, ribHem: 0, ribCuff: 0,
  depth: 2.2, radius: 5.5, sleeveDepth: 1.7, neckRib: 1.0,
  fabric: 'jersey', hood: false, pocket: false, strings: false,
};
const SPECS = {
  'tee': {},
  'tee-vneck': { neckType: 'v', neckF: 15, neckW: 8.8 },
  'tee-oversize': { W: 31, hemW: 31, L: 74, shoulderX: 29, drop: 8, armDepth: 26, sleeve: { len: 25, cuff: 19.5, angle: 34 }, radius: 6.5 },
  'tee-women': { W: 23, hemW: 24, L: 64, shoulderX: 19, drop: 4, neckW: 8, neckF: 9, armDepth: 19.5, waist: 2.2, sleeve: { len: 15, cuff: 14, angle: 22 }, depth: 2, radius: 5 },
  'tee-crop': { W: 26, hemW: 26, L: 47, shoulderX: 24, drop: 6, neckW: 8, neckF: 8.5, armDepth: 21, sleeve: { len: 20, cuff: 16, angle: 28 }, depth: 2, radius: 5 },
  'longsleeve': { sleeve: { len: 64, cuff: 10, angle: 60 }, ribCuff: 0, sleeveDepth: 1.6 },
  'raglan': { sleeve: { len: 42, cuff: 11.5, angle: 56 }, sleeveDepth: 1.6, contrast: '#22252a' },
  'tank': { neckW: 11, neckF: 15, neckB: 5, shoulderX: 15.5, drop: 2.5, armDepth: 27, sleeve: null, tank: true, L: 71, neckRib: 0.7 },
  'sweatshirt': { W: 29, hemW: 27.5, L: 70, shoulderX: 25, drop: 6, armDepth: 25, neckW: 9, neckF: 9, neckB: 2.5, sleeve: { len: 56, cuff: 12.5, angle: 60 }, ribHem: 7, ribCuff: 7, depth: 2.8, radius: 7, sleeveDepth: 2.2, neckRib: 1.4, fabric: 'fleece' },
  'hoodie': { W: 29, hemW: 27.5, L: 70, shoulderX: 25, drop: 6, armDepth: 25, neckW: 9.5, neckF: 9, neckB: 2.5, sleeve: { len: 56, cuff: 12.5, angle: 60 }, ribHem: 7, ribCuff: 7, depth: 2.8, radius: 7, sleeveDepth: 2.2, neckRib: 0, hood: true, pocket: true, strings: true, fabric: 'fleece' },
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
  } else { pts.push(S, U); }
  const neckN = s.raglan ? 11 : (s.neckType === 'v' && !back ? 3 : 15);
  const hemY = s.ribHem ? s.ribHem - 0.6 : 0;
  if (s.waist) pts.push([s.W - s.waist, (U[1] + hemY) * 0.5]);
  pts.push([s.hemW, hemY + (s.hemCurve || 0)]);
  pts.push([0, hemY]);
  return { pts, S, U, hemY, neckN };
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
export function buildGarment(id) {
  const meta = GARMENT_LIST.find(g => g.id === id) || GARMENT_LIST[0];
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
  pieces.push({ id: 'front', label: 'FRONT', poly: front.map(p => affApply(toFront, ...p)), kind: 'main', stitches: s.ribHem ? [] : [stitchLocal(hemStitch(hf.hemY), toFront)], grain: true });
  pieces.push({ id: 'back', label: 'BACK', poly: back.map(p => affApply(toBack, ...p)), kind: 'main', stitches: s.ribHem ? [] : [stitchLocal(hemStitch(hb.hemY), toBack)], grain: true });
  panels.push({ piece: 'front', outline: front, side: 1, depth: s.depth, radius: s.radius, toLocal: toFront, kind: 'main', role: 'front' });
  panels.push({ piece: 'back', outline: back, side: -1, depth: s.depth, radius: s.radius, toLocal: toBack, kind: 'main', role: 'back' });

  /* neck rib (tube in 3D) */
  if (s.neckRib) {
    const fl = hf.pts.slice(0, hf.neckN);
    extras.necklines.push({ pts: [...mirrorX(fl).reverse(), ...fl.slice(1)], side: 1, r: s.neckRib });
    const bl = hb.pts.slice(0, hb.neckN);
    extras.necklines.push({ pts: [...mirrorX(bl).reverse(), ...bl.slice(1)], side: -1, r: s.neckRib });
  }
  extras.label = { x: 0, y: top - s.neckB - 1.2, w: 5.6, h: 3.2 };
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
      let half = [S, T, B, U];
      let m = frame(S, d, n);
      if (sideX < 0) m = [-m[0], m[1], -m[2], m[3], -m[4], m[5]]; // keep artwork readable on the left sleeve
      const mBack = [m[0], -m[1], m[2], -m[3], m[4], -m[5]];
      const loc = half.map(p => affApply(m, ...p));
      const mir = loc.map(([x, y]) => [x, -y]);
      // full piece: front half below the fold line, back half above it
      const full = dedupe([loc[0], loc[3], loc[2], loc[1], mir[2], mir[3]]);
      const pid = sideX > 0 ? 'sleeveL' : 'sleeveR'; // named by the wearer
      const cuffX = loc[1][0];
      const stitches = s.ribCuff ? [] : [[[cuffX - 2 * Math.sign(cuffX || 1), -sl.cuff + 0.6], [cuffX - 2 * Math.sign(cuffX || 1), sl.cuff - 0.6]]];
      pieces.push({ id: pid, label: sideX > 0 ? 'LEFT SLEEVE' : 'RIGHT SLEEVE', poly: dedupe(densify(full, 1.2, true)), kind: 'main', stitches, folds: [[[loc[0][0], 0], [loc[1][0], 0]]], grain: true });
      const outline = dedupe(densify(half, 1.0, true));
      panels.push({ piece: pid, outline, side: 1, depth: s.sleeveDepth, radius: 4, toLocal: m, kind: 'main', role: 'sleeve' });
      panels.push({ piece: pid, outline, side: -1, depth: s.sleeveDepth, radius: 4, toLocal: mBack, kind: 'main', role: 'sleeve' });
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
        pieces.push({ id: cid, label: sideX > 0 ? 'LEFT CUFF · rib' : 'RIGHT CUFF · rib', poly: dedupe([cl[0], cl[3], cl[2], cl[1], [cl[2][0], -cl[2][1]], [cl[3][0], -cl[3][1]]]), kind: 'rib', folds: [[[cl[0][0], 0], [cl[1][0], 0]]] });
        const co = dedupe(densify(ch, 0.8, true));
        panels.push({ piece: cid, outline: co, side: 1, depth: s.sleeveDepth * 0.85, radius: 2.5, toLocal: mc, kind: 'rib', role: 'cuff' });
        panels.push({ piece: cid, outline: co, side: -1, depth: s.sleeveDepth * 0.85, radius: 2.5, toLocal: mcB, kind: 'rib', role: 'cuff' });
      }
    }
  }

  /* waistband rib */
  if (s.ribHem) {
    const rw = s.hemW - 1.2;
    const rect = dedupe(densify([[-rw, s.ribHem], [rw, s.ribHem], [rw, 0], [-rw, 0]], 1.0, true));
    const mF = [1, 0, 0, -1, rw, s.ribHem], mB = [-1, 0, 0, -1, rw, s.ribHem];
    pieces.push({ id: 'ribF', label: 'WAISTBAND · front', poly: rect.map(p => affApply(mF, ...p)), kind: 'rib' });
    pieces.push({ id: 'ribB', label: 'WAISTBAND · back', poly: rect.map(p => affApply(mB, ...p)), kind: 'rib' });
    panels.push({ piece: 'ribF', outline: rect, side: 1, depth: s.depth * 0.8, radius: 3, toLocal: mF, kind: 'rib', role: 'rib' });
    panels.push({ piece: 'ribB', outline: rect, side: -1, depth: s.depth * 0.8, radius: 3, toLocal: mB, kind: 'rib', role: 'rib' });
  }

  /* hood: lies flat behind the back, peeking above the shoulders */
  if (s.hood) {
    const hwid = 17, yTop = top + 9, yBot = top - 26;
    const hood = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24 * Math.PI; hood.push([-Math.cos(t) * hwid, yBot + 16 + Math.sin(t) * (yTop - yBot - 16)]); }
    hood.push([hwid * 0.92, yBot + 6], ...qbez([hwid * 0.78, yBot + 1], [0, yBot - 3], [-hwid * 0.78, yBot + 1], 12), [-hwid * 0.92, yBot + 6]);
    const ho = dedupe(densify(hood, 1.2, true));
    const mH = [-1, 0, 0, -1, hwid, yTop], mL = [1, 0, 0, -1, hwid, yTop];
    pieces.push({ id: 'hood', label: 'HOOD · outside', poly: ho.map(p => affApply(mH, ...p)), kind: 'main', grain: true });
    pieces.push({ id: 'hoodIn', label: 'HOOD · lining', poly: ho.map(p => affApply(mL, ...p)), kind: 'main' });
    extras.hood = { outline: ho, z: -(s.depth * 2 + 0.2) };
    panels.push({ piece: 'hood', outline: ho, side: -1, depth: 1.4, radius: 5, toLocal: mH, kind: 'main', role: 'hood', zBase: extras.hood.z });
    panels.push({ piece: 'hoodIn', outline: ho, side: 1, depth: 1.0, radius: 5, toLocal: mL, kind: 'main', role: 'hood', zBase: extras.hood.z });
  }

  /* kangaroo pocket on the front */
  if (s.pocket) {
    const y0 = s.ribHem + 0.5, y1 = y0 + 22, wT = 13, wB = 19;
    const pk = dedupe(densify([[-wT, y1], [wT, y1], [wT + 3.5, y1 - 5], [wB, y0 + 9], [wB, y0], [-wB, y0], [-wB, y0 + 9], [-wT - 3.5, y1 - 5]], 1.0, true));
    const mP = [1, 0, 0, -1, wB, y1];
    pieces.push({ id: 'pocket', label: 'POCKET', poly: pk.map(p => affApply(mP, ...p)), kind: 'main' });
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
    { id: 'front', label: 'FRONT', poly: o.map(p => affApply(mF, ...p)), kind: 'main', stitches: [[[0.6, 3], [2 * w - 0.6, 3]]], grain: true },
    { id: 'back', label: 'BACK', poly: o.map(p => affApply(mB, ...p)), kind: 'main', stitches: [[[0.6, 3], [2 * w - 0.6, 3]]], grain: true },
  ];
  const panels = [
    { piece: 'front', outline: o, side: 1, depth: 1.3, radius: 4, toLocal: mF, kind: 'main', role: 'front' },
    { piece: 'back', outline: o, side: -1, depth: 1.3, radius: 4, toLocal: mB, kind: 'main', role: 'back' },
  ];
  const extras = { necklines: [], label: null, hood: null, pocket: null, strings: [], hanger: null, handles: { w, h, x: 9, rise: 30 } };
  return finish(meta, { ...s, L: h }, pieces, panels, extras);
}

/* ---------- placement presets (piece-local centre & width, cm) ---------- */
function presetsFor(g) {
  const P = (piece, fx, fy, w, name) => ({ name, piece, fx, fy, w });
  const list = [];
  if (g.tote) return [P('front', 0.5, 0.5, 26, 'Front · centre'), P('back', 0.5, 0.5, 26, 'Back · centre')];
  list.push(P('front', 0.5, 0.33, 25, 'Front · centre chest'));
  list.push(P('front', 0.64, 0.25, 9, 'Front · left chest'));
  list.push(P('front', 0.5, 0.47, 32, 'Front · full'));
  list.push(P('back', 0.5, 0.1, 7, 'Back · neck'));
  list.push(P('back', 0.5, 0.4, 30, 'Back · full'));
  if (g.pieces.some(p => p.id === 'sleeveL')) list.push(P('sleeveL', 0.5, 0.75, 7, 'Left sleeve'), P('sleeveR', 0.5, 0.75, 7, 'Right sleeve'));
  if (g.pieces.some(p => p.id === 'hood')) list.push(P('hood', 0.5, 0.4, 16, 'Hood · back'));
  if (g.pieces.some(p => p.id === 'pocket')) list.push(P('pocket', 0.5, 0.55, 18, 'Pocket'));
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
    for (const pn of panels) if (pn.piece === p.id) pn.toLocal = [pn.toLocal[0], pn.toLocal[1], pn.toLocal[2], pn.toLocal[3], pn.toLocal[4] - x0, pn.toLocal[5] - y0];
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

// simple shelf packing of the pattern pieces onto one sheet (cm)
function layoutPieces(pieces) {
  const M = 8;
  const order = [...pieces].sort((a, b) => b.h - a.h);
  const totalArea = pieces.reduce((s, p) => s + (p.w + M) * (p.h + M), 0);
  const maxW = Math.max(Math.sqrt(totalArea) * 1.55, ...pieces.map(p => p.w + 2 * M));
  let x = M, y = M, rowH = 0, sheetW = 0;
  for (const p of order) {
    if (x + p.w + M > maxW && x > M) { x = M; y += rowH + M; rowH = 0; }
    p.sx = x; p.sy = y;
    x += p.w + M; rowH = Math.max(rowH, p.h); sheetW = Math.max(sheetW, x);
  }
  return { w: Math.ceil(sheetW), h: Math.ceil(y + rowH + M) };
}

/* SVG thumbnail from the 3D outlines (front view) */
export function garmentThumbSVG(g, fill = 'currentColor') {
  const b = g.bounds, pad = 4;
  const vb = `${b.x0 - pad} ${-b.y1 - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`;
  const order = [...g.panels].filter(p => p.side === 1 || p.role === 'hood').sort((a, b) => (a.role === 'hood' ? -1 : 0) - (b.role === 'hood' ? -1 : 0));
  const paths = order.map(pn => `<path d="M${pn.outline.map(([x, y]) => `${x.toFixed(1)},${(-y).toFixed(1)}`).join('L')}Z" fill="${fill}" stroke="rgba(0,0,0,.28)" stroke-width="0.6"/>`).join('');
  let extra = '';
  if (g.extras.handles) { const h = g.extras.handles; extra = `<path d="M${-h.x},${-h.h} C${-h.x},${-h.h - h.rise * 1.3} ${h.x},${-h.h - h.rise * 1.3} ${h.x},${-h.h}" fill="none" stroke="${fill}" stroke-width="2.6"/>`; }
  return `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${extra}${paths}</svg>`;
}
