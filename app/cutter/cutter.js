// Pattern cutter: draw a garment's seams on its 3D model, fill each pattern piece, hand the cut to the converter
// (tools/model-import/hoodie_build.py --usercut). The cut is saved as points on the surface (seam points, a point
// inside each piece, brush strokes), not as triangle numbers, so it is small enough to paste in a chat and the
// converter can cut the mesh exactly along the same lines.
//
// A seam between two points: the plane through both points that stands upright on the surface there, cut with the
// surface between them (only the part of the surface joined to the two points, within reach of the straight line).
// The converter cuts the mesh with exactly that plane, so what you see is what you get.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const $ = (s) => document.querySelector(s);
const MODELS = {
  'hoodie-zip': { name: 'Zip hoodie', url: './models/hoodie-zip.glb', auto: './models/hoodie-zip-auto.json', pieces: 'hoodie', space: 'blender' },
};
const PIECE_SETS = {
  hoodie: [['frontL', 'Front · left'], ['frontR', 'Front · right'], ['back', 'Back'], ['sleeveL', 'Left sleeve'], ['sleeveR', 'Right sleeve'],
    ['cuffL', 'Left cuff'], ['cuffR', 'Right cuff'], ['waistbandB', 'Waistband · back'], ['waistbandL', 'Waistband · front left'],
    ['waistbandR', 'Waistband · front right'], ['hoodL', 'Hood · left'], ['hoodR', 'Hood · right'], ['pocketL', 'Pocket · left'],
    ['pocketR', 'Pocket · right'], ['zip', 'Zip'], ['cords', 'Drawcords'], ['lining', 'Lining (inside)']],
  generic: [['front', 'Front'], ['back', 'Back'], ['sleeveL', 'Left sleeve'], ['sleeveR', 'Right sleeve'], ['lining', 'Lining (inside)']],
};
const COLORS = ['#e8524a', '#3d8bd9', '#4cae5b', '#f2b134', '#9a5fd0', '#2bb5b8', '#ef7fb0', '#a39a2e', '#e07b39', '#5b6bd6',
  '#b8475f', '#3b9e8a', '#c8a14a', '#8a6a4c', '#2b2f3a', '#f7f7f2', '#6b6f7a', '#d46ab0', '#7cc36a', '#4aa3df'];
const SPECIAL_COLORS = { zip: '#2b2f3a', cords: '#f7f7f2', lining: '#6b6f7a' };
const UNSET_OUT = new THREE.Color('#d5d7dd'), UNSET_IN = new THREE.Color('#8e919b');
const mirrorId = (id) => (/L$/.test(id) ? id.slice(0, -1) + 'R' : /R$/.test(id) ? id.slice(0, -1) + 'L' : id);
const HINTS = {
  seam: '<b>Click</b> on the garment to place seam points; the cut runs between them over the surface. <b>Click the first point</b> to close a loop, <b>double-click</b> or <b>Enter</b> to finish, <b>Backspace</b> takes the last point back. Click on a seam to start from it. Drag to turn the model.',
  fill: 'Choose a piece on the left, then <b>click inside</b> the area it covers: it fills up to the seams. If the colour runs over into the next piece, a seam is not closed there yet.',
  brush: '<b>Drag</b> to paint the chosen piece. Right-drag turns the model, <b>Alt</b>-drag erases. The brush follows the model\'s triangles, so its edge is rough: for a clean edge (the zip, a drawcord) draw a seam round it and fill.',
  erase: '<b>Click a seam</b> to delete it, <b>click a filled piece</b> to clear it. To wipe brush paint, use the Brush with <b>Alt</b> held (or Alt-drag here).',
};

// ---------------------------------------------------------------------------------------------------------------
// state
const S = { modelId: null, model: null, pieces: [], active: null, tool: 'seam', mirror: true, brushR: 0.014, showAuto: false,
  seams: [], fills: [], strokes: [], drawing: null };
let M = null;            // mesh data
let LAB = null, BASE = null, BARRIER = null; // labels per face (piece index, −1 none), labels before brush, seam faces
let AUTO = null;         // Claude's automatic cut for comparison: piece id per face
const hist = { past: [], future: [] };

// ---------------------------------------------------------------------------------------------------------------
// three.js
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.6));
const head = new THREE.DirectionalLight(0xffffff, 1.4); camera.add(head); head.position.set(0.3, 0.5, 1); scene.add(camera);
const surfMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
let surf = null;
const seamMat = new LineMaterial({ color: 0xff2d87, linewidth: 3, worldUnits: false, depthTest: true });
const prevMat = new LineMaterial({ color: 0xff2d87, linewidth: 2, worldUnits: false, depthTest: true, transparent: true, opacity: 0.55 });
const seamLines = new LineSegments2(new LineSegmentsGeometry(), seamMat); seamLines.frustumCulled = false; scene.add(seamLines);
const prevLines = new LineSegments2(new LineSegmentsGeometry(), prevMat); prevLines.frustumCulled = false; scene.add(prevLines);
const dotGeo = new THREE.SphereGeometry(1, 12, 8);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
let dots = new THREE.InstancedMesh(dotGeo, dotMat, 1); dots.count = 0; scene.add(dots);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff2d87, transparent: true, opacity: 0.85, depthTest: false }));
ring.visible = false; ring.renderOrder = 5; scene.add(ring);
let dirty = true;
const raycaster = new THREE.Raycaster();

function stageColour() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#e9eaee';
  renderer.setClearColor(new THREE.Color(c)); dirty = true;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', stageColour);
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  seamMat.resolution.set(r.width, r.height); prevMat.resolution.set(r.width, r.height); dirty = true;
}
new ResizeObserver(resize).observe(canvas.parentElement);
controls.addEventListener('change', () => (dirty = true));
(function loop() {
  requestAnimationFrame(loop);
  if (controls.update()) dirty = true;
  if (dirty) { renderer.render(scene, camera); dirty = false; }
})();

