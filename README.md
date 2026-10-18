# Svgcraft

A small in-browser SVG editor with no dependencies and no build step. It's
three static files (`index.html`, `style.css`, `app.js`): open `index.html`
directly, or serve the folder (`npx serve .`) and host it
anywhere static.

**Live:** <https://orthlieb.github.io/svgcraft/> (served by GitHub Pages
from the root of `main`; every push to `main` redeploys it).

[CENSUS.md](CENSUS.md) surveys 13 current editors and ranks features by
importance. It explains why the feature set below looks the way it does,
and what comes next.

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
| P B E                 | Pencil · Pen · Eraser                   |
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

Tool icons are from [Font Awesome Free](https://fontawesome.com) 6.7.2 by
Fonticons, Inc., licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
They're inlined as SVG, so nothing loads from a CDN.
