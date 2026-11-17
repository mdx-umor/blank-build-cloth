// Design Master — 3D studio: renderer, materials, lights, window-light gobos, catalogue render.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildGarmentGroup } from './mesh.js';
import { normalMapCanvas, FABRICS } from './fabric.js';
import { makeCanvas, mulberry, rad, clamp, mixHex } from './util.js';

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
    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.55;

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
    const inner = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 1, side: THREE.BackSide });
    const trim = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.95, normalMap: nm('rib'), normalScale: new THREE.Vector2(0.5, 0.5), sheen: 0.2 });
    trim.normalMap = trim.normalMap.clone(); trim.normalMap.repeat.set(4, 1);
    const labelTex = new THREE.CanvasTexture(makeCanvas(4, 4)); labelTex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.6, side: THREE.DoubleSide });
    const hanger = new THREE.MeshStandardMaterial({ color: 0xb08a5c, roughness: 0.45, metalness: 0.0 });
    const cord = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const aglet = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 });
    return { main, rib, inner, trim, label, hanger, cord, aglet };
  }

  setGarment(garment, opts) {
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
    const F = FABRICS.find(f => f.id === fabric.type) || FABRICS[0];
    const m = this.mats.main;
    if (this._fabType !== F.id) { m.normalMap = this._nm(F.id); this._fabType = F.id; }
    m.roughness = F.rough; m.sheen = F.sheen;
    const rs = (fabric.relief ?? 0.6);
    m.normalScale.set(rs, rs);
    this.mats.rib.normalScale.set(rs, rs);
    this.mats.rib.roughness = F.rough;
    this._tileCm = F.tileCm * (fabric.knit ?? 1);
    const inner = mixHex(fabric.color, '#000000', 0.32);
    this.mats.inner.color.set(inner);
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

  setLabel(canvas) { const t = this.mats.label.map; t.image = canvas; t.needsUpdate = true; this.dirty = true; }

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
    this.key.intensity = (sc.lightPower ?? 1) * 3.2;
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
      this.hemi.intensity = 0.42 * (sc.ambient ?? 1);
    } else { this.key.map = null; this._gobo = null; this.hemi.intensity = 0.55 * (sc.ambient ?? 1); }
    this.scene.environmentIntensity = sc.envPower ?? 0.55;
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
