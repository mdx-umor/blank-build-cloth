# Design Master — handoff notes (for the next session)

Written at the end of the first (cloud) session, 2026-11-18. Read this first.

## What this project is
**Design Master** is a browser studio for apparel mockups. You place artwork on a real sewing pattern
(2D editor), it shows live on a 3D garment (Three.js), and you export renders, print files, spec sheets,
sublimation panels and videos. It is modelled on the **functions and use cases** of
https://blankbuilder.app/app/ (the owner's reference product), built with our own code, our own name and logo.
Their code, 3D models and branding were **not** copied.

- Repo: `mdx-umor/blank-build-cloth`, branch **`claude/admiring-shannon-swed86`** (currently the default branch; no `main` yet)
- Live (GitHub Pages, auto-deploys from that branch in ~1–2 min): https://mdx-umor.github.io/blank-build-cloth/
- Static site, no build step: `python3 -m http.server 8000` from the repo root → http://localhost:8000/app/

## What the owner wants (preferences learned)
- **Functions and use cases must match the original exactly** ("copy every function"). UI looks are secondary;
  the owner disliked my first UI attempt — when unsure how something should behave, check the original.
- 3D garments must look **realistic** (draped cloth with folds, open sleeves/hem, visible inside), not flat/pillowy.
- The owner can supply **real 3D garment models** (Blender / Marvelous Designer) — they want those used.
- Next phases the owner will define: **the website, payment gateway, accounts/plans** ("then I will tell you
  how the website, payment gateway etc. will be done").
- Waiting on the owner's answers:
  1. Which **languages** (original has EN / FR / RU / 中文 switcher)?
  2. Accounts / plans / payment provider (also decides cloud saving + cloud rendering)?
  3. Vectorize / Upscale need a paid AI image service — wanted?

## Where things stand
- Every function of the original is implemented and listed in **`docs/feature-parity.md`** (✅ / ➕ extras / ⏸ later).
- **71 automated browser tests pass** (`tests/functional.test.js`, Playwright). Each export was checked to download.
- Not built yet (⏸): log in / plans / payment / cloud render, Vectorize & Upscale (AI), language switcher.
- The complete English UI text of the original (356 strings = its feature list) is in `docs/original-ui-strings.txt`.

## Code map (`app/`)
| File | What it does |
|---|---|
| `index.html`, `css/app.css` | Page shell: header, pattern pane, 3D pane, inspector (Design / Fabric / Scene tabs), dialogs |
| `js/main.js` | App state (`window.DM` for debugging), selection (multi), undo/redo, autosave, inspector rendering + events, garment switching, inside/outside, keyboard |
| `js/editor.js` | 2D pattern editor: rulers, zoom/pan, multi-select + box select, shape drawing, Alt-drag copy, rotate outside corner, inside view (mirrored) |
| `js/atlas.js` | Compositor: the pattern sheet **is** the 3D texture. Fabric fill/gradients/washes, artwork, text raster, shapes, image tools (crop, invert, hue, saturation, fill, halftone) |
| `js/scene.js` | Three.js studio: lights, HDRI (`assets/studio.hdr`), gobos, backdrop, catalogue render (accumulated passes), turntable video (MediaRecorder), **wrap-over-seams GPU bake**, real-model loading (GLB) |
| `js/mesh.js` | Procedural garments → 3D: hollow shells with open edges, Coons-mapped sleeves, folded hems, neck rib, label, fold-shadow AO |
| `js/garments.js` | Parametric garments (tee, V-neck, oversize, women's, crop, long sleeve, baseball, tank, sweatshirt, hoodie, tote) + real-model garments, presets ("Place at"), label shapes |
| `js/fabric.js` | Knit normal maps, materials, washes |
| `js/exports.js` | Render dialog, snapshot, print files ZIP (SVG+PNG+prints+spec), spec sheet PDF (jsPDF), sublimation panels, video, mockup sheet, colourways, pattern PNG |
| `js/panels.js` | Your files (IndexedDB), crop dialog, models picker, quick tour |
| `js/store.js` | IndexedDB: autosave + saved files |
| `vendor/` | three.js r170 (+ OrbitControls, GLTFLoader, RGBELoader, meshopt decoder), JSZip, jsPDF — all vendored, no CDN |
| `models/shirt-ls/` | Real model: long-sleeve button-up shirt (GLB 970 KB + `pieces.json` + thumbnail) |

Key idea: each garment's **pattern pieces map 1:1 onto the 3D UVs**, so artwork placed on the pattern lands exactly on the 3D garment (and vice versa — prints can be dragged on the 3D view).

## Real 3D models (owner-supplied)
- The owner sent `Blender3.2.rar` → `Shirt Long Sleeves.blend` (Marvelous-style cloth sim, 131k polys, UVs = sewing
  pattern) + `Studio HDRI.hdr`. Converted and live as "Long-sleeve shirt" (group "Real 3D models").
- **Missing from the archive:** the `Custom Textures/Shirt Custom Textures/` folder (fabric diffuse + normal maps).
  Our procedural fabric normals are used instead. Ask the owner for that folder if they have it.
- Conversion pipeline: **`tools/model-import/README.md`** (Blender 4 headless → GLB + UV islands → OpenCV contour
  trace → `pieces.json` → gltf-transform meshopt). Needs `blender`, `python3-numpy`, `opencv-python-headless`,
  `@gltf-transform/cli`. Owner should send more models made the same way (T-shirts, hoodies, polos…).
- Licensing: if models come from a paid mockup pack, the owner must check the licence allows use in a paid product.

## Testing notes
- Run: see the header of `tests/functional.test.js` (local server on port 8765 + Playwright).
- Headless Chromium with software GL (swiftshader) is very slow for 3D (view turns ~4 s, video recording minutes) — use long click timeouts there; on a real GPU it's fast.
- Use `window.DM` in the console (`DM.doc`, `DM.selected()`, `DM.studio`, `DM.editor`) to inspect state.
- Gotcha from the cloud session: a shell safety check misread JavaScript `$$(...)` inside shell heredocs as a shell variable — edit such files with an editor tool rather than shell heredocs.

## Ideas / known rough edges
- The procedural garments are good but still less photoreal than sculpted models — real models are the way forward.
- Back-to-home link points to `../` (root redirects to the app) until the website exists.
- Before building the website, consider moving the branch to `main` and using a custom domain.
