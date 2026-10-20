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
  size, grid and snap) and Layers (see below).
- **Auto-Select** on the Move tool's options bar: **Group** makes a canvas
  click pick the whole top-level item. **Layer** picks the exact shape
  under the cursor, even deep inside groups.
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
- **Free Transform and Edit → Transform**, as in Photoshop:
  - **Free Transform** (Alt+T) opens a transform session. Drag corners to
    scale and the top knob to rotate, or type exact X, Y, W, H (with a
    proportion lock), an angle, and horizontal or vertical skew into the
    options bar. Enter or ✓ commits. Esc or ✕ cancels the whole session.
  - **Transform → Scale / Rotate / Skew** open the same session with the
    handles set to that job: corners and edges only scale, any handle
    rotates, or edge handles slide along their edge to skew. Shift snaps
    angles to 15°.
  - **Rotate 180°, Rotate 90° Clockwise / Counter Clockwise, Flip
    Horizontal / Vertical** each apply in one step, about the selection's
    centre.
  - **Again** (Alt+Shift+T) repeats the last transform about the
    selection's current centre. **Again with Copy** (Ctrl+Alt+Shift+T)
    duplicates first, so a 30° rotation repeated 11 times makes a ring of 12.
  - Browsers reserve Ctrl+T and Ctrl+Shift+T for tabs, so these shortcuts
    use Alt. Distort, Perspective and Warp aren't included, because SVG
    transforms can only express straight-line (affine) changes.
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
- **Gradients**, for fill and stroke:
  - Set a paint's **Type** to Solid, Linear or Radial in the Color panel.
  - **Gradient editor**: click the bar to add a stop, drag a stop to move
    it, or drag it down off the bar to remove it. Each stop has a colour,
    opacity and location. There's also an angle field, Reverse, and
    presets (colour → transparent, black ↔ white, sunset, ocean, rainbow,
    gold, mint). With a gradient active, clicking a swatch recolours the
    selected stop.
  - **Gradient tool** (G): drag across the selection to lay the gradient
    (Shift snaps to 45°). Radial drags from the centre outwards. Drag the
    end handles on the canvas to adjust it.
  - Each shape gets its own gradient in its own coordinates, so angles
    stay true and the gradient moves, rotates and scales with the shape.
    Duplicates split off their own copy when edited, unused gradients are
    removed automatically, and gradients in imported files are read,
    including ones that borrow stops from another gradient.
- **Stroke options**, in the options bar of the drawing tools and in
  Properties:
  - **Caps**: butt, round or square line ends.
  - **Joins**: miter, round or bevel corners.
  - **Dashes**: solid, dashed, dotted or long dash. Dash lengths are sized
    in multiples of the stroke width, as in Photoshop, so they keep their
    proportions when the width changes. They also allow for round and
    square caps, which extend each dash, so dotted lines come out as round
    dots.
- **Rounded rectangles**:
  - Set a **Radius** on the Rectangle tool's options bar before drawing,
    or edit a selected rectangle's four corners in Properties. The link
    toggle changes them all together.
  - Or drag the round handles inside the corners on the canvas. Alt-drag
    moves a single corner, as in Photoshop's live corners.
  - Equal corners stay a plain `<rect rx>`. Unequal corners become a path
    that remembers it's a rectangle, so its radii stay editable until you
    edit its points.
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

## Type

The Type tool (T) works like Photoshop's:

- **Point and paragraph text.** Click to start point text, which grows as
  you type. Drag a box to start paragraph text, which wraps inside the box.
  Enter starts a new line. Ctrl/⌘+Enter, or clicking away, finishes; Esc
  cancels.
- **Editing in place.** Click text with the Type tool, or double-click it
  with Move, to edit it right on the canvas, in its own font, size, colour
  and rotation.
- **Fonts.** The font picker (searchable, each name shown in its own face)
  lists web-safe system fonts and about 25 Google Fonts covering sans,
  serif, display, script and mono. In Chromium browsers, "Show fonts
  installed on this computer" adds your own fonts through the browser's
  Local Font Access permission. The Style menu only offers weights and
  italics the font really has.
- **Options bar.** Family, style, size and alignment, plus a button that
  opens the Character and Paragraph panels.
- **Per-character styling.** While editing, select characters (drag,
  double-click a word, or Shift+arrows) and change the font, style, size,
  tracking, baseline shift, caps, super/subscript, underline,
  strikethrough or Fill colour. Only those characters change. The options
  bar, Character panel, font picker and colour controls all keep the edit
  open, and they show the settings of the characters under the caret. With
  nothing selected, a change applies to the whole layer. Applying a setting
  to a selected layer when you're not editing styles the whole layer and
  clears that setting from its characters, as in Photoshop. Auto leading is
  120% of the largest size on each line, and paragraph text wraps by the
  real width of every run.
- **Character panel.** Size, leading (empty means Auto, 120%), tracking in
  thousandths of an em as in Photoshop, and baseline shift. Toggles for All
  Caps, Small Caps, Superscript, Subscript, Underline and Strikethrough.
  Colour comes from the Fill paint.
- **Paragraph panel.** Alignment, paragraph box width, and Convert to Point
  / Paragraph Text.
- **Fonts go with your file.** An exported SVG links the Google Fonts it
  uses, so it renders the same in any browser. A PNG export downloads those
  fonts and embeds them in the image, because an SVG drawn into an image
  isn't allowed to fetch fonts. Installed (local) fonts only look right on
  computers that have them.
- **Plain SVG underneath.** A text layer is ordinary SVG text, one
  `<tspan>` per line and a nested `<tspan>` per styled run, with the
  settings in standard attributes. The type
  details survive export and import, and other editors can read the file.
- **Limits.** No Warp Text or Convert to Shape (outlines) yet. Undo while
  typing covers the typing itself; character-style changes are undone as
  part of the finished edit.

## Layers

The Layers panel works like Photoshop's:

- **One row per layer.** Every shape is a layer, including the shapes
  inside a group. Groups show as folders you can expand or collapse, and
  each level is indented. An imported SVG arrives as a folder named after
  the file, with one layer per shape inside it.
- **Selecting**: click a row to select it, Ctrl/⌘-click to add or remove
  it, and Shift-click to select a run of rows. A group and a layer inside
  it are never selected together.
- **Grouping**: Ctrl+G, or the folder button at the bottom of the panel,
  puts the selected layers in a new group (Group 1, Group 2 …) where the
  frontmost one was. With nothing selected, it adds an empty group.
  Object → Ungroup dissolves a group again.
- **Reordering**: drag a row. Dropping on the top half of a row puts the
  layer in front of it, and the bottom half puts it behind. The middle of a
  folder drops it inside, and the empty space at the bottom of the list
  sends it to the back. Dragging a selected row moves the whole selection.
  Layers never move on screen when they change groups, and paint they
  inherited from their old group (such as an icon's `fill="none"`) goes
  with them.
- **Renaming**: double-click a name and type. Enter saves, Esc cancels, and
  an empty name goes back to the automatic one. Names are saved as
  `data-name`, which Illustrator uses too, and Inkscape layer labels are
  read on import.
- **Everything works at any depth.** Move, scale, rotate, flip, nudge,
  align, distribute, duplicate, copy, colours, the eraser and point editing
  all work on a layer inside a group, so you never have to ungroup first.

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
| Alt+T · Alt+Shift+T   | Free Transform · Transform Again        |
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
