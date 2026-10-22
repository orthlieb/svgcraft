// SVGCraft — Zoom, pan and document size.
'use strict';

// ---------------------------------------------------------------------
// View (zoom / pan) + document size
// ---------------------------------------------------------------------
function applyView() {
  view.setAttribute('transform', `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
  // The view is kept with the document too.
  if (docsLoaded) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDocs, 400);
  }
  updateTitle();
  const c = 8 / state.zoom;
  const pat = $('#sc-checker');
  pat.setAttribute('width', 2 * c);
  pat.setAttribute('height', 2 * c);
  const r = pat.querySelectorAll('rect');
  r[0].setAttribute('width', 2 * c);
  r[0].setAttribute('height', 2 * c);
  for (const [i, el] of [r[1], r[2]].entries()) {
    el.setAttribute('width', c);
    el.setAttribute('height', c);
    el.setAttribute('x', i * c);
    el.setAttribute('y', i * c);
  }
  $('#sc-gridline').setAttribute('stroke-width', 1 / state.zoom);
  drawPixelGrid();
  drawRulers();
  drawSelection();
  tools[state.tool].redraw?.();
}

function zoomAt(z, sx, sy) {
  z = clamp(z, 0.02, 64);
  const r = stage.getBoundingClientRect();
  if (sx == null) {
    sx = r.width / 2;
    sy = r.height / 2;
  }
  const dx = (sx - state.panX) / state.zoom;
  const dy = (sy - state.panY) / state.zoom;
  state.zoom = z;
  state.panX = sx - dx * z;
  state.panY = sy - dy * z;
  applyView();
}

function fit() {
  const r = stage.getBoundingClientRect();
  const pad = Math.min(48, r.width * 0.06);
  const z = Math.min((r.width - pad * 2) / state.w, (r.height - pad * 2) / state.h);
  state.zoom = clamp(z, 0.02, 64);
  state.panX = (r.width - state.w * state.zoom) / 2;
  state.panY = (r.height - state.h * state.zoom) / 2;
  applyView();
}

// Fill Screen: the artboard covers the whole stage, centred.
function fillScreen() {
  const r = stage.getBoundingClientRect();
  state.zoom = clamp(Math.max(r.width / state.w, r.height / state.h), 0.02, 64);
  state.panX = (r.width - state.w * state.zoom) / 2;
  state.panY = (r.height - state.h * state.zoom) / 2;
  applyView();
}

// Photoshop's zoom presets, as fractions: the Zoom tool's clicks step
// through these.
const ZOOM_STEPS = [
  0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5,
  6, 7, 8, 12, 16, 24, 32, 48, 64,
];
function zoomStep(z, out) {
  return out
    ? (ZOOM_STEPS.findLast((v) => v < z / 1.001) ?? ZOOM_STEPS[0])
    : (ZOOM_STEPS.find((v) => v > z * 1.001) ?? ZOOM_STEPS.at(-1));
}

function setSize(w, h) {
  state.w = clamp(+w || 1, 1, 20000);
  state.h = clamp(+h || 1, 1, 20000);
  for (const id of ['#sc-board-bg', '#sc-grid-rect', '#sc-board-frame']) {
    $(id).setAttribute('width', state.w);
    $(id).setAttribute('height', state.h);
  }
  $('#sc-w').value = f(state.w);
  $('#sc-h').value = f(state.h);
  drawPixelGrid();
  drawKeylines();
  updateTitle();
}

// Image → Crop: make the artboard exactly box (rounded out to whole
// pixels). The artboard always starts at 0,0, so everything, guides
// included, shifts by the box's corner; the view shifts with it so nothing
// jumps on screen. Anything left outside is kept but not exported.
function cropTo(box, what) {
  if (!box || box.w <= 0 || box.h <= 0) return say(`There’s nothing visible to crop to.`);
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  const w = Math.ceil(box.x + box.w) - x;
  const h = Math.ceil(box.y + box.h) - y;
  if (x === 0 && y === 0 && w === state.w && h === state.h)
    return say(`The artboard already fits ${what}.`);
  exitIso();
  if (x || y) {
    const T = new DOMMatrix().translate(-x, -y);
    for (const el of doc.children) if (el instanceof SVGGraphicsElement) transformDoc(el, T);
    for (const g of state.guides) g.pos -= g.axis === 'x' ? x : y;
  }
  setSize(w, h);
  state.panX += x * state.zoom;
  state.panY += y * state.zoom;
  renderGuides();
  applyView();
  commit();
  say(`Cropped to ${what}: ${w} × ${h} px.`);
}

// Document tab ("name.svg @ 100%") and the status-bar zoom / size readouts.
function updateTitle() {
  const pct = Math.round(state.zoom * 1000) / 10;
  const t = $('#sc-doc-title');
  if (t)
    t.textContent = `${state.fileName}.svg${curDoc && dirty(curDoc) ? '*' : ''} @ ${pct}% (SVG)`;
  document.title = `${state.fileName}.svg${curDoc && dirty(curDoc) ? '*' : ''} · SVGCraft`;
  const z = $('#sc-zoom-input');
  if (document.activeElement !== z) z.value = pct;
  $('#sc-docsize').textContent = `${f(state.w)} × ${f(state.h)} px`;
}

function setGrid() {
  const g = state.gridSize;
  const pat = $('#sc-gridpat');
  pat.setAttribute('width', g);
  pat.setAttribute('height', g);
  $('#sc-gridline').setAttribute('d', `M${g} 0H0V${g}`);
  $('#sc-grid-rect').setAttribute('display', state.grid ? 'inline' : 'none');
}