// ---------------------------------------------------------------------------------------------------------------
// the mesh: triangles, which side (outside / lining), neighbours, a grid for finding the nearest triangle
function buildMesh(root, unitHint) {
  root.updateMatrixWorld(true);
  const pos = [], side = [], v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, P = g.attributes.position, I = g.index, n = I ? I.count : P.count;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const inside = /inside|lining/i.test(mats[gr.materialIndex]?.name || mats[0]?.name || '') ? 1 : 0;
      const end = Math.min(gr.start + gr.count, n);
      for (let k = gr.start; k + 3 <= end; k += 3) {
        for (let j = 0; j < 3; j++) { v.fromBufferAttribute(P, I ? I.getX(k + j) : k + j).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); }
        side.push(inside);
      }
    }
  });
  const F = side.length;
  if (!F) throw new Error('No triangles in this file');
  const Pf = new Float32Array(pos);
  // units: the converter works in metres
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < Pf.length; i += 3) { lo = Math.min(lo, Pf[i]); hi = Math.max(hi, Pf[i]); }
  const h = hi - lo, unit = unitHint || (h > 300 ? 0.001 : h > 30 ? 0.01 : 1);
  if (unit !== 1) for (let i = 0; i < Pf.length; i++) Pf[i] *= unit;
  // weld corners at the same place (neighbours, smooth normals)
  const vid = new Int32Array(F * 3), vmap = new Map(); let nV = 0;
  for (let c = 0; c < F * 3; c++) {
    const k = Math.round(Pf[c * 3] * 2e4) + ',' + Math.round(Pf[c * 3 + 1] * 2e4) + ',' + Math.round(Pf[c * 3 + 2] * 2e4);
    let id = vmap.get(k); if (id === undefined) { id = nV++; vmap.set(k, id); } vid[c] = id;
  }
  const C = new Float32Array(F * 3), N = new Float32Array(F * 3), A = new Float32Array(F), VN = new Float32Array(nV * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c3 = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let f = 0; f < F; f++) {
    a.fromArray(Pf, f * 9); b.fromArray(Pf, f * 9 + 3); c3.fromArray(Pf, f * 9 + 6);
    e1.subVectors(b, a); e2.subVectors(c3, a); e1.cross(e2);
    const ar = e1.length(); A[f] = ar / 2;
    for (let j = 0; j < 3; j++) { C[f * 3 + j] = (a.getComponent(j) + b.getComponent(j) + c3.getComponent(j)) / 3; N[f * 3 + j] = ar ? e1.getComponent(j) / ar : 0; }
    for (let j = 0; j < 3; j++) { const vi = vid[f * 3 + j]; VN[vi * 3] += e1.x; VN[vi * 3 + 1] += e1.y; VN[vi * 3 + 2] += e1.z; }
  }
  // neighbours across each edge
  const nb = new Int32Array(F * 3).fill(-1), em = new Map();
  for (let f = 0; f < F; f++) for (let j = 0; j < 3; j++) {
    const p = vid[f * 3 + j], q = vid[f * 3 + (j + 1) % 3], k = p < q ? p * nV + q : q * nV + p;
    const o = em.get(k);
    if (o === undefined) em.set(k, f * 3 + j);
    else if (o >= 0) { nb[f * 3 + j] = (o / 3) | 0; nb[o] = f; em.set(k, -1); }
  }
  // grid of triangle centres (2 cm cells)
  const cell = 0.02, grid = new Map();
  const gk = (x, y, z) => ((Math.floor(x / cell) + 2000) * 4000 + (Math.floor(y / cell) + 2000)) * 4000 + (Math.floor(z / cell) + 2000);
  for (let f = 0; f < F; f++) { const k = gk(C[f * 3], C[f * 3 + 1], C[f * 3 + 2]); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(f); }
  const box = new THREE.Box3().setFromArray(Pf);
  return { F, P: Pf, C, N, A, side: new Uint8Array(side), vid, VN, nb, grid, cell, gk, box, unit, totalOut: side.reduce((s, x, f) => s + (x ? 0 : A[f]), 0) };
}

function makeSurface() {
  const { F, P, vid, VN } = M;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  const nrm = new Float32Array(F * 9);
  for (let c = 0; c < F * 3; c++) {
    const vi = vid[c]; const x = VN[vi * 3], y = VN[vi * 3 + 1], z = VN[vi * 3 + 2], l = Math.hypot(x, y, z) || 1;
    nrm[c * 3] = x / l; nrm[c * 3 + 1] = y / l; nrm[c * 3 + 2] = z / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(F * 9), 3));
  g.computeBoundingSphere(); g.computeBoundingBox();
  if (surf) { scene.remove(surf); surf.geometry.dispose(); }
  surf = new THREE.Mesh(g, surfMat); scene.add(surf);
}

// nearest triangle to a point (optionally facing a direction / on one side)
function nearestFace(p, n, wantSide) {
  const { C, N, side, grid, cell, gk } = M;
  let best = -1, bd = Infinity;
  for (let R = 1; R <= 4 && best < 0; R++) {
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      const l = grid.get(gk(p.x + dx * cell, p.y + dy * cell, p.z + dz * cell)); if (!l) continue;
      for (const f of l) {
        if (wantSide !== undefined && side[f] !== wantSide) continue;
        if (n && N[f * 3] * n.x + N[f * 3 + 1] * n.y + N[f * 3 + 2] * n.z < 0.2) continue;
        const d = (C[f * 3] - p.x) ** 2 + (C[f * 3 + 1] - p.y) ** 2 + (C[f * 3 + 2] - p.z) ** 2;
        if (d < bd) { bd = d; best = f; }
      }
    }
  }
  return best;
}
const fN = (f) => new THREE.Vector3(M.N[f * 3], M.N[f * 3 + 1], M.N[f * 3 + 2]);
const fC = (f) => new THREE.Vector3(M.C[f * 3], M.C[f * 3 + 1], M.C[f * 3 + 2]);
function facesNear(p, r) {
  const { C, grid, cell, gk } = M, out = [], R = Math.ceil(r / cell);
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
    const l = grid.get(gk(p.x + dx * cell, p.y + dy * cell, p.z + dz * cell)); if (!l) continue;
    for (const f of l) if ((C[f * 3] - p.x) ** 2 + (C[f * 3 + 1] - p.y) ** 2 + (C[f * 3 + 2] - p.z) ** 2 <= r * r) out.push(f);
  }
  return out;
}
// a point on the surface: {p, n, f} — the triangle closest to the point itself (on long thin triangles the nearest
// triangle centre can belong to another triangle)
const triTmp = new THREE.Triangle(), cpTmp = new THREE.Vector3();
function surfPoint(p, n) {
  const { P, N, grid, cell, gk } = M;
  let best = -1, bd = Infinity; const q = new THREE.Vector3();
  for (const R of [2, 4]) {
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      const l = grid.get(gk(p.x + dx * cell, p.y + dy * cell, p.z + dz * cell)); if (!l) continue;
      for (const f of l) {
        if (n && N[f * 3] * n.x + N[f * 3 + 1] * n.y + N[f * 3 + 2] * n.z < 0.2) continue;
        triTmp.a.fromArray(P, f * 9); triTmp.b.fromArray(P, f * 9 + 3); triTmp.c.fromArray(P, f * 9 + 6);
        triTmp.closestPointToPoint(p, cpTmp); const d = cpTmp.distanceToSquared(p);
        if (d < bd) { bd = d; best = f; q.copy(cpTmp); }
      }
    }
    if (best >= 0) break;
  }
  if (best < 0) return null;
  return { p: q, n: fN(best), f: best };
}
const mirrorPoint = (q) => surfPoint(new THREE.Vector3(-q.p.x, q.p.y, q.p.z), new THREE.Vector3(-q.n.x, q.n.y, q.n.z));

