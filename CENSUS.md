# SVGCraft — editor census & feature ranking

Before building SVGCraft we surveyed the SVG / vector editors people actually
use, to decide which features count as "table stakes" and which can wait.

**Method.** For each editor we noted whether it has a feature natively
(● full, ◐ partial / limited, ○ absent). The data comes from product knowledge
as of late 2026. A few cells, mostly erasers and freehand tools that vendors
tend to ship quietly, are best-effort. They're good enough for ranking but
shouldn't be quoted as a spec sheet. Then we ranked features by three things:

1. **Prevalence**: how many of the 13 editors ship it. A feature that every
   editor has is one users will look for in the first minute.
2. **Brief**: whether the SVGCraft brief asks for it by name (import, export,
   pencil, pen, eraser, colours, transparency). A named feature is required
   no matter how common it is.
3. **Fit**: how much it's worth to a lightweight, single-page, in-browser
   editor compared with what it costs to build.

## Editors surveyed

| #   | Editor                   | Kind                         |
| --- | ------------------------ | ---------------------------- |
| 1   | Inkscape 1.4             | Desktop, open source         |
| 2   | Adobe Illustrator        | Desktop, pro                 |
| 3   | Affinity Designer 2      | Desktop, pro                 |
| 4   | Figma (+ Figma Draw)     | Web, UI design               |
| 5   | Penpot 2                 | Web, open source UI design   |
| 6   | Boxy SVG                 | Web / desktop, SVG-native    |
| 7   | SVG-Edit 7               | Web, open source, SVG-native |
| 8   | Method Draw              | Web, open source (SVG-Edit)  |
| 9   | Vectr                    | Web, free                    |
| 10  | Corel Vector (ex-Gravit) | Web / desktop                |
| 11  | Vectorpea (Photopea)     | Web, free                    |
| 12  | Excalidraw               | Web, whiteboard              |
| 13  | tldraw                   | Web, whiteboard              |

## Feature matrix

Columns follow the numbering above.

| Feature                          | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  | 12  | 13  | Count |
| -------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ----- |
| Select / move                    | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Undo / redo                      | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Zoom / pan                       | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Fill & stroke colour             | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Stroke width                     | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Object opacity                   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Rect / ellipse / line            | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Delete / duplicate / copy-paste  | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Export SVG                       | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Export PNG                       | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Z-order (front / back)           | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Resize / rotate handles          | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Text                             | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Group / ungroup                  | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Keyboard shortcuts               | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Pencil / freehand                | ●   | ●   | ●   | ●   | ●   | ◐   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 12.5  |
| Import / open SVG                | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ◐   | ◐   | 12    |
| Pen (Bézier) tool                | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ◐   | 11.5  |
| Grid & snapping                  | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ◐   | ●   | ●   | ●   | ●   | ●   | 12.5  |
| Align / distribute               | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Node (point) editing             | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ◐   | ◐   | 12    |
| Separate fill / stroke alpha     | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ◐   | ◐   | ●   | ●   | ○   | ○   | 10    |
| Layers panel                     | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ●   | ●   | ●   | ○   | ○   | 10    |
| Gradients                        | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ○   | 11    |
| Place raster image               | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | 13    |
| Local autosave / persistence     | ◐   | ◐   | ◐   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ◐   | ●   | ●   | 11.5  |
| Eyedropper                       | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ○   | ○   | ●   | ●   | ○   | ○   | 8     |
| Boolean ops (union / subtract …) | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ○   | ●   | ●   | ●   | ○   | ○   | 9     |
| Eraser                           | ●   | ●   | ◐   | ○   | ○   | ○   | ○   | ○   | ○   | ◐   | ◐   | ●   | ●   | 5     |
| Effects / filters (blur, shadow) | ●   | ●   | ●   | ●   | ●   | ●   | ◐   | ○   | ●   | ●   | ●   | ○   | ○   | 9     |
| Pressure / variable-width brush  | ●   | ●   | ●   | ◐   | ○   | ○   | ○   | ○   | ○   | ○   | ○   | ◐   | ●   | 5     |
| Source / XML editor              | ●   | ○   | ○   | ○   | ○   | ●   | ●   | ○   | ○   | ○   | ○   | ○   | ○   | 3     |
| Bitmap tracing                   | ●   | ●   | ○   | ○   | ○   | ○   | ○   | ○   | ○   | ○   | ●   | ○   | ○   | 3     |
| Real-time collaboration          | ○   | ◐   | ○   | ●   | ●   | ○   | ○   | ○   | ●   | ◐   | ○   | ●   | ●   | 6     |
| Symbols / components             | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ○   | ○   | ◐   | ○   | ◐   | ○   | 6.5   |

