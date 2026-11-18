// Design Master — picture import. PNG, JPG, WebP and GIF come in as pictures. SVG, PDF and Illustrator files
// (with PDF inside) are kept as vectors: the original file travels with the design and goes into the print
// files as vector, while a sharp picture of it is shown on the pattern and the 3D garment.
import { makeCanvas, loadImage, readFileAsDataURL } from './util.js';

export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.ai,.eps';
export const MSG = {
  eps: 'EPS files can’t be opened here. Save it as PDF or SVG (in Illustrator: File → Save As) and upload again.',
  aiOld: 'This Illustrator file has no PDF inside. Save it again with “Create PDF Compatible File” on, or as PDF or SVG, and upload again.',
  pdfFail: 'This PDF couldn’t be opened. Save it again as PDF or SVG and upload again.',
  svgBig: 'This file is too large to keep as a vector: it stays a sharp picture.',
  notImage: 'That file is not a picture. Use PNG, JPG, WebP, SVG, PDF or AI.',
};
export class ImportError extends Error {}

const SVG_MAX_BYTES = 3e6;   // bigger SVGs are kept as a sharp picture only
const SHOW_PX = 4000;        // long side of the picture shown for a vector
const PIC_MAX = 8000;        // long side kept for pictures

const ext = (f) => (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
async function head(file, n = 8) { return new Uint8Array(await file.slice(0, n).arrayBuffer()); }
const startsWith = (b, s) => [...s].every((ch, i) => b[i] === ch.charCodeAt(0));
const bufToDataURL = (buf, type) => readFileAsDataURL(new Blob([buf], { type }));

/** What kind of file is this? 'picture' | 'svg' | 'pdf' | 'eps' | 'ai-old' | 'project' | null */
export async function sniff(file) {
  const e = ext(file), b = await head(file);
  if (file.type === 'application/json' || e === 'dmproj' || e === 'json') return 'project';
  if (e === 'eps' || startsWith(b, '%!PS') || (b[0] === 0xC5 && b[1] === 0xD0 && b[2] === 0xD3 && b[3] === 0xC6)) return 'eps';
  if (startsWith(b, '%PDF')) return 'pdf';
  if (e === 'ai') return 'ai-old';
  if (e === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (e === 'svg' || file.type === 'image/svg+xml') return 'svg';
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e)) return 'picture';
  return null;
}

/** Read a picture file. Returns { src, w, h, name, vec?, note? } or throws ImportError with a message for the user. */
export async function readPicture(file) {
  const kind = await sniff(file);
  const name = file.name.replace(/\.[^.]+$/, '') || 'image';
  if (kind === 'eps') throw new ImportError(MSG.eps);
  if (kind === 'ai-old') throw new ImportError(MSG.aiOld);
  if (kind === 'pdf') return { name, ...(await readPdf(file)) };
  if (kind === 'svg') return { name, ...(await readSvg(file)) };
  if (kind !== 'picture') throw new ImportError(MSG.notImage);
  let src = await readFileAsDataURL(file);
  const img = await loadImage(src).catch(() => { throw new ImportError(MSG.notImage); });
  let w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
  if (Math.max(w, h) > PIC_MAX) { const cv = scaled(img, w, h, PIC_MAX); src = cv.toDataURL('image/png'); w = cv.width; h = cv.height; }
  return { name, src, w, h };
}

function scaled(img, w, h, max) {
  const k = max / Math.max(w, h), cv = makeCanvas(w * k, h * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

/* ---------------------------------------------------------------- SVG */
// size of an SVG in its own units, from width/height or the viewBox
export function svgSize(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const el = doc.documentElement;
  if (!el || el.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  const vb = (el.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const len = (v) => { const m = String(v || '').match(/^([\d.]+)\s*(px|pt|mm|cm|in)?$/); if (!m) return 0; const k = { px: 1, pt: 4 / 3, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[m[2] || 'px']; return +m[1] * k; };
  let w = len(el.getAttribute('width')), h = len(el.getAttribute('height'));
  if (vb.length === 4 && vb.every(Number.isFinite)) { if (!w && !h) { w = vb[2]; h = vb[3]; } else if (!w) w = h * vb[2] / vb[3]; else if (!h) h = w * vb[3] / vb[2]; }
  return { w: w || 300, h: h || 300, viewBox: vb.length === 4 ? vb : [0, 0, w || 300, h || 300] };
}
// make sure the SVG scales to whatever box it is drawn in (some files only carry width/height)
export function normaliseSvg(text) {
  const size = svgSize(text); if (!size) return null;
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), el = doc.documentElement;
  if (!el.getAttribute('viewBox')) el.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
  el.setAttribute('width', size.w); el.setAttribute('height', size.h);
  if (!el.getAttribute('xmlns')) el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { text: new XMLSerializer().serializeToString(doc), ...size };
}
async function readSvg(file) {
  const raw = await file.text();
  const norm = normaliseSvg(raw);
  if (!norm) throw new ImportError('This SVG couldn’t be opened. Save it again as SVG or PDF and upload again.');
  const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(norm.text);
  const img = await loadImage(svgUrl).catch(() => { throw new ImportError('This SVG couldn’t be opened. Save it again as SVG or PDF and upload again.'); });
  const cv = scaled(img, norm.w, norm.h, SHOW_PX);
  const src = cv.toDataURL('image/png');
  if (file.size > SVG_MAX_BYTES) return { src, w: cv.width, h: cv.height, note: MSG.svgBig };
  return { src, w: cv.width, h: cv.height, vec: { kind: 'svg', data: svgUrl, size: [norm.w, norm.h] } };
}

/* ---------------------------------------------------------------- PDF / Illustrator (page 1) */
let pdfjs = null;
export async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}
/** Render page 1 of a PDF (data: URL or bytes) so its long side is `px`; transparent where the page is empty. */
export async function renderPdf(data, px = SHOW_PX) {
  const lib = await loadPdfJs();
  const bytes = typeof data === 'string' ? Uint8Array.from(atob(data.split(',')[1]), c => c.charCodeAt(0)) : data;
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: px / Math.max(base.width, base.height) });
    const cv = makeCanvas(vp.width, vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    return { cv, pt: [base.width, base.height] };
  } finally { doc.destroy(); }
}
async function readPdf(file) {
  const buf = await file.arrayBuffer();
  let r;
  try { r = await renderPdf(new Uint8Array(buf.slice(0))); } catch (e) { console.warn(e); throw new ImportError(MSG.pdfFail); }
  // a logo on a big page: keep just the artwork (the crop is kept with the vector too)
  const box = opaqueBox(r.cv);
  if (!box) throw new ImportError(MSG.pdfFail);
  const { cv } = r, pad = Math.round(Math.max(cv.width, cv.height) * 0.004);
  const x0 = Math.max(0, box.x0 - pad), y0 = Math.max(0, box.y0 - pad), x1 = Math.min(cv.width, box.x1 + pad), y1 = Math.min(cv.height, box.y1 + pad);
  const out = makeCanvas(x1 - x0, y1 - y0);
  out.getContext('2d').drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
  const pageCrop = { x: x0 / cv.width, y: y0 / cv.height, w: (x1 - x0) / cv.width, h: (y1 - y0) / cv.height };
  return { src: out.toDataURL('image/png'), w: out.width, h: out.height, vec: { kind: 'pdf', data: await bufToDataURL(buf, 'application/pdf'), size: r.pt, page: pageCrop } };
}
// bounding box of the non-transparent pixels, or null if the picture is empty
export function opaqueBox(cv) {
  const W = cv.width, H = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
