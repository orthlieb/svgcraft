# Svgcraft

A small in-browser SVG editor with no dependencies and no build step. It's
four static files (`index.html`, `style.css`, `app.js`, `icons.js`): open `index.html`
directly, or serve the folder (`npx serve .`) and host it
anywhere static.

**Live:** <https://orthlieb.github.io/svgcraft/> (served by GitHub Pages
from the root of `main`; every push to `main` redeploys it).

[CENSUS.md](CENSUS.md) surveys 13 current editors and ranks features by
importance. It explains why the feature set below looks the way it does,
and what comes next.

## Workspace

The layout follows Photoshop:

- **Menu bar**: File, Edit, Object and View menus. Click to open, hover to
  switch between them, and use the arrow keys to move around.
- **Options bar**: settings for the current tool, such as stroke width and
  smoothing for the pencil, mode and size for the eraser, or the point
  commands for Edit Points. Drag a field's label sideways to scrub its value
  (Shift scrubs 10× faster).
- **Toolbar**: the tools, with the fill and stroke chips at the bottom.
  Click a chip to make it the active paint, and click it again to pick a
  colour. Below the chips are swap (X) and "none".
- **Document tab** above the canvas, showing the file name and zoom.
- **Docked panels**: Color / Swatches, Properties (stroke width, document
  size, grid and snap) and Layers (opacity, thumbnails, show / hide, and
  group, duplicate, reorder and delete buttons).
- **Status bar**: an editable zoom field and the document size.
- **Theme**: follows your OS by default. The sun / moon button and
  View → Theme switch between Dark and Light, and the choice is remembered.

## Features

- **Import**: Open… replaces the drawing. Import… places an SVG (as a
  group, scaled to fit) or a PNG / JPEG / WebP / GIF into the drawing. You
  can also drag and drop files, or paste SVG markup or images.
  Imported SVG is sanitized: scripts, `foreignObject`, `on*` handlers and
  `javascript:` links are stripped, and `<style>` rules are inlined so they
  can't restyle the editor. Root-level paint like `fill="none"
stroke="currentColor"` (common in icon sets) is pushed down so it survives.
- **Export**: SVG download (Ctrl+S), PNG at 1× / 2× / 4× with a
  transparent background, and Copy, which puts the drawing (or the
  selection) on the clipboard as SVG markup.
- **Pencil**: freehand drawing with adjustable smoothing (RDP simplification
  plus a Catmull-Rom → Bézier fit).
- **Pen**: click for corners, drag for smooth curves, click the first point
  to close. Enter or double-click finishes, Backspace removes the last
  point, and Shift snaps to 45°.
- **Align / distribute**: from the Move tool's options bar or Object →
  Align. Align left, centre or right edges, or top, middle or bottom, to
  the selection's bounds. With one object selected, it aligns to the
  artboard instead, as in Photoshop. Distribute spaces three or more
  objects with equal gaps and leaves the outermost two where they are.
- **Eyedropper** (I): **Style** mode copies a shape's fill, stroke, alpha,
  stroke width and opacity into the current settings, and applies them to
  anything selected. **Colour** mode samples the exact rendered pixel,
  including blended transparency and placed images, into the active paint.
  A ring around the cursor previews the colour, and Alt-click sends it to
  the other paint. In Chromium browsers, the eyedropper button on the Color
  panel can pick a colour from anywhere on screen.
- **Edit points** (A, or double-click a shape): drag points and Bézier
  handles, Shift-click or drag a box to pick several, and nudge with the
  arrow keys. Double-click a segment to add a point, or a point to switch
  it between corner and smooth. Delete removes points, and Close / open
  toggles the closing segment. Smooth points keep their handles in line;
  Alt-drag a handle to break one. Works on paths with any command (arcs
  included) and on rectangles, ellipses, circles, lines, polylines and
  polygons. A basic shape turns into a `<path>` only once you change it.
- **Eraser**: **Object** mode deletes anything you rub. **Cut** mode splits
  stroked lines and paths where you rub and leaves filled shapes alone.
- **Colours**: fill and stroke, each with an on/off switch, a colour
  picker, a hex field and a palette. Press X to swap fill and stroke.
  Shift-click a swatch to apply it to the other target.
- **Transparency**: fill alpha, stroke alpha and object opacity are
  separate sliders, and a checkerboard artboard shows the result.
- **Also included**: rectangle, ellipse, line and text tools; select /
  marquee / move; resize and rotate handles (Shift keeps the ratio, Alt
  scales from the centre); flip; group / ungroup; z-order; duplicate; a
  layers list with show / hide; grid and snap; document size; zoom / pan
  (wheel, Ctrl+wheel, pinch, Space-drag); undo / redo; and autosave to
  `localStorage`.

## Shortcuts

| Key                   | Action                                  |
| --------------------- | --------------------------------------- |
| V A                   | Select · Edit points                    |
| P B E I               | Pencil · Pen · Eraser · Eyedropper      |
| R O L T H             | Rect · Ellipse · Line · Text · Pan      |
| Space (hold)          | Pan                                     |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo                             |
| Ctrl+C / X / V        | Copy / cut / paste (as SVG)             |
| Ctrl+D · Ctrl+A       | Duplicate · select all                  |
| Ctrl+G · Ctrl+Shift+G | Group · ungroup                         |
| ] [ · Ctrl+] Ctrl+[   | Forward / backward · to front / to back |
| Arrows (Shift = 10)   | Nudge                                   |
| Del / Backspace       | Delete                                  |
| X                     | Swap fill and stroke                    |
| + − 0 1               | Zoom in / out · fit · 100%              |
| Ctrl+S · Ctrl+O       | Export SVG · open                       |

## How it works

- The drawing lives in `<g id="sc-doc">` (plus `<defs id="sc-defs">`) in
  document units. `#sc-view` carries the zoom / pan transform, and the
  overlays (selection, pen preview, eraser ring) sit in the same space,
  scaled by `1/zoom`.
- Only top-level children of `#sc-doc` can be selected. Every move, scale,
  rotate and flip pre-multiplies a matrix onto the element's `transform`,
  so any imported element can be transformed without understanding its
  geometry.
- History is a stack of `innerHTML` snapshots (150 deep), which keeps undo
  simple and exact.
- `window.svgcraft` exposes `state`, `serialize`, `openSvg`, `placeSvg`
  and friends for poking at the editor from the console.

## Credits

Icons are from [Font Awesome Free](https://fontawesome.com) 6.7.2 by
Fonticons, Inc., licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
`icons.js` holds them as SVG snippets keyed by name, and any element marked
`data-icon="name"` gets its snippet at startup, so nothing loads from a CDN.
To add an icon, copy its SVG from fontawesome.com into `icons.js`.