// ---------------------------------------------------------------------------------------------------------------
// a seam between two surface points (see the top of this file)
const segCache = new Map();
function segPath(a, b) {
  const key = [a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z].map((x) => x.toFixed(5)).join(',');
  const hit = segCache.get(key); if (hit) return hit;
  const { C, N, P, nb } = M;
  const d = b.p.clone().sub(a.p), L = d.length();
  const res = { faces: [a.f, b.f], lines: [], cuts: [] };
  if (L < 1e-4) { segCache.set(key, res); return res; }
  const dir = d.clone().divideScalar(L);
  const navg = a.n.clone().add(b.n); if (navg.length() < 0.2) navg.copy(a.n); navg.normalize();
  const pn = dir.clone().cross(navg); if (pn.length() < 1e-3) pn.copy(dir).cross(Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  pn.normalize();
  const r = Math.max(0.02, 0.35 * L);
  const w = new THREE.Vector3();
  const near = (x, y, z) => {
    w.set(x - a.p.x, y - a.p.y, z - a.p.z);
    const t = Math.min(L, Math.max(0, w.dot(dir)));
    const dx = w.x - dir.x * t, dy = w.y - dir.y * t, dz = w.z - dir.z * t;
    return dx * dx + dy * dy + dz * dz <= r * r;
  };
  // its centre or a corner within reach (a long thin triangle crossing the seam has its centre far off)
  const inCap = (f) => N[f * 3] * navg.x + N[f * 3 + 1] * navg.y + N[f * 3 + 2] * navg.z > -0.2 &&
    (near(C[f * 3], C[f * 3 + 1], C[f * 3 + 2]) || near(P[f * 9], P[f * 9 + 1], P[f * 9 + 2]) || near(P[f * 9 + 3], P[f * 9 + 4], P[f * 9 + 5]) || near(P[f * 9 + 6], P[f * 9 + 7], P[f * 9 + 8]));
  const seen = new Set([a.f, b.f]), st = [a.f, b.f];
  while (st.length) {
    const f = st.pop();
    for (let j = 0; j < 3; j++) { const g = nb[f * 3 + j]; if (g >= 0 && !seen.has(g) && inCap(g)) { seen.add(g); st.push(g); } }
  }
  const sd = [0, 0, 0], V = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], q = [];
  for (const f of seen) {
    for (let j = 0; j < 3; j++) { V[j].fromArray(P, f * 9 + j * 3); sd[j] = V[j].clone().sub(a.p).dot(pn); }
    const mn = Math.min(...sd), mx = Math.max(...sd);
    if (mn > 1e-7 || mx < -1e-7) continue;
    q.length = 0;
    for (let j = 0; j < 3; j++) {
      const k = (j + 1) % 3;
      if (Math.abs(sd[j]) <= 1e-7) q.push(V[j].clone());
      else if ((sd[j] > 0) !== (sd[k] > 0) && Math.abs(sd[k]) > 1e-7) q.push(V[j].clone().lerp(V[k], sd[j] / (sd[j] - sd[k])));
    }
    if (q.length < 2) { if (f === a.f || f === b.f) continue; res.faces.push(f); continue; }
    let q1 = q[0], q2 = q[1];
    let t1 = q1.clone().sub(a.p).dot(dir), t2 = q2.clone().sub(a.p).dot(dir);
    if ((t1 < 0 && t2 < 0) || (t1 > L && t2 > L)) continue;
    const clip = (qa, ta, qb, tb, t) => qa.clone().lerp(qb, (t - ta) / (tb - ta));
    const crosses = t1 >= 0 && t1 <= L && t2 >= 0 && t2 <= L;   // the seam runs right across this triangle
    if (t1 < 0) { q1 = clip(q1, t1, q2, t2, 0); t1 = 0; } else if (t1 > L) { q1 = clip(q1, t1, q2, t2, L); t1 = L; }
    if (t2 < 0) { q2 = clip(q2, t2, q1, t1, 0); t2 = 0; } else if (t2 > L) { q2 = clip(q2, t2, q1, t1, L); t2 = L; }
    if (f !== a.f && f !== b.f) res.faces.push(f);
    if (crosses) res.cuts.push(f);
    const off = fN(f).multiplyScalar(0.0009);
    res.lines.push(q1.x + off.x, q1.y + off.y, q1.z + off.z, q2.x + off.x, q2.y + off.y, q2.z + off.z);
  }
  res.plane = [pn.x, pn.y, pn.z, pn.dot(a.p)]; res.dir = dir;
  segCache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
// triangles a seam runs through: split along the seam(s) for display, each part in the colour of its side
const overlayMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
let overlay = null;
function splitPoly(poly, pl, keepPos) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = p.x * pl[0] + p.y * pl[1] + p.z * pl[2] - pl[3], dq = q.x * pl[0] + q.y * pl[1] + q.z * pl[2] - pl[3];
    const inP = keepPos ? dp >= 0 : dp <= 0, inQ = keepPos ? dq >= 0 : dq <= 0;
    if (inP) out.push(p);
    if (inP !== inQ) out.push(p.clone().lerp(q, dp / (dp - dq)));
  }
  return out.length >= 3 ? out : null;
}
function buildOverlay(cutsByFace, lab, joints = JOINTS) {
  if (overlay) { scene.remove(overlay); overlay.geometry.dispose(); overlay = null; }
  if (S.showAuto || (!cutsByFace.size && !joints.size)) { dirty = true; return; }
  const { P, nb, side, vid, VN } = M;
  // 1. split each triangle a seam runs through; note which of its edges each part touches
  const parts = [];        // {f, pg, edges: [j...], L}
  const byEdge = new Map(); // f*3+j → parts touching that edge
  const V = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const groups = [];
  const todo = new Map(cutsByFace); for (const f of joints.keys()) if (!todo.has(f)) todo.set(f, []);
  for (const [f, planes0] of todo) {
    for (let k = 0; k < 3; k++) V[k].fromArray(P, f * 9 + k * 3);
    const jt = joints.get(f);
    const planes = jt ? [jt.A, jt.B] : planes0;
    let polys = [[V[0].clone(), V[1].clone(), V[2].clone()]];
    for (const pl of planes) { const nx = []; for (const pg of polys) { const a = splitPoly(pg, pl, true), b = splitPoly(pg, pl, false); if (a) nx.push(a); if (b) nx.push(b); } polys = nx; }
    // a corner of a seam: the wedge between its two segments is one side, the other three quarters the other
    let gW = null, gR = null;
    if (jt) { gW = []; gR = []; groups.push(gW, gR); }
    for (const pg of polys) {
      const part = { f, pg, edges: [], ranges: {}, L: null };   // L: piece index, −1 = no piece yet, null = not known
      if (jt) {
        const c = pg.reduce((s_, v) => s_.add(v), new THREE.Vector3()).divideScalar(pg.length);
        const sa = c.x * jt.A[0] + c.y * jt.A[1] + c.z * jt.A[2] - jt.A[3] >= 0, sb = c.x * jt.B[0] + c.y * jt.B[1] + c.z * jt.B[2] - jt.B[3] >= 0;
        (sa === jt.sA && sb === jt.sB ? gW : gR).push(part); part.group = sa === jt.sA && sb === jt.sB ? gW : gR;
      }
      for (let j = 0; j < 3; j++) {
        // along the edge from its lower-numbered corner to the other, so both triangles on it measure alike
        const flip = vid[f * 3 + j] > vid[f * 3 + (j + 1) % 3];
        const e0 = flip ? V[(j + 1) % 3] : V[j], e1 = flip ? V[j] : V[(j + 1) % 3], ed = e1.clone().sub(e0), len2 = ed.lengthSq() || 1;
        const ts = [];
        for (const v of pg) { const t = v.clone().sub(e0).dot(ed) / len2; if (t > -1e-6 && t < 1 + 1e-6 && v.distanceToSquared(e0.clone().addScaledVector(ed, t)) < 1e-12) ts.push(t); }
        if (ts.length >= 2 && Math.max(...ts) - Math.min(...ts) > 1e-6) {
          part.edges.push(j); part.ranges[j] = [Math.min(...ts), Math.max(...ts)];
          let l = byEdge.get(f * 3 + j); if (!l) byEdge.set(f * 3 + j, (l = [])); l.push(part);
        }
      }
      parts.push(part);
    }
  }
  // 2. a part takes the piece of the face across an edge it touches (as a fill would reach it); across an edge to
  //    another split triangle, the part of it on that edge
  const isSplit = (g) => cutsByFace.has(g) || joints.has(g);
  for (const part of parts) for (const j of part.edges) {
    const g = nb[part.f * 3 + j];
    if (g >= 0 && !isSplit(g) && side[g] === side[part.f]) { part.L = lab[g]; break; }
  }
  const unify = () => { for (const gp of groups) { const l = gp.find((q) => q.L !== null)?.L; if (l !== undefined) for (const q of gp) if (q.L === null) q.L = l; } };
  unify();
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const part of parts) {
      if (part.L !== null) continue;
      for (const j of part.edges) {
        const g = nb[part.f * 3 + j]; if (g < 0 || !isSplit(g)) continue;
        let k = 0; while (k < 3 && nb[g * 3 + k] !== part.f) k++;
        // the neighbour's part along the same stretch of the shared edge
        const [a0, a1] = part.ranges[j];
        let best = null, bo = 1e-6;
        for (const q of byEdge.get(g * 3 + k) || []) {
          if (q.L === null) continue;
          const [b0, b1] = q.ranges[k], ov = Math.min(a1, b1) - Math.max(a0, b0);
          if (ov > bo) { bo = ov; best = q; }
        }
        if (best) { part.L = best.L; changed = true; break; }
      }
    }
    unify();
    if (!changed) break;
  }
  // what nothing reached: the nearest labelled face on the same side of this triangle's seam planes
  for (const part of parts) {
    if (part.L !== null) continue;
    const planes = joints.get(part.f) ? [joints.get(part.f).A, joints.get(part.f).B] : cutsByFace.get(part.f) || [];
    const c = part.pg.reduce((s_, v) => s_.add(v), new THREE.Vector3()).divideScalar(part.pg.length);
    const sideOf = (pl, x, y, z) => x * pl[0] + y * pl[1] + z * pl[2] - pl[3] >= 0;
    let best = -1, bd = Infinity;
    for (const h of facesNear(c, 0.05)) {
      if (isSplit(h) || side[h] !== side[part.f]) continue;
      const hx = M.C[h * 3], hy = M.C[h * 3 + 1], hz = M.C[h * 3 + 2];
      if (!planes.every((pl) => sideOf(pl, hx, hy, hz) === sideOf(pl, c.x, c.y, c.z))) continue;
      const d = (hx - c.x) ** 2 + (hy - c.y) ** 2 + (hz - c.z) ** 2; if (d < bd) { bd = d; best = h; }
    }
    part.L = best >= 0 ? lab[best] : lab[part.f];
  }
  // 3. geometry, with smooth normals (the triangle's corner normals, weighted by where each point lies)
  const pos = [], nrm = [], col = [];
  for (const part of parts) {
    const f = part.f;
    const A = new THREE.Vector3().fromArray(P, f * 9), B = new THREE.Vector3().fromArray(P, f * 9 + 3), Cc = new THREE.Vector3().fromArray(P, f * 9 + 6);
    const e1 = B.clone().sub(A), e2 = Cc.clone().sub(A), n0 = e1.clone().cross(e2), area2 = n0.lengthSq() || 1;
    const vn = (k) => new THREE.Vector3(VN[vid[f * 3 + k] * 3], VN[vid[f * 3 + k] * 3 + 1], VN[vid[f * 3 + k] * 3 + 2]).normalize();
    const N0 = vn(0), N1 = vn(1), N2 = vn(2);
    const L = part.L;
    const cc = L >= 0 ? colOf(S.pieces[L].color) : side[f] ? UNSET_IN : UNSET_OUT;
    const pg = part.pg;
    for (let i = 1; i + 1 < pg.length; i++) for (const v of [pg[0], pg[i], pg[i + 1]]) {
      pos.push(v.x, v.y, v.z);
      const w = v.clone().sub(A), c1 = w.clone().cross(e2).dot(n0) / area2, c2 = e1.clone().cross(w).dot(n0) / area2, c0 = 1 - c1 - c2;
      const nn = N0.clone().multiplyScalar(c0).addScaledVector(N1, c1).addScaledVector(N2, c2).normalize();
      nrm.push(nn.x, nn.y, nn.z); col.push(cc.r, cc.g, cc.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  overlay = new THREE.Mesh(g, overlayMat); overlay.renderOrder = 1; scene.add(overlay); dirty = true;
}

// ---------------------------------------------------------------------------------------------------------------
// pieces: fill each one up to the seams, then the brush on top
const pieceIndex = (id) => S.pieces.findIndex((p) => p.id === id);
function regionOf(f0, barrier) {
  const { nb, side } = M, s = side[f0], out = [f0], seen = new Uint8Array(M.F); seen[f0] = 1;
  for (let i = 0; i < out.length; i++) {
    const f = out[i];
    for (let j = 0; j < 3; j++) { const g = nb[f * 3 + j]; if (g >= 0 && !seen[g] && !barrier[g] && side[g] === s) { seen[g] = 1; out.push(g); } }
  }
  return out;
}
function seamSegments(s) {
  const out = [];
  for (let i = 0; i + 1 < s.pts.length; i++) out.push([s.pts[i], s.pts[i + 1]]);
  if (s.closed && s.pts.length > 2) out.push([s.pts[s.pts.length - 1], s.pts[0]]);
  return out;
}
function compute() {
  if (!M) return;
  const { F, nb } = M;
  BARRIER = new Uint8Array(F);
  const lines = [], cutsByFace = new Map(), joints = new Map();
  for (const s of S.seams) {
    const segs = seamSegments(s);
    for (let i = 0; i < segs.length; i++) {
      const nx = segs[i + 1] || (s.closed ? segs[0] : null); if (!nx || nx === segs[i]) continue;
      const A = segPath(...segs[i]), B = segPath(...nx); if (!A.plane || !B.plane) continue;
      const q = segs[i][1], p = q.p;
      const sd = (pl, v) => v.x * pl[0] + v.y * pl[1] + v.z * pl[2] - pl[3] >= 0;
      joints.set(q.f, { A: A.plane, B: B.plane, sA: sd(A.plane, p.clone().addScaledVector(B.dir, 1e-3)), sB: sd(B.plane, p.clone().addScaledVector(A.dir, -1e-3)) });
    }
  }
  for (const s of S.seams) for (const [a, b] of seamSegments(s)) {
    const r = segPath(a, b); for (const f of r.faces) BARRIER[f] = 1; for (const x of r.lines) lines.push(x);
    if (r.plane) for (const f of r.cuts) { let l = cutsByFace.get(f); if (!l) cutsByFace.set(f, (l = [])); l.push(r.plane); }
  }
  const lab = new Int16Array(F).fill(-1);
  for (const fl of S.fills) {
    const pi = pieceIndex(fl.piece); if (pi < 0) continue;
    let f0 = fl.f;
    if (BARRIER[f0]) { for (let j = 0; j < 3; j++) { const g = nb[f0 * 3 + j]; if (g >= 0 && !BARRIER[g] && M.side[g] === M.side[f0]) { f0 = g; break; } } }
    if (BARRIER[f0]) continue;
    for (const f of regionOf(f0, BARRIER)) lab[f] = pi;
  }
  // faces on a seam: the converter cuts them exactly. Here a face the seam runs right across is drawn split (overlay);
  // the others (the seam only touches them) take the piece of a neighbour the seam does not touch, else of a face
  // that got one that way (never of a split face: that one has both pieces)
  const split = new Uint8Array(F); for (const f of cutsByFace.keys()) split[f] = 1; for (const f of joints.keys()) split[f] = 1;
  // (a face the seam only touches lies wholly on one side: a neighbour the seam does not touch is on that side too, so
  // its piece is right even when it has none yet)
  const decided = new Uint8Array(F);
  for (let f = 0; f < F; f++) {
    if (!BARRIER[f] || lab[f] >= 0 || split[f]) continue;
    for (let j = 0; j < 3; j++) { const g = nb[f * 3 + j]; if (g >= 0 && !BARRIER[g] && M.side[g] === M.side[f]) { lab[f] = lab[g]; decided[f] = 1; break; } }
  }
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let f = 0; f < F; f++) {
      if (!BARRIER[f] || lab[f] >= 0 || decided[f]) continue;
      for (let j = 0; j < 3; j++) {
        const g = nb[f * 3 + j];
        if (g >= 0 && lab[g] >= 0 && M.side[g] === M.side[f] && !split[g]) { lab[f] = lab[g]; changed = true; break; }
      }
    }
    if (!changed) break;
  }
  BASE = lab.slice();
  for (const st of S.strokes) applyStroke(st, lab);
  LAB = lab; CUTS = cutsByFace; JOINTS = joints;
  const g = new LineSegmentsGeometry(); if (lines.length) g.setPositions(lines); seamLines.geometry.dispose(); seamLines.geometry = g; seamLines.visible = lines.length > 0;
  paint(); drawDots(); updatePieces(); updateStatus();
}
let CUTS = new Map(), JOINTS = new Map();
function applyStroke(st, lab) {
  const pi = st.piece ? pieceIndex(st.piece) : -2;
  if (pi === -1) return;
  const n = new THREE.Vector3();
  for (const q of st.pts) {
    n.set(q[3], q[4], q[5]);
    for (const f of facesNear(new THREE.Vector3(q[0], q[1], q[2]), st.r)) {
      if (M.N[f * 3] * n.x + M.N[f * 3 + 1] * n.y + M.N[f * 3 + 2] * n.z < 0.2) continue;
      lab[f] = pi === -2 ? BASE[f] : pi;
    }
  }
}
const colorCache = new Map();
const colOf = (hex) => { let c = colorCache.get(hex); if (!c) colorCache.set(hex, (c = new THREE.Color(hex))); return c; };
function paint() {
  if (!surf) return;
  const col = surf.geometry.attributes.color.array, { F, side } = M;
  for (let f = 0; f < F; f++) {
    let c;
    if (S.showAuto && AUTO) { const id = AUTO[f]; c = id ? colOf(S.pieces.find((p) => p.id === id)?.color || '#999') : side[f] ? UNSET_IN : UNSET_OUT; }
    else if (LAB[f] >= 0) c = colOf(S.pieces[LAB[f]].color);
    else c = side[f] ? UNSET_IN : UNSET_OUT;
    for (let k = 0; k < 3; k++) { col[f * 9 + k * 3] = c.r; col[f * 9 + k * 3 + 1] = c.g; col[f * 9 + k * 3 + 2] = c.b; }
  }
  surf.geometry.attributes.color.needsUpdate = true; dirty = true;
  if (!pointer.painting) buildOverlay(CUTS, LAB);
}
function drawDots() {
  const pts = [];
  for (const s of S.seams) for (const q of s.pts) pts.push(q.p);
  scene.remove(dots); dots.dispose();
  dots = new THREE.InstancedMesh(dotGeo, dotMat, Math.max(1, pts.length)); dots.count = pts.length;
  const m = new THREE.Matrix4(), r = 0.0028;
  pts.forEach((p, i) => dots.setMatrixAt(i, m.makeScale(r, r, r).setPosition(p)));
  dots.instanceMatrix.needsUpdate = true; dots.renderOrder = 3; scene.add(dots); dirty = true;
}

