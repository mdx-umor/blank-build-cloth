# Deep study of blankbuilder.app (November 2026)

How the reference app is built and how each function behaves, found with **Craft Anything** (deep mode) and a
hands-on walkthrough with real files. Their code was not copied: the main app script is obfuscated and locked to
their domain, so it was not deobfuscated or reused. Everything in Design Master is our own code, built from the
observed behaviour and the visible wording.

Tooling: `tools/craft-study/` on branch `claude/craft-anything-tool` (MCP driver, capture steps, behaviour
walkthrough). Raw captures stay local in `.craft/` (git-ignored) because they contain the reference's files.

## How it is made
| Part | What they use |
|---|---|
| 3D | three.js (ES modules) with GTAO ambient occlusion + Poisson denoise post-processing, RGBE (HDR) loader, simplex noise; garments are pre-made models (`garments/<id>/` with thumbnails, normal maps, knit masks); a GPU path tracer is loaded only for catalogue renders on your own computer |
| Picture import | pdf.js (`pdfjs/pdf.min.mjs` + worker) to open PDF and Illustrator files |
| Print files | pdf-lib to write vector PDFs; their own SVG writer (clip paths, outlined letters) |
| Video | WebCodecs H.264 encoder, MP4 muxer with in-memory fast start; WebM muxer as fallback |
| Accounts / cloud | Supabase (log in, saved projects, cloud renders), Google sign-in, Facebook sign-in |
| Payments | Paddle (checkout, local currency) + ProfitWell (retention) |
| Analytics | Google Analytics, Cloudflare Insights, Facebook pixel, a cookie consent banner |
| Paid AI tools | `api/vectorize` and `api/upscale` (credits per image) |

## Plans seen in the app (for the website/payment phase)
| Plan | Price | Includes |
|---|---|---|
| Basic | $11.99 / month | Short-sleeve T-shirts, 10 images a design, 30 HD exports a month, no watermark, 3 cloud renders (Good, up to 2500 px), 10 saved projects |
| Pro (most popular) | $28.99 / month | All garments, 50 images, 150 HD exports, 50 cloud renders up to 3000 px, unlimited renders on your own computer, Halftone for DTF prints, 60 saved projects |
| Ultra | $58.99 / month | All garments, unlimited images and HD exports, 300 cloud renders up to 3840 px, unlimited own-computer renders, Halftone, unlimited saved projects, priority support |

Yearly billing saves up to 34%. Exports (print files, spec sheet, sublimation, video) ask you to log in first; Halftone
opens the plans window on the free tier.

## Behaviour observed with real files
- **File picker** accepts `image/*, .svg, .pdf, .ai, .eps, application/pdf`, several at once.
- **PNG**: placed on the chest at 26 cm wide, selected; a floating “Selected item” card opens over the 3D view.
- **SVG** and **PDF** stay vector: no Vectorize/Upscale offered for them, not listed as blurry in exports. A PDF
  logo on a bigger page is trimmed to the artwork.
- **Crop**: in place on the pattern. A small card: “Drag the edges to crop. Drag inside to move the picture.” with
  Trim empty edges · Reset crop · Cancel · Done; a dashed frame with handles on the picture.
- **Print files (ZIP)** dialog: “My shirt is a different size”, then the blurry list (“Front picture: 109 DPI at
  26.2 × 32.7 cm. Too low for a sharp print…”, inside pieces as “Back (inside of the garment) picture”), note “a
  picture needs 300 DPI at its printed size”, Cancel / Download ZIP.
- **Spec sheet (PDF)** dialog: “My shirt is a different size”, Cancel / Download PDF.
- **Sublimation panels (ZIP)** dialog: shirt size, Bleed 5 / **10** / 15 mm, Dashed cut line on the panels,
  Mirror for transfer printing (sublimation, DTF, heat transfer), blurry list (outside pieces only), Cancel /
  Download ZIP.
- **Turntable video**: Format 9:16 Reels / 4:5 Feed / 1:1 Square, One full turn 6 / **8** / 10 s, “Keep this tab
  open while it records.”
- **Catalogue render**: big frame preview on the left with Front / Back / Side / Reset view; settings on the right
  (image size, frame, quality, recommended preset, transparent background, cloud / own-computer render, Save PNG /
  Save WebP).

## Where each finding went in Design Master
| Finding | File |
|---|---|
| PDF / AI / SVG import kept as vector, EPS & old-AI messages | `app/js/importer.js` (+ `app/vendor/pdfjs`) |
| Crop in place | `app/js/editor.js` (`CropSession`), crop bar in `app/index.html` |
| Halftone dialog and engine | `app/js/halftone.js` |
| Vector print files (outlined letters, SVG pictures, vector PDF pictures) | `app/js/vector.js` (+ `app/vendor/opentype.module.js`, `app/vendor/pdf-lib.esm.min.js`) |
| Export options dialog, print files, spec sheet, sublimation | `app/js/exports.js` |
| Frame-by-frame MP4 video | `app/js/scene.js` (`recordTurntable`) (+ `app/vendor/mp4-muxer.mjs`, `webm-muxer.mjs`) |
| Render frame preview | `app/js/exports.js` (`drawPreview`, `bindPreview`) |
| Wash spot size / wash prints, gradient midpoints | `app/js/fabric.js`, `app/js/atlas.js`, `app/js/main.js` |

Libraries added are open source (pdf.js Apache-2.0, pdf-lib MIT, opentype.js MIT, mp4-muxer MIT, webm-muxer MIT);
licences are in `app/vendor/licenses/`. Outlined letters fetch the font file from the Fontsource CDN when you export;
if that fails, the text goes into the print file as a 300 DPI picture instead.

## Still waiting on the owner
Accounts and plans, payment provider (they use Paddle), cloud saving/rendering, languages (EN / FR / RU / 中文),
and whether to offer Vectorize / Upscale (needs a paid AI image service).
