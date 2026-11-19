# Feature parity checklist — original vs Design Master

Legend: ✅ works like the original · ➕ Design Master extra · ⏸ later (accounts, payments, AI credits, languages)

## Header / project
| Function | Design Master |
|---|---|
| Back to home page | ✅ |
| Garment name + cut shown | ✅ |
| View: Sewing pattern / Split / 3D (keys 1 2 3) | ✅ |
| Day / night mode | ✅ |
| Quick tour (6 steps, next / back / skip, dots) | ✅ |
| Undo / redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y) | ✅ |
| New design (clears artwork; undo brings it back) | ✅ |
| Your files: save (Ctrl+S), open, rename, copy, download, delete | ✅ stored in this browser (cloud with accounts ⏸) |
| 3D snapshot button | ✅ |
| Export → Catalogue render | ✅ |
| More exports: Print files ZIP — options dialog: “My shirt is a different size” (front width, scales prints and positions, range check), Files: Original (vector SVG/PDF, text as outlined letters, pictures PNG) or PNG only (300 DPI), blurry-picture list (below 150 DPI), README notes (turned, runs past the edge, low DPI, inside, wrap) | ✅ |
| More exports: Spec sheet PDF — Project, Garment, Colour, Date, Units, Size; per piece: drawing at scale 1:n, Size, From top, Centre line (centred / to the left / right), Quality (DPI or vector), continued pages, page n of m | ✅ |
| More exports: Sublimation panels ZIP — shirt size, Bleed 5 / 10 / 15 mm, dashed cut line, mirror for transfer printing, DPI chosen for this browser, blurry-picture list, “Preparing panel n of m” | ✅ |
| More exports: Turntable video (9:16 / 4:5 / 1:1, 6 / 8 / 10 s) — rendered frame by frame and encoded to H.264 MP4 (WebCodecs, fast start); WebM with the original's note where MP4 isn't possible; Save video | ✅ |
| Mockup sheet, all views, colourways, pattern PNG, project file | ➕ |
| Language EN / FR / RU / 中文 | ⏸ |
| Log in / plans / cloud render | ⏸ |

## Sewing pattern
| Function | Design Master |
|---|---|
| Piece count | ✅ |
| Outside / Inside (inside pieces incl. label; prints inside, mirrored like the original) | ✅ |
| Tools: Select, Hand, Image, Text | ✅ |
| Shapes tool: icon grid (Rectangle, Square, Circle, Triangle, Star, Diamond, Line, Dashed line); drag to draw — may start off the piece (e.g. a rectangle over the thin neck rib to colour it), it goes on the piece it covers; Shift keeps even, Esc cancels | ✅ (+ rounded, heart, badge ➕) |
| Units mm / cm / in | ✅ |
| Rulers (top + left, in the chosen unit) | ✅ |
| Zoom − / % / + / Fit / Pattern markings | ✅ |
| Scroll zoom, right-drag or Space pan, double-click fit | ✅ |
| Ctrl = no snapping, Alt+drag = copy, Ctrl+D = copy | ✅ |
| Rotate by dragging outside a corner | ✅ |
| Position readout "x × y from corner" while moving | ✅ |
| Multi-select: Shift-click, selection box, Ctrl+A; move / align / copy / delete together | ✅ |
| Prints trimmed at piece edge | ✅ |
| Drop / paste images (pattern or 3D) | ✅ |
| Piece labels "w × h · cut 1", centre lines | ✅ |

## 3D preview
| Function | Design Master |
|---|---|
| Quality: Adaptive / Full / Half / Quarter | ✅ |
| Front / Back / Side (+ ¾ ➕) | ✅ |
| Model picker: search, category filters, grid / list | ✅ |
| Auto-rotate, Reset view, double-click recentre | ✅ |
| Quick toggles: Neck label, Hanger | ✅ |
| Live preview indicator, "It's 3D — move it" hint | ✅ |
| 3D preview is for viewing only (drag turns the garment; prints are placed on the pattern) | ✅ |

## Selected item
| Function | Design Master |
|---|---|
| Width / Height (linked) / Rotation / Opacity numbers, position from centre/top | ✅ |
| ↺ 90° / ↻ 90°, Align to piece (6) | ✅ |
| Mirror, Copy, Delete, Forward / Backward | ✅ |
| Image: Invert, Hue, Saturation, Fill with colour (+ eyedropper), Reset colours | ✅ |
| Image: Crop in place on the pattern (drag edges, drag the picture inside, Trim empty edges, Reset crop, Cancel, Done; “No empty edges to trim”) | ✅ |
| Import: PNG / JPG / WebP / GIF; SVG, PDF and Illustrator (.ai with PDF inside) kept as vector; EPS / old AI / broken PDF messages; very large SVG kept as a sharp picture; “Preparing image…”, paste tip | ✅ |
| Image: Halftone dialog — styles Classic, Colour dots, Palette (auto or own colours), One colour (ink colour), Comic (CMYK), Fade; shapes Dots, Lines, Engraving, Crosshatch, Diamonds, Squares, Circles, Grain; size Large / Medium / Fine; angle; contrast; shirt shows in Dark / Light / Nowhere; stays solid Light / Dark; preview with zoom & pan; low-resolution note; Apply / Remove / Reset | ✅ (Pro plan feature in the original) |
| Wrap over seams (print continues across seams, baked from 3D) | ✅ |
| Place at: Chest, Left chest logo, Front bottom, Back, Back neck, Right sleeve, Left sleeve, Label, Printed label | ✅ |
| Text: font, weight 100–900, colour + eyedropper, Bold / Italic / ALL CAPS, paragraph, line height, letter spacing | ✅ (+ curve, outline ➕) |
| Shape panel: shape dropdown, colour + eyedropper, Colour Solid / Gradient (second colour, linear / radial, angle, swap colours), outline only, thickness mm, dashed | ✅ |
| Layers: eye toggle, thumbnail, type ("· inside"), drag order, + button | ✅ (+ lock ➕) |
| Image: Vectorize / Upscale (AI) | ⏸ needs an AI service |
| Trim edges, remove background, print-quality DPI, distress, soft ink | ➕ |