// ---------------------------------------------------------------------------------------------------------------
// panel: pieces list, status
function updatePieces() {
  const area = new Float64Array(S.pieces.length);
  if (LAB) for (let f = 0; f < M.F; f++) if (LAB[f] >= 0) area[LAB[f]] += M.A[f];
  const el = $('#pieces');
  el.innerHTML = S.pieces.map((p, i) => `<div class="piece" role="option" data-i="${i}" aria-selected="${p.id === S.active}" title="${p.id}">
    <span class="sw" style="background:${p.color}"></span><span class="nm">${esc(p.name)}</span>
    <span class="ar">${area[i] ? Math.round(area[i] * 1e4) + ' cm²' : ''}</span>${p.custom ? '<button class="x" data-del="' + i + '" title="Remove this piece">✕</button>' : ''}</div>`).join('');
}
function updateStatus() {
  let un = 0; if (LAB) for (let f = 0; f < M.F; f++) if (!M.side[f] && LAB[f] < 0) un += M.A[f];
  const pct = M.totalOut ? Math.round((un / M.totalOut) * 100) : 0;
  $('#status').textContent = `${S.seams.length} seam${S.seams.length === 1 ? '' : 's'} · ${S.fills.length} filled · outside not given to a piece yet: ${pct}%`;
  $('#undoBtn').disabled = !hist.past.length; $('#redoBtn').disabled = !hist.future.length;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------------------------------------------------------
// history + autosave
const snap = () => JSON.stringify({ pieces: S.pieces, seams: S.seams.map(packSeam), fills: S.fills.map(packFill), strokes: S.strokes });
function commit() {
  hist.past.push(lastSnap); if (hist.past.length > 120) hist.past.shift(); hist.future.length = 0;
  lastSnap = snap(); save(); compute();
}
let lastSnap = null;
function restore(json) {
  const J = JSON.parse(json);
  S.pieces = J.pieces; S.seams = J.seams.map(unpackSeam).filter(Boolean); S.fills = J.fills.map(unpackFill).filter(Boolean); S.strokes = J.strokes || [];
  if (!S.pieces.find((p) => p.id === S.active)) S.active = S.pieces[0]?.id;
  S.drawing = null; lastSnap = json; save(); compute();
}
function undo() { if (!hist.past.length) return; finishSeam(); hist.future.push(lastSnap); restore(hist.past.pop()); }
function redo() { if (!hist.future.length) return; hist.past.push(lastSnap); restore(hist.future.pop()); }
const storeKey = () => 'dm.cutter.v1.' + S.modelId;
function save() { try { localStorage.setItem(storeKey(), lastSnap); } catch (e) { /* storage full or blocked: the cut stays in this tab */ } }
const r4 = (x) => Math.round(x * 1e4) / 1e4, r3 = (x) => Math.round(x * 1e3) / 1e3;
const packPt = (q) => [r4(q.p.x), r4(q.p.y), r4(q.p.z), r3(q.n.x), r3(q.n.y), r3(q.n.z)];
const packSeam = (s) => ({ closed: !!s.closed, pts: s.pts.map(packPt) });
const packFill = (fl) => ({ piece: fl.piece, p: packPt(fl), inside: !!M.side[fl.f] });
function unpackPt(a) { const q = surfPoint(new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(a[3], a[4], a[5])); if (q) q.p.set(a[0], a[1], a[2]); return q; }
function unpackSeam(s) { const pts = s.pts.map(unpackPt).filter(Boolean); return pts.length ? { closed: s.closed, pts } : null; }
function unpackFill(fl) {
  const p = new THREE.Vector3(fl.p[0], fl.p[1], fl.p[2]), n = new THREE.Vector3(fl.p[3], fl.p[4], fl.p[5]);
  const f = nearestFace(p, n, fl.inside ? 1 : 0) >= 0 ? nearestFace(p, n, fl.inside ? 1 : 0) : nearestFace(p, n);
  return f >= 0 ? { piece: fl.piece, p, n, f } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// export: the converter works in Blender's axes (x right, y back, z up), metres
const toB = (a) => [a[0], -a[2], a[1], a[3], -a[5], a[4]];
const fromB = (a) => [a[0], a[2], -a[1], a[3], a[5], -a[4]];
function exportCut() {
  const blender = S.model?.space === 'blender';
  const conv = (a) => (blender ? toB(a) : a);
  const b = M.box;
  return {
    format: 'design-master-cut', version: 1, model: S.modelId, file: S.fileName || null,
    space: blender ? 'blender' : 'y-up', units: 'm', unitScale: M.unit, faces: M.F,
    bbox: blender ? [toB([b.min.x, b.min.y, b.max.z, 0, 0, 0]).slice(0, 3), toB([b.max.x, b.max.y, b.min.z, 0, 0, 0]).slice(0, 3)].map((v) => v.map(r4)) : [b.min.toArray().map(r4), b.max.toArray().map(r4)],
    pieces: S.pieces.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    seams: S.seams.map((s) => ({ closed: !!s.closed, pts: s.pts.map((q) => conv(packPt(q))) })),
    fills: S.fills.map((fl) => ({ piece: fl.piece, p: conv(packPt(fl)), inside: !!M.side[fl.f] })),
    strokes: S.strokes.map((st) => ({ piece: st.piece, r: st.r, pts: st.pts.map((q) => conv(q)) })),
  };
}
function importCut(J) {
  if (J.format !== 'design-master-cut') throw new Error('This is not a cut from the pattern cutter');
  if (J.model && S.modelId && J.model !== S.modelId) throw new Error(`This cut is for "${J.model}", not for the model that is open`);
  const conv = (a) => (J.space === 'blender' ? fromB(a) : a);
  const pieces = J.pieces.map((p, i) => ({ id: p.id, name: p.name, color: p.color || COLORS[i % COLORS.length], custom: !S.pieces.some((q) => q.id === p.id) }));
  const json = JSON.stringify({ pieces, seams: J.seams.map((s) => ({ closed: s.closed, pts: s.pts.map(conv) })),
    fills: J.fills.map((fl) => ({ piece: fl.piece, p: conv(fl.p), inside: fl.inside })), strokes: (J.strokes || []).map((st) => ({ piece: st.piece, r: st.r, pts: st.pts.map(conv) })) });
  hist.past.push(lastSnap); hist.future.length = 0; restore(json);
}

// ---------------------------------------------------------------------------------------------------------------
// input
const pointer = { down: null, moved: false, button: 0, painting: null };
function pick(ev) {
  if (!surf) return null;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const h = raycaster.intersectObject(surf, false)[0];
  if (!h) return null;
  return { p: h.point.clone(), n: fN(h.faceIndex), f: h.faceIndex };
}
function screenOf(p) { const v = p.clone().project(camera), r = canvas.getBoundingClientRect(); return [((v.x + 1) / 2) * r.width + r.left, ((1 - v.y) / 2) * r.height + r.top, v.z]; }
// an existing seam point or a point on a seam line near the pointer (to join seams cleanly)
function snapPoint(ev, q) {
  let best = null, bd = 10 * 10;
  const cam = camera.position;
  const visible = (p) => { if (!q) return true; return p.distanceTo(cam) <= q.p.distanceTo(cam) + 0.03; };
  for (const s of S.seams) for (const t of s.pts) {
    const [x, y] = screenOf(t.p), d = (x - ev.clientX) ** 2 + (y - ev.clientY) ** 2;
    if (d < bd && visible(t.p)) { bd = d; best = { p: t.p.clone(), n: t.n.clone(), f: t.f, seamPoint: t }; }
  }
  if (best) return best;
  bd = 8 * 8;
  for (const s of S.seams) for (const [a, b] of seamSegments(s)) {
    const L = segPath(a, b).lines;
    for (let i = 0; i < L.length; i += 3) {
      const p = new THREE.Vector3(L[i], L[i + 1], L[i + 2]);
      const [x, y] = screenOf(p), d = (x - ev.clientX) ** 2 + (y - ev.clientY) ** 2;
      if (d < bd && visible(p)) { bd = d; best = p; }
    }
  }
  if (best && best.isVector3) { const sp = surfPoint(best, q?.n); if (sp) { sp.p.copy(best); return sp; } }
  return null;
}
function seamNear(ev) {
  let best = -1, bd = 9 * 9;
  S.seams.forEach((s, i) => {
    for (const q of s.pts) { const [x, y] = screenOf(q.p), d = (x - ev.clientX) ** 2 + (y - ev.clientY) ** 2; if (d < bd) { bd = d; best = i; } }
    for (const [a, b] of seamSegments(s)) {
      const L = segPath(a, b).lines;
      for (let k = 0; k < L.length; k += 6) { const [x, y] = screenOf(new THREE.Vector3(L[k], L[k + 1], L[k + 2])), d = (x - ev.clientX) ** 2 + (y - ev.clientY) ** 2; if (d < bd) { bd = d; best = i; } }
    }
  });
  return best;
}

function addSeamPoint(q, ev) {
  if (!S.drawing) {
    const s = { closed: false, pts: [q] };
    S.seams.push(s);
    let twin = null;
    if (S.mirror && Math.abs(q.p.x) > 0.008) { const m = mirrorPoint(q); if (m) { twin = { closed: false, pts: [m] }; S.seams.push(twin); } }
    S.drawing = { s, twin };
    compute(); return;
  }
  const { s, twin } = S.drawing;
  // back on the first point: close the loop
  if (s.pts.length > 2 && ev) { const [x, y] = screenOf(s.pts[0].p); if ((x - ev.clientX) ** 2 + (y - ev.clientY) ** 2 < 100) { s.closed = true; if (twin) twin.closed = true; finishSeam(); return; } }
  s.pts.push(q);
  if (twin) { const m = mirrorPoint(q); if (m) twin.pts.push(m); }
  compute();
}
function finishSeam() {
  if (!S.drawing) return;
  const { s, twin } = S.drawing; S.drawing = null;
  // a seam on the centre line has no twin
  if (twin && s.pts.every((q) => Math.abs(q.p.x) < 0.012)) S.seams.splice(S.seams.indexOf(twin), 1);
  if (s.pts.length < 2) { S.seams.splice(S.seams.indexOf(s), 1); if (twin && S.seams.includes(twin)) S.seams.splice(S.seams.indexOf(twin), 1); }
  prevLines.visible = false;
  commit();
}
function fillAt(q) {
  const piece = S.active; if (!piece) return toast('Choose a piece first');
  S.fills.push({ piece, p: q.p, n: q.n, f: q.f });
  if (S.mirror) {
    const m = mirrorPoint(q);
    if (m) {
      const mf = nearestFace(m.p, m.n, M.side[q.f]); const mp = mirrorId(piece);
      const sameRegion = !BARRIER[q.f] && regionOf(q.f, BARRIER).includes(mf);
      // (not when the other side is still the same open area: that would paint over this fill)
      if (mf >= 0 && !sameRegion && pieceIndex(mp) >= 0) S.fills.push({ piece: mp, p: m.p, n: m.n, f: mf });
    }
  }
  commit();
}
function eraseAt(ev, q) {
  const si = seamNear(ev);
  if (si >= 0) { S.seams.splice(si, 1); commit(); return toast('Seam deleted'); }
  if (!q) return;
  const clear = (f) => { const reg = new Set(BARRIER[f] ? [f] : regionOf(f, BARRIER)); const n0 = S.fills.length; S.fills = S.fills.filter((fl) => !reg.has(fl.f)); return n0 - S.fills.length; };
  let n = clear(q.f);
  if (S.mirror) { const m = mirrorPoint(q); if (m) n += clear(m.f); }
  if (n) { commit(); toast('Piece cleared'); }
}
function strokeStart(q, erase) {
  const st = { piece: erase ? null : S.active, r: S.brushR, pts: [] }; S.strokes.push(st);
  let twin = null;
  if (S.mirror) { twin = { piece: erase ? null : mirrorId(S.active), r: S.brushR, pts: [] }; if (twin.piece && pieceIndex(twin.piece) < 0) twin = null; else S.strokes.push(twin); }
  pointer.painting = { st, twin, last: null };
  strokeAdd(q);
}
function strokeAdd(q) {
  const pt = pointer.painting; if (!pt) return;
  if (pt.last && pt.last.distanceTo(q.p) < pt.st.r * 0.4) return;
  pt.last = q.p.clone();
  const a = packPt(q); pt.st.pts.push(a); applyStroke({ ...pt.st, pts: [a] }, LAB);
  if (pt.twin) { const m = mirrorPoint(q); if (m) { const b = packPt(m); pt.twin.pts.push(b); applyStroke({ ...pt.twin, pts: [b] }, LAB); } }
  paint();
}
function strokeEnd() {
  const pt = pointer.painting; if (!pt) return;
  pointer.painting = null;
  S.strokes = S.strokes.filter((s) => s.pts.length);
  commit();
}

let hoverRaf = 0, lastMove = null;
canvas.addEventListener('pointerdown', (ev) => {
  pointer.down = [ev.clientX, ev.clientY]; pointer.moved = false; pointer.button = ev.button;
  if (S.tool === 'brush' && ev.button === 0) {
    const q = pick(ev);
    if (q) { strokeStart(q, ev.altKey); canvas.setPointerCapture(ev.pointerId); }
  }
});
canvas.addEventListener('pointermove', (ev) => {
  if (pointer.down && Math.hypot(ev.clientX - pointer.down[0], ev.clientY - pointer.down[1]) > 4) pointer.moved = true;
  if (pointer.painting) { const q = pick(ev); if (q) strokeAdd(q); return; }
  if (S.tool === 'erase' && pointer.down && pointer.moved && pointer.button === 0 && ev.altKey && !pointer.erasing) {
    const q = pick(ev); if (q) { pointer.erasing = true; controls.enabled = false; strokeStart(q, true); } return;
  }
  lastMove = ev;
  if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; hover(lastMove); });
});
canvas.addEventListener('pointerup', (ev) => {
  const wasPainting = !!pointer.painting;
  if (pointer.painting) strokeEnd();
  pointer.erasing = false; controls.enabled = true;
  const click = pointer.down && !pointer.moved && ev.button === 0;
  pointer.down = null;
  if (!click || wasPainting) return;
  const q = pick(ev);
  if (S.tool === 'seam') { const sp = snapPoint(ev, q) || q; if (sp) addSeamPoint(sp, ev); }
  else if (S.tool === 'fill') { if (q) fillAt(q); }
  else if (S.tool === 'erase') eraseAt(ev, q);
});
canvas.addEventListener('dblclick', (ev) => { if (S.tool === 'seam' && S.drawing) { ev.preventDefault(); const s = S.drawing.s; if (s.pts.length > 2) { s.pts.pop(); if (S.drawing.twin && S.drawing.twin.pts.length > s.pts.length) S.drawing.twin.pts.pop(); } finishSeam(); } });
canvas.addEventListener('pointerleave', () => { ring.visible = false; prevLines.visible = false; dirty = true; });
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
function hover(ev) {
  if (!ev || !M) return;
  const q = pick(ev);
  if (S.tool === 'brush' || (S.tool === 'erase' && q)) {
    if (q && S.tool === 'brush') { ring.visible = true; ring.position.copy(q.p).addScaledVector(q.n, 0.001); ring.lookAt(q.p.clone().add(q.n)); ring.scale.setScalar(S.brushR); }
    else ring.visible = false;
  } else ring.visible = false;
  if (S.tool === 'seam' && S.drawing && q) {
    const a = S.drawing.s.pts[S.drawing.s.pts.length - 1], b = snapPoint(ev, q) || q;
    const L = segPath(a, b).lines;
    const g = new LineSegmentsGeometry(); if (L.length) g.setPositions(L); prevLines.geometry.dispose(); prevLines.geometry = g; prevLines.visible = L.length > 0;
  } else prevLines.visible = false;
  canvas.style.cursor = S.tool === 'seam' || S.tool === 'fill' ? (q ? 'crosshair' : 'grab') : S.tool === 'brush' ? (q ? 'none' : 'grab') : 'pointer';
  dirty = true;
}

