// Design Master — vector output for print files. Text becomes outlined letters (paths, no fonts needed at the
// print shop), shapes become paths, SVG pictures stay vector, PDF/Illustrator pictures stay vector in PDF.
// Pictures (and anything with picture-only effects) go in as PNG.
import { layoutText, shapePath, shapeGradient, isLine, itemHeight, itemRaster, colourAdjusted, FONTS } from './atlas.js';
import { svgSize } from './importer.js';
import { makeCanvas, rad } from './util.js';

const n = (v) => +(+v).toFixed(4);
const escXml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------------------------------------------------------- fonts (for outlining letters) */
let opentype = null;
const fontCache = new Map();
const fontId = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
async function fetchFont(family, weight, style) {
  const url = `https://cdn.jsdelivr.net/fontsource/fonts/${fontId(family)}@latest/latin-${weight}-${style}.ttf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('font ' + r.status);
  return opentype.parse(await r.arrayBuffer());
}
/** The font file for a text item, or null when it can't be fetched (then the text goes in as a picture). */
export async function fontFor(it) {
  opentype = opentype || (await import('../vendor/opentype.module.js')).default;
  const family = it.font || 'Inter', want = it.weight || 400, italic = !!it.italic;
  const key = `${family}|${want}|${italic}`;
  if (fontCache.has(key)) return fontCache.get(key);
  const weights = FONTS.find(f => f.family === family)?.weights || [400];
  const tries = [...weights].sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
  let font = null, synthItalic = false;
  for (const style of italic ? ['italic', 'normal'] : ['normal']) {
    for (const w of tries) { try { font = await fetchFont(family, w, style); break; } catch { /* next */ } }
    if (font) { synthItalic = italic && style === 'normal'; break; }
  }
  const res = font ? { font, synthItalic } : null;
  fontCache.set(key, res);
  return res;
}

/* ---------------------------------------------------------------- paths from canvas-style drawing */
// a stand-in 2D context that records a path as SVG path data, so shapes use the exact same geometry as on screen
class PathRecorder {
  constructor() { this.d = []; }
  beginPath() { this.d = []; }
  moveTo(x, y) { this.d.push(`M${n(x)} ${n(y)}`); }
  lineTo(x, y) { this.d.push(`${this.d.length ? 'L' : 'M'}${n(x)} ${n(y)}`); }
  bezierCurveTo(a, b, c, d, x, y) { this.d.push(`C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(x)} ${n(y)}`); }
  closePath() { this.d.push('Z'); }
  rect(x, y, w, h) { this.d.push(`M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`); }
  roundRect(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); this.d.push(`M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`); }
  ellipse(cx, cy, rx, ry) { this.d.push(`M${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)}Z`); }
  toString() { return this.d.join(''); }
}

/* ---------------------------------------------------------------- one item as SVG */
let uidN = 0;
// prefix the ids inside an embedded SVG so several pictures can live in one file
function prefixIds(svgText, pre) {
  return svgText.replace(/\bid="([^"]+)"/g, `id="${pre}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${pre}$1)`).replace(/(xlink:)?href="#([^"]+)"/g, (m, x, id) => `${x || ''}href="#${pre}${id}"`);
}
// does the item need to go in as a picture? (effects that only exist as pixels)
export const needsRaster = (it) => it.type === 'image' && (!it.vec || it.vec.kind !== 'svg' || colourAdjusted(it) || it.halftone) || !!it.distress;

/**
 * SVG markup for one item in piece cm (centred at it.x, it.y with its turn and mirror), or for the print alone
 * (`alone`: centred in a box w × h at the origin). Returns { svg, kind: 'vector'|'picture' }.
 */
