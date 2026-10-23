// SVGCraft — Document units (px, mm, cm, in, pt) and page-size presets.
'use strict';

// The drawing is always in pixels inside (1 user unit = 1 CSS px, 96 per
// inch), so nothing about shapes, strokes or zoom changes. The units are
// how lengths are shown and typed: the rulers, the artboard size, guide
// positions, the X/Y/W/H fields, Image and Canvas Size, the grid and the
// status bar. A drawing in mm, cm, in or pt is saved with real-world
// width and height (width="210mm"), so print and cutting software know
// its size; the viewBox stays in pixels. Strokes, type and effects stay in
// pixels, as in Photoshop.
// name, px per unit, a round grid size in that unit.
const UNITS = {
  px: ['Pixels', 1, 20],
  mm: ['Millimetres', 96 / 25.4, 5],
  cm: ['Centimetres', 96 / 2.54, 0.5],
  in: ['Inches', 96, 0.25],
  pt: ['Points', 96 / 72, 12],
};
// Changing units gives the grid that unit's round size.
function unitGrid() {
  const [, k, g] = UNITS[state.units];
  state.gridSize = g * k;
  setGrid();
}
// Lengths a file may give its width and height in (pc: picas).
const LENGTH_PX = {
  ...Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v[1]])),
  pc: 16,
};
const uPx = () => UNITS[state.units]?.[1] || 1;
// A length in pixels, in the document's units (a number for fields).
const inUnits = (px) => f(px / uPx());
// A typed length in the document's units, in pixels.
const fromUnits = (v) => +v * uPx();
// A length to show: "12.5 mm", or "800 px".
const showLen = (px) => `${inUnits(px)} ${state.units}`;
// A width or height attribute ("210mm", "8.5in", "800"): { px, unit }.
function parseLength(v) {
  const m = /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(px|mm|cm|in|pt|pc)?\s*$/i.exec(v || '');
  if (!m) return null;
  const unit = (m[2] || 'px').toLowerCase();
  return { px: +m[1] * LENGTH_PX[unit], unit };
}

// Page sizes: name, short side, long side, units. Portrait unless the
// artboard is wider than tall, which keeps a landscape page landscape.
const PAGE_PRESETS = {
  a5: ['A5', 148, 210, 'mm'],
  a4: ['A4', 210, 297, 'mm'],
  a3: ['A3', 297, 420, 'mm'],
  letter: ['US Letter', 8.5, 11, 'in'],
  legal: ['US Legal', 8.5, 14, 'in'],
  tabloid: ['Tabloid', 11, 17, 'in'],
  card: ['Business card', 55, 85, 'mm'],
  hd: ['Full HD screen', 1080, 1920, 'px'],
  square: ['Square post', 1080, 1080, 'px'],
};
const unitSel = $('#sc-units');
const pageSel = $('#sc-page');
for (const [k, [name]] of Object.entries(UNITS))
  unitSel.append(
    Object.assign(document.createElement('option'), { value: k, textContent: k, title: name }),
  );
for (const [k, [name, a, b, u]] of Object.entries(PAGE_PRESETS))
  pageSel.append(
    Object.assign(document.createElement('option'), {
      value: k,
      textContent: name,
      title: `${a} × ${b} ${u}`,
    }),
  );

// Which preset the artboard is, either way round, or ''.
function pagePreset() {
  for (const [k, [, a, b, u]] of Object.entries(PAGE_PRESETS)) {
    const [pa, pb] = [a, b].map((v) => v * LENGTH_PX[u]);
    const near = (x, y) => Math.abs(x - y) < 0.05;
    if ((near(state.w, pa) && near(state.h, pb)) || (near(state.w, pb) && near(state.h, pa)))
      return k;
  }
  return '';
}

// Every field label, readout and ruler that shows a length.
function syncUnits() {
  for (const el of document.querySelectorAll('[data-doc-unit]')) el.textContent = state.units;
  unitSel.value = state.units;
  pageSel.value = pagePreset();
  $('#sc-w').value = inUnits(state.w);
  $('#sc-h').value = inUnits(state.h);
  $('#sc-grid-size').value = inUnits(state.gridSize);
  $('#sc-docsize').textContent = `${inUnits(state.w)} × ${inUnits(state.h)} ${state.units}`;
}

function setUnits(u) {
  if (!UNITS[u] || u === state.units) return;
  state.units = u;
  unitGrid();
  syncUnits();
  drawRulers();
  drawSelection();
  commit();
  say(`Units: ${UNITS[u][0].toLowerCase()}.`);
}

// A page preset: its size (keeping the artboard's orientation) and units.
function setPage(k) {
  const p = PAGE_PRESETS[k];
  if (!p) return;
  const [name, a, b, u] = p;
  const land = state.w > state.h && a !== b;
  if (state.units !== u) {
    state.units = u;
    unitGrid();
  }
  setSize(...(land ? [b, a] : [a, b]).map((v) => v * LENGTH_PX[u]));
  fit();
  commit();
  say(`Page size: ${name}${land ? ', landscape' : ''}.`);
}
// Turn the page: width and height swap.
function turnPage() {
  if (state.w === state.h) return say('A square page looks the same either way.');
  setSize(state.h, state.w);
  fit();
  commit();
  say(state.w > state.h ? 'Landscape.' : 'Portrait.');
}

unitSel.addEventListener('change', () => setUnits(unitSel.value));
pageSel.addEventListener('change', () => (pageSel.value ? setPage(pageSel.value) : syncUnits()));
$('#sc-orient').addEventListener('click', turnPage);