function setTool(t) {
  if (S.tool === 'seam' && t !== 'seam') finishSeam();
  S.tool = t;
  document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  $('#hint').innerHTML = HINTS[t];
  const brush = t === 'brush';
  controls.mouseButtons = { LEFT: brush ? null : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: brush ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN };
  controls.touches = { ONE: brush ? null : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  ring.visible = false; dirty = true;
}
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
window.addEventListener('keydown', (ev) => {
  if (ev.target.closest('input, textarea, dialog')) return;
  const k = ev.key.toLowerCase();
  if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if ((ev.ctrlKey || ev.metaKey) && k === 'y') { ev.preventDefault(); redo(); return; }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (k === 's') setTool('seam'); else if (k === 'f') setTool('fill'); else if (k === 'b') setTool('brush'); else if (k === 'e') setTool('erase');
  else if (k === 'enter' || k === 'escape') finishSeam();
  else if (k === 'backspace' && S.drawing) {
    ev.preventDefault(); const { s, twin } = S.drawing; s.pts.pop(); if (twin) twin.pts.pop();
    if (!s.pts.length) finishSeam(); else compute();
  } else if (k === '[' || k === ']') { setBrush(S.brushR * 1000 + (k === ']' ? 2 : -2)); }
});
function setBrush(mm) { mm = Math.max(4, Math.min(60, Math.round(mm))); S.brushR = mm / 1000; $('#brushSize').value = mm; $('#brushVal').textContent = mm + ' mm'; ring.scale.setScalar(S.brushR); dirty = true; }
$('#brushSize').addEventListener('input', (e) => setBrush(+e.target.value));
$('#mirror').addEventListener('change', (e) => { S.mirror = e.target.checked; });
$('#showAuto').addEventListener('change', (e) => { S.showAuto = e.target.checked; if (S.showAuto && !AUTO) toast('Claude\'s automatic cut is only there for the zip hoodie'); paint(); });
$('#pieces').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { const p = S.pieces[+del.dataset.del]; if (confirm(`Remove the piece "${p.name}"? What you filled with it is cleared.`)) { S.pieces.splice(+del.dataset.del, 1); S.fills = S.fills.filter((f) => f.piece !== p.id); S.strokes = S.strokes.filter((s) => s.piece !== p.id); commit(); } return; }
  const row = e.target.closest('.piece'); if (!row) return;
  S.active = S.pieces[+row.dataset.i].id; updatePieces();
  if (S.tool !== 'fill' && S.tool !== 'brush') setTool('fill');
});
$('#pieces').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.piece'); if (!row) return;
  const p = S.pieces[+row.dataset.i]; const n = prompt('Name of this piece', p.name);
  if (n && n.trim()) { p.name = n.trim(); commit(); }
});
$('#addPiece').addEventListener('click', () => {
  const n = prompt('Name of the new piece (for example "Collar" or "Yoke · left")'); if (!n || !n.trim()) return;
  let id = n.trim().replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase()) || 'piece';
  while (pieceIndex(id) >= 0) id += '2';
  const used = new Set(S.pieces.map((p) => p.color));
  S.pieces.push({ id, name: n.trim(), color: COLORS.find((c) => !used.has(c)) || COLORS[S.pieces.length % COLORS.length], custom: true });
  S.active = id; commit(); setTool('fill');
});
$('#clearBtn').addEventListener('click', () => { if (!confirm('Start over? All seams, fills and brush strokes are removed (Undo brings them back).')) return; S.seams = []; S.fills = []; S.strokes = []; S.drawing = null; commit(); });
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
function setView(v) {
  if (!M) return;
  const c = M.box.getCenter(new THREE.Vector3()), size = M.box.getSize(new THREE.Vector3()), d = Math.max(size.x, size.y, size.z) * 2.1;
  const dir = { front: [0, 0.08, 1], back: [0, 0.08, -1], left: [1, 0.08, 0], right: [-1, 0.08, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001] }[v];
  camera.position.copy(c).addScaledVector(new THREE.Vector3(...dir).normalize(), d); controls.target.copy(c); controls.update(); dirty = true;
}

