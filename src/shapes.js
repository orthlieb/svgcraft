// SVGCraft — The Shape tool group (U): Rectangle, Ellipse, Triangle,
// Polygon / Star, Line (with arrowheads) and Custom Shape.
'use strict';

// As in Photoshop, the toolbar shows one Shape tool: the last one used.
// Its flyout (hold the button, right-click it, or click its corner mark)
// lists them all; U picks it and Shift+U steps through the group.
const SHAPE_TOOLS = ['rect', 'ellipse', 'triangle', 'polygon', 'line', 'custom'];

// ---- live polygons -----------------------------------------------------------
// A triangle or polygon / star keeps what made it in data-sc-shape: kind,
// sides (n), star ratio (r, 100 = no points inward) and the box it fills, so
// Properties can change its sides or ratio later. Editing its points by
// hand makes it an ordinary polygon.
function readShape(el) {
  if (el?.localName !== 'polygon') return null;
  let d;
  try {
    d = JSON.parse(el.getAttribute('data-sc-shape') || 'null');
  } catch {
    return null;
  }
  if (!d || (d.k !== 'polygon' && d.k !== 'triangle')) return null;
  const num = (v, lo, hi, def) => (v != null && isFinite(+v) ? clamp(+v, lo, hi) : def);
  return {
    k: d.k,
    n: Math.round(num(d.n, 3, 100, 5)),
    r: num(d.r, 1, 100, 100),
    x: num(d.x, -1e6, 1e6, 0),
    y: num(d.y, -1e6, 1e6, 0),
    w: num(d.w, 0, 1e6, 0),
    h: num(d.h, 0, 1e6, 0),
  };
}
function newShape(kind, box) {
  const b = { x: f(box.x), y: f(box.y), w: f(box.w), h: f(box.h) };
  return kind === 'triangle'
    ? { k: 'triangle', n: 3, r: 100, ...b }
    : { k: 'polygon', n: state.polySides, r: state.starRatio, ...b };
}
// The points, filling the box exactly: a triangle points up; a polygon
// starts at the top, and a star puts every other point at the ratio.
function shapePoints(s) {
  let pts;
  if (s.k === 'triangle')
    pts = [
      [0.5, 0],
      [1, 1],
      [0, 1],
    ];
  else {
    const m = s.r < 100 ? s.n * 2 : s.n;
    pts = [];
    for (let i = 0; i < m; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / m;
      const rr = s.r < 100 && i % 2 ? s.r / 100 : 1;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
    const [sw, sh] = [Math.max(...xs) - x0 || 1, Math.max(...ys) - y0 || 1];
    pts = pts.map(([u, v]) => [(u - x0) / sw, (v - y0) / sh]);
  }
  return pts.map(([u, v]) => `${f(s.x + u * s.w)},${f(s.y + v * s.h)}`).join(' ');
}
function writeShape(el, s) {
  el.setAttribute('points', shapePoints(s));
  el.setAttribute('data-sc-shape', JSON.stringify(s));
}
// Still as it was drawn (its points haven't been edited by hand).
const liveShape = (el) => {
  const s = readShape(el);
  return s && el.getAttribute('points') === shapePoints(s) ? s : null;
};

// ---- arrowheads ---------------------------------------------------------------
// One shared marker, drawn in each line's own stroke colour (context-stroke)
// and sized by its stroke width; the start one is turned round.
function arrowMarker() {
  let m = defs.querySelector(':scope > marker[data-sc-arrow]');
  if (!m) {
    m = mk(
      'marker',
      {
        id: newDefId('sc-arrow'),
        'data-sc-arrow': '',
        viewBox: '0 0 10 10',
        // The tip sits half a stroke past the end, over a round or square cap.
        refX: '8.75',
        refY: '5',
        markerWidth: '4',
        markerHeight: '4',
        orient: 'auto-start-reverse',
      },
      defs,
    );
    mk('path', { d: 'M0 0L10 5L0 10Z', fill: 'context-stroke' }, m);
  }
  return m.id;
}
const ARROWABLE = (el) =>
  el.localName === 'line' ||
  el.localName === 'polyline' ||
  (el.localName === 'path' && !/z/i.test(el.getAttribute('d') || ''));
const arrowsOf = (el) => ({
  start: el.hasAttribute('marker-start'),
  end: el.hasAttribute('marker-end'),
});
function setArrows(el, { start, end }) {
  for (const [k, on] of [
    ['marker-start', start],
    ['marker-end', end],
  ])
    if (on) el.setAttribute(k, `url(#${arrowMarker()})`);
    else el.removeAttribute(k);
}

// ---- Custom Shape: a Symbols-library shape drawn into a box ----------------------
// The shape is the Symbols library's current one: picking it here or
// clicking a tile in the panel's Library is the same.
const customItem = () => libItem('symbols', libSel.symbols) || lib.symbols[0] || null;
libPickers.symbols = libPicker($('#sc-custom-shape'), {
  label: 'Custom shape',
  items: () => lib.symbols,
  current: customItem,
  thumb: libSymThumb,
  cats: true,
  pick: (it) => pickLibSymbol(it.id),
  manage: () => {
    showTab('symbols');
    setSymView('lib');
  },
  manageLabel: 'Manage in the Symbols panel',
});
// An instance of the shape, fitted (proportions kept) and centred in box.
function placeCustom(box) {
  const item = customItem();
  if (!item) return warn('The Symbols library is empty: add a symbol to draw it as a shape.');
  const sym = libSymbolFor(item);
  if (!sym) return warn(`Couldn’t read the library symbol “${item.name}”.`);
  const paint =
    state.fillOn && !state.fillGrad && !state.fillPat
      ? { fill: state.fill, 'fill-opacity': state.fillA < 1 ? f(state.fillA) : null }
      : {};
  const u = mk('use', { href: `#${sym.id}`, 'data-name': symName(sym), ...paint }, doc);
  const b = bboxDoc(u);
  if (b && b.w > 0 && b.h > 0) {
    const s = Math.min(box.w / b.w, box.h / b.h);
    const t = (c, bc, bw) => c - (bc + bw / 2) * s;
    setM(
      u,
      new DOMMatrix([s, 0, 0, s, t(box.x + box.w / 2, b.x, b.w), t(box.y + box.h / 2, b.y, b.h)]),
    );
  }
  state.sel = [u];
  commit();
  return u;
}
tools.custom = {
  hint: 'Drag to draw the custom shape (it keeps its proportions) · Alt draws from the centre · Click for an exact size',
  cursor: 'crosshair',
  down(e, p) {
    this.p0 = snapPt(p);
    this.box = null;
    this.ghost = mk('rect', { class: 'sc-ov sc-ov-dash' }, selLayer);
    this.move(e, p);
  },
  move(e, p) {
    if (!this.ghost) return;
    p = snapPt(p);
    const a = this.p0;
    let w = p.x - a.x;
    let h = p.y - a.y;
    if (e.shiftKey) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * s;
      h = Math.sign(h || 1) * s;
    }
    const k = e.altKey ? 2 : 1;
    const x = e.altKey ? a.x - Math.abs(w) : Math.min(a.x, a.x + w);
    const y = e.altKey ? a.y - Math.abs(h) : Math.min(a.y, a.y + h);
    this.box = { x, y, w: Math.abs(w) * k, h: Math.abs(h) * k };
    for (const [n, v] of Object.entries({ x, y, width: this.box.w, height: this.box.h }))
      this.ghost.setAttribute(n, f(v));
  },
  up() {
    if (!this.ghost) return;
    this.ghost.remove();
    this.ghost = null;
    const b = this.box;
    if (!b || (b.w * state.zoom < 2 && b.h * state.zoom < 2)) openCreateShape('custom', this.p0);
    else placeCustom(b);
  },
  cancel() {
    this.ghost?.remove();
    this.ghost = null;
  },
  enter() {
    libPickers.symbols.sync();
  },
};

