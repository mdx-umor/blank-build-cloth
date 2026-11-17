# Design Master

Browser studio for apparel mockups: design on a real sewing pattern, see it live on a 3D garment, export catalogue renders and print-ready files.

Static site, no build step. Run locally:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000/app/

- `app/js/garments.js` – parametric garments (pattern pieces + 3D panels from measurements)
- `app/js/mesh.js` – inflates pattern panels into the 3D garment (Three.js)
- `app/js/atlas.js` – compositor: fabric, artwork, text, shapes (pattern sheet = 3D texture)
- `app/js/fabric.js` – procedural knit normal maps, washes, tie-dye, heather
- `app/js/scene.js` – studio lights, window-light gobos, progressive catalogue render
- `app/js/editor.js` – 2D pattern editor
- `app/js/main.js` – app state, inspector, undo/redo, autosave, exports
