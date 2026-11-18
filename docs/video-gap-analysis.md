# Video gap analysis — original app vs Design Master

Source: owner's screen recording of the original app (`Screen Recording 2026-11-17 at 8.51.01 PM.mov`,
3 min 16 s). Decoded at 30 fps (4,868 frames); ~140 key frames (every screen change + every 2 s) reviewed,
then compared against the live Design Master build (2026-11-18).

## What the video shows (in order)
| Time | What happens in the original |
|---|---|
| 0–20 s | Large print dragged around the Front piece and over the edge toward the Back; 3D updates instantly, print trimmed at the seam. |
| 15–33 s | Fabric swatches clicked one after another (navy, olive, sand, grey, pink, sky, off-white); pattern + 3D recolour instantly, print keeps its look on every colour. |
| 40–90 s | Rectangles laid over sleeve pieces and cuff band to colour-block them. Custom **colour picker popover**: saturation square, hue bar, eyedropper, HEX, R/G/B fields, **Saved colours** row with “+”, Cancel / **Apply colour**. |
| 50–90 s | **Selected item** is a collapsible card floating at the top-left of the 3D view (type dropdown, colour, Solid/Gradient, Outline only, Thickness, Mirror/Copy/Delete, Wrap over seams, Place at). |
| 94–108 s | Free orbit: open sleeves with visible inner fabric, sleeve hem turned up, real drape and wrinkles, textured studio backdrop. |
| 114–180 s | **Inside** view: its own set of pieces — Front·inside, Back·inside, Label, Right/Left sleeve·inside, **Right/Left sleeve hem facing·inside, Hem facing front/back·inside**. Rectangles drawn on the hem facings colour the inner turned-up cuff and body hem in 3D. Shape tool opens an 8-shape popover. |
| 188–196 s | Back to navy; Fabric panel: Material, Fold shadows (AO), Fabric wrinkles, Wrinkles / Texture / Knit size / Brightness / Contrast sliders. |

## Gaps found in Design Master
Priority 1 = most visible to users.

| # | Gap | Original | Design Master today | Priority |
|---|---|---|---|---|
| 1 | 3D realism of the default tee | Draped cloth, visible knit texture, deep folds, turned-up hems, cloth thickness at openings | Smooth, plasticky, pale; few folds; reads as a flat model | 1 |
| 2 | Hem facings (inside pieces) | Sleeve hem facings + front/back hem facings, printable; they colour the inner turn-up in 3D | Not present (tee has 7 pieces, no facings; inside shows only mirrored outer pieces + label) | 1 |
| 3 | Colour picker | Custom popover: SV square, hue, eyedropper, HEX + RGB, saved colours (+), Cancel/Apply | Browser’s native `<input type=color>` + hex text | 1 |
| 4 | Selected item placement | Floating, collapsible card over the 3D view | Section inside the right inspector | 2 |
| 5 | Layers list position | Top of the Design tab, always visible, thumbnails, “· inside” tag | Lower in the Design tab | 2 |
| 6 | Piece count / layout of the tee | 6 outside pieces (neck rib F/B, sleeves, front, back) laid out compactly; label lives on the inside sheet | 6 outside + label; layout taller, pieces overlap the help text at the bottom | 2 |
| 7 | Studio look | Textured grey backdrop, hanger, soft shadows | Plain light-lilac backdrop | 2 |
| 8 | Shape tool | Single toolbar button opening an 8-shape popover | Present (check it matches the popover behaviour) | 3 |
| 9 | Speed | Instant 3D update while dragging and recolouring | Not measured on a real GPU yet — verify | 3 |

## Suggested order of work
1. Hem facings on the inside sheet for tee-type garments, wired to the 3D turn-ups (#2).
2. Custom colour picker popover with saved colours, used everywhere a colour is picked (#3).
3. Tee realism pass: knit texture default on, stronger folds, hem turn-ups, cloth thickness, backdrop (#1, #7). Best result still comes from real owner-supplied T-shirt models.
4. Layout parity: floating Selected-item card, layers at top, compact piece layout (#4–#6).