// ---- the group: toolbar button and flyout ------------------------------------------
const shapeBtn = $('#sc-shape-btn');
const shapeMenu = $('#sc-shape-menu');
// Called by setTool: the button shows (and presses for) the group's tool.
function syncShapeButton() {
  if (SHAPE_TOOLS.includes(state.tool)) state.shape = state.tool;
  const on = SHAPE_TOOLS.includes(state.tool);
  shapeBtn.setAttribute('aria-pressed', on);
  const [ic, name] = TOOL_META[state.shape];
  shapeBtn.querySelector('[data-shape-icon]').innerHTML = icon(ic);
  shapeBtn.setAttribute('aria-label', name);
  shapeBtn.dataset.tip = name;
  for (const b of shapeMenu.querySelectorAll('[data-shape-tool]'))
    b.setAttribute('aria-checked', b.dataset.shapeTool === state.shape);
}
const shapeFlyout = toolFlyout(shapeBtn, shapeMenu, () => setTool(state.shape));
// U: the group's tool; Shift+U: the next one in the group.
function shapeKey(next) {
  const i = SHAPE_TOOLS.indexOf(state.shape);
  setTool(
    next && SHAPE_TOOLS.includes(state.tool)
      ? SHAPE_TOOLS[(i + 1) % SHAPE_TOOLS.length]
      : state.shape,
  );
}
for (const b of shapeMenu.querySelectorAll('[data-shape-tool]'))
  b.addEventListener('click', () => {
    shapeFlyout.close();
    setTool(b.dataset.shapeTool);
  });

