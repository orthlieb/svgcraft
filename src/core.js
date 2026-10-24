// SVGCraft — a small, dependency-free in-browser SVG editor.
//
// The drawing lives in <g id="sc-doc"> (plus <defs id="sc-defs">) inside the
// stage SVG, in document units. #sc-view carries the zoom/pan transform, so
// every overlay (selection box, pen preview, eraser ring) is drawn in the
// same coordinate space and scaled back with 1/zoom where it must stay a
// fixed screen size. Only *top-level* children of #sc-doc are selectable;
// their transform attribute is always rewritten as one matrix(...) so move /
// scale / rotate / flip are all "pre-multiply a matrix".
//
// See CENSUS.md for why the feature set looks the way it does.
//
// src/core.js: Constants, editor state and small helpers.
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const STORE_KEY = 'svgcraft.v1';
const SHAPE_SEL = 'path,rect,circle,ellipse,line,polyline,polygon,text,tspan,use';
const NON_GRAPHIC = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'script']);
const PALETTE = [
  'none',
  '#000000',
  '#ffffff',
  '#6b7280',
  '#1f2933',
  '#dc2626',
  '#f97316',
  '#e8a33d',
  '#facc15',
  '#84cc16',
  '#16a34a',
  '#14b8a6',
  '#0ea5e9',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#92400e',
  '#fde7c8',
];

const $ = (s) => document.querySelector(s);
const icon = (name) => window.SC_ICONS?.[name] || '';
const THEME_KEY = 'svgcraft.theme';
let previewMode = false; // phone-sized screen: view only (see syncPreview)

// Fill every data-icon="name" placeholder with its Font Awesome snippet.
function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
}
const stage = $('#sc-stage');
const view = $('#sc-view');
const doc = $('#sc-doc');
const defs = $('#sc-defs');
const selLayer = $('#sc-selection');
const guides = $('#sc-guides');

const state = {
  tool: 'select',
  zoom: 1,
  zoomOut: false, // Zoom tool steps out instead of in
  scrubby: true, // Zoom tool drags zoom smoothly instead of drawing a box
  panX: 0,
  panY: 0,
  w: 800,
  h: 600,
  sel: [],
  grid: false,
  snap: false,
  gridSize: 20,
  // Lengths shown and typed in (src/units.js); the drawing is always px.
  units: 'px',
  fileName: 'Untitled-1',
  eraserMode: 'object',
  eyedropMode: 'style',
  autoSelect: 'group',
  tf: null, // an open Free Transform / Scale / Rotate / Skew session
  eraserSize: 12,
  smoothing: 4,
  type: {
    family: 'System UI',
    weight: 400,
    italic: false,
    size: 32,
    leading: 0,
    tracking: 0,
    shift: 0,
    script: 'none',
    caps: 'none',
    underline: false,
    strike: false,
    align: 'start',
    box: 0,
  },
  active: 'fill',
  fillOn: true,
  fill: '#e8a33d',
  fillA: 1,
  strokeOn: true,
  stroke: '#1f2933',
  strokeA: 1,
  strokeWidth: 3,
  dashPat: [4, 2], // Custom dashes: dash, gap, … in multiples of the stroke width
  strokeAlign: 'center', // 'inside' | 'center' | 'outside', closed shapes only
  cap: 'round', // stroke-linecap for new strokes: butt | round | square
  join: 'round', // stroke-linejoin: miter | round | bevel
  dash: 'solid', // solid | dash | dot | long (sized from the stroke width)
  radius: 0, // corner radius for new rectangles
  // The Shape tool group (src/shapes.js): its current tool, new polygons'
  // sides and star ratio (100 = a plain polygon), new lines' arrowheads,
  // and the Symbols-library shape Custom Shape draws.
  shape: 'rect',
  polySides: 5,
  starRatio: 100,
  arrows: { start: false, end: false },
  customShape: '',
  radiusLinked: true,
  fillGrad: null, // { type, stops, angle } when the fill is a gradient
  strokeGrad: null,
  fillPat: null, // { id, name, w, h, svg, scale, angle } when the fill is a pattern
  strokePat: null,
  gradStop: 0, // selected stop in the gradient editor
  gradType: 'linear', // type the Gradient tool lays down
  guides: [], // { axis: 'x' | 'y', pos }
  meta: {}, // File Info: see cleanMeta
  guidesOn: true,
  guidesLocked: false,
  snapGuides: true,
  smart: true, // smart guides: snap to other objects and the artboard
  pixelGrid: false, // View → Pixel Grid (from 600%)
  snapPixel: false, // View → Snap to Pixel
  keylines: false, // View → Icon Keylines
  rulers: true,
  opacity: 1,
};

// The symbol being edited in place, if any (see enterIso).
let iso = null;

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
const f = (n) => +(+n).toFixed(2);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A floating window or dialog: drag it by its title bar (the ⠿ grip on
// the left), and keep it on screen. A dialog starts centred near the top;
// once dragged it stays where it was put for the session.
const shownWin = (win) => (win.localName === 'dialog' ? win.open : !win.hidden);
function winClamp(win) {
  const r = win.getBoundingClientRect();
  win.style.left = `${clamp(r.left, 0, Math.max(0, innerWidth - 120))}px`;
  win.style.top = `${clamp(r.top, 0, Math.max(0, innerHeight - 40))}px`;
}
function dragWindow(win, bar) {
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, a') || win.dataset.docked)
      return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    // From centred by transform to placed by position.
    win.style.transform = 'none';
    win.style.left = `${r.left}px`;
    win.style.top = `${r.top}px`;
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      win.style.left = `${ev.clientX - dx}px`;
      win.style.top = `${ev.clientY - dy}px`;
      winClamp(win);
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
  window.addEventListener(
    'resize',
    () => shownWin(win) && !win.dataset.docked && win.style.left && winClamp(win),
  );
}
// Every dialog's title bar is a drag bar, with the grip on its left (drawn
// by style.css, so code that sets a title's text leaves it alone).
for (const d of document.querySelectorAll('dialog.sc-dialog')) {
  const bar = d.querySelector(':scope > .sc-dialog-title');
  if (bar) dragWindow(d, bar);
}

// Dialogs are native <dialog>s, shown modally: the browser moves them to
// the top layer, keeps focus inside and makes the page behind inert. Esc
// (the dialog's cancel) runs the dialog's own Cancel.
function showDialog(d, onCancel) {
  d.oncancel = (e) => {
    e.preventDefault();
    onCancel();
  };
  if (!d.open) d.showModal();
  // Where it was dragged to, still on screen if the window got smaller.
  if (d.style.left) winClamp(d);
}
function hideDialog(d) {
  if (d.open) d.close();
}

function mk(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (parent) parent.append(el);
  return el;
}

// The SVG Source window's state (see openSource); afterChange and
// drawSelection look at it from the start, so it lives up here.
const srcView = {
  open: false,
  timer: 0,
  text: null,
  full: '',
  lines: [],
  spans: new Map(),
  rows: [],
  chunks: [],
  flags: null,
  shown: null,
  sel: [],
  hits: [],
  hit: -1,
  pointer: false,
};

let msgTimer = 0;
function say(text) {
  const m = $('#sc-msg');
  m.textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (m.textContent = ''), 3500);
}
