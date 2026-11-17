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
