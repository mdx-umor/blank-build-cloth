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