// copy / save / load
function cutText() { return JSON.stringify(exportCut()); }
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }
$('#copyBtn').addEventListener('click', async () => {
  finishSeam();
  const t = cutText(); const ok = await copyText(t);
  $('#copyText').value = t;
  const kb = Math.round(t.length / 1024);
  $('#copyMsg').textContent = (ok ? 'Copied. Paste it in the chat with Claude.' : 'Select all the text below, copy it and paste it in the chat with Claude.') + (kb > 60 ? ` It is ${kb} KB: if the chat won't take that much, use Save as file and send the file.` : '');
  $('#copyDlg').showModal(); if (!ok) $('#copyText').select();
});
$('#copyAgain').addEventListener('click', async () => { const ok = await copyText($('#copyText').value); toast(ok ? 'Copied' : 'Select the text and copy it'); if (!ok) $('#copyText').select(); });
$('#copyClose').addEventListener('click', () => $('#copyDlg').close());
function download() {
  finishSeam();
  const blob = new Blob([JSON.stringify(exportCut(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${S.modelId || 'model'}-cut.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#saveBtn').addEventListener('click', download);
$('#copyDl').addEventListener('click', download);
$('#importBtn').addEventListener('click', () => { $('#loadText').value = ''; $('#loadDlg').showModal(); });
$('#loadCancel').addEventListener('click', () => $('#loadDlg').close());
$('#loadFile').addEventListener('click', () => $('#fileCut').click());
$('#fileCut').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; $('#loadText').value = await f.text(); e.target.value = ''; });
$('#loadOk').addEventListener('click', () => {
  try { const t = $('#loadText').value.trim().replace(/^```(json)?|```$/g, ''); importCut(JSON.parse(t)); $('#loadDlg').close(); toast('Cut loaded'); }
  catch (err) { toast(err.message || 'That is not a cut'); }
});

// open another model
$('#openBtn').addEventListener('click', () => $('#fileModel').click());
$('#fileModel').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try { await openFile(file); } catch (err) { console.error(err); toast('Could not open this file: ' + (err.message || err)); $('#loading').hidden = true; }
});
async function openFile(file) {
  $('#loading').hidden = false; $('#loading').textContent = 'Opening ' + file.name + '…';
  const ext = file.name.split('.').pop().toLowerCase();
  let root;
  if (ext === 'glb' || ext === 'gltf') { const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); root = (await L.parseAsync(await file.arrayBuffer(), '')).scene; }
  else if (ext === 'obj') { const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); root = new OBJLoader().parse(await file.text()); }
  else if (ext === 'fbx') { const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js'); root = new FBXLoader().parse(await file.arrayBuffer(), ''); }
  else throw new Error('use a GLB, glTF, OBJ or FBX file');
  const id = 'file:' + file.name;
  setModel(id, { name: file.name, space: 'y-up', pieces: 'generic' }, root);
  S.fileName = file.name;
}

