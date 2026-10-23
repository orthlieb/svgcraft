# SVGCraft

A small in-browser SVG editor with no dependencies and no build step. It's
static files (`index.html`, `style.css`, the scripts in `src/`, `icons.js`
and `symbols-library.js`): open `index.html` directly, or serve the folder
(`npx serve .`) and host it anywhere static.

**Live:** <https://orthlieb.github.io/svgcraft/> (served by GitHub Pages
from the root of `main`; every push to `main` redeploys it).

[CENSUS.md](CENSUS.md) surveys 13 current editors and ranks features by
importance. It explains why the feature set below looks the way it does,
and what comes next.

## Workspace

SVGCraft edits on tablets and larger screens. A phone (narrower than
768 px, or a phone held sideways) gets a **preview** instead: open SVGs,
switch between tabs, pan and pinch-zoom, Fit, and About. The editing tools,
menus and panels are hidden, and nothing on a phone changes a drawing.
On tablets in portrait, the toolbar moves to the bottom and the panels
slide in from the right (the sliders button).

The layout follows Photoshop:

- **Menu bar**: File, Edit, Image, Object, Type, Select, View and Help menus. Click to open, hover to
  switch between them, and use the arrow keys to move around.
- **Options bar**: settings for the current tool, such as stroke width and
  smoothing for the pencil, mode and size for the eraser, or the point
  commands for Edit Points. Drag a field's label sideways to scrub its value
  (Shift scrubs 10× faster).
- **Toolbar**: the tools, with the fill and stroke chips at the bottom.
  Click a chip to make it the active paint, and click it again to pick a
  colour. Below the chips are swap (X) and "none".
- **Document tabs** above the canvas, one per open drawing, showing the
  file name and zoom (see Documents below).
- **Docked panels**: Color / Swatches / Gradients / Patterns, Properties
  (stroke width, document size, grid and snap) and Layers (see below).
- **Auto-Select** on the Move tool's options bar: **Group** makes a canvas
  click pick the whole top-level item. **Layer** picks the exact shape
  under the cursor, even deep inside groups.
- **Rulers, guides and smart guides**:
  - **Rulers** run along the top and left, in document pixels. Their ticks
    re-scale with zoom, and a marker follows the cursor. View → Rulers
    turns them off.
  - **Guides:** drag one out of a ruler. Drag it with the Move tool to
    reposition it (Shift rounds to 10 px), or drag it back onto a ruler
    to delete it. View → New Guide… places one at an exact position, and
    the View menu has Show Guides, Lock Guides and Clear Guides. Guides
    are part of undo and are saved in the file as invisible metadata
    (`data-sc-guides`).
  - **Snapping:** moving and drawing snap to guides, and with **Smart
    Guides** on, to the edges and centres of other objects and of the
    artboard. A moved selection snaps by its left, centre or right edge
    (and top, middle or bottom), and magenta lines show what lined up.
    A guide or smart match within 6 screen pixels takes priority over
    the grid. Hold Ctrl/⌘ while dragging to skip snapping.
- **Status bar**: an editable zoom field and the document size.
- **Theme**: follows your OS by default. The sun / moon button and
  View → Theme switch between Dark and Light, and the choice is remembered.

## Features

- **Import**: Open… replaces the drawing. Import… places an SVG (as a
  group, scaled to fit) or a PNG / JPEG / WebP / GIF into the drawing. You
  can also drag and drop files, or paste SVG markup or images.
  Imported SVG (opened, imported, pasted, restored from this browser, or
  in a library file) is sanitised with an allowlist, because it goes into
  the editor's own page. Only SVG drawing elements are kept: no script,
  `foreignObject`, animation, or elements from other namespaces (such as
  HTML `<base>`, `<form>` or `<meta>`). Event handlers (`on*`) go. Links
  may only point inside the file, except image `data:` URLs and `http(s)`
  / `mailto` on `<a>`; they're checked as the browser reads them, so a
  hidden tab can't disguise `javascript:`. `url(…)` that would fetch from
  another server is dropped from styles and paint attributes, so opening
  a file never contacts anyone. `<style>` rules are baked into style
  attributes so they can't restyle the editor, and `<title>` / `<desc>`
  keep their text only. Root-level paint like `fill="none"
stroke="currentColor"` (common in icon sets) is pushed down so it
  survives.
- **Crop** (Image menu): **Crop to Selection** and **Crop to Drawing** fit
  the artboard tightly around the selected layers, or around everything
  visible, rounded out to whole pixels. The box is what's actually
  painted, so nothing is shaved off: stroke width and position (Center,
  Inside, Outside), mitre tips at sharp corners (up to the mitre limit),
  square and round caps, round joins, and effects (drop shadow, outer
  glow, blur) all count, including on rotated and scaled layers. Hidden
  layers don't count. Define Pattern and Copy as SVG frame the selection
  the same way. The drawing and the guides shift so
  the artboard still starts at 0, 0, and nothing moves on screen. Anything
  left outside the artboard is kept, but it isn't exported.
- **Select menu**: **All** (Ctrl+A), **Deselect** (Esc) and **Inverse**
  (Shift+F7, or Ctrl+Shift+I where the browser allows it), which selects
  every visible layer that wasn't selected. If the selection includes a
  shape inside a group, Inverse works with individual shapes. Otherwise it
  works with top-level layers.
