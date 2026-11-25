// SVGCraft — the Crop tool (C): a box over the canvas, dragged to the part
// to keep; Enter crops the canvas to it.
'use strict';

// Cropping changes the canvas, not the art: the canvas becomes the box (see
// cropTo in src/view.js), and whatever is left outside is kept, just not
// shown in the export. Crop to Drawing, or a bigger Canvas Size, brings it
// back. The box starts as the canvas; drag its edges or corners, drag
// inside it to move it, or drag outside it for a new one. It can reach
// past the canvas, which adds room there.
const CROP_HANDLES = [
  ['nw', 0, 0],
  ['n', 0.5, 0],
  ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1],
  ['s', 0.5, 1],
  ['sw', 0, 1],
  ['w', 0, 0.5],
];
const CROP_CURSORS = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

tools.crop = {
  hint: 'Drag a box round the part to keep, or drag the box’s edges or corners · Drag inside it to move it · Shift keeps its shape · Enter crops · Esc puts the box back',
  box: null,
  over: null,
  get cursor() {
    const o = this.over;
    return o === 'in' ? 'move' : o ? CROP_CURSORS[o] : 'crosshair';
  },
  page: () => ({ x: 0, y: 0, w: state.w, h: state.h }),
  enter() {
    this.box = this.page();
    this.sync();
  },
  leave() {
    this.g = null;
    this.box = null;
    guides.replaceChildren();
  },
  restored() {
    this.box = this.page();
    this.sync();
  },
  // Which handle (or 'in' the box) is at p, if any.
  hitAt(p) {
    const b = this.box;
    if (!b) return null;
    const r = 7 / state.zoom;
    for (const [k, u, v] of CROP_HANDLES)
      if (Math.abs(p.x - (b.x + u * b.w)) <= r && Math.abs(p.y - (b.y + v * b.h)) <= r) return k;
    if (p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h) return 'in';
    return null;
  },
  down(e, p) {
    let hit = this.hitAt(p);
    // While the box is still the whole canvas, a drag inside it draws a
    // new one (moving the canvas-sized box would get nowhere).
    const b = this.box;
    if (hit === 'in' && !b.x && !b.y && b.w === state.w && b.h === state.h) hit = null;
    this.g = { hit: hit || 'new', p0: p, b0: { ...b } };
  },
  move(e, p) {
    const g = this.g;
    if (!g) {
      this.over = this.hitAt(p);
      return;
    }
    let dx = p.x - g.p0.x;
    let dy = p.y - g.p0.y;
    const b0 = g.b0;
    let b;
    if (g.hit === 'new') {
      let w = Math.abs(dx);
      let h = Math.abs(dy);
      if (e.shiftKey) w = h = Math.max(w, h);
      b = {
        x: dx < 0 ? g.p0.x - w : g.p0.x,
        y: dy < 0 ? g.p0.y - h : g.p0.y,
        w,
        h,
      };
    } else if (g.hit === 'in') b = { ...b0, x: b0.x + dx, y: b0.y + dy };
    else {
      const k = g.hit;
      let x0 = b0.x;
      let y0 = b0.y;
      let x1 = b0.x + b0.w;
      let y1 = b0.y + b0.h;
      if (k.includes('w')) x0 += dx;
      if (k.includes('e')) x1 += dx;
      if (k.includes('n')) y0 += dy;
      if (k.includes('s')) y1 += dy;
      // Shift on a corner keeps the box's shape.
      if (e.shiftKey && k.length === 2 && b0.w && b0.h) {
        const s = Math.max((x1 - x0) / b0.w, (y1 - y0) / b0.h);
        if (k.includes('w')) x0 = x1 - b0.w * s;
        else x1 = x0 + b0.w * s;
        if (k.includes('n')) y0 = y1 - b0.h * s;
        else y1 = y0 + b0.h * s;
      }
      b = {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      };
    }
    // On whole pixels, as the crop will be.
    const x = Math.round(b.x);
    const y = Math.round(b.y);
    this.box = { x, y, w: Math.round(b.x + b.w) - x, h: Math.round(b.y + b.h) - y };
    this.sync();
  },
  up() {
    const g = this.g;
    this.g = null;
    // A click outside the box, without a drag, leaves the box as it was.
    if (g?.hit === 'new' && (this.box.w * state.zoom < 4 || this.box.h * state.zoom < 4))
      this.box = g.b0;
    this.sync();
  },
  // Crop the canvas to the box (whole pixels, rounded out).
  apply() {
    const b = this.box;
    if (!b || b.w < 1 || b.h < 1) return warn('Drag a box round the part to keep first.');
    noteStep('Crop');
    cropTo(b, 'the crop box');
    this.box = this.page();
    this.sync();
  },
  reset() {
    this.box = this.page();
    this.sync();
  },
  key(e) {
    if (e.key === 'Enter') this.apply();
    else if (e.key === 'Escape') this.reset();
    else return false;
    return true;
  },
  // The box, its handles and the shade over what will be cut away, and the
  // options bar's W and H.
  redraw() {
    guides.replaceChildren();
    const b = this.box;
    if (!b || state.tool !== 'crop') return;
    const z = state.zoom;
    // The shade covers the stage as it's seen (redrawn on zoom and pan).
    const r = stage.getBoundingClientRect();
    const x0 = Math.min(-state.panX / z, b.x) - 10;
    const y0 = Math.min(-state.panY / z, b.y) - 10;
    const x1 = Math.max((r.width - state.panX) / z, b.x + b.w) + 10;
    const y1 = Math.max((r.height - state.panY) / z, b.y + b.h) + 10;
    // Above, below, left and right of the box.
    for (const [x, y, w, h] of [
      [x0, y0, x1 - x0, b.y - y0],
      [x0, b.y + b.h, x1 - x0, y1 - b.y - b.h],
      [x0, b.y, b.x - x0, b.h],
      [b.x + b.w, b.y, x1 - b.x - b.w, b.h],
    ])
      mk('rect', { x, y, width: w, height: h, class: 'sc-crop-shade' }, guides);
    mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'sc-crop-box' }, guides);
    // Thirds, to compose by.
    for (const t of [1 / 3, 2 / 3]) {
      mk(
        'line',
        { x1: b.x + b.w * t, y1: b.y, x2: b.x + b.w * t, y2: b.y + b.h, class: 'sc-crop-third' },
        guides,
      );
      mk(
        'line',
        { x1: b.x, y1: b.y + b.h * t, x2: b.x + b.w, y2: b.y + b.h * t, class: 'sc-crop-third' },
        guides,
      );
    }
    const s = 8 / z;
    for (const [k, u, v] of CROP_HANDLES)
      mk(
        'rect',
        {
          x: b.x + u * b.w - s / 2,
          y: b.y + v * b.h - s / 2,
          width: s,
          height: s,
          class: 'sc-handle',
          'data-crop': k,
        },
        guides,
      );
  },
  sync() {
    this.redraw();
    const b = this.box;
    for (const k of ['w', 'h']) {
      const el = $(`#sc-crop-${k}`);
      if (el && document.activeElement !== el) el.value = b ? inUnits(Math.round(b[k])) : '';
    }
  },
};

// The options bar: the box's size (from its top-left corner), Crop and
// Reset, and the two crops that need no box.
for (const k of ['w', 'h'])
  $(`#sc-crop-${k}`).addEventListener('change', (e) => {
    const v = fromUnits(e.target.value);
    const t = tools.crop;
    if (t.box && v >= 1) t.box = { ...t.box, [k]: v };
    t.sync();
  });
$('#sc-crop-apply').addEventListener('click', () => tools.crop.apply());
$('#sc-crop-reset').addEventListener('click', () => tools.crop.reset());