## Fabric / appearance
| Function | Design Master |
|---|---|
| Swatches + custom colour + eyedropper | ✅ |
| Solid / multi-stop gradient (up to 5 stops, add by clicking under the bar, drag away to remove, swap) | ✅ (+ radial, direction ➕) |
| Washes: Acid, Bleach, Caustic, Enzyme stone, Ice, Laser, Mineral, Permanganate spray, Snow, Stone, Vintage | ✅ (+ bleach splatter, tie-dye, crumple, dip-dye ➕) |
| Materials: Cotton, Cotton blend, Fleece, Interlock, Piqué, Rib, Sport knit, Waffle, Athletic mesh | ✅ (+ heavyweight, canvas, denim ➕) |
| Fold shadows (AO) | ✅ |
| Fabric wrinkles on/off + amount, Texture, Knit size | ✅ |
| Brightness, Contrast | ✅ |
| Default settings: reset to saved / save as default / factory | ✅ |
| Colour blocking per part, heather | ➕ |

## Scene
| Function | Design Master |
|---|---|
| Studio HDRI on/off, intensity, rotation | ✅ |
| Studio backdrop on/off; the backdrop is a full-resolution picture fixed on screen (colour × backdrop light, deeper tone of the colour in the shadows, soft studio fall-off) while the garment is turned, zoomed or moved; the backdrop light falls on the backdrop only | ✅ |
| Shadow on the backdrop (off by default): moves, turns and zooms with the garment, in a deeper tone of the backdrop colour | ✅ |
| Your own light picture: any image becomes the backdrop light, tinted by the backdrop colour | ➕ |
| Backdrop colours: the original's 17 + custom + eyedropper | ✅ |
| Backdrop colours + custom + eyedropper | ✅ |
| Backdrop light presets, as in the original: None, Window, Beam, Blinds, Soft blinds, Window blinds, Arched window, Window & leaves, Light stripes, Leaf shadows (default), Palm fronds, Fan palm, Branches, Spotlight, Light & shade (+ Round window ➕); 🎃 Halloween: Spider web, Pumpkins · glow, Bats, Bare branches, Gothic windows, Jack-o’-lantern faces; 🎄 Christmas: Pine window, Frost on glass, Dense spruce, Spruce frame, Garland & fir, Arched / Round / Leaded window · frost, Winter forest; Invert light | ✅ |
| Backdrop brightness, contrast | ✅ |
| Key light: side, height, power (+ softness, ambient ➕) | ✅ |
| Hanger show + colours + custom | ✅ |
| Neck label, label shape (Small woven, Wide, Square, Tall satin, Loop fold), label colour / same as shirt, printable label | ✅ |
| Auto-rotate, Pattern markings | ✅ |

## Catalogue render
| Function | Design Master |
|---|---|
| Recommended preset, frame (as in 3D / front / back / side), sizes, quality | ✅ |
| Transparent background (studio light kept) | ✅ |
| Start / Stop, progress, save PNG / WebP (+ JPEG ➕) | ✅ |
| Cloud render with plan limits | ⏸ |

## Added after the deep study (behaviour walkthrough of the original, Nov 2026)
| Function | Design Master |
|---|---|
| Catalogue render: live frame preview, Front / Back / Side / Reset view over it, drag to turn, scroll to zoom | ✅ |
| Wrap over seams: “Extra past the seams” (bleed of each part's file), message when the design is not on a front/back/sleeve/hood/pocket | ✅ |
| Wash: Spot size, Wash the prints too, Another pattern | ✅ |
| Gradient: draggable midpoints between colours | ✅ |
| Vector pictures show “Vector · sharp at any size” instead of DPI | ✅ |
| Real 3D model: Zip hoodie (owner's model + the pattern from the owner's screenshot: fronts with zip, back, sleeves, cuffs, 3-part waistband, hood halves; sleeves, cuffs and pockets as cut by the owner in the Pattern cutter (pockets are their own pieces, outlines marked on the fronts); seams cut on straight lines; rib knit on cuffs and waistband; zip in the fabric colour unless chosen, colourable drawcords) | ➕ |
| Pattern cutter (`app/cutter/`): draw a 3D model's seams on the surface, fill its pieces, brush, mirror left/right, undo, autosave, Claude's automatic cut to compare, export as a small cut file (Copy for Claude); the converter cuts exactly along those seams | ➕ |