(◐ counts as ½.)

The census turned up two things worth calling out:

- **Erasers are rare in vector editors.** Only Inkscape and Illustrator ship a
  true path-cutting eraser. The whiteboards (Excalidraw, tldraw) ship an
  _object_ eraser that deletes whatever you touch. The brief asks for an
  eraser, so SVGCraft offers both: **Object** (delete what you touch) and
  **Cut** (split strokes where you rub, like Inkscape's "cut" mode).
- **Transparency means three separate controls.** The full editors give
  you fill alpha, stroke alpha _and_ object opacity, plus a checkerboard
  canvas so you can see the alpha. The whiteboards collapse this into one
  opacity slider, which isn't enough for "transparency" as a headline
  feature.

## Ranked feature list

Ordered by importance. **Tier 0** is the minimum viable editor: every
feature in it is either in the brief or universal (13/13). **Tier 1** is
near-universal and cheap. **Tier 2** is common but costly, so it goes on the
roadmap. **Tier 3** is niche or out of scope for a single-page tool.
✅ = shipped in this first version of SVGCraft.

### Tier 0 — must have

| Rank | Feature                                                | Why                           | Status |
| ---- | ------------------------------------------------------ | ----------------------------- | ------ |
| 1    | Canvas with zoom / pan (wheel, pinch, space-drag, fit) | 13/13 — everything sits on it | ✅     |
| 2    | Select, move, multi-select, marquee                    | 13/13                         | ✅     |
| 3    | Undo / redo                                            | 13/13 — safety net            | ✅     |
| 4    | Export SVG                                             | Brief + 13/13                 | ✅     |
| 5    | Import / open SVG (file, drag-drop, paste)             | Brief + 12/13                 | ✅     |
| 6    | Pencil (freehand with smoothing)                       | Brief + 12.5/13               | ✅     |
| 7    | Pen (Bézier: click corners, drag curves, close)        | Brief + 11.5/13               | ✅     |
| 8    | Fill & stroke colour, palette, "none"                  | Brief + 13/13                 | ✅     |
| 9    | Transparency: fill alpha, stroke alpha, object opacity | Brief + 10–13/13              | ✅     |
| 10   | Eraser: Object + Cut modes                             | Brief (5/13)                  | ✅     |
| 11   | Stroke width                                           | 13/13                         | ✅     |
| 12   | Delete / duplicate / copy-paste                        | 13/13                         | ✅     |

### Tier 1 — expected, cheap

| Rank | Feature                                | Why                                    | Status |
| ---- | -------------------------------------- | -------------------------------------- | ------ |
| 13   | Basic shapes: rectangle, ellipse, line | 13/13                                  | ✅     |
| 14   | Resize & rotate handles (Shift, Alt)   | 13/13                                  | ✅     |
| 15   | Keyboard shortcuts                     | 13/13                                  | ✅     |
| 16   | Export PNG (1×/2×/4×, transparent)     | 13/13                                  | ✅     |
| 17   | Z-order                                | 13/13                                  | ✅     |
| 18   | Group / ungroup                        | 13/13 — imported SVGs arrive grouped   | ✅     |
| 19   | Text (basic)                           | 13/13                                  | ✅     |
| 20   | Layers panel (select, show / hide)     | 10/13                                  | ✅     |
| 21   | Grid & snap                            | 12.5/13                                | ✅     |
| 22   | Local autosave                         | 11.5/13 — a reload shouldn't lose work | ✅     |
| 23   | Flip horizontal / vertical             | ubiquitous, ~free given transforms     | ✅     |
| 24   | Place raster image (for tracing over)  | 13/13                                  | ✅     |
| 25   | Document size                          | universal                              | ✅     |

### Tier 2 — roadmap

| Rank | Feature                              | Why deferred                                 |
| ---- | ------------------------------------ | -------------------------------------------- |
| 26   | Node editing (move points / handles) | ✅ shipped after the first version           |
| 27   | Align / distribute                   | ✅ shipped after the first version           |
| 28   | Gradients (linear / radial)          | ✅ shipped after the first version           |
| 29   | Eyedropper                           | ✅ shipped after the first version           |
| 30   | Boolean ops                          | ✅ shipped after the first version           |
| 31   | Pressure-sensitive brush             | 5/13; pencil + stroke width covers most uses |
| 32   | Effects (blur, drop shadow)          | 9/13                                         |

### Tier 3 — out of scope for now

Source / XML editor (3/13), bitmap tracing (3/13), symbols / components
(6.5/13), real-time collaboration (6/13; needs a server).