export async function itemSvg(it, assets, { alone = false, dpi = 300 } = {}) {
  const h = itemHeight(it, assets), w = it.w;
  const tf = alone ? `translate(${n(w / 2)} ${n(h / 2)})${it.flip ? ' scale(-1 1)' : ''}` : `translate(${n(it.x)} ${n(it.y)}) rotate(${n(it.rot || 0)})${it.flip ? ' scale(-1 1)' : ''}`;
  const op = (it.opacity ?? 1) < 1 ? ` opacity="${n(it.opacity)}"` : '';
  const blend = it.blend === 'multiply' ? ' style="mix-blend-mode:multiply"' : '';
  const g = (inner) => `<g transform="${tf}"${op}${blend}>${inner}</g>`;
  const picture = () => {
    const k = Math.min(dpi / 2.54, 12000 / Math.max(w, h));
    const cv = itemRaster(it, assets, k, null, 12000);
    return { svg: g(`<image x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none" href="${cv.toDataURL('image/png')}"/>`), kind: 'picture' };
  };
  if (needsRaster(it)) return picture();
  if (it.type === 'shape') {
    const rec = new PathRecorder(); shapePath(rec, it.shape, w, it.h);
    const lw = (it.thick || 3) / 10;
    const gr = shapeGradient(it), gid = `g${++uidN}`;
    const defs = !gr ? '' : gr.type === 'radial'
      ? `<defs><radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${n(gr.r)}">${gr.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</radialGradient></defs>`
      : `<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(gr.x1)}" y1="${n(gr.y1)}" x2="${n(gr.x2)}" y2="${n(gr.y2)}">${gr.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`;
    const col = gr ? `url(#${gid})` : it.color;
    const paint = isLine(it.shape) || it.outline
      ? `fill="none" stroke="${col}" stroke-width="${n(lw)}" stroke-linejoin="round" stroke-linecap="round"${it.dashed || it.shape === 'dashed' ? ` stroke-dasharray="${n(lw * 3)} ${n(lw * 2.2)}"` : ''}`
      : `fill="${col}"`;
    return { svg: g(`${defs}<path d="${rec}" ${paint}/>`), kind: 'vector' };
  }
  if (it.type === 'text') {
    const ft = await fontFor(it);
    if (!ft) return picture();
    const L = layoutText(it), { font, synthItalic } = ft, s = L.TF / font.unitsPerEm, k = w / L.W;
    const mid = (font.ascender + font.descender) / 2 * s; // canvas "middle" baseline
    let paths = '';
    for (const gl of L.glyphs) {
      if (!gl.ch.trim()) continue;
      const adv = font.charToGlyph(gl.ch).advanceWidth * s;
      const dx = gl.mode === 'centre' ? -adv / 2 : 0, dy = gl.mode === 'centre' ? mid : 0;
      const d = font.getPath(gl.ch, 0, 0, L.TF).toPathData(2);
      if (!d) continue;
      paths += `<path transform="translate(${n(gl.x)} ${n(gl.y)})${gl.rot ? ` rotate(${n(gl.rot * 180 / Math.PI)})` : ''} translate(${n(dx)} ${n(dy)})${synthItalic ? ' skewX(-12)' : ''}" d="${d}"/>`;
    }
    const stroke = L.strokePx ? ` stroke="${it.strokeColor || '#000'}" stroke-width="${n(L.strokePx * 2)}" stroke-linejoin="round" paint-order="stroke"` : '';
    return { svg: g(`<g transform="scale(${n(k)}) translate(${n(-L.W / 2)} ${n(-L.H / 2)})" fill="${it.color || '#111'}"${stroke}>${paths}</g>`), kind: 'vector' };
  }
  // SVG picture: the original file, nested, with its crop
  const text = decodeSvg(assets[it.vec.asset]);
  const size = svgSize(text); if (!size) return picture();
  const [vx, vy, vw, vh] = size.viewBox, c = it.crop || { x: 0, y: 0, w: 1, h: 1 };
  const pre = `p${++uidN}-`;
  const doc = new DOMParser().parseFromString(prefixIds(text, pre), 'image/svg+xml'), el = doc.documentElement;
  el.setAttribute('x', n(-w / 2)); el.setAttribute('y', n(-h / 2)); el.setAttribute('width', n(w)); el.setAttribute('height', n(h));
  el.setAttribute('viewBox', `${n(vx + c.x * vw)} ${n(vy + c.y * vh)} ${n(c.w * vw)} ${n(c.h * vh)}`);
  el.setAttribute('preserveAspectRatio', 'none'); el.setAttribute('overflow', 'hidden');
  return { svg: g(new XMLSerializer().serializeToString(el).replace(/<\?xml[^>]*>/, '')), kind: 'vector' };
}
export function decodeSvg(dataUrl) {
  const i = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, i), body = dataUrl.slice(i + 1);
  return meta.includes(';base64') ? new TextDecoder().decode(Uint8Array.from(atob(body), ch => ch.charCodeAt(0))) : decodeURIComponent(body);
}

/** A whole SVG file for one print on its own, at its printed size (cm), scaled by `k` (shirt size). */
export async function printSvg(it, assets, k = 1, title = '') {
  const h = itemHeight(it, assets), { svg, kind } = await itemSvg(it, assets, { alone: true });
  return {
    kind,
    text: `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(it.w * k)}cm" height="${n(h * k)}cm" viewBox="0 0 ${n(it.w)} ${n(h)}">${title ? `<title>${escXml(title)}</title>` : ''}${svg}</svg>`,
  };
}

/* ---------------------------------------------------------------- PDF pictures stay vector */
let PDFLib = null;
const dataBytes = (dataUrl) => Uint8Array.from(atob(dataUrl.split(',')[1]), ch => ch.charCodeAt(0));
/** A one-page PDF of a PDF/Illustrator picture at its printed size, still vector, with its crop and mirror. */
export async function printPdf(it, assets, k = 1) {
  PDFLib = PDFLib || await import('../vendor/pdf-lib.esm.min.js');
  const src = await PDFLib.PDFDocument.load(dataBytes(assets[it.vec.asset]), { ignoreEncryption: true });
  const page = src.getPage(0);
  const mb = page.getMediaBox(); // { x, y, width, height } in points
  const pc = it.vec.page || { x: 0, y: 0, w: 1, h: 1 }, c = it.crop || { x: 0, y: 0, w: 1, h: 1 };
  const fx = pc.x + c.x * pc.w, fy = pc.y + c.y * pc.h, fw = c.w * pc.w, fh = c.h * pc.h; // fraction of the page
  const box = { left: mb.x + fx * mb.width, right: mb.x + (fx + fw) * mb.width, top: mb.y + (1 - fy) * mb.height, bottom: mb.y + (1 - fy - fh) * mb.height };
  const out = await PDFLib.PDFDocument.create();
  const emb = await out.embedPage(page, box);
  const W = it.w * k / 2.54 * 72, H = itemHeight(it, assets) * k / 2.54 * 72;
  const pg = out.addPage([W, H]);
  pg.drawPage(emb, it.flip ? { x: W, y: 0, xScale: -W / emb.width, yScale: H / emb.height } : { x: 0, y: 0, width: W, height: H });
  out.setTitle(it.name || 'print'); out.setProducer('Design Master'); out.setCreator('Design Master');
  return out.save();
}
export const isVectorPdf = (it) => it.type === 'image' && it.vec?.kind === 'pdf' && !colourAdjusted(it) && !it.halftone && !it.distress;