// ---- options bar -----------------------------------------------------------------
for (const el of document.querySelectorAll('[data-shape-opt]'))
  el.addEventListener('change', () => {
    const k = el.dataset.shapeOpt;
    if (k === 'sides') state.polySides = clamp(Math.round(+el.value) || 5, 3, 100);
    else if (k === 'ratio') state.starRatio = clamp(Math.round(+el.value) || 100, 1, 100);
    else if (k === 'arrowStart') state.arrows.start = el.checked;
    else if (k === 'arrowEnd') state.arrows.end = el.checked;
    syncShapeOptions();
  });
function syncShapeOptions() {
  for (const el of document.querySelectorAll('[data-shape-opt]')) {
    const k = el.dataset.shapeOpt;
    if (k === 'sides') el.value = state.polySides;
    else if (k === 'ratio') el.value = state.starRatio;
    else el.checked = state.arrows[k === 'arrowStart' ? 'start' : 'end'];
  }
}
syncShapeOptions();

// ---- Properties: the selected polygons' sides and ratio, lines' arrowheads -------------
const shapeProps = $('#sc-shape-props');
const propPolys = () =>
  shapesIn(state.sel, 'polygon').filter((el) => liveShape(el)?.k === 'polygon');
const propLines = () => shapesIn(state.sel, 'line,polyline,path').filter(ARROWABLE);
function syncShapeUI() {
  const polys = propPolys();
  const lines = propLines();
  shapeProps.hidden = !polys.length && !lines.length;
  shapeProps.querySelector('[data-shape-poly]').hidden = !polys.length;
  shapeProps.querySelector('[data-shape-arrows]').hidden = !lines.length;
  const set = (k, v) => {
    const el = shapeProps.querySelector(`[data-shape-prop="${k}"]`);
    if (document.activeElement === el) return;
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
  };
  if (polys.length) {
    const s = liveShape(polys[0]);
    set('sides', s.n);
    set('ratio', s.r);
  }
  if (lines.length) {
    set(
      'arrowStart',
      lines.every((el) => arrowsOf(el).start),
    );
    set(
      'arrowEnd',
      lines.every((el) => arrowsOf(el).end),
    );
  }
}
for (const el of shapeProps.querySelectorAll('[data-shape-prop]'))
  el.addEventListener('change', () => {
    const k = el.dataset.shapeProp;
    const els = k.startsWith('arrow') ? propLines() : propPolys();
    if (!els.length || refuseLocked(state.sel, 'edit')) return;
    for (const t of els) {
      if (k === 'arrowStart' || k === 'arrowEnd')
        setArrows(t, { ...arrowsOf(t), [k === 'arrowStart' ? 'start' : 'end']: el.checked });
      else {
        const s = liveShape(t);
        if (k === 'sides') s.n = clamp(Math.round(+el.value) || s.n, 3, 100);
        else s.r = clamp(Math.round(+el.value) || s.r, 1, 100);
        writeShape(t, s);
      }
    }
    commit();
    syncShapeUI();
  });