// ---------------------------------------------------------------------------------------------------------------
function setModel(id, info, root) {
  S.modelId = id; S.model = info; segCache.clear(); AUTO = null;
  $('#modelName').textContent = info.name;
  M = buildMesh(root);
  makeSurface();
  const saved = (() => { try { return localStorage.getItem('dm.cutter.v1.' + id); } catch (e) { return null; } })();
  S.pieces = PIECE_SETS[info.pieces || 'generic'].map(([pid, name], i) => ({ id: pid, name, color: SPECIAL_COLORS[pid] || COLORS[i % COLORS.length] }));
  S.active = S.pieces[0].id; S.seams = []; S.fills = []; S.strokes = []; S.drawing = null;
  hist.past.length = 0; hist.future.length = 0;
  lastSnap = snap();
  if (saved) { try { restore(saved); toast('Your cut from last time is back'); } catch (e) { compute(); } } else compute();
  setView('front'); $('#loading').hidden = true;
}
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

async function boot() {
  resize(); stageColour(); setTool('seam'); setBrush(14);
  const id = new URLSearchParams(location.search).get('model') || 'hoodie-zip';
  const info = MODELS[id] || MODELS['hoodie-zip'];
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(info.url);
    setModel(MODELS[id] ? id : 'hoodie-zip', info, gltf.scene);
    if (info.auto) fetch(info.auto).then((r) => (r.ok ? r.json() : null)).then((J) => {
      if (!J || J.faces !== M.F) return;
      if ((J.check || []).some(([i, x, y, z]) => Math.abs(M.C[i * 3] - x) + Math.abs(M.C[i * 3 + 1] - y) + Math.abs(M.C[i * 3 + 2] - z) > 3e-4)) return;
      const raw = atob(J.labels), ids = J.ids; AUTO = new Array(M.F);
      for (let f = 0; f < M.F; f++) { const v = raw.charCodeAt(f); AUTO[f] = v ? ids[v - 1] : null; }
      if (S.showAuto) paint();
    }).catch(() => {});
  } catch (err) {
    console.error(err); $('#loading').textContent = 'Could not load the model. Use "Open model…" to open a file.';
  }
}
window.CUTTER = { S, get overlay() { return overlay; }, get surf() { return surf; }, redraw: () => { dirty = true; }, get M() { return M; }, get LAB() { return LAB; }, get BARRIER() { return BARRIER; }, regionOf, exportCut, importCut, setTool, setView, addSeamPoint, finishSeam, fillAt, surfPoint, segPath, compute, pick };
boot();
