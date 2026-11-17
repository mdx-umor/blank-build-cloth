# Design Master

Browser studio for apparel mockups: design on a real sewing pattern, see it live on a 3D garment,
export catalogue renders, print files, spec sheets, sublimation panels and turntable videos.

Live: https://mdx-umor.github.io/blank-build-cloth/

Static site, no build step. Run locally:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000/app/

Full function list and parity status: [docs/feature-parity.md](docs/feature-parity.md)

## Code map
- `app/js/main.js` – app state, selection, editing commands, inspector (Design / Fabric / Scene), keyboard
- `app/js/editor.js` – 2D sewing-pattern editor (rulers, multi-select, shape drawing, inside view)
- `app/js/atlas.js` – compositor: fabric, artwork, text, shapes, image tools (crop, hue, halftone…)
- `app/js/scene.js` – 3D studio: lights, HDRI, gobos, wrap-over-seams bake, catalogue render, video
- `app/js/mesh.js` – turns pattern panels into the 3D garment, fold shadows (AO)
- `app/js/garments.js` – parametric garments, real-model garments, presets, label shapes
- `app/js/fabric.js` – knit normal maps, washes, materials
- `app/js/exports.js` – render dialog, print files, spec sheet PDF, sublimation, video, mockups
- `app/js/panels.js` – Your files, crop, models picker, quick tour
- `app/js/store.js` – IndexedDB (autosave + Your files)
- `tools/model-import/` – convert cloth-sim garments (.blend) into GLB + sewing pattern
