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

// Settings kept in this browser (localStorage). Strings are stored as they
// are (the theme is read that way before the scripts load), anything else
// as JSON. Storage can be blocked or full: then a read gives the fallback
// and a write returns false, lasting for this visit only.
function stored(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
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
  // sides and star ratio (100 = a plain polygon) and new lines' arrowheads.
  // (Custom Shape draws the Symbols library's current one, libSel.symbols.)
  shape: 'rect',
  polySides: 5,
  starRatio: 100,
  arrows: { start: false, end: false },
  radiusLinked: true,
  fillGrad: null, // { type, stops, angle } when the fill is a gradient
  strokeGrad: null,
  fillPat: null, // { id, name, w, h, svg, scale, angle } when the fill is a pattern
  strokePat: null,
  gradStop: 0, // selected stop in the gradient editor
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
let scope = null; // the group isolated (isolation mode, src/scope.js), or null

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
function showDialog(d, onCancel = () => hideDialog(d)) {
  d.oncancel = (e) => {
    e.preventDefault();
    onCancel();
  };
  dialogError(d);
  if (!d.open) d.showModal();
  // Where it was dragged to, still on screen if the window got smaller.
  if (d.style.left) winClamp(d);
}
// A value a dialog can't take: said in the dialog, above its buttons, with
// the field marked and focused, and the dialog left open. With no field,
// clears it (as opening the dialog, or changing the field, does).
function dialogError(d, field, msg) {
  for (const el of d.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  let err = d.querySelector(':scope .sc-dlg-err');
  if (!field) {
    if (err) err.hidden = true;
    return;
  }
  if (!err) {
    err = document.createElement('p');
    err.className = 'sc-dlg-err';
    err.setAttribute('role', 'alert');
    const foot = d.querySelector('.sc-dialog-foot');
    if (foot) foot.before(err);
    else d.append(err);
    d.addEventListener('input', (e) => {
      if (e.target.getAttribute('aria-invalid')) dialogError(d);
    });
  }
  err.textContent = msg;
  err.hidden = false;
  field.setAttribute('aria-invalid', 'true');
  field.focus();
  field.select?.();
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

// Messages. say() is news (done, saved, now on landscape): a line in the
// status bar for a few seconds. warn() is an error, or a refusal to do
// something: it shows above the status bar in red with a warning sign and
// stays until it's dismissed (✕) or a newer one replaces it, so it can't be
// missed. With `details` (an unexpected bug's report) it adds Copy details.
let msgTimer = 0;
// A message in the status bar; with `undo`, an Undo button after it that
// takes it back (and the message stays longer, to reach it).
function say(text, undo = null) {
  const m = $('#sc-msg');
  m.textContent = text;
  if (undo) {
    const b = document.createElement('button');
    b.className = 'sc-linkbtn sc-msg-undo';
    b.textContent = 'Undo';
    b.addEventListener('click', () => {
      m.textContent = '';
      undo();
    });
    m.append(' ', b);
  }
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (m.textContent = ''), undo ? 8000 : 3500);
}
let alertDetails = '';
let alertMore = null;
// A warning in the bar over the canvas. details: text for its Copy details
// button; more: what its More info button does.
// A plain alert (no More info or details) goes when it no longer applies:
// on Esc, the next change to the drawing, or a new selection.
let alertAt = 0;
function staleAlert() {
  const a = $('#sc-alert');
  if (!a.hidden && !alertMore && !alertDetails && performance.now() - alertAt > 400)
    a.hidden = true;
}
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && !$('#sc-alert').hidden) $('#sc-alert').hidden = true;
  },
  true,
);
function warn(text, { details = '', more = null } = {}) {
  alertAt = performance.now();
  clearTimeout(msgTimer);
  $('#sc-msg').textContent = '';
  const a = $('#sc-alert');
  $('#sc-alert-text').textContent = text;
  alertDetails = details;
  alertMore = more;
  $('#sc-alert-copy').hidden = !details;
  $('#sc-alert-more').hidden = !more;
  a.hidden = false;
  // A repeat of the same message pulses, so it's seen to be new.
  a.classList.remove('sc-alert-new');
  void a.offsetWidth;
  a.classList.add('sc-alert-new');
}
$('#sc-alert-close').addEventListener('click', () => ($('#sc-alert').hidden = true));
$('#sc-alert-more').addEventListener('click', () => alertMore?.());
$('#sc-alert-copy').addEventListener('click', () =>
  navigator.clipboard.writeText(alertDetails).then(
    () => say('Copied the details: paste them into your report.'),
    () => {
      // No clipboard: show them in the console to copy from there.
      console.info(alertDetails);
      say('Couldn’t reach the clipboard: the details are in the console.');
    },
  ),
);

// Unexpected bugs: an exception nothing caught, or a promise that failed
// with nothing waiting for it, would otherwise just leave a command
// half-done with nothing on screen. Say so, with a report to copy (the
// console has it too). A run of them shows only the first few.
let bugsShown = 0;
function reportBug(err, how) {
  const e = err instanceof Error ? err : null;
  const text = String(e?.message ?? err?.message ?? err ?? 'unknown error');
  if (++bugsShown > 5) return;
  const details = [
    `SVGCraft ${typeof APP_VERSION === 'string' ? APP_VERSION : '(version unknown)'}`,
    `${new Date().toISOString()} · ${how}`,
    navigator.userAgent,
    '',
    e?.stack || text,
  ].join('\n');
  warn(`Something went wrong: ${text}. What you were doing may not have finished.`, {
    details,
  });
}
addEventListener('error', (e) => {
  // Not ours to report: "Script error." from another origin's script, and
  // the browser's harmless ResizeObserver notice.
  if (!e.error && /^Script error|ResizeObserver loop/.test(e.message || '')) return;
  reportBug(e.error || e.message, 'uncaught exception');
});
addEventListener('unhandledrejection', (e) => reportBug(e.reason, 'unhandled promise rejection'));
