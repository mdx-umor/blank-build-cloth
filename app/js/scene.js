// Design Master — 3D studio: renderer, materials, lights, window-light gobos, catalogue render.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildGarmentGroup, cavityAO } from './mesh.js';
import { normalMapCanvas, FABRICS } from './fabric.js';
import { makeCanvas, mulberry, rad, clamp, mixHex } from './util.js';

// the best video encoder this browser offers: H.264 → MP4 first, then VP9 / VP8 → WebM
async function pickVideoEncoder(width, height, fps) {
  if (!window.VideoEncoder || !window.VideoFrame) return null;
  const bitrate = Math.round(Math.min(40e6, Math.max(8e6, width * height * fps * 0.12)));
  const tries = [
    ['mp4', 'avc1.640033', { avc: { format: 'avc' } }], ['mp4', 'avc1.4d0033', { avc: { format: 'avc' } }], ['mp4', 'avc1.42003e', { avc: { format: 'avc' } }],
    ['webm', 'vp09.00.51.08', {}, 'V_VP9'], ['webm', 'vp8', {}, 'V_VP8'],
  ];
  for (const [format, codec, extra, mux] of tries) {
    const config = { codec, width, height, bitrate, framerate: fps, latencyMode: 'quality', ...extra };
    try {
      if (!(await VideoEncoder.isConfigSupported(config)).supported) continue;
      const lib = format === 'mp4' ? await import('../vendor/mp4-muxer.mjs') : await import('../vendor/webm-muxer.mjs');
      return { format, config, lib, mux };
    } catch { /* try the next one */ }
  }
  return null;
}

export const GOBOS = [
  { id: 'none', name: 'None' }, { id: 'window', name: 'Window' }, { id: 'arch', name: 'Arched window' },
  { id: 'blinds', name: 'Blinds' }, { id: 'softblinds', name: 'Soft blinds' }, { id: 'leaves', name: 'Leaf shadows' },
  { id: 'palm', name: 'Palm fronds' }, { id: 'branches', name: 'Bare branches' }, { id: 'split', name: 'Light & shade' },
  { id: 'spot', name: 'Spotlight' }, { id: 'beam', name: 'Light beam' }, { id: 'round', name: 'Round window' },
];

/* ---------- gobo textures (white = light) ---------- */
const goboCache = new Map();
export function goboCanvas(id, invert = false) {
  const key = id + invert;
  if (goboCache.has(key)) return goboCache.get(key);
  const S = 1024, cv = makeCanvas(S, S), c = cv.getContext('2d');
  const r = mulberry(id.length * 97 + 3);
  c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
  c.fillStyle = '#fff'; c.strokeStyle = '#fff';
  const blur = (px) => { c.filter = `blur(${px}px)`; };
  switch (id) {
    case 'none': c.fillRect(0, 0, S, S); break;
    case 'window': blur(10); for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) c.fillRect(250 + i * 270, 170 + j * 235, 245, 210); break;
    case 'arch': blur(12); for (const x of [230, 530]) { c.beginPath(); c.moveTo(x, 900); c.lineTo(x, 380); c.arc(x + 130, 380, 130, Math.PI, 0); c.lineTo(x + 260, 900); c.fill(); } c.filter = 'none'; c.fillStyle = '#000'; blur(6); c.fillRect(0, 600, S, 22); c.fillRect(352, 200, 16, 700); c.fillRect(652, 200, 16, 700); break;
    case 'blinds': blur(5); for (let y = 0; y < S; y += 64) c.fillRect(0, y, S, 34); break;
    case 'softblinds': blur(22); for (let y = 0; y < S; y += 92) c.fillRect(0, y, S, 46); break;
    case 'leaves': c.fillRect(0, 0, S, S); c.fillStyle = '#000'; blur(9); for (let i = 0; i < 90; i++) { c.save(); c.translate(r() * S, r() * S); c.rotate(r() * Math.PI); c.beginPath(); c.ellipse(0, 0, 30 + r() * 40, 11 + r() * 12, 0, 0, Math.PI * 2); c.fill(); c.restore(); } break;
    case 'palm': c.fillRect(0, 0, S, S); c.fillStyle = '#000'; c.strokeStyle = '#000'; blur(7); for (let f = 0; f < 4; f++) { const ox = r() * S, oy = r() * S * 0.4, ang = r() * Math.PI; c.lineWidth = 8; c.beginPath(); c.moveTo(ox, oy); const L = 600; c.lineTo(ox + Math.cos(ang) * L, oy + Math.sin(ang) * L); c.stroke(); for (let k = 0; k < 26; k++) { const t = k / 26, px = ox + Math.cos(ang) * L * t, py = oy + Math.sin(ang) * L * t; for (const s of [-1, 1]) { c.save(); c.translate(px, py); c.rotate(ang + s * 1.0); c.beginPath(); c.ellipse(70, 0, 80 * (1 - t * 0.6), 9, 0, 0, Math.PI * 2); c.fill(); c.restore(); } } } break;
    case 'branches': c.fillRect(0, 0, S, S); c.strokeStyle = '#000'; blur(4); const br = (x, y, a, l, w, d) => { if (d > 7 || l < 8) return; const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l; c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke(); br(x2, y2, a - 0.3 - r() * 0.4, l * 0.72, w * 0.7, d + 1); br(x2, y2, a + 0.3 + r() * 0.4, l * 0.7, w * 0.7, d + 1); }; br(S * 0.1, S, -1.2, 260, 22, 0); br(S * 0.95, S * 0.1, 2.4, 220, 18, 0); break;
    case 'split': blur(40); c.fillRect(0, 0, S * 0.55, S); break;
    case 'spot': { const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.36); g.addColorStop(0, '#fff'); g.addColorStop(0.7, '#ddd'); g.addColorStop(1, '#000'); c.fillStyle = g; c.fillRect(0, 0, S, S); break; }
    case 'beam': blur(30); c.save(); c.translate(S / 2, S / 2); c.rotate(-0.5); c.fillRect(-150, -S, 300, S * 2); c.restore(); break;
    case 'round': blur(10); c.beginPath(); c.arc(S / 2, S / 2, 280, 0, Math.PI * 2); c.fill(); c.filter = 'none'; c.fillStyle = '#000'; blur(5); c.fillRect(S / 2 - 9, 200, 18, 620); c.fillRect(200, S / 2 - 9, 620, 18); break;
  }
  c.filter = 'none';
  if (invert) { c.globalCompositeOperation = 'difference'; c.fillStyle = '#fff'; c.fillRect(0, 0, S, S); }
  goboCache.set(key, cv);
  return cv;
}

