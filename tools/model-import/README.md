# Importing a real 3D garment

Works with cloth-sim garments (Marvelous Designer / CLO exports) whose **UVs are the sewing pattern**.

1. Convert (Blender 4, headless) — writes `model.glb` + `islands.json`:
   `blender -b garment.blend --python convert.py -- "<mesh object name>" out/`
2. Trace the pattern pieces from the UV islands (needs `opencv-python-headless`):
   `python3 trace.py out/islands.json out/pieces.traced.json`
3. Name the pieces, write `pieces.json`:
   `python3 assemble.py out/pieces.traced.json names.json app/models/<id>/pieces.json`
4. Compress: `npx @gltf-transform/cli meshopt out/model.glb app/models/<id>/model.glb`
5. Add `presets` + `bbox3d` to `pieces.json`, a `thumb.png`, and an entry in `GARMENT_LIST`
   (`app/js/garments.js`) with `model: 'models/<id>/'`.

## Garments without a sewing pattern (no UVs, e.g. AI-generated models)
`hoodie_build.py` cuts such a model into a hoodie's panels and flattens each one (Blender 4, headless):
`blender -b model.blend --python hoodie_build.py -- <object> out/ <decimate-ratio> [labels-only]`
It finds the outside vs the lining (rays to the sky), the panels (fronts at the zip, back, sleeves at a dropped
shoulder, cuffs, waistband ×3, hood halves), the drawcords (whatever stands 3 mm proud of the front) and the zip,
opens tube-shaped panels along their shortest line, flattens them (ABF), stands them upright, and writes `model.glb`
+ `islands.json` for `trace.py`. The cut lines are tuned for a zip hoodie; the pieces are rougher than a real pattern,
so an export that carries the pattern as UVs (Marvelous Designer / CLO / Style3D) is always better.

### With a screenshot of the real pattern (how the zip hoodie was made)
When the model has no UVs but you have a screenshot of its pattern (Marvelous Designer / CLO 2D window):
1. `blender -b model.blend --python hoodie_build.py -- <object> out/ <decimate-ratio> cut` → `panels.json`, `labels.json`, `cut.blend`
2. `python3 trace_screenshot.py shot.png traced.json <x0 y0 x1 y1 of the 2D window>` — traces the pieces; the 10 cm grid
   gives the scale
3. `pairs.json`: which traced piece is which panel (and its label), pockets, presets — see the zip hoodie's in git history
4. `python3 fit_panels.py panels.json traced.json pairs.json shot.png fit.json pieces.json` — each 3D panel keeps its
   own flat shape, is scaled to the pattern, anchored by a seam (zip edge, centre back, shoulder point, face opening)
   and tucked inside the piece; rib bands are laid along their length; what lies in a pocket outline goes to the pocket
5. `blender -b out/cut.blend --python apply_fit.py -- <object> out/ model-raw.glb`, then
   `npx @gltf-transform/cli meshopt model-raw.glb app/models/<id>/model.glb`; add `bbox3d` (printed) to `pieces.json`