// ---- Create (a click without dragging): an exact size ----------------------------------
const csDialog = $('#sc-createshape');
const csField = (k) => csDialog.querySelector(`[data-cs-shape="${k}"]`);
const createShape = { kind: 'rect', at: { x: 0, y: 0 }, w: 100, h: 100 };
function openCreateShape(kind, at) {
  Object.assign(createShape, { kind, at });
  $('#sc-cs-shape-title').textContent = `Create ${TOOL_META[kind][1]}`;
  csField('w').value = inUnits(createShape.w);
  csField('h').value = inUnits(createShape.h);
  csField('sides').value = state.polySides;
  csField('ratio').value = state.starRatio;
  csField('radius').value = state.radius;
  for (const el of csDialog.querySelectorAll('[data-cs-for]'))
    el.hidden = !el.dataset.csFor.split(' ').includes(kind);
  showDialog(csDialog, () => closeCreateShape(false));
  setTimeout(() => csField('w').select(), 0);
}
function closeCreateShape(ok) {
  hideDialog(csDialog);
  if (!ok) return;
  const w = fromUnits(+csField('w').value);
  const h = fromUnits(+csField('h').value);
  if (!(w > 0 && h > 0)) return warn('Enter a width and height above zero.');
  Object.assign(createShape, { w, h });
  const { kind, at } = createShape;
  const c = csField('centre').checked;
  const box = { x: c ? at.x - w / 2 : at.x, y: c ? at.y - h / 2 : at.y, w, h };
  if (kind === 'polygon') {
    state.polySides = clamp(Math.round(+csField('sides').value) || 5, 3, 100);
    state.starRatio = clamp(Math.round(+csField('ratio').value) || 100, 1, 100);
    syncShapeOptions();
  }
  if (kind === 'rect') state.radius = clamp(+csField('radius').value || 0, 0, 10000);
  if (kind === 'custom') return placeCustom(box);
  const tag = kind === 'triangle' || kind === 'polygon' ? 'polygon' : kind;
  const el = mk(tag, newStyle('shape'), doc);
  if (tag === 'polygon') writeShape(el, newShape(kind, box));
  else if (kind === 'rect') {
    for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: w, height: h }))
      el.setAttribute(k, f(v));
    const r = Math.min(state.radius, w / 2, h / 2);
    if (r) {
      el.setAttribute('rx', f(r));
      el.setAttribute('ry', f(r));
    }
  } else
    for (const [k, v] of Object.entries({
      cx: box.x + w / 2,
      cy: box.y + h / 2,
      rx: w / 2,
      ry: h / 2,
    }))
      el.setAttribute(k, f(v));
  state.sel = [el];
  commit();
}
csDialog.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.target.closest('[data-cs-shape-btn="cancel"]')) {
    e.preventDefault();
    closeCreateShape(true);
  } else if (e.key === 'Escape') closeCreateShape(false);
});
csDialog
  .querySelector('[data-cs-shape-btn="ok"]')
  .addEventListener('click', () => closeCreateShape(true));
csDialog
  .querySelector('[data-cs-shape-btn="cancel"]')
  .addEventListener('click', () => closeCreateShape(false));