export class Studio {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 0.92; // neutral keeps print colours true
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 3000);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 40, maxDistance: 600, minPolarAngle: rad(35), maxPolarAngle: rad(118), minAzimuthAngle: -rad(70), maxAzimuthAngle: rad(70), screenSpacePanning: true });
    const pm = this.pmrem = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.55;
    // studio HDRI (soft photo-studio light); falls back to the built-in room light
    new RGBELoader().loadAsync('assets/studio.hdr').then(t => { t.mapping = THREE.EquirectangularReflectionMapping; this.hdrTex = pm.fromEquirectangular(t).texture; t.dispose(); this.updateScene(this.sc || {}); }).catch(() => {});

    this.turntable = new THREE.Group(); this.scene.add(this.turntable);
    this.garmentRoot = new THREE.Group(); this.turntable.add(this.garmentRoot);

    // backdrop wall + soft floor shadow catcher
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0xececec, roughness: 0.96 });
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), this.wallMat);
    this.wall.position.z = -26; this.wall.receiveShadow = true; this.scene.add(this.wall);
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), new THREE.ShadowMaterial({ opacity: 0.25 }));
    this.shadowCatcher.position.z = -26; this.shadowCatcher.receiveShadow = true; this.shadowCatcher.visible = false; this.scene.add(this.shadowCatcher);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xdcd6cf, 0.55); this.scene.add(this.hemi);
    this.key = new THREE.SpotLight(0xffffff, 1, 0, rad(32), 0.55, 0);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.5;
    this.key.shadow.camera.near = 20; this.key.shadow.camera.far = 1500;
    this.scene.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.35); this.fill.position.set(200, 60, 300); this.scene.add(this.fill);
    this.rim = new THREE.DirectionalLight(0xfff4ea, 0.25); this.rim.position.set(-120, 200, -60); this.scene.add(this.rim);

    this.atlasTex = new THREE.CanvasTexture(makeCanvas(4, 4));
    this.atlasTex.colorSpace = THREE.SRGBColorSpace; this.atlasTex.anisotropy = r.capabilities.getMaxAnisotropy();
    // inside of the garment: inside prints + the woven label (same UV layout as the outside)
    this.insideTex = new THREE.CanvasTexture(makeCanvas(4, 4));
    this.insideTex.colorSpace = THREE.SRGBColorSpace; this.insideTex.anisotropy = r.capabilities.getMaxAnisotropy();
    this.fabUniforms = { uBright: { value: 1 }, uContrast: { value: 1 } };
    this.mats = this.makeMaterials();
    this.quality = 'adaptive'; this.moving = false; this.autoRotate = false;
    this.viewYaw = 0; this.targetYaw = 0;
    this.controls.addEventListener('start', () => { this.moving = true; this.applyPixelRatio(); });
    this.controls.addEventListener('end', () => { this.moving = false; setTimeout(() => this.applyPixelRatio(), 120); });
    this._loop = this._loop.bind(this);
    this.dirty = true;
    this.controls.addEventListener('change', () => (this.dirty = true));
    requestAnimationFrame(this._loop);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  makeMaterials() {
    const nm = (type) => { const t = new THREE.CanvasTexture(normalMapCanvas(type)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
    this._nm = nm;
    const main = new THREE.MeshPhysicalMaterial({ map: this.atlasTex, roughness: 0.92, normalMap: nm('jersey'), normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.15, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff), side: THREE.FrontSide });
    const rib = main.clone(); rib.normalMap = nm('rib');
    const inner = new THREE.MeshStandardMaterial({ map: this.insideTex, color: 0xc4c4c4, roughness: 1, side: THREE.BackSide });
    // fabric brightness / contrast (applied to the fabric and its prints, like a photo adjustment)
    for (const m of [main, rib, inner]) m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.fabUniforms);
      sh.fragmentShader = 'uniform float uBright; uniform float uContrast;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = clamp((diffuseColor.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBright;');
    };
    const trim = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.95, normalMap: nm('rib'), normalScale: new THREE.Vector2(0.5, 0.5), sheen: 0.2 });
    trim.normalMap = trim.normalMap.clone(); trim.normalMap.repeat.set(4, 1);
    const label = new THREE.MeshStandardMaterial({ map: this.insideTex, roughness: 0.6, side: THREE.DoubleSide });
    const hanger = new THREE.MeshStandardMaterial({ color: 0xb08a5c, roughness: 0.45, metalness: 0.0 });
    const cord = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const aglet = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 });
    // folded edges (hems, cuffs) take the colour of their piece
    const edgeCache = {};
    const edge = (pieceId) => {
      const col = (this._fabric?.pieceColors?.[pieceId]) || this._fabric?.color || '#ffffff';
      const k = pieceId;
      if (!edgeCache[k]) edgeCache[k] = new THREE.MeshStandardMaterial({ roughness: 0.95 });
      edgeCache[k].color.set(col);
      return edgeCache[k];
    };
    this._edgeCache = edgeCache;
    const button = new THREE.MeshPhysicalMaterial({ color: 0xf2f0ea, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const thread = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.9 });
    return { main, rib, inner, trim, label, hanger, cord, aglet, edge, button, thread };
  }

  loadGLB(url) {
    this._glb ??= {};
    if (!this._glb[url]) { const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); this._glb[url] = l.loadAsync(url); }
    return this._glb[url];
  }
  // garments from real cloth-sim models: the UVs are the sewing pattern, remapped onto the atlas sheet
  async setModelGarment(g, opts) {
    const token = (this._token = (this._token || 0) + 1);
    const gltf = await this.loadGLB(g.glb);
    if (token !== this._token) return;
    this.garment = g;
    for (const ch of [...this.garmentRoot.children]) { this.garmentRoot.remove(ch); ch.traverse(o => o.geometry && o.geometry.dispose()); }
    const group = new THREE.Group(), U = g.uvMap, sh = g.sheet;
    gltf.scene.updateMatrixWorld(true);
    const toFloat = (a, n) => { const f = new Float32Array(a.count * n); for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) f[i * n + k] = a.getComponent(i, k); return new THREE.BufferAttribute(f, n); };
    const panelMeshes = [];
    const box = new THREE.Box3();
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', toFloat(o.geometry.attributes.position, 3));
      geo.setAttribute('normal', toFloat(o.geometry.attributes.normal, 3));
      if (o.geometry.attributes.uv) geo.setAttribute('uv', toFloat(o.geometry.attributes.uv, 2));
      geo.setIndex(o.geometry.index);
      geo.applyMatrix4(o.matrixWorld); geo.scale(100, 100, 100); // metres → cm
      const name = o.material?.name || '';
      if (name.startsWith('Fabric')) {
        const uv = geo.attributes.uv;
        // which piece does a point of the original UV layout belong to? (bounding boxes first, then the outline)
        const boxes = g.pieces.map(p => [p.sx0 - 0.8, p.sy0 - 0.8, p.sx0 + p.w + 0.8, p.sy0 + p.h + 0.8, p]);
        const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
        const pieceOf = (x, y) => {
          const cand = boxes.filter(b => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
          if (cand.length <= 1) return cand[0]?.[4];
          return (cand.find(b => inPoly(x - b[4].sx0, y - b[4].sy0, b[4].poly)) || cand.sort((a, b) => (a[2] - a[0]) * (a[3] - a[1]) - (b[2] - b[0]) * (b[3] - b[1]))[0])[4];
        };
        for (let i = 0; i < uv.count; i++) {
          let sx = (uv.getX(i) - U.u0) * U.k + U.M, sy = (U.v1 - (1 - uv.getY(i))) * U.k + U.M; // glTF flips V
          const p = pieceOf(sx, sy);
          if (p) { sx += p.sx - p.sx0; sy += p.sy - p.sy0; }
          uv.setXY(i, sx / sh.w, 1 - sy / sh.h);
        }
        geo.computeBoundingBox(); box.union(geo.boundingBox);
        cavityAO(geo, 0.8);
        const outer = new THREE.Mesh(geo, this.mats.main); outer.castShadow = outer.receiveShadow = true; outer.userData = { panel: { model: true }, pick: true };
        const inner = new THREE.Mesh(geo, this.mats.inner); inner.receiveShadow = true;
        group.add(outer, inner); panelMeshes.push(outer);
      } else {
        const m = new THREE.Mesh(geo, name.startsWith('Thread') ? this.mats.thread : this.mats.button);
        m.castShadow = m.receiveShadow = true; group.add(m);
      }
    });
    if (opts.hanger) {
      const y1 = box.max.y, zc = (box.min.z + box.max.z) / 2 - 3;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 12), this.mats.hanger); stem.position.set(0, y1 + 1, zc);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.3, 10, 40, Math.PI * 1.35), this.mats.hanger); arc.position.set(-2.6, y1 + 4, zc); arc.rotation.z = -0.1;
      for (const m of [stem, arc]) { m.castShadow = true; group.add(m); }
    }
    const top = box.max.y + (opts.hanger ? 7 : 0);
    g.bounds = { x0: box.min.x, x1: box.max.x, y0: box.min.y, y1: top, cx: (box.min.x + box.max.x) / 2, cy: (box.min.y + top) / 2, zc: (box.min.z + box.max.z) / 2 };
    g.bounds.w = g.bounds.x1 - g.bounds.x0; g.bounds.h = g.bounds.y1 - g.bounds.y0;
    this.garmentRoot.add(group);
    this.panelMeshes = panelMeshes;
    this.garmentRoot.position.set(-g.bounds.cx, -g.bounds.cy, -g.bounds.zc);
    this.updateNormalRepeat();
    if (!this._framed || opts.reframe) { this.frame(); this._framed = true; }
    this.dirty = true;
  }

  setGarment(garment, opts) {
    if (garment.model) return this.setModelGarment(garment, opts);
    this._token = (this._token || 0) + 1;
    this.garment = garment;
    for (const ch of [...this.garmentRoot.children]) { this.garmentRoot.remove(ch); ch.traverse(o => o.geometry && o.geometry.dispose()); }
    const { group, panelMeshes } = buildGarmentGroup(garment, this.mats, opts);
    this.garmentRoot.add(group);
    this.panelMeshes = panelMeshes;
    const b = garment.bounds;
    this.garmentRoot.position.set(-b.cx, -b.cy, 0);
    this.updateNormalRepeat();
    if (!this._framed || opts.reframe) { this.frame(); this._framed = true; }
    this.dirty = true;
  }

  frame(keepAngle = false) {
    const b = this.garment.bounds;
    const fov = rad(this.camera.fov), asp = this.camera.aspect || 1;
    const fitH = b.h * 1.18 / 2 / Math.tan(fov / 2);
    const fitW = b.w * 1.18 / 2 / Math.tan(fov / 2) / asp;
    const dist = Math.max(fitH, fitW, 80);
    this.controls.target.set(0, 0, 0);
    if (!keepAngle) this.camera.position.set(0, 4, dist);
    else this.camera.position.setLength(dist);
    this.controls.update();
    this.dirty = true;
  }

  updateFabric(fabric, sheet) {
    this._fabric = fabric;
    for (const [k, m] of Object.entries(this._edgeCache || {})) m.color.set(fabric.pieceColors?.[k] || fabric.color);
    const F = FABRICS.find(f => f.id === fabric.type) || FABRICS[0];
    const m = this.mats.main;
    if (this._fabType !== F.id) { m.normalMap = this._nm(F.id); this._fabType = F.id; }
    m.roughness = F.rough; m.sheen = F.sheen;
    const rs = (fabric.relief ?? 0.6);
    m.normalScale.set(rs, rs);
    this.mats.rib.normalScale.set(rs, rs);
    this.mats.rib.roughness = F.rough;
    this._tileCm = F.tileCm * (fabric.knit ?? 1);
    this.fabUniforms.uBright.value = fabric.bright ?? 1;
    this.fabUniforms.uContrast.value = fabric.contrast ?? 1;
    // fold shadows: cavity occlusion stored as vertex colours
    const ao = fabric.ao !== false;
    for (const mat of [this.mats.main, this.mats.rib]) if (mat.vertexColors !== ao) { mat.vertexColors = ao; mat.needsUpdate = true; }
    this.mats.trim.color.set(fabric.pieceColors?.trim || fabric.color);
    this.mats.trim.normalScale.set(rs, rs);
    this.updateNormalRepeat();
    this.dirty = true;
  }
  updateNormalRepeat() {
    if (!this.garment) return;
    const s = this.garment.sheet, t = this._tileCm || 1.1;
    for (const mat of [this.mats.main, this.mats.rib]) if (mat.normalMap) mat.normalMap.repeat.set(s.w / t, s.h / t);
    if (this.mats.rib.normalMap) this.mats.rib.normalMap.repeat.set(s.w / (t * 1.3), s.h / (t * 1.3));
  }

  setAtlas(canvas) {
    if (this.atlasTex.image !== canvas || this.atlasTex.image.width !== this._aw || this.atlasTex.image.height !== this._ah) {
      const old = this.atlasTex;
      this.atlasTex = new THREE.CanvasTexture(canvas);
      this.atlasTex.colorSpace = THREE.SRGBColorSpace; this.atlasTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.mats.main.map = this.atlasTex; this.mats.rib.map = this.atlasTex;
      this.mats.main.needsUpdate = this.mats.rib.needsUpdate = true;
      this._aw = canvas.width; this._ah = canvas.height;
      old.dispose();
    } else this.atlasTex.needsUpdate = true;
    this.dirty = true;
  }

  setInside(canvas) {
    if (this.insideTex.image !== canvas || canvas.width !== this._iw || canvas.height !== this._ih) {
      const old = this.insideTex;
      this.insideTex = new THREE.CanvasTexture(canvas);
      this.insideTex.colorSpace = THREE.SRGBColorSpace; this.insideTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.mats.inner.map = this.insideTex; this.mats.label.map = this.insideTex;
      this.mats.inner.needsUpdate = this.mats.label.needsUpdate = true;
      this._iw = canvas.width; this._ih = canvas.height; old.dispose();
    } else this.insideTex.needsUpdate = true;
    this.dirty = true;
  }

  updateScene(sc) {
    this.sc = sc;
    this.wall.visible = sc.backdrop !== false;
    this.wallMat.color.set(sc.bgColor || '#ececec');
    this.wallMat.color.multiplyScalar(sc.bgBright ?? 1);
    this.renderer.setClearColor(sc.bgColor || '#ececec', sc.backdrop === false && sc.transparent ? 0 : 1);
    this.scene.background = sc.backdrop === false ? new THREE.Color(sc.bgColor || '#ececec') : null;
    // key light on a sphere around the garment
    const side = rad(sc.lightSide ?? -35), up = rad(sc.lightHeight ?? 40), dist = 520;
    this.key.position.set(Math.sin(side) * Math.cos(up) * dist, Math.sin(up) * dist, Math.cos(side) * Math.cos(up) * dist);
    this.key.target.position.set(0, 0, -20);
    const contrast = sc.bgContrast ?? 1; // backdrop contrast: stronger key light, weaker ambient
    this.key.intensity = (sc.lightPower ?? 1) * 3.2 * contrast;
    this.key.decay = 0;
    this.key.penumbra = 0.6;
    this.key.angle = rad(26);
    this.key.shadow.radius = 2 + (sc.softness ?? 0.5) * 10;
    this.key.shadow.blurSamples = 16;
    this.key.castShadow = sc.shadows !== false;
    const gid = sc.gobo || 'none';
    if (gid !== 'none') {
      const key = gid + !!sc.goboInvert;
      if (this._gobo !== key) { const t = new THREE.CanvasTexture(goboCanvas(gid, !!sc.goboInvert)); t.colorSpace = THREE.SRGBColorSpace; this.key.map = t; this._gobo = key; }
      this.hemi.intensity = 0.42 * (sc.ambient ?? 1) / contrast;
    } else { this.key.map = null; this._gobo = null; this.hemi.intensity = 0.55 * (sc.ambient ?? 1) / contrast; }
    const useHdr = sc.hdri !== false && this.hdrTex;
    this.scene.environment = useHdr ? this.hdrTex : this.envTex;
    this.scene.environmentIntensity = useHdr ? (sc.hdriPower ?? 1) * 0.6 : (sc.envPower ?? 0.55);
    this.scene.environmentRotation.set(0, rad(sc.hdriRot ?? 0), 0);
    this.fill.intensity = 0.35 * (sc.fill ?? 1);
    this.mats.hanger.color.set(sc.hangerColor || '#b08a5c');
    this.mats.hanger.metalness = sc.hangerColor === '#c0c4c8' ? 0.85 : 0;
    this.mats.hanger.roughness = sc.hangerColor === '#c0c4c8' ? 0.3 : 0.5;
    this.autoRotate = !!sc.spin;
    this.dirty = true;
  }

  setView(v) {
    this.targetYaw = { front: 0, back: Math.PI, side: Math.PI / 2, three: -Math.PI / 5 }[v] ?? 0;
    // take the shortest way round
    const twoPi = Math.PI * 2;
    let d = (this.targetYaw - this.viewYaw) % twoPi; if (d > Math.PI) d -= twoPi; if (d < -Math.PI) d += twoPi;
    this.targetYaw = this.viewYaw + d;
    this.camera.position.set(0, 4, this.camera.position.length()); this.controls.update();
    this.dirty = true;
  }

  resize() {
    if (this.recording) return; // a size change would break the video being recorded
    const p = this.canvas.parentElement; if (!p) return;
    const w = p.clientWidth, h = p.clientHeight; if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.applyPixelRatio();
    this.dirty = true;
  }
  applyPixelRatio() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const q = { full: 1, half: 0.5, quarter: 0.25, adaptive: this.moving || this.autoRotate ? 0.6 : 1 }[this.quality] ?? 1;
    const pr = Math.max(0.35, dpr * q);
    if (this.renderer.getPixelRatio() !== pr) { this.renderer.setPixelRatio(pr); const p = this.canvas.parentElement; this.renderer.setSize(p.clientWidth, p.clientHeight, false); }
    this.dirty = true;
  }

  _loop(t) {
    requestAnimationFrame(this._loop);
    if (this.paused) return;
    const ch = this.controls.update();
    if (this.autoRotate) { this.viewYaw += 0.006; this.targetYaw = this.viewYaw; this.dirty = true; }
    else if (Math.abs(this.targetYaw - this.viewYaw) > 1e-4) { this.viewYaw += (this.targetYaw - this.viewYaw) * 0.14; this.dirty = true; }
    this.turntable.rotation.y = this.viewYaw;
    if (this.dirty || ch) { this.renderer.render(this.scene, this.camera); this.dirty = false; this.onFrame && this.onFrame(); }
  }

  // raycast from a pointer event → { mesh, uv }
  pick(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(p, this.camera);
    const hit = rc.intersectObjects(this.panelMeshes || [], false)[0];
    return hit ? { mesh: hit.object, uv: hit.uv, panel: hit.object.userData.panel } : null;
  }

  /* ---------------- wrap over seams ----------------
     A wrapped print is projected onto the 3D garment from its anchor point (planar decal along the
     surface normal there) and baked back into the pattern texture, so it continues across seams. */
  _uvIndex() {
    if (this._uvIdx?.g === this.garment) return this._uvIdx;
    const tris = [];
    for (const m of this.panelMeshes || []) {
      if (m.userData.panel?.role === 'label') continue;
      const g = m.geometry, pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv, idx = g.index;
      const n = idx ? idx.count : pos.count;
      tris.push({ pos, nrm, uv, idx, n });
    }
    return (this._uvIdx = { g: this.garment, tris });
  }
  // 3D point + normal on the garment at a pattern (sheet, cm) position, or null
  surfaceAt(sx, sy) {
    const sh = this.garment.sheet, u = sx / sh.w, v = 1 - sy / sh.h;
    for (const t of this._uvIndex().tris) {
      const { pos, nrm, uv, idx, n } = t;
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        const ax = uv.getX(a), ay = uv.getY(a), bx = uv.getX(b), by = uv.getY(b), cx = uv.getX(c), cy = uv.getY(c);
        if (u < Math.min(ax, bx, cx) || u > Math.max(ax, bx, cx) || v < Math.min(ay, by, cy) || v > Math.max(ay, by, cy)) continue;
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-14) continue;
        const w1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / d, w2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / d, w3 = 1 - w1 - w2;
        if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) continue;
        const P = new THREE.Vector3(), N = new THREE.Vector3(), tmp = new THREE.Vector3();
        for (const [k, w] of [[a, w1], [b, w2], [c, w3]]) { P.addScaledVector(tmp.fromBufferAttribute(pos, k), w); N.addScaledVector(tmp.fromBufferAttribute(nrm, k), w); }
        return { P, N: N.normalize() };
      }
    }
    return null;
  }
  // decal frame for a print centred at sheet (sx, sy), rotated rot° (clockwise on the pattern)
  wrapFrame(sx, sy, rotDeg, flip) {
    const c = this.surfaceAt(sx, sy); if (!c) return null;
    const e = 0.6;
    const px = this.surfaceAt(sx + e, sy) || this.surfaceAt(sx - e, sy), py = this.surfaceAt(sx, sy + e) || this.surfaceAt(sx, sy - e);
    if (!px || !py) return null;
    const sgx = this.surfaceAt(sx + e, sy) ? 1 : -1, sgy = this.surfaceAt(sx, sy + e) ? 1 : -1;
    const Rp = px.P.clone().sub(c.P).multiplyScalar(sgx), Dp = py.P.clone().sub(c.P).multiplyScalar(sgy);
    const N = c.N.clone();
    Rp.addScaledVector(N, -Rp.dot(N)).normalize();
    Dp.addScaledVector(N, -Dp.dot(N)).addScaledVector(Rp, -Dp.dot(Rp)).normalize();
    const a = rotDeg * Math.PI / 180;
    const R = Rp.clone().multiplyScalar(Math.cos(a)).addScaledVector(Dp, Math.sin(a));
    const D = Rp.clone().multiplyScalar(-Math.sin(a)).addScaledVector(Dp, Math.cos(a));
    if (flip) R.negate();
    return { O: c.P, R, U: D.negate(), N };
  }
  bakeWrap(prints, W, H) {
    const r = this.renderer;
    if (!this._wrapMat) {
      this._wrapMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, O: { value: new THREE.Vector3() }, R: { value: new THREE.Vector3() }, U: { value: new THREE.Vector3() }, N: { value: new THREE.Vector3() }, S: { value: new THREE.Vector2(1, 1) }, depth: { value: 10 }, opacity: { value: 1 } },
        vertexShader: 'varying vec3 vPos; varying vec3 vNrm; void main(){ vPos = position; vNrm = normal; gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D map; uniform vec3 O; uniform vec3 R; uniform vec3 U; uniform vec3 N; uniform vec2 S; uniform float depth; uniform float opacity;
          varying vec3 vPos; varying vec3 vNrm;
          void main(){ vec3 d = vPos - O; float u = dot(d, R) / S.x + 0.5; float v = dot(d, U) / S.y + 0.5;
            if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) discard;
            if (abs(dot(d, N)) > depth) discard;
            if (dot(normalize(vNrm), N) < 0.05) discard;
            vec4 c = texture2D(map, vec2(u, v)); gl_FragColor = vec4(c.rgb, c.a * opacity); }`,
        side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true,
        blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
    }
    const mat = this._wrapMat;
    const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    for (const m of this.panelMeshes || []) if (m.userData.panel?.role !== 'label') { const bm = new THREE.Mesh(m.geometry, mat); bm.frustumCulled = false; sc.add(bm); } // drawn in UV space: never cull
    const rt = new THREE.WebGLRenderTarget(W, H);
    const prev = { target: r.getRenderTarget(), auto: r.autoClear, clear: r.getClearAlpha(), col: r.getClearColor(new THREE.Color()), tone: r.toneMapping };
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.autoClear = false; r.toneMapping = THREE.NoToneMapping;
    const texs = [];
    for (const p of prints) {
      const t = new THREE.CanvasTexture(p.raster); t.colorSpace = THREE.NoColorSpace; texs.push(t);
      mat.uniforms.map.value = t; mat.uniforms.O.value.copy(p.f.O); mat.uniforms.R.value.copy(p.f.R); mat.uniforms.U.value.copy(p.f.U); mat.uniforms.N.value.copy(p.f.N);
      mat.uniforms.S.value.set(p.w, p.h); mat.uniforms.depth.value = Math.max(6, (p.w + p.h) * 0.35); mat.uniforms.opacity.value = p.opacity ?? 1;
      r.render(sc, cam);
    }
    const buf = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(prev.target); r.autoClear = prev.auto; r.setClearColor(prev.col, prev.clear); r.toneMapping = prev.tone;
    rt.dispose(); texs.forEach(t => t.dispose());
    const cv = makeCanvas(W, H), c = cv.getContext('2d'), im = c.createImageData(W, H);
    const d = im.data;
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4, dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        const al = buf[src + x + 3]; if (!al) continue;
        const k = 255 / al; // stored premultiplied
        d[dst + x] = Math.min(255, buf[src + x] * k); d[dst + x + 1] = Math.min(255, buf[src + x + 1] * k); d[dst + x + 2] = Math.min(255, buf[src + x + 2] * k); d[dst + x + 3] = al;
      }
    }
    c.putImageData(im, 0, 0);
    this.dirty = true;
    return cv;
  }

  /**
   * Turntable video: one full turn of the garment, recorded from the WebGL canvas.
   * Returns a Blob (MP4 where the browser can record it, otherwise WebM).
   */
  /**
   * One full turn as a video. Where the browser has WebCodecs, every frame is rendered and encoded one by one
   * (smooth on any computer): H.264 in an MP4 (fast start), or VP9/VP8 in a WebM. Otherwise the canvas is
   * recorded in real time. Returns { blob, format: 'mp4'|'webm' }.
   */
  async recordTurntable({ width, height, seconds = 8, fps = 30, onProgress, signal }) {
    width -= width % 2; height -= height % 2;
    const enc = await pickVideoEncoder(width, height, fps);
    const r = this.renderer;
    this.paused = true; this.recording = true;
    const prev = { pr: r.getPixelRatio(), yaw: this.viewYaw };
    try {
      r.setPixelRatio(1); r.setSize(width, height, false);
      this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
      const total = Math.round(seconds * fps), base = this.viewYaw;
      const frameAt = (f) => { this.turntable.rotation.y = base + (f / total) * Math.PI * 2; this.controls.update(); r.render(this.scene, this.camera); };
      if (!enc) return await this.recordRealtime({ total, fps, frameAt, onProgress, signal });
      const { Muxer, ArrayBufferTarget } = enc.lib, target = new ArrayBufferTarget();
      const muxer = enc.format === 'mp4'
        ? new Muxer({ target, video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' })
        : new Muxer({ target, video: { codec: enc.mux, width, height, frameRate: fps } });
      let failed = null;
      const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
      encoder.configure(enc.config);
      for (let f = 0; f < total; f++) {
        if (signal?.aborted || failed) break;
        frameAt(f);
        const frame = new VideoFrame(this.canvas, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
        frame.close();
        onProgress && onProgress(f + 1, total);
        while (encoder.encodeQueueSize > 3) await new Promise(res => setTimeout(res, 4));
        if (f % 4 === 0) await new Promise(res => setTimeout(res, 0)); // let the page breathe
      }
      if (failed) throw failed;
      await encoder.flush(); encoder.close();
      muxer.finalize();
      return { blob: new Blob([target.buffer], { type: enc.format === 'mp4' ? 'video/mp4' : 'video/webm' }), format: enc.format };
    } finally {
      this.viewYaw = prev.yaw; this.turntable.rotation.y = prev.yaw;
      r.setPixelRatio(prev.pr); this.recording = false; this.resize();
      this.paused = false; this.dirty = true;
    }
  }
  async recordRealtime({ total, fps, frameAt, onProgress, signal }) {
    const types = ['video/mp4;codecs=avc3.42E01E', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error('Could not record a video in this browser.');
    const rec = new MediaRecorder(this.canvas.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 10_000_000 });
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise(res => (rec.onstop = res));
    rec.start(250);
    for (let f = 0; f <= total; f++) {
      if (signal?.aborted) break;
      frameAt(f); onProgress && onProgress(f, total);
      await new Promise(res => setTimeout(res, 1000 / fps));
    }
    rec.stop(); await done;
    const type = mime.split(';')[0];
    return { blob: new Blob(chunks, { type }), format: type.includes('mp4') ? 'mp4' : 'webm' };
  }

  /**
   * Progressive catalogue render: accumulates jittered frames (sub-pixel AA + soft area light).
   * Returns a canvas. onProgress(pass, total).
   */
  async renderImage({ width, height, passes = 32, transparent = false, keepShadow = true, view = null, onProgress, signal }) {
    const r = this.renderer;
    const maxDim = Math.min(r.capabilities.maxTextureSize, 8192);
    const sc = Math.min(1, maxDim / Math.max(width, height));
    const W = Math.round(width * sc), H = Math.round(height * sc);
    this.paused = true;
    const prev = { pr: r.getPixelRatio(), w: this.canvas.clientWidth, h: this.canvas.clientHeight, aspect: this.camera.aspect, yaw: this.viewYaw, keyPos: this.key.position.clone(), clear: r.getClearAlpha(), clearC: r.getClearColor(new THREE.Color()), bg: this.scene.background, wall: this.wall.visible, catcher: this.shadowCatcher.visible, map: this.key.shadow.mapSize.x };
    try {
      if (view) { this.viewYaw = { front: 0, back: Math.PI, side: Math.PI / 2, three: -Math.PI / 5 }[view] ?? this.viewYaw; this.turntable.rotation.y = this.viewYaw; }
      if (transparent) { this.wall.visible = false; this.scene.background = null; r.setClearColor(0x000000, 0); this.shadowCatcher.visible = keepShadow; }
      this.key.shadow.mapSize.set(4096, 4096); this.key.shadow.map?.dispose(); this.key.shadow.map = null;
      r.setPixelRatio(1); r.setSize(W, H, false);
      this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
      const acc = new Float32Array(W * H * 4), buf = new Uint8Array(W * H * 4);
      const gl = r.getContext();
      const rnd = mulberry(42);
      const base = prev.keyPos;
      const soft = 6 + (this.sc?.softness ?? 0.5) * 22;
      let passesDone = 0;
      for (let i = 0; i < passes; i++) {
        if (signal?.aborted) break;
        const jx = rnd() - 0.5, jy = rnd() - 0.5;
        this.camera.setViewOffset(W, H, jx, jy, W, H);
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * soft;
        this.key.position.set(base.x + Math.cos(a) * rr, base.y + Math.sin(a) * rr, base.z);
        r.render(this.scene, this.camera);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        for (let k = 0; k < buf.length; k++) acc[k] += buf[k];
        passesDone++;
        onProgress && onProgress(i + 1, passes);
        if (i % 2 === 1) await new Promise(res => setTimeout(res, 0));
      }
      this.camera.clearViewOffset();
      passesDone = Math.max(1, passesDone);
      const out = makeCanvas(W, H), oc = out.getContext('2d'), im = oc.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const si = ((H - 1 - y) * W + x) * 4, di = (y * W + x) * 4;
        const a = acc[si + 3] / passesDone;
        if (transparent && a > 0) { const k = 255 / a; im.data[di] = clamp(acc[si] / passesDone * k, 0, 255); im.data[di + 1] = clamp(acc[si + 1] / passesDone * k, 0, 255); im.data[di + 2] = clamp(acc[si + 2] / passesDone * k, 0, 255); }
        else { im.data[di] = acc[si] / passesDone; im.data[di + 1] = acc[si + 1] / passesDone; im.data[di + 2] = acc[si + 2] / passesDone; }
        im.data[di + 3] = transparent ? a : 255;
      }
      oc.putImageData(im, 0, 0);
      return out;
    } finally {
      this.key.position.copy(prev.keyPos);
      this.wall.visible = prev.wall; this.shadowCatcher.visible = prev.catcher; this.scene.background = prev.bg;
      r.setClearColor(prev.clearC, prev.clear);
      this.key.shadow.mapSize.set(prev.map, prev.map); this.key.shadow.map?.dispose(); this.key.shadow.map = null;
      this.viewYaw = prev.yaw; this.turntable.rotation.y = prev.yaw;
      r.setPixelRatio(prev.pr); this.resize();
      this.paused = false; this.dirty = true;
    }
  }
}
