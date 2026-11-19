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

Clean seams: before anything is labelled, the mesh is cut along the straight seam lines (zip edges, centre line,
waistband and cuff tops, side seams, armholes, hood neckline), each only where it is a seam, so no triangle straddles
a seam and every piece ends on a straight line instead of a zigzag along the triangles (vertex normals are carried
over, so the cuts don't show in the shading). Where the hood lies on the back, a face is hood when more of the outside
of the garment lies right behind it; the line between them is then the hood's real rim. Drawcords keep only what lies
along a smooth line; loose bits of the body's sides under the arms go to the front/back.

### With a screenshot of the real pattern (how the zip hoodie was made)
When the model has no UVs but you have a screenshot of its pattern (Marvelous Designer / CLO 2D window):
1. `blender -b model.blend --python hoodie_build.py -- <object> out/ <decimate-ratio> cut` → `panels.json`, `labels.json`, `cut.blend`
2. `python3 trace_screenshot.py shot.png traced.json <x0 y0 x1 y1 of the 2D window>` — traces the pieces; the 10 cm grid
   gives the scale
3. `pairs.json`: which traced piece is which panel (and its label), pockets, presets — see `examples/hoodie-zip.pairs.json`
4. `python3 fit_panels.py panels.json traced.json pairs.json shot.png fit.json pieces.json` — each 3D panel keeps its
   own flat shape, is scaled to the pattern, anchored by a seam (zip edge, centre back, shoulder point, face opening)
   and tucked inside the piece; rib bands are laid along their length; the pocket outline is marked on its front
   (prints run over it; only if `pairs.json` also lists a pocket piece does the surface inside go to that piece)
5. `blender -b out/cut.blend --python apply_fit.py -- <object> out/ model-raw.glb`, then
   `npx @gltf-transform/cli meshopt model-raw.glb app/models/<id>/model.glb`; add `bbox3d` (printed) to `pieces.json`

## Pattern cutter: the owner marks the pieces (`app/cutter/`)
When the rules above don't cut a model the way its pattern is cut, the owner draws the cut on the 3D model in the
**Pattern cutter** (Design Master → model picker → "Pattern cutter", or `app/cutter/?model=hoodie-zip`):
- **Draw seam**: click points on the surface; between two points the cut is the plane through both points standing
  upright on the surface, cut with the surface joined to them (shown live). Click the first point to close a loop.
  Mirror left ↔ right draws the twin seam on the other side.
- **Fill piece**: pick a piece, click inside it: it fills up to the seams (on the side clicked: outside or lining).
- **Brush**: paints triangles (rough edge); **Erase**: seams, fills, brush paint.
- **Copy for Claude** / **Save file**: a small JSON (`format: design-master-cut`): seam points, one point per fill, brush
  strokes, all as points on the surface (Blender axes, metres), so it does not depend on triangle numbers.

The cutter's model is the uncut work mesh: `hoodie_build.py ... <ratio> work` writes `work.glb` (materials Outside /
Inside from the outside/lining detection) and `work-auto.json` (the rules' cut, to compare with). Copy them to
`app/cutter/models/<id>.glb` and `<id>-auto.json` and add the model to `MODELS` in `app/cutter/cutter.js`.

To use a cut: `blender -b model.blend --python hoodie_build.py -- <object> out/ <ratio> cut --usercut cut.json`
(same object and ratio as the work mesh). It cuts the mesh exactly along each seam segment (same plane, same reach as
the cutter shows), fills each piece from its point without crossing a seam, applies the brush strokes, and carries on
as usual (flatten, then `fit_panels.py` / `apply_fit.py`). Pieces with ids from `pairs.json` are fitted to the traced
pattern; `--debug-seams` lists loose seam ends (a gap in a seam loop shows up there).

A cut that covers only some pieces: `--usercut cut.json --usercut-pieces sleeveL,sleeveR,cuffL,cuffR,pocketL,pocketR`
takes just those pieces from the owner's cut and the rules' cut for everything else (both sets of seams are cut; where
the rules gave a face one of those pieces but the owner did not, it takes the nearest piece around it). A pocket cut
this way is its own panel; it is flattened together with its front (it is sewn on top of it) and then fitted to the
pocket piece of the pattern (`pairs.json` lists `pocketL`/`pocketR` pieces). The cutter warns when one fill covers more
than a third of the garment: that is a seam that isn't closed, and such a piece should be left out of the list.