- **Documents**: every open drawing gets a tab, as in Photoshop.
  - **File → New** (or + in the tab bar) adds an Untitled tab. **Open**
    puts a file in a tab of its own, reusing an untouched Untitled tab.
    **Close** (the tab's ✕, a middle-click, or File → Close) asks first
    if the drawing has unsaved changes.
  - Each tab keeps its own drawing, undo history and zoom.
  - A `*` after the name means the drawing differs from the version last
    opened or saved. **Save as SVG** (Ctrl+S) downloads it and clears the
    `*`. Undoing back to the saved version clears it too. PNG export
    doesn't count as saving.
  - All open drawings are kept in this browser (IndexedDB) as they
    change, so a reload or a later visit brings back the same tabs, the
    same `*` marks and the same view. The browser's copy is per browser
    and per machine; Save as SVG to keep a file. A drawing autosaved by an
    older version of SVGCraft is brought over as a tab.
- **Export**: SVG download (Ctrl+S), PNG at 1× / 2× / 4× with a
  transparent background, and Copy, which puts the drawing (or the
  selection) on the clipboard as SVG markup.
- **Export Clean SVG…** (File menu) saves `<name>.min.svg`: plain SVG for
  the web or another app. It draws exactly the same (effects, clips,
  masks, gradients and patterns stay as the real SVG that draws them), but
  leaves out what SVGCraft keeps to reopen the file editable: every
  `data-*` attribute (layer names, locks, effect settings, guides…),
  unreferenced ids, unused defs, comments, empty and attribute-free groups
  and attributes set to their defaults. Options, remembered:
  - **Decimal places** for coordinates (2 by default; path data is
    compacted too).
  - **Minify**: one line, with short ids.
  - **Scale to fit**: only a viewBox, no width and height.
  - **Leave out hidden layers**.
  - **Keep File Info**: the title, description and licence.
  - **Solid colours as currentColor**, for one-colour icons a page can
    recolour with CSS.

  Keep Save as SVG for your working copy: a clean SVG reopens as plain
  shapes.

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
- **Fill rule and path direction** (Properties, under Stroke, when a path,
  polygon or polyline is selected; also Object → Path). Where a path
  crosses itself or holds another subpath, the fill rule decides what's
  inside: **Non-zero** (SVG's default) fills an area unless the outline's
  directions around it cancel out; **Even-odd** makes every nested loop a
  hole, whichever way it runs. It's set on each selected shape, inside
  groups too, and saved as `fill-rule` (nothing for non-zero, unless a
  group or style above would make it even-odd). **Reverse** (Reverse Path
  Direction) runs the selected paths, polygons, polylines and lines the
  other way: under non-zero, a loop running against its outer shape is a
  hole; it also flips where text on the path starts and which way dashes
  and markers run. A closed path keeps its starting point. Rectangles,
  circles and ellipses become paths (a live rectangle's corners stop being
  editable as corners).
- **Animate** (Properties, when one layer or group is selected). Add
  animations from presets: entrances (Fade, Slide, Pop and Zoom in), exits
  (Fade, Slide and Zoom out), loops (Spin, Pulse, Bounce, Shake, Float,
  Blink), line effects (Draw on, Draw off, Dash march) and Colour cycle.
  Each has a length, delay, number of times or forever, direction (normal,
  reverse, back and forth) and easing, plus its own options (slide side
  and distance, turns, how far to grow, the colour to cycle to). A layer
  can have several, which play together; ▶ **Play** (or View → Play
  Animations) previews the whole drawing, and Esc, a click on the canvas
  or any edit stops it. They're kept as settings on the layer
  (`data-sc-anim`) and written out as SVG animation (SMIL:
  `<animate>`, `<animateTransform>`, `<set>`) only when the drawing is
  saved, so editing and undo always see the shapes at rest. Moves, spins
  and scales are additive, so they happen about the layer's own centre, on
  top of its transform. SMIL plays in every current browser, including SVG
  shown in an `<img>` tag. Each animation adds about 150–300 bytes;
  Export Clean SVG keeps the animation and rounds its coordinates like the
  rest. PNG, app icon and favicon exports use the still drawing. Reopening
  a saved file rebuilds the animations from their settings.
- **Zoom** (Z), as in Photoshop: click to zoom in one step (50%, 66.7%,
  100%, 200%, 300% …), and Alt-click or the options bar's Zoom Out button to
  step out. With **Scrubby Zoom** on, drag right to zoom in and left to zoom
  out, centred where you pressed. With it off, drag a box to fill the window
  with that area. 100%, Fit Screen and Fill Screen are in the options bar,
  and double-clicking the tool goes to 100%.
- **Pixel grid and Snap to Pixel** (View menu, or the checkboxes under
  Document in Properties): the pixel grid is a 1 px grid over the artboard
  from 600% zoom up. Snap to Pixel puts points and moved shapes on whole
  pixels, so edges stay sharp in PNG exports and at small sizes. A centred
  stroke of odd whole width (1, 3 px …) snaps to half pixels instead, so
  its edges land on whole pixels. Guides and smart guides still win when
  they're close, and Snap to Grid wins when it's on. Both are remembered.
- **Eraser**: **Object** mode deletes anything you rub. **Cut** mode splits
  stroked lines and paths where you rub and leaves filled shapes alone.
- **Gradients**, for fill and stroke:
  - Set a paint's **Type** to Solid, Linear or Radial in the Color panel.
  - **Gradient editor**: click the bar to add a stop, drag a stop to move
    it, or drag it down off the bar to remove it. Each stop has a colour,
    opacity and location. There's also an angle field, Reverse, a Presets
    list (Colour → Transparent plus everything in the Gradients panel) and
    a + button that saves the gradient to the Gradients panel. With a
    gradient active, clicking a swatch recolours the selected stop.
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
  - **Width** (thickness) in px.
  - **Align**: Inside, Center or Outside, as in Photoshop, for closed
    shapes (rectangles, ellipses, polygons and closed paths). SVG strokes
    are always centred, so an aligned stroke is drawn twice as wide and the
    unwanted half is hidden: clipped to the shape for Inside, and painted
    under the fill for Outside (masked when there's no fill). The width
    you set stays the visible width. Under a semi-transparent fill, the
    hidden half of an Outside stroke shows through faintly. Opening a path
    puts its stroke back to Center.
  - **Caps**: butt, round or square line ends.
  - **Joins**: miter, round or bevel corners.
  - **Dashes**: solid, dashed, dotted or long dash. Dash lengths are sized
    in multiples of the stroke width, as in Photoshop, so they keep their
    proportions when the width changes. They also allow for round and
    square caps, which extend each dash, so dotted lines come out as round
    dots. **Custom** opens Photoshop's dash / gap fields in Properties: up
    to three dash-and-gap pairs, in stroke widths. Imported dash patterns
    show up there too.
- **Rounded rectangles**:
  - Set a **Radius** on the Rectangle tool's options bar before drawing,
    or edit a selected rectangle's four corners in Properties. The link
    toggle changes them all together.
  - Or drag the round handles inside the corners on the canvas. Alt-drag
    moves a single corner, as in Photoshop's live corners.
  - Equal corners stay a plain `<rect rx>`. Unequal corners become a path
    that remembers it's a rectangle, so its radii stay editable until you
    edit its points.
- **Patterns**, for fill and stroke:
  - Set a paint's **Type** to Pattern, or click a tile in the **Patterns**
    panel. The built-ins (stripes, diagonal, dots, grid, checks,
    crosshatch, waves, bricks, triangles) are drawn in the paint's colour,
    so changing the colour re-inks them.
  - The pattern editor in the Color panel sets **Scale** and **Angle** and
    picks another pattern. The tiles start at the shape's top-left corner.
  - **Edit → Define Pattern…** turns the selection into a pattern tile the
    size of its visible box, as in Photoshop. It looks the same as it does
    on the canvas, including transforms, gradients and clip paths.
  - As with gradients, each shape gets its own `<pattern>` in its own
    coordinates, so the pattern moves and rotates with the shape. Patterns
    export as plain SVG.
- **Libraries**: the **Swatches**, **Gradients** and **Patterns** panels
  are saved in this browser (localStorage), like Photoshop's presets.
  - **+** adds the current colour (with its alpha), saves the active
    gradient, or defines a pattern from the selection. Each asks for a
    name.
  - Click a tile to apply it to the active paint, or Shift-click to apply
    it to the other one. Double-click renames it, Alt-click deletes it,
    and the bar's buttons do the same for the selected tile. **Reset**
    brings back the built-in set for that panel.
  - **Export** (on any of the panels) saves the whole library, symbols
    included, as one `svgcraft-library.zip`:
    - `svgcraft-library.json`: everything, for SVGCraft.
    - `swatches.gpl`: a palette for GIMP, Inkscape and Krita.
    - `swatches.css` and `gradients.css`: CSS custom properties
      (`--name: #hex`, `--name: linear-gradient(…)`).
    - `gradients.svg` and `patterns.svg`: `<linearGradient>`,
      `<radialGradient>` and `<pattern>` defs for Inkscape, Illustrator and
      browsers, each drawn as a labelled sample. Pattern tiles draw in
      `currentColor`, set on each `<pattern>`.
    - `symbols.svg`: an SVG sprite, one `<symbol id="…">` per symbol with
      its credit, for `<use href="symbols.svg#id"/>`.
    - `README.txt`: what each file is. Kinds with nothing in them are left
      out.
  - **Import** adds a file's contents, skipping anything you already have
    (the same colour, gradient, tile or symbol, whatever its name). If
    something new has the name of one of yours, SVGCraft asks once for the
    whole import: **Keep both** (the default; the imported one becomes
    "Sky 2"), **Replace mine** (yours keeps its name and place and takes the
    new definition) or **Skip them**.
    It reads the exported zip (from its `svgcraft-library.json`), a zip of
    palettes, gradients and SVGs without one (deflated or not, in folders or
    not), a JSON library, a GIMP palette (including GIMP 3's alpha), a GIMP
    gradient (`.ggr`), or any SVG, taking its gradients (shared stops
    included), patterns and symbols. Symbols from an SVG go in a category
    named after the file.
  - Browser storage belongs to one browser on one machine and is lost if
    you clear the site's data, so export to keep a copy. Pattern tiles and
    symbols from a file are sanitised like imported drawings.
- **Colours**: fill and stroke, each with an on/off switch, a colour
  picker, a hex field and the Swatches panel. Press X to swap fill and stroke.
  Shift-click a swatch to apply it to the other target.
- **Transparency**: fill alpha, stroke alpha and object opacity are
  separate sliders, and a checkerboard artboard shows the result.
- **Also included**: rectangle, ellipse, line and text tools; select /
  marquee / move; resize and rotate handles (Shift keeps the ratio, Alt
  scales from the centre); flip; group / ungroup; z-order; duplicate; a
  layers list with show / hide; grid and snap; document size; zoom / pan
  (wheel, Ctrl+wheel, pinch, Space-drag); and undo / redo.

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
  opens on **Popular**: web-safe system fonts and about 40 popular Google
  Fonts. The whole Google Fonts catalogue, about 1,900 families, is a
  search away, or browse it by category (Sans, Serif, Display, Script,
  Mono). A search ranks names that start with what you typed first, then
  names with a word that does; long lists show their first 150 and
  narrow as you type. Each name loads a tiny preview of itself as it
  scrolls into view. A drawing opened from elsewhere in any Google family
  loads that family. In Chromium browsers, "Show fonts installed on this
  computer" adds your own fonts through the browser's Local Font Access
  permission. The Style menu only offers the weights and italics the font
  really has. The catalogue (`google-fonts.js`, 13 KB compressed) is
  regenerated with `scripts/gen-google-fonts.mjs`.
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
- **Create Outlines.** Type → Create Outlines turns text into shapes
  (see below).
- **Limits.** No Warp Text yet. Undo while
  typing covers the typing itself; character-style changes are undone as
  part of the finished edit.

## Text on a path

Illustrator's Type on a Path. Select one text layer and one path or shape
(path, rectangle, ellipse, circle, polygon, polyline or line; Shift-click
both), then choose **Type → Text on Path**, or **Put Text on Path** in
the Properties panel.

- **One line along the path.** The text's lines are joined into one, with
  a space where each line break was. Its fonts, per-character styles, fill,
  effects, blend mode, lock and name stay. The path layer stays where it is
  and keeps its own paint, so give it no stroke, or hide it, if you only
  want the text.
- **Live.** Move, rotate, scale or point-edit the path layer, or the group
  it's in, and the text re-flows along it straight away. The text follows
  the path, so moving the text layer on its own leaves it on the path.
- **Options.** With a text-on-path layer selected, the Properties panel
  shows **Start** (where the text starts along the path, in percent),
  **Align** (text starts at, is centred on, or ends at that point; picking
  one also sets Start to 0, 50 or 100%) and **Flip**, which puts the text on
  the other side of the path, running the other way. On a closed shape the
  text starts where the shape does: an ellipse's or circle's right-hand
  point, a rectangle's top-left corner.
- **Editing.** Double-click the text with Move, or click it with the Type
  tool, to change the words. It's edited as one straight line where it
  starts on the path; Enter or clicking away finishes. Character panel and
  options-bar changes (font, size, tracking, colour, caps…) apply to the
  whole text and keep it on the path. Paragraph settings that need lines
  (box width, Convert to Paragraph Text) don't apply.
- **Release.** **Type → Release Text on Path** (or the Properties button)
  turns it back into one line of point text, placed where it started on
  the path.
- **If the path layer is deleted**, the text keeps the last shape it ran
  along and stays where it was, so nothing jumps or disappears. Release it
  to make it ordinary text again.
- **In the file.** The text is a standard `<text>` with a `<textPath>`
  pointing at a copy of the path's shape in `<defs>` (SVG ignores the
  referenced path's own transform, so the copy is kept in the text's
  coordinates), plus `data-sc-textpath` naming the path layer's id. The
  path layer gets an id if it had none. The link survives Save as SVG →
  reopen, Import and paste (ids that clash are renamed and the link
  follows), undo and Duplicate: duplicating the text with its path links
  the copy to the copied path.

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
- **Blend mode and Opacity** at the top of the panel, as in Photoshop:
  Normal, Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge,
  Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation,
  Color and Luminosity, plus **Pass Through** for groups. Blend mode and
  opacity belong to a layer, and a group is a layer: on a group they
  apply to the group as a whole. As in Photoshop, a group starts out on
  Pass Through, so its layers blend with whatever is below the group.
  Setting the group to Normal isolates it, so its layers blend only with
  each other; any other mode isolates it too. They're saved as the
  layer's CSS (`mix-blend-mode`, `isolation`), which browsers apply to
  exported SVGs too.
- **Lock**: **Lock position** stops the layer moving, scaling, rotating,
  flipping, nudging and aligning. **Lock all** stops every change: paint,
  styles, blend mode, point and text edits, deleting and erasing. Locked
  layers can still be selected, and a lock on a group covers everything in
  it. A padlock on the row shows the lock; click it to unlock. The same
  commands are in Object → Lock Position / Lock All / Unlock.
- **Layer Style (fx)**: the fx button at the bottom of the panel, Object →
  Layer Style…, or double-clicking a layer's fx badge opens Photoshop's
  Layer Style dialog. Effects are listed down the left: tick one to turn it
  on, or click its name to turn it on and edit it. The canvas previews the
  changes as you edit (untick Preview to compare). OK keeps them, and
  Cancel or Esc puts everything back.
  - **Drop Shadow** and **Inner Shadow**: colour, opacity, angle,
    distance, spread / choke and size.
  - **Outer Glow** and **Inner Glow**: colour, opacity, spread / choke and
    size.
  - **Color Overlay**: colour and opacity.
  - **Gaussian Blur**: radius.
  - **Blending Options**: blend mode and opacity.
  - Angles, distances and sizes are in document pixels, as in Photoshop,
    so a rotated or scaled layer still casts its shadow the same way.
    Each layer gets its own SVG `<filter>`, which follows the layer as it
    changes and is exported with it. Object → Clear Layer Style removes
    the effects.
- **Everything works at any depth.** Move, scale, rotate, flip, nudge,
  align, distribute, duplicate, copy, colours, the eraser and point editing
  all work on a layer inside a group, so you never have to ungroup first.

## Tooltips

Hover over any button for a tooltip. Tools also show a one-line description
of what they do. Tooltips float above everything, panels and menus
included, and fade after three seconds. Tabbing to a button shows its tip
too, and on a touch screen a tap shows it briefly.

## Combine Shapes

Object → Combine Shapes, or the four buttons in the Move tool's options
bar, merges the selected shapes into one path, as Photoshop and
Illustrator do:

- **Unite**: the outline of all the shapes together.
- **Subtract Front**: the backmost shape minus everything in front of it.
- **Intersect**: only the area where all the shapes overlap.
- **Exclude**: the areas where an odd number of shapes overlap, so the
  overlaps become holes.

The result takes the place, name and style of the topmost shape (the
backmost one for Subtract Front), and keeps its curves, so you can point-edit
it straight away. A group counts as one shape made of everything in it.
Rotated, scaled and nested layers combine where they are on screen.
Text and images are skipped, and you get a message saying so. The geometry
comes from [paper.js](http://paperjs.org), which loads the first time you
combine shapes.

## Clipping masks

Object → Clipping Mask → Make (Ctrl+Alt+G), or the scissors button at the bottom
of the Layers panel, clips the selected layers to the topmost of them, as
Illustrator does. The topmost selected layer is the clipping path, and it
has to be a single shape or a text layer; anything else (a group, an
image) gets a message saying why, and nothing changes. Everything selected
goes into a new "Clipping group" where the clipping path was, without
moving on screen. Only the art inside the clipping path's outline shows;
the clipping path itself isn't painted.

The clipping path stays in the group as an ordinary layer, so the clip stays
live. In the Layers panel the group and the clipping path are marked with
scissors, and the clipping path's name is underlined. Click its row to
select it, then move, transform or point-edit it: the window changes and the
art stays put. Moving the whole group moves both together. Drop another
layer into the group to clip it too. Deleting the clipping path, or
dragging it out of the group, ends the clip.

Object → Clipping Mask → Release (Ctrl+Alt+Shift+G), with the group or any layer
in it selected, turns the clip off: the clipping path shows again with its
own fill and stroke, and the layers stay grouped. Duplicated clipping
groups clip on their own. Locked layers can't be clipped, and a locked
clipping group can't be released. The clip is saved in the file and is
still live when you open it again.

## Create Outlines

Type → Create Outlines (Ctrl+Shift+O), Illustrator's Create Outlines and
Photoshop's Convert to Shape, turns the selected text layers (or the text
inside selected groups) into filled paths that look exactly like the text
did, so the drawing no longer needs the fonts and the letters can be
point-edited:

- **Placed as drawn.** Every character goes where the browser drew it, so
  kerning, tracking, alignment, line spacing, paragraph wrapping, baseline
  shift, super/subscript and rotation all carry over. All Caps becomes
  capitals and Small Caps becomes smaller capitals.
- **One path per style.** Each layer becomes a group named "…
  (outlines)" holding one path per character style, in that style's fill,
  stroke and opacity, so a bold word or a red word is its own path.
  Underline and strikethrough become bars in the same paths.
- **Keeps the layer.** The group takes the text's place in the stack, its
  transform, Layer Style effects, blend mode, opacity, lock and hidden
  state. One undo brings the text back.
- **Fonts.** The glyph shapes come from the real font files. Google Fonts
  download from Fontsource's CDN (jsDelivr), with extra character sets
  (Latin Extended, Cyrillic, Greek, Vietnamese) fetched only when the text
  needs them. Fonts installed on your computer are read directly once
  you've allowed installed fonts in the font picker (Chromium only).
  Otherwise system fonts use open stand-ins, and the message says which:
  Arimo for Arial and Helvetica, Tinos for Times New Roman, Cousine for
  Courier New (these three match the originals letter for letter), Gelasio
  for Georgia, DejaVu Sans for Verdana, Fira Sans for Trebuchet MS, Anton for
  Impact and Roboto for System UI. A font the browser fakes (an italic the
  family doesn't have) is slanted the same way.
- **If a font can't be downloaded** (offline, say), that layer is left as
  text and the message says why.
- **Limits.** Characters are outlined one by one, so ligatures and the
  joined forms of scripts like Arabic and Devanagari aren't reproduced,
  and Small Caps uses scaled capitals rather than a font's own small caps.
  A gradient that fills text is measured against each path rather than the
  whole line. A bold the family doesn't have, which the browser fakes by
  thickening the letters, comes out at the family's nearest real weight.
  The glyph shapes come from [opentype.js](https://opentype.js.org), which
  loads the first time you create outlines.

## Icons

Tools for drawing icons (see also the pixel grid and Snap to Pixel, under
Features):

- **File → New Icon…** makes a square artboard. Type a size or pick a
  common one (16 to 2048) from the size box's list, and a margin: the
  margins become ordinary guides on all four sides, plus centre guides if
  you like, so they move, lock, snap and save like any other guide. The
  margin follows the size (a twelfth of it) until you type your own. An
  untouched Untitled tab gives way to the icon.
- **Templates** from the platforms' guidelines set the size and margins,
  say what the guides mean, and set the icon preview's mask:
  - Material system icon: 24 px with 2 px padding.
  - Favicon: 32 px.
  - Android adaptive launcher icon: 108 dp at 4× (432 px), with guides
    around the 72 dp area launchers show and the 66 dp safe zone inside it.
    Preview: circle mask, adaptive crop.
  - Google Play icon: 512 px, full bleed. Preview: rounded mask.
  - iOS app icon: 1024 px, full bleed (iOS rounds the corners itself).
    Preview: iOS mask.
  - macOS app icon: 1024 px with guides around the 824 px body.
- **View → Icon Keylines** draws Material's keyline shapes in the live
  area: a circle, a square, upright and wide rectangles, the diagonals and
  centre lines. Sizing an icon's main shape to the keyline that matches it
  makes round, square, tall and wide icons look equally big side by side.
  The live area is inside the guides nearest each edge, so moving a margin
  guide moves the keylines (without guides it's a twelfth in from each
  edge). Keylines aren't part of the drawing.
- **View → Icon Preview** (Ctrl+Alt+P) shows the drawing at 16, 24, 32,
  48, 64 and 128 px in a pane docked beside the canvas: drag the divider
  (or focus it and use the arrow keys) to resize it. The button in its title
  bar floats it as a window of its own and docks it back. The previews are
  drawn by the browser just as a web page would draw the SVG. They update
  as you work, and clicking a size
  shows the canvas at that size. Its options (and whether it's docked, and
  how wide) are remembered:
  - **Background**: light, dark or transparent (checkerboard), or all
    three. It starts on the app's theme.
  - **Mask**: how platforms crop app icons: **iOS** (a rounded square, as
    iOS and macOS draw app icons), **Circle** and **Squircle** (Android
    launchers), **Rounded** (Google Play and Android, corners rounded by a
    fifth), or none.
  - **Adaptive crop** shows only the middle 72 dp of a 108 dp Android
    adaptive icon, the part launchers show (and mask).
- **File → Export App Icons…** saves `<name>-app-icons.zip` with every
  size each platform asks for, each drawn from the vector art (not scaled
  from one big bitmap). Pick the platforms:
  - **Web**: `favicon.ico` (16, 32 and 48 px), `favicon.svg`,
    `apple-touch-icon.png` (180), `icon-192.png` and `icon-512.png`, a
    `site.webmanifest` and `head.html`, the `<link>` tags to paste into your
    pages.
  - **iOS**: `AppIcon.appiconset` (one 1024 px icon and its
    `Contents.json`) to drag into an Xcode asset catalogue.
  - **Android**: a `res/` folder to copy into `app/src/main/`, and the
    512 px Play Store icon. It has an **adaptive icon** (Android 8+):
    108 dp foreground, background and monochrome layers for mdpi to
    xxxhdpi, and `mipmap-anydpi-v26/ic_launcher.xml` and
    `ic_launcher_round.xml` tying them together. The monochrome layer is
    the foreground's shape, for Android 13's themed icons. There are also
    legacy square and round `ic_launcher` PNGs (48 to 192 px) for older
    launchers.
    - A top-level layer named **Background** becomes the background layer,
      and the rest the foreground. Without one, the background is the
      Background colour (`values/ic_launcher_background.xml`).
    - Artwork drawn on New Icon's Android adaptive template (a 108 dp
      canvas, recognised by its guides 1/6 in) is used as drawn, edge to
      edge; the legacy and Play Store icons show its middle 72 dp, as a
      launcher does. Any other icon is fitted into the 66 dp safe zone, so
      no launcher mask cuts into it.
  - **macOS**: `AppIcon.icns`, and the `AppIcon.iconset` it's built from
    (16 to 1024 px), for `iconutil`.
  - The iOS icon and the Apple touch icon can't be transparent: they're
    filled with the **Background** colour (as is Android's adaptive
    background, when there's no Background layer) and saved without an alpha
    channel, as the App Store requires. The rest keep their transparency.
    A non-square artboard is centred in each square icon.

## Symbols

A symbol is artwork you reuse: draw it once, place it as often as you like,
and change every copy at once by editing the symbol. As in Illustrator:

- **Object → Make Symbol…** asks for a name and turns the selection into a
  symbol. The selection is replaced by one _instance_ of it, exactly where
  it was, so nothing moves on screen. Effects, gradients and patterns the
  artwork uses go with it.
- **The Symbols panel** (next to Properties, Character and Paragraph) shows
  the drawing's symbols. Click one, then **Place** to add an instance in
  the middle of the view, or double-click it, or drag it onto the canvas
  to drop one where you let go. Rename a symbol with the pen button or by
  double-clicking its name; instances still called after it follow the
  new name. Deleting a symbol that has instances asks whether to **Break
  Links** (the instances stay, as ordinary groups) or **Delete Instances**
  too.
- **Instances are layers like any other.** Select, move, scale, rotate,
  flip, align, duplicate, lock, hide, set their opacity, blend mode and
  Layer Style. The Layers panel marks them with a clover and shows the
  symbol's name. A colour you give an instance goes onto the instance, so
  it only shows on the parts of the symbol that don't have a colour of
  their own; to recolour the artwork itself, edit the symbol.
- **Edit Symbol**: double-click an instance (or use Object → Edit Symbol,
  or the panel's nib button). The rest of the drawing dims and steps back,
  and the symbol's artwork appears in place of that instance, ready to
  edit with every tool. Anything you draw goes into the symbol. Every
  other instance follows as you work. Click **Done** in the bar at the top,
  press Esc, or double-click an empty spot to finish. Each edit is a step
  in the drawing's undo history; undoing while you edit keeps you editing.
- **Object → Break Link to Symbol** turns the selected instances into
  ordinary groups of the symbol's artwork, which no longer follow the
  symbol. They get their own copies of any gradients or effects inside.

Symbols are saved as real SVG `<symbol>` and `<use>` elements, so other
viewers draw them too. They survive saving and reopening, importing into
another drawing (where clashing ids are renamed and the instances follow)
and copy and paste (pasting instances of a symbol the drawing already has
reuses it). Define Pattern on an instance takes the symbol into the tile.
Symbols in an imported file, including the top-level `<symbol>`s of icon
sprite sheets, show up in the panel.

### The Symbols library

The Symbols panel has two views: **This drawing** (the drawing's own
symbols, above) and **Library**, symbols you keep across drawings. The
library lives in this browser with the swatches, gradients and patterns,
and travels in the same Export / Import Library file.

- **Find one** with the category menu and the search box, which matches
  names and categories.
- **Place** it with the clone button, by double-clicking it, or by dragging
  it onto the canvas. Placing adds the symbol to the drawing's own symbols
  (reusing it if the drawing already has the same artwork, so placing an
  icon ten times gives one symbol and ten instances) and puts an instance in
  the middle of the view, or where you drop it. From then on it's an
  ordinary symbol: edit it, break its link, rename it.
- **Save to Library** (the book button under This drawing, or the plus
  button in the library) copies the drawing's selected symbol, or the
  selected instance's, into the library, at the size it is. Saved symbols go
  in the _Saved_ category.
- Rename an entry by double-clicking its name or with the pen button, and
  delete it with the bin button or Alt-click. **Reset** puts the built-in
  icons back (and only touches the symbols).

The library starts with a built-in set of 80 icons from Font Awesome Free
6.7.2 in eleven categories: Arrows, Shapes, Interface, Communication,
Weather, People, Objects, Nature, Charts, Faces and Places. They're placed 64 px tall and in the
current fill colour. The icons don't set a colour of their own, so the
instance's fill paints them: select an instance and pick a colour in the
Color or Swatches panel to recolour it. Each icon's `<symbol>` carries its
credit (`data-credit="Font Awesome Free 6.7.2 — CC BY 4.0"`), so the
attribution stays in any drawing that uses it.

Library files are checked on the way in like any imported drawing: scripts,
event handlers, `javascript:` links and style sheets are taken out of
imported symbols, and entries that don't make sense are skipped.

## File Info

File → File Info… (Alt+Shift+Ctrl+I, as in Photoshop; Inkscape calls it
Document Metadata) describes the drawing: **Title**, **Author**,
**Description**, **Keywords** (comma separated), **Date** (today's date to
start with, free text), **Copyright Status** (Unknown, Copyrighted, Public
Domain), **Copyright Notice**, **Licence**, **Source / Info URL** and
**Language**. The licence is one of CC BY, BY-SA, BY-ND, BY-NC and
BY-NC-SA 4.0, CC0 1.0, All rights reserved, or a custom URL. The source
and a custom licence must be `http://` or `https://` addresses; anything
else is refused with a note under the fields.

- OK is one undo step and puts the \* on the tab; Cancel or Esc throws the
  edits away. Each tab has its own File Info, and it comes back with the
  tab after a reload.
- A titled drawing's tab shows the title in its tooltip.
- **Saved as standard SVG.** The title and description become the root's
  first `<title>` and `<desc>` (screen readers read them, and browsers show
  the title as a tooltip). Everything goes into a `<metadata>` block of
  RDF/XML in the shape Inkscape writes: a `cc:Work` with Dublin Core
  `dc:title`, `dc:creator` and `dc:rights` (each a `cc:Agent`), `dc:date`,
  `dc:description`, `dc:subject` (an `rdf:Bag` of keywords), `dc:source`,
  `dc:language` and `cc:license`, followed by a `cc:License` block listing
  what a Creative Commons licence permits, requires and prohibits.
  Copyright Status uses XMP's `xmpRights:Marked` (`True` copyrighted,
  `False` public domain, left out when unknown), and All rights reserved is
  `xmpRights:UsageTerms`, as Adobe's apps do. The values are written with
  the DOM's XML APIs, so `<`, `&`, quotes and emoji are escaped properly.
- **Read back from files.** Open reads that RDF, including files from
  Inkscape (older `http://` Creative Commons URLs are recognised and
  written back as `https://`), and falls back to a plain `<title>` /
  `<desc>`. Only text and `http(s)` URLs are taken from it: nothing in a
  `<metadata>` block ever enters the drawing, and none of it (or Inkscape's
  `sodipodi:namedview`) shows up as a layer.
- **Import keeps your File Info.** Importing or pasting an SVG into a
  drawing leaves the drawing's own File Info alone. Copy and cut of a
  selection leave the document's File Info out, since it describes the
  whole drawing. Copy as SVG markup with nothing selected copies the whole
  file, File Info included.
- Other RDF fields Inkscape can write (publisher, contributors, identifier,
  relation, coverage) aren't kept; a field the dialog doesn't show is
  dropped when the file is saved again.

## Shortcuts

| Key                   | Action                                    |
| --------------------- | ----------------------------------------- |
| V A                   | Select · Edit points                      |
| P B E I               | Pencil · Pen · Eraser · Eyedropper        |
| R O L T H Z           | Rect · Ellipse · Line · Text · Pan · Zoom |
| Space (hold)          | Pan                                       |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo (Ctrl+Y redoes too)           |
| Ctrl+C / X / V        | Copy / cut / paste (as SVG)               |
| Ctrl+D · Ctrl+A       | Duplicate · select all                    |
| Shift+F7              | Select inverse                            |
| Alt+T · Alt+Shift+T   | Free Transform · Transform Again          |
| Ctrl+G · Ctrl+Shift+G | Group · ungroup                           |
| Ctrl+Alt+G (+ Shift)  | Make / release clipping mask              |
| Ctrl+Shift+O          | Create Outlines                           |
| ] [ · Ctrl+] Ctrl+[   | Forward / backward · to front / to back   |
| Arrows (Shift = 10)   | Nudge                                     |
| Del / Backspace       | Delete                                    |
| X                     | Swap fill and stroke                      |
| + − 0 1               | Zoom in / out · fit · 100%                |
| Ctrl+S · Ctrl+O       | Save as SVG · open                        |
| Ctrl+U                | Show / hide the SVG source                |
| Ctrl+Alt+P            | Show / hide the icon preview              |
| Alt+Shift+Ctrl+I      | File Info                                 |

## SVG source

View → SVG Source (Ctrl+U, as in a browser's view-source) opens a floating
window with the drawing's SVG, exactly as Save as SVG would write it,
including the `@import` for any Google Fonts. It's read-only, laid out one
element per line, indented by nesting, with long attribute lists wrapped,
and coloured for tags, attributes, values, comments and text. Drag the
window by its title bar and resize it from its corner.

- **Live.** The source follows your edits, undo and tab switches. It waits
  while you're selecting text in it, and keeps its scroll position.
- **Linked to the canvas.** Selecting layers highlights their lines and
  scrolls them into view. Clicking an element's start tag selects that
  layer. A run inside a text layer selects the text.
- **Copy** puts the whole source on the clipboard. **Download** saves it
  as an `.svg` file. This doesn't count as saving the drawing, so the tab
  keeps its \*. You can also select any part of the text and copy that.
- **Find** (Ctrl+F in the window) highlights every match. Enter and
  Shift+Enter, or F3, step through them.
- **Wrap** wraps long lines instead of scrolling sideways.
- Long embedded `data:` URIs (images, fonts) are shortened with an … on
  screen, but Copy and Download give the full text. Copying a selection
  with the mouse copies what you see, so use Copy for those.
- Everything in the drawing is shown as text, never run: a text layer that
  says `<script>` shows up as `&lt;script&gt;`, as it is in the file.
- Large drawings stay quick: lines are drawn as they scroll into view.
- Esc closes the window. Keys pressed inside it don't edit the drawing,
  apart from undo, redo, save and open.

## What the saved SVG keeps

Save as SVG writes everything you set in SVGCraft into the file itself, so
opening it again, or importing it into another drawing, gives back the
same editable drawing:

- layer names, hidden layers, locks, blend modes and opacity
- effects, stroke align, custom dashes and per-corner radii
- clipping masks, still live and editable
- gradients, patterns, styled text runs, text on a path, guides and the
  document size
- symbols and their instances
- File Info: title, author, description, keywords, date, copyright and
  licence, as `<title>`, `<desc>` and RDF `<metadata>`. Open brings it
  back; Import leaves the receiving drawing's own (see
  [File Info](#file-info))

Each setting is stored on its element, as a `data-*` attribute
(`data-sc-fx`, `data-sc-lock`, `data-name`, …) or as CSS, next to real SVG
(`<filter>`, `<pattern>`, `<clipPath>`). Other viewers ignore the
attributes but still draw the file correctly. Editors keep attributes with
their element, which comments wouldn't survive. An optimiser told to strip
`data-*` attributes keeps the look but loses the editable settings.

Not saved in the file: undo history and the view (they stay with the
browser's open tabs), and the Swatches / Gradients / Patterns / Symbols
libraries (Export Library saves those). Placed library symbols are in the
file, like any other symbol.

`tests/roundtrip.spec.js` checks all of this.

## Development

The app has no dependencies and no build step: open `index.html`, or serve the
folder. `package.json` is only for the dev tools.

```sh
npm install
npx playwright install chromium   # once
npm test                          # Playwright tests (Chromium)
npm run lint                      # ESLint
npm run format:check              # Prettier (npm run format to fix)
```

**The code.** The editor is split by area into the scripts in `src/`:
`core.js` (state and helpers), `guides.js`, `geometry.js`, `paints.js`,
`type.js`, `points.js`, `export.js`, `libraries.js`, `symbols.js`,
`input.js` and so on, each starting with a line saying what it covers.
They're classic scripts that share one scope, loaded in order by
`index.html`, rather than ES modules: browsers don't load modules from
`file://`, and SVGCraft runs when `index.html` is opened straight from
disk. So a file can use anything another file declares at its top level
once start-up is done; code that runs while the scripts load can only use
what earlier files declared. Two files can't declare the same name (ESLint
checks; the browser would refuse to load the second). ESLint gives each
file the others' top-level names as globals, so typos are still caught.

The tests in `tests/` drive the real app in Chromium, opening `index.html`
straight from disk. Each feature has its own spec, and they check exact
geometry, attributes and rendered pixels. Any page error or console error
fails a test. GitHub Actions (`.github/workflows/ci.yml`) runs format, lint
and the tests on every push, and uploads the Playwright report when
something fails.

**The About page.** `about.html` (Help → About SVGCraft, Feature List or
Keyboard Shortcuts, which open it in its own tab) is a static page with a
feature overview, the shortcuts and the credits. Its screenshots in
`about/` are taken from the real app by `node scripts/gen-about-screens.mjs`,
which opens `about/demo.svg` and shows a different part of the editor in
each shot; run it again when the UI changes. Keep the page's feature list
and shortcut table in step with this README.

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
- Dialogs (New Guide, New Icon, File Info, Layer Style, the export
  dialogs and the name / confirm prompt) are native `<dialog>` elements
  shown modally, so the browser keeps focus inside them, makes the page
  behind inert, and turns Esc into the dialog's own Cancel. The SVG Source
  and Icon Preview windows aren't dialogs: they stay open while you work.
- `window.svgcraft` exposes `state`, `serialize`, `openSvg`, `placeSvg`
  and friends for poking at the editor from the console.

## Credits

Icons are from [Font Awesome Free](https://fontawesome.com) 6.7.2 by
Fonticons, Inc., licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
`icons.js` holds them as SVG snippets keyed by name, and any element marked
`data-icon="name"` gets its snippet at startup, so nothing loads from a CDN.
To add an icon, copy its SVG from fontawesome.com into `icons.js`. The
Combine Shapes glyphs and the gradient glyph are custom.

The Symbols library's built-in icons are also Font Awesome Free 6.7.2
icons, CC BY 4.0 (attribution: Fonticons, Inc., https://fontawesome.com).
They live in `symbols-library.js`, generated from the Font Awesome Free
package by `scripts/gen-symbols-library.mjs` (which lists the icons and
their categories). Placing one puts the credit on its `<symbol>` in the
drawing. No brand icons are included.

Boolean geometry uses [paper.js](http://paperjs.org) 0.12.18 (MIT) and
Create Outlines reads fonts with [opentype.js](https://opentype.js.org)
1.3.4 (MIT), both vendored in `vendor/`. See `vendor/README.md` for their
versions and checksums. The tests serve Lato (SIL Open Font License 1.1)
from `tests/fonts/`.
