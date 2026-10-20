// Svgcraft — a small, dependency-free in-browser SVG editor.
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
'use strict';

(() => {
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
    panX: 0,
    panY: 0,
    w: 800,
    h: 600,
    sel: [],
    grid: false,
    snap: false,
    gridSize: 20,
    fileName: 'drawing',
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
    opacity: 1,
  };

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  const f = (n) => +(+n).toFixed(2);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function mk(tag, attrs = {}, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    if (parent) parent.append(el);
    return el;
  }

  let msgTimer = 0;
  function say(text) {
    const m = $('#sc-msg');
    m.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (m.textContent = ''), 3500);
  }

  function snapPt(p) {
    if (!state.snap) return p;
    const g = state.gridSize;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  function constrain45(a, p) {
    const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
    const d = dist(a, p);
    return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
  }

  function toDoc(e) {
    const m = view.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  // Transform of a top-level element as a DOMMatrix (identity if none).
  function getM(el) {
    let m = new DOMMatrix();
    const list = el.transform?.baseVal;
    if (!list) return m;
    for (let i = 0; i < list.numberOfItems; i++) {
      const t = list.getItem(i).matrix;
      m = m.multiply(new DOMMatrix([t.a, t.b, t.c, t.d, t.e, t.f]));
    }
    return m;
  }

  function setM(el, m) {
    if (m.isIdentity) el.removeAttribute('transform');
    else
      el.setAttribute(
        'transform',
        `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((n, i) => +n.toFixed(i < 4 ? 5 : 3) || 0).join(' ')})`,
      );
  }

  // Axis-aligned bounding box of an element (at any depth), in document
  // units; pass m to measure it under another matrix instead.
  function bboxDoc(el, m = fullM(el)) {
    let b;
    try {
      b = el.getBBox();
    } catch {
      return null;
    }
    if (!b || (b.width === 0 && b.height === 0 && b.x === 0 && b.y === 0 && !el.childNodes.length))
      return null;
    const pts = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function unionBox(els) {
    let box = null;
    for (const el of els) {
      const b = bboxDoc(el);
      if (!b) continue;
      if (!box) box = { ...b };
      else {
        const x2 = Math.max(box.x + box.w, b.x + b.w);
        const y2 = Math.max(box.y + box.h, b.y + b.h);
        box.x = Math.min(box.x, b.x);
        box.y = Math.min(box.y, b.y);
        box.w = x2 - box.x;
        box.h = y2 - box.y;
      }
    }
    return box;
  }

  const selBox = () => unionBox(state.sel);

  // The deepest point-editable shape at or above node (imported SVGs nest
  // their shapes in groups; the point tool reaches inside them).
  function editableFrom(node) {
    if (!node || !doc.contains(node)) return null;
    for (let n = node; n && n !== doc; n = n.parentNode)
      if (
        ['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'].includes(n.localName)
      )
        return n;
    return null;
  }

  // Element-local → document transform, through every enclosing group.
  function fullM(el) {
    let m = getM(el);
    for (let n = el.parentNode; n && n !== doc; n = n.parentNode) m = getM(n).multiply(m);
    return m;
  }

  // Parent space → document space for el.
  function parentM(el) {
    return el.parentNode && el.parentNode !== doc ? fullM(el.parentNode) : new DOMMatrix();
  }

  // Apply a document-space transform T to el wherever it sits in the tree:
  // its own matrix becomes P⁻¹·T·P·base (base = its matrix before the edit).
  function transformDoc(el, T, base = getM(el)) {
    const P = parentM(el);
    setM(el, P.inverse().multiply(T).multiply(P).multiply(base));
  }

  // Paint an element inherits from its groups, written onto target (el
  // itself by default) so it survives leaving those groups.
  function bakeInherited(el, target = el) {
    for (let a = el.parentNode; a && a !== doc; a = a.parentNode)
      for (const k of INHERITED)
        if (a.hasAttribute(k) && !target.hasAttribute(k)) target.setAttribute(k, a.getAttribute(k));
  }

  // Move el into parent (before `before`, or last) without it moving on screen.
  function reparent(el, parent, before = null) {
    const D = fullM(el);
    if (el.parentNode !== parent) bakeInherited(el);
    parent.insertBefore(el, before);
    setM(el, (parent === doc ? new DOMMatrix() : fullM(parent)).inverse().multiply(D));
  }

  // Child-index path from #sc-doc to el, so it can be found again after
  // undo / redo rebuilds the DOM.
  function treePath(el) {
    const path = [];
    for (let n = el; n && n !== doc; n = n.parentNode)
      path.unshift([...n.parentNode.children].indexOf(n));
    return path;
  }
  function fromTreePath(path) {
    let n = doc;
    for (const i of path) n = n?.children[i];
    return n || null;
  }

  function topLevel(node) {
    if (!node || !doc.contains(node) || node === doc) return null;
    while (node.parentNode !== doc) node = node.parentNode;
    return selectable(node) ? node : null;
  }

  function selectable(el) {
    return el.nodeType === 1 && !NON_GRAPHIC.has(el.localName);
  }

  const items = () => [...doc.children].filter(selectable);
  const inDocOrder = (els) =>
    [...new Set(els)]
      .filter((el) => doc.contains(el))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  // A selection never holds both a group and something inside it.
  const normalizeSel = (els) =>
    inDocOrder(els).filter((el) => {
      for (let a = el.parentNode; a && a !== doc; a = a.parentNode)
        if (els.includes(a)) return false;
      return true;
    });

  // What a canvas click picks: the whole top-level item (Auto-Select: Group)
  // or the exact shape under the cursor (Auto-Select: Layer).
  function pickLayer(node) {
    if (state.autoSelect !== 'layer') return topLevel(node);
    if (!node || !doc.contains(node) || node === doc) return null;
    return node.closest('text') || node;
  }
  const leafLayers = () =>
    [...doc.querySelectorAll('*')].filter(
      (el) =>
        !NON_GRAPHIC.has(el.localName) &&
        el.localName !== 'g' &&
        !el.parentNode.closest?.('text, defs, clipPath, mask, pattern, marker, symbol'),
    );

  // ---------------------------------------------------------------------
  // Path smoothing (pencil, eraser-cut)
  // ---------------------------------------------------------------------
  function rdp(pts, eps) {
    if (pts.length < 3 || eps <= 0) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let max = 0;
      let idx = -1;
      const A = pts[a];
      const B = pts[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1e-9;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i].x - dx * pts[i].y + B.x * A.y - B.y * A.x) / len;
        if (d > max) {
          max = d;
          idx = i;
        }
      }
      if (max > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // Catmull-Rom spline through the points, emitted as cubic Béziers.
  function smoothD(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}h0.01`;
    let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    if (pts.length === 2) return d + `L${f(pts[1].x)} ${f(pts[1].y)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
    }
    return d;
  }

  function segDist(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  // ---------------------------------------------------------------------
  // Style (colour + transparency)
  // ---------------------------------------------------------------------
  function hex(c) {
    if (!c) return null;
    if (c[0] === '#') {
      if (c.length === 4) return '#' + [...c.slice(1)].map((ch) => ch + ch).join('');
      return c.slice(0, 7).toLowerCase();
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b] = m[1].split(/[\s,/]+/).map(Number);
    return (
      '#' +
      [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('')
    );
  }

  function colorAlpha(c) {
    const m = c && c.match(/rgba\([^)]*[,/]\s*([\d.]+%?)\s*\)/);
    if (!m) return 1;
    return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  }

  function paintTargets(el) {
    return el.localName === 'g' ? [el, ...el.querySelectorAll(SHAPE_SEL)] : [el];
  }

  function setPaintAttr(el, name, value, defaultValue) {
    el.style?.removeProperty(name);
    if (value == null || value === defaultValue) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function applyStyle(el, key) {
    if (key === 'opacity') {
      setPaintAttr(el, 'opacity', f(state.opacity), 1);
      return;
    }
    if (key === 'fill' && el.localName === 'text')
      for (const ts of el.querySelectorAll('tspan[data-run]')) {
        ts.removeAttribute('fill');
        ts.removeAttribute('fill-opacity');
      }
    for (const t of paintTargets(el)) {
      if (key === 'fill') {
        t.style?.removeProperty('fill');
        t.setAttribute('fill', state.fillOn ? state.fill : 'none');
        setPaintAttr(t, 'fill-opacity', f(state.fillA), 1);
      } else if (key === 'stroke') {
        t.style?.removeProperty('stroke');
        if (state.strokeOn) t.setAttribute('stroke', state.stroke);
        else t.setAttribute('stroke', 'none');
        setPaintAttr(t, 'stroke-opacity', f(state.strokeA), 1);
      } else if (key === 'width') {
        setPaintAttr(t, 'stroke-width', f(state.strokeWidth));
      }
    }
  }

  function readStyle(el) {
    const shape = el.matches(SHAPE_SEL) ? el : el.querySelector(SHAPE_SEL);
    const ownCs = getComputedStyle(el);
    state.opacity = parseFloat(ownCs.opacity) || 0;
    if (shape) {
      const cs = getComputedStyle(shape);
      const fill = cs.fill;
      state.fillOn = !!fill && fill !== 'none' && !fill.startsWith('url');
      if (state.fillOn) state.fill = hex(fill) || state.fill;
      state.fillA = parseFloat(cs.fillOpacity) * colorAlpha(fill);
      const stroke = cs.stroke;
      state.strokeOn = !!stroke && stroke !== 'none' && !stroke.startsWith('url');
      if (state.strokeOn) state.stroke = hex(stroke) || state.stroke;
      state.strokeA = parseFloat(cs.strokeOpacity) * colorAlpha(stroke);
      state.strokeWidth = parseFloat(cs.strokeWidth) || 0;
    }
    syncStyleUI();
  }

  // Attributes for a newly drawn element. Line-ish tools never fill; if the
  // stroke is switched off they borrow the fill colour so the mark shows.
  function newStyle(kind) {
    const a = {};
    const lineish = kind === 'line' || kind === 'open';
    if (lineish) {
      a.fill = 'none';
      const alpha = state.strokeOn ? state.strokeA : state.fillA;
      a.stroke = state.strokeOn ? state.stroke : state.fill;
      if (alpha < 1) a['stroke-opacity'] = f(alpha);
      a['stroke-width'] = f(state.strokeWidth || 1);
      a['stroke-linecap'] = 'round';
      a['stroke-linejoin'] = 'round';
    } else {
      a.fill = state.fillOn ? state.fill : 'none';
      if (state.fillA < 1) a['fill-opacity'] = f(state.fillA);
      if (kind !== 'text' && state.strokeOn && state.strokeWidth > 0) {
        a.stroke = state.stroke;
        a['stroke-width'] = f(state.strokeWidth);
        a['stroke-linejoin'] = 'round';
        if (state.strokeA < 1) a['stroke-opacity'] = f(state.strokeA);
      }
    }
    if (state.opacity < 1) a.opacity = f(state.opacity);
    return a;
  }

  // ---------------------------------------------------------------------
  // History + autosave
  // ---------------------------------------------------------------------
  const hist = [];
  let hIdx = -1;
  let saveTimer = 0;

  function snapshot() {
    return { d: doc.innerHTML, f: defs.innerHTML, w: state.w, h: state.h };
  }

  function commit() {
    hist.splice(hIdx + 1);
    hist.push(snapshot());
    if (hist.length > 150) hist.shift();
    hIdx = hist.length - 1;
    afterChange();
  }

  function restore(s, keepSel = false) {
    doc.innerHTML = s.d;
    defs.innerHTML = s.f;
    setSize(s.w, s.h);
    if (!keepSel) state.sel = [];
    tools[state.tool].restored?.();
    afterChange();
  }

  function undo() {
    tools[state.tool].cancel?.();
    if (hIdx > 0) restore(hist[--hIdx]);
  }

  function redo() {
    if (hIdx < hist.length - 1) restore(hist[++hIdx]);
  }

  function afterChange() {
    rasterJob = null;
    $('#sc-undo').disabled = hIdx <= 0;
    $('#sc-redo').disabled = hIdx >= hist.length - 1;
    state.sel = state.sel.filter((el) => doc.contains(el));
    drawSelection();
    renderLayers();
    updateTitle();
    tools[state.tool].redraw?.();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ svg: serialize(), name: state.fileName }));
      } catch {
        /* storage full or blocked — autosave is a convenience only */
      }
    }, 400);
  }

  // ---------------------------------------------------------------------
  // View (zoom / pan) + document size
  // ---------------------------------------------------------------------
  function applyView() {
    view.setAttribute('transform', `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
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

  function setSize(w, h) {
    state.w = clamp(+w || 1, 1, 20000);
    state.h = clamp(+h || 1, 1, 20000);
    for (const id of ['#sc-board-bg', '#sc-grid-rect', '#sc-board-frame']) {
      $(id).setAttribute('width', state.w);
      $(id).setAttribute('height', state.h);
    }
    $('#sc-w').value = f(state.w);
    $('#sc-h').value = f(state.h);
    updateTitle();
  }

  // Document tab ("name.svg @ 100%") and the status-bar zoom / size readouts.
  function updateTitle() {
    const pct = Math.round(state.zoom * 1000) / 10;
    $('#sc-doc-title').textContent = `${state.fileName}.svg @ ${pct}% (SVG)`;
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

  // ---------------------------------------------------------------------
  // Selection + overlay
  // ---------------------------------------------------------------------
  function setSel(els) {
    state.sel = normalizeSel(els);
    els = state.sel;
    if (els.length) readStyle(els[0]);
    if (els.length && readTypeFromSelection() && els.every((el) => el.localName === 'text'))
      $('[data-tab="character"]').click();
    drawSelection();
    markLayers();
  }

  // Re-highlight the selected rows without rebuilding the list (a rebuild
  // between the two clicks of a double-click would swallow the rename).
  function markLayers() {
    for (const li of $('#sc-layers').children)
      if (li.layerEl) li.classList.toggle('sel', state.sel.includes(li.layerEl));
  }

  function toggleSel(el) {
    setSel(state.sel.includes(el) ? state.sel.filter((x) => x !== el) : [...state.sel, el]);
  }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function handlePos(box, k) {
    const x = k.includes('w') ? box.x : k.includes('e') ? box.x + box.w : box.x + box.w / 2;
    const y = k.includes('n') ? box.y : k.includes('s') ? box.y + box.h : box.y + box.h / 2;
    return { x, y };
  }

  function drawSelection() {
    selLayer.replaceChildren();
    $('#sc-pos').dataset.sel = '';
    if (!state.sel.length || state.tool === 'node') return;
    const z = state.zoom;
    if (state.sel.length > 1) {
      for (const el of state.sel) {
        const b = bboxDoc(el);
        if (b) mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'sc-ov' }, selLayer);
      }
    }
    const box = selBox();
    if (!box) return;
    mk(
      'rect',
      { x: box.x, y: box.y, width: box.w, height: box.h, class: 'sc-ov sc-ov-dash' },
      selLayer,
    );
    const n = state.sel.length;
    $('#sc-pos').dataset.sel = `${n} selected · ${f(box.w)}×${f(box.h)}`;
    syncTransformFields(box);
    if (state.tool !== 'select') return;
    const mode = state.tf?.mode;
    const top = { x: box.x + box.w / 2, y: box.y };
    if (mode !== 'scale')
      mk('line', { x1: top.x, y1: top.y, x2: top.x, y2: top.y - 22 / z, class: 'sc-ov' }, selLayer);
    if (mode !== 'scale')
      mk(
        'circle',
        {
          cx: top.x,
          cy: top.y - 22 / z,
          r: 5 / z,
          class: 'sc-handle',
          'data-handle': 'rot',
          style: 'cursor:grab',
        },
        selLayer,
      );
    const hs = 8 / z;
    for (const k of HANDLES) {
      const p = handlePos(box, k);
      const cursor =
        mode === 'rotate'
          ? 'grab'
          : mode === 'skew' && k.length === 1
            ? { n: 'ew', s: 'ew', e: 'ns', w: 'ns' }[k] + '-resize'
            : {
                n: 'ns',
                s: 'ns',
                e: 'ew',
                w: 'ew',
                nw: 'nwse',
                se: 'nwse',
                ne: 'nesw',
                sw: 'nesw',
              }[k] + '-resize';
      mk(
        'rect',
        {
          x: p.x - hs / 2,
          y: p.y - hs / 2,
          width: hs,
          height: hs,
          class: 'sc-handle',
          'data-handle': k,
          style: `cursor:${cursor}`,
        },
        selLayer,
      );
    }
  }

  const INKSCAPE = 'http://www.inkscape.org/namespaces/inkscape';

  // A layer's own name: data-name (what Illustrator exports) or Inkscape's label.
  function customName(el) {
    return el.getAttribute('data-name') || el.getAttributeNS(INKSCAPE, 'label') || '';
  }

  function layerName(el) {
    const own = customName(el);
    if (own) return own;
    const tag = el.localName;
    const id = el.id ? ` #${el.id}` : '';
    if (tag === 'text') return `“${rawText(el).replace(/\s+/g, ' ').trim().slice(0, 28)}”`;
    if (tag === 'g') return `group (${el.children.length})${id}`;
    if (tag === 'path') return `path${id}`;
    return tag + id;
  }

  // A small live preview of one layer, framed on its own bounding box.
  function layerThumb(el) {
    const t = mk('svg', { class: 'sc-thumb', 'aria-hidden': 'true' });
    const b = bboxDoc(el, getM(el));
    if (!b) return t;
    const pad = Math.max(b.w, b.h) * 0.08 + 1;
    t.setAttribute(
      'viewBox',
      [b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad].map(f).join(' '),
    );
    const c = el.cloneNode(true);
    bakeInherited(el, c);
    c.removeAttribute('display');
    for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id');
    t.append(c);
    return t;
  }

  // Groups the user folded in the Layers panel, keyed by tree path.
  const folded = new Set();
  let rangeAnchor = null;

  function renderLayers() {
    const ol = $('#sc-layers');
    ol.replaceChildren();
    if (!items().length) {
      const li = document.createElement('li');
      li.className = 'sc-empty';
      li.textContent = 'No layers yet. Draw something, or drop an SVG onto the canvas.';
      ol.append(li);
      return;
    }
    let rows = 0;
    const walk = (parent, depth) => {
      for (const el of [...parent.children].filter(selectable).reverse()) {
        if (rows++ >= 500) return;
        const open = el.localName === 'g' && !folded.has(treePath(el).join('/'));
        ol.append(layerRow(el, depth, open, rows));
        if (open) walk(el, depth + 1);
      }
    };
    walk(doc, 0);
  }

  function layerRow(el, depth, open, n) {
    const li = document.createElement('li');
    const hidden = el.getAttribute('display') === 'none';
    const isGroup = el.localName === 'g';
    li.className = (state.sel.includes(el) ? 'sel ' : '') + (hidden ? 'hidden' : '');
    li.style.paddingLeft = `${4 + depth * 16}px`;
    li.layerEl = el;
    li.draggable = true;

    const twisty = document.createElement('button');
    twisty.className = 'sc-twisty';
    if (isGroup) {
      twisty.innerHTML = `<i data-icon="chevron-right" class="${open ? 'open' : ''}">${icon('chevron-right')}</i>`;
      twisty.setAttribute('aria-label', open ? 'Collapse group' : 'Expand group');
      twisty.setAttribute('aria-expanded', open);
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = treePath(el).join('/');
        if (open) folded.add(key);
        else folded.delete(key);
        renderLayers();
      });
    } else twisty.tabIndex = -1;

    const eye = document.createElement('button');
    eye.className = 'sc-eye';
    eye.innerHTML = `<i data-icon="${hidden ? 'eye-slash' : 'eye'}">${icon(hidden ? 'eye-slash' : 'eye')}</i>`;
    eye.setAttribute('aria-label', hidden ? 'Show layer' : 'Hide layer');
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hidden) el.removeAttribute('display');
      else el.setAttribute('display', 'none');
      commit();
    });

    let thumb;
    if (isGroup) {
      thumb = document.createElement('span');
      thumb.className = 'sc-thumb sc-folder';
      thumb.innerHTML = `<i data-icon="${open ? 'folder-open' : 'folder'}">${icon(open ? 'folder-open' : 'folder')}</i>`;
    } else thumb = n <= 150 ? layerThumb(el) : mk('svg', { class: 'sc-thumb' });

    const name = document.createElement('span');
    name.className = 'sc-layer-name';
    name.textContent = layerName(el);
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      renameLayer(el, name);
    });
    li.append(eye, twisty, thumb, name);

    // Photoshop's rules: click selects, Ctrl/⌘-click toggles, Shift-click
    // selects the run of rows from the last plain click.
    li.addEventListener('click', (e) => {
      if (e.target.closest('input')) return;
      if (e.ctrlKey || e.metaKey) toggleSel(el);
      else if (e.shiftKey && rangeAnchor && rangeAnchor.isConnected) {
        const rows = [...$('#sc-layers').children].map((r) => r.layerEl).filter(Boolean);
        const [a, b] = [rows.indexOf(rangeAnchor), rows.indexOf(el)].sort((x, y) => x - y);
        setSel(rows.slice(a, b + 1));
      } else {
        rangeAnchor = el;
        setSel([el]);
      }
    });
    wireLayerDrag(li, el);
    return li;
  }

  // Drag rows to restack them: the top or bottom half of a row drops in
  // front of / behind it; the middle of a group row drops inside it.
  let dragEls = null;
  function dropZone(e, li, el) {
    if (!dragEls || dragEls.some((d) => d === el || d.contains(el))) return null;
    const r = li.getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (el.localName === 'g') return t < 0.28 ? 'above' : t > 0.72 ? 'below' : 'into';
    return t < 0.5 ? 'above' : 'below';
  }
  function clearDropMarks() {
    for (const r of document.querySelectorAll('.drop-above, .drop-below, .drop-into, .drop-end'))
      r.classList.remove('drop-above', 'drop-below', 'drop-into', 'drop-end');
  }
  function wireLayerDrag(li, el) {
    li.addEventListener('dragstart', (e) => {
      dragEls = state.sel.includes(el) ? normalizeSel(state.sel) : [el];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', layerName(el));
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      dragEls = null;
      li.classList.remove('dragging');
      clearDropMarks();
    });
    li.addEventListener('dragover', (e) => {
      const zone = dropZone(e, li, el);
      if (!zone) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      li.classList.add(`drop-${zone}`);
    });
    li.addEventListener('drop', (e) => {
      const zone = dropZone(e, li, el);
      if (!zone) return;
      e.preventDefault();
      e.stopPropagation();
      moveLayers(dragEls, el, zone);
    });
  }

  function moveLayers(els, target, zone) {
    els = inDocOrder(els);
    if (zone === 'into') {
      for (const el of els) reparent(el, target);
      folded.delete(treePath(target).join('/'));
    } else if (zone === 'above') {
      let ref = target;
      for (const el of els) {
        reparent(el, target.parentNode, ref.nextSibling);
        ref = el;
      }
    } else if (zone === 'below') {
      for (const el of els) reparent(el, target.parentNode, target);
    } else {
      // Empty space under the list: to the very back of the drawing.
      const ref = [...doc.children].find((c) => selectable(c) && !els.includes(c)) || null;
      for (const el of els) reparent(el, doc, ref);
    }
    dragEls = null;
    clearDropMarks();
    state.sel = els;
    commit();
    readStyle(els[0]);
  }

  // Swap a layer's name for a text field. Enter or leaving the field saves,
  // Esc cancels, and an empty name goes back to the automatic one.
  function renameLayer(el, span) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sc-layer-input';
    input.value = customName(el);
    input.placeholder = layerName(el);
    input.setAttribute('aria-label', 'Layer name');
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v !== customName(el)) {
        el.removeAttributeNS(INKSCAPE, 'label');
        if (v) el.setAttribute('data-name', v);
        else el.removeAttribute('data-name');
        commit();
      } else renderLayers();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------
  const tools = {};

  tools.select = {
    hint: 'Click to select · Shift-click adds · Drag to move · Handles scale (Shift keeps ratio, Alt from centre) · Arrows nudge · Double-click a shape to edit its points, or text to edit it',
    cursor: 'default',
    down(e, p) {
      const h = e.target.closest?.('[data-handle]');
      const box = selBox();
      if (h && box) {
        const k = h.dataset.handle;
        const tfMode = state.tf?.mode;
        this.g = {
          mode:
            k === 'rot' || tfMode === 'rotate'
              ? 'rot'
              : tfMode === 'skew' && k.length === 1
                ? 'skew'
                : 'scale',
          k: h.dataset.handle,
          p0: p,
          box,
          m0: state.sel.map(getM),
        };
        return;
      }
      const el = pickLayer(e.target);
      if (el) {
        if (e.shiftKey) {
          toggleSel(el);
          this.g = null;
          return;
        }
        if (!state.sel.includes(el)) setSel([el]);
      } else if (
        !(
          box &&
          !e.shiftKey &&
          p.x >= box.x &&
          p.x <= box.x + box.w &&
          p.y >= box.y &&
          p.y <= box.y + box.h
        )
      ) {
        this.g = { mode: 'marquee', p0: p, base: e.shiftKey ? [...state.sel] : [] };
        if (!e.shiftKey) setSel([]);
        return;
      }
      this.g = { mode: 'move', p0: p, box: selBox(), m0: state.sel.map(getM) };
    },
    move(e, p) {
      const g = this.g;
      if (!g) return;
      if (g.mode === 'marquee') {
        const x = Math.min(g.p0.x, p.x);
        const y = Math.min(g.p0.y, p.y);
        const w = Math.abs(p.x - g.p0.x);
        const h = Math.abs(p.y - g.p0.y);
        guides.replaceChildren();
        mk('rect', { x, y, width: w, height: h, class: 'sc-ov sc-ov-fill sc-ov-dash' }, guides);
        const hit = (state.autoSelect === 'layer' ? leafLayers() : items()).filter((el) => {
          const b = el.getAttribute('display') !== 'none' && bboxDoc(el);
          return b && b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y;
        });
        state.sel = normalizeSel([...g.base, ...hit]);
        drawSelection();
        return;
      }
      let T;
      if (g.mode === 'move') {
        let dx = p.x - g.p0.x;
        let dy = p.y - g.p0.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (state.snap && g.box) {
          const s = snapPt({ x: g.box.x + dx, y: g.box.y + dy });
          dx = s.x - g.box.x;
          dy = s.y - g.box.y;
        }
        if (!dx && !dy) return;
        T = new DOMMatrix().translate(dx, dy);
      } else if (g.mode === 'scale') {
        const b = g.box;
        const k = g.k;
        const fromCentre = e.altKey;
        const h0 = handlePos(b, k);
        const a = fromCentre
          ? { x: b.x + b.w / 2, y: b.y + b.h / 2 }
          : handlePos(
              b,
              k.replace(/[nsew]/g, (c) => ({ n: 's', s: 'n', e: 'w', w: 'e' })[c]),
            );
        const sp = snapPt(p);
        let sx = /[ew]/.test(k) && h0.x !== a.x ? (sp.x - a.x) / (h0.x - a.x) : 1;
        let sy = /[ns]/.test(k) && h0.y !== a.y ? (sp.y - a.y) / (h0.y - a.y) : 1;
        if (e.shiftKey && /[ew]/.test(k) && /[ns]/.test(k)) {
          const s = Math.max(Math.abs(sx), Math.abs(sy));
          sx = Math.sign(sx || 1) * s;
          sy = Math.sign(sy || 1) * s;
        }
        if (Math.abs(sx) < 1e-3) sx = 1e-3 * Math.sign(sx || 1);
        if (Math.abs(sy) < 1e-3) sy = 1e-3 * Math.sign(sy || 1);
        T = new DOMMatrix().translate(a.x, a.y).scale(sx, sy).translate(-a.x, -a.y);
      } else if (g.mode === 'skew') {
        // Drag an edge sideways along itself; the opposite edge stays put.
        const b = g.box;
        const k = g.k;
        const horiz = k === 'n' || k === 's';
        const a = e.altKey
          ? { x: b.x + b.w / 2, y: b.y + b.h / 2 }
          : handlePos(b, { n: 's', s: 'n', e: 'w', w: 'e' }[k]);
        const h0 = handlePos(b, k);
        const arm = horiz ? h0.y - a.y : h0.x - a.x;
        if (!arm) return;
        let deg = (Math.atan((horiz ? p.x - g.p0.x : p.y - g.p0.y) / arm) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        g.deg = clamp(deg, -85, 85);
        const skew = horiz ? new DOMMatrix().skewX(g.deg) : new DOMMatrix().skewY(g.deg);
        T = new DOMMatrix().translate(a.x, a.y).multiply(skew).translate(-a.x, -a.y);
      } else {
        const c = { x: g.box.x + g.box.w / 2, y: g.box.y + g.box.h / 2 };
        let deg =
          ((Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(g.p0.y - c.y, g.p0.x - c.x)) * 180) /
          Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        g.deg = deg;
        T = new DOMMatrix().translate(c.x, c.y).rotate(deg).translate(-c.x, -c.y);
      }
      state.sel.forEach((el, i) => transformDoc(el, T, g.m0[i]));
      g.T = T;
      g.changed = true;
      drawSelection();
    },
    up() {
      const g = this.g;
      this.g = null;
      guides.replaceChildren();
      if (!g) return;
      if (g.mode === 'marquee') setSel(state.sel);
      else if (g.changed) {
        if (state.tf && g.mode === 'rot') state.tf.angle += g.deg;
        if (state.tf && g.mode === 'skew')
          state.tf[g.k === 'n' || g.k === 's' ? 'skx' : 'sky'] += g.deg;
        noteTransform(g.T, g.box);
        commit();
      }
    },
    dblclick(e) {
      const shape = editableFrom(e.target);
      if (shape) {
        setTool('node');
        tools.node.target(shape);
        return;
      }
      const el = doc.contains(e.target) ? e.target.closest('text') : null;
      if (el) editTextLayer(el);
    },
    cancel() {
      this.g = null;
      guides.replaceChildren();
    },
  };

  tools.pencil = {
    hint: 'Drag to draw freehand · Smoothing lives in the panel',
    cursor: 'crosshair',
    down(e, p) {
      this.pts = [p];
      this.el = mk('path', { ...newStyle('open'), d: smoothD(this.pts) }, doc);
    },
    move(e, p) {
      if (!this.el) return;
      const evs = e.getCoalescedEvents?.() || [];
      const pts = evs.length ? evs.map(toDoc) : [p];
      const minD = 0.75 / state.zoom;
      for (const q of pts) if (dist(q, this.pts.at(-1)) >= minD) this.pts.push(q);
      this.el.setAttribute('d', 'M' + this.pts.map((q) => `${f(q.x)} ${f(q.y)}`).join('L'));
    },
    up() {
      if (!this.el) return;
      const eps = (state.smoothing * 0.45) / state.zoom;
      const pts = state.smoothing ? rdp(this.pts, eps) : this.pts;
      this.el.setAttribute('d', smoothD(pts));
      this.el = null;
      commit();
    },
    cancel() {
      this.el?.remove();
      this.el = null;
    },
  };

  tools.pen = {
    hint: 'Click for corners · Drag for curves · Click the first point to close · Enter or double-click finishes · Backspace removes the last point · Esc ends',
    cursor: 'crosshair',
    pts: [],
    down(e, p) {
      p = snapPt(p);
      const pts = this.pts;
      if (pts.length && e.shiftKey) p = constrain45(pts.at(-1), p);
      if (pts.length >= 2 && dist(p, pts[0]) < 8 / state.zoom) {
        this.finish(true);
        return;
      }
      if (
        pts.length &&
        e.timeStamp - (this.lastDown || 0) < 350 &&
        dist(p, pts.at(-1)) < 5 / state.zoom
      ) {
        this.finish(false);
        return;
      }
      this.lastDown = e.timeStamp;
      pts.push({ x: p.x, y: p.y, hin: null, hout: null });
      if (!this.el) this.el = mk('path', newStyle('open'), doc);
      this.dragging = true;
      this.render();
    },
    move(e, p) {
      if (this.dragging) {
        const a = this.pts.at(-1);
        if (dist(p, a) > 2 / state.zoom) {
          a.hout = { x: p.x, y: p.y };
          a.hin = { x: 2 * a.x - p.x, y: 2 * a.y - p.y };
        }
      } else {
        this.cursor =
          this.pts.length && e.shiftKey ? constrain45(this.pts.at(-1), snapPt(p)) : snapPt(p);
      }
      this.render();
    },
    up() {
      this.dragging = false;
    },
    d(closed) {
      const pts = this.pts;
      if (!pts.length) return '';
      const seg = (a, b) => {
        if (!a.hout && !b.hin) return `L${f(b.x)} ${f(b.y)}`;
        const c1 = a.hout || a;
        const c2 = b.hin || b;
        return `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
      };
      let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
      for (let i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
      if (closed) d += (pts.at(-1).hout || pts[0].hin ? seg(pts.at(-1), pts[0]) : '') + 'Z';
      return d;
    },
    render() {
      if (this.el) this.el.setAttribute('d', this.d(false));
      this.redraw();
    },
    redraw() {
      guides.replaceChildren();
      const pts = this.pts;
      if (!pts.length) return;
      const z = state.zoom;
      const last = pts.at(-1);
      if (this.cursor && !this.dragging) {
        const c1 = last.hout || last;
        mk(
          'path',
          {
            d: `M${last.x} ${last.y}C${c1.x} ${c1.y} ${this.cursor.x} ${this.cursor.y} ${this.cursor.x} ${this.cursor.y}`,
            class: 'sc-ov sc-ov-dash',
          },
          guides,
        );
      }
      for (const a of [last]) {
        for (const h of [a.hin, a.hout]) {
          if (!h) continue;
          mk('line', { x1: a.x, y1: a.y, x2: h.x, y2: h.y, class: 'sc-ov' }, guides);
          mk('circle', { cx: h.x, cy: h.y, r: 3 / z, class: 'sc-anchor' }, guides);
        }
      }
      pts.forEach((a, i) => {
        const s = (i === 0 ? 9 : 7) / z;
        mk(
          'rect',
          {
            x: a.x - s / 2,
            y: a.y - s / 2,
            width: s,
            height: s,
            class: 'sc-anchor' + (i === 0 ? ' sc-anchor-first' : ''),
          },
          guides,
        );
      });
    },
    finish(closed) {
      const el = this.el;
      // A double-click lands two clicks on one spot — drop the duplicate.
      while (this.pts.length > 1 && dist(this.pts.at(-1), this.pts.at(-2)) < 1e-6) this.pts.pop();
      if (el && this.pts.length >= 2) {
        el.setAttribute('d', this.d(closed));
        if (closed) {
          for (const a of [...el.attributes]) if (a.name !== 'd') el.removeAttribute(a.name);
          for (const [k, v] of Object.entries(newStyle('shape'))) el.setAttribute(k, v);
        }
        this.reset();
        commit();
      } else this.cancel();
    },
    cancel() {
      this.el?.remove();
      this.reset();
    },
    reset() {
      this.el = null;
      this.pts = [];
      this.cursor = null;
      this.dragging = false;
      guides.replaceChildren();
    },
    key(e) {
      if (!this.pts.length) return false;
      if (e.key === 'Enter') this.finish(false);
      else if (e.key === 'Escape') this.finish(false);
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        this.pts.pop();
        if (!this.pts.length) this.cancel();
        else this.render();
      } else return false;
      return true;
    },
    leave() {
      if (this.pts.length) this.finish(false);
    },
  };

  function shapeTool(kind, hint) {
    return {
      hint,
      cursor: 'crosshair',
      down(e, p) {
        this.p0 = snapPt(p);
        this.el = mk(kind, newStyle(kind === 'line' ? 'line' : 'shape'), doc);
        this.move(e, p);
      },
      move(e, p) {
        if (!this.el) return;
        p = snapPt(p);
        const a = this.p0;
        if (kind === 'line') {
          const b = e.shiftKey ? constrain45(a, p) : p;
          const s = e.altKey ? { x: 2 * a.x - b.x, y: 2 * a.y - b.y } : a;
          Object.entries({ x1: f(s.x), y1: f(s.y), x2: f(b.x), y2: f(b.y) }).forEach(([k, v]) =>
            this.el.setAttribute(k, v),
          );
          return;
        }
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
        const W = Math.abs(w) * k;
        const H = Math.abs(h) * k;
        const attrs =
          kind === 'rect'
            ? { x, y, width: W, height: H }
            : { cx: x + W / 2, cy: y + H / 2, rx: W / 2, ry: H / 2 };
        for (const [k, v] of Object.entries(attrs)) this.el.setAttribute(k, f(v));
      },
      up() {
        const el = this.el;
        this.el = null;
        if (!el) return;
        const b = bboxDoc(el);
        if (!b || (b.w * state.zoom < 2 && b.h * state.zoom < 2)) {
          el.remove();
          return;
        }
        state.sel = [el];
        commit();
      },
      cancel() {
        this.el?.remove();
        this.el = null;
      },
    };
  }

  tools.rect = shapeTool(
    'rect',
    'Drag for a rectangle · Shift for a square · Alt draws from the centre',
  );
  tools.ellipse = shapeTool(
    'ellipse',
    'Drag for an ellipse · Shift for a circle · Alt draws from the centre',
  );
  tools.line = shapeTool(
    'line',
    'Drag for a line · Shift snaps to 45° · Alt draws from the centre',
  );

  // ---------------------------------------------------------------------
  // Type (Photoshop-style)
  //
  // A text layer is <text x y> with one <tspan data-line> per line, each
  // absolutely positioned (x = the alignment anchor, y = baseline + n ×
  // leading) so empty lines keep their place. Paragraph text carries
  // data-box (its width); its soft-wrapped lines are marked data-soft so
  // the original string can be rebuilt for editing. Character settings
  // live in ordinary SVG attributes, so exports render anywhere.
  // ---------------------------------------------------------------------
  const XML_NS = 'http://www.w3.org/XML/1998/namespace';
  const WEIGHT_NAMES = {
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black',
  };
  const ALL_W = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  // name, CSS stack, weights, has italics, source. Google weights are the
  // ones each family really ships, so every requested style exists.
  const FONTS = [
    { name: 'System UI', css: 'system-ui, sans-serif', w: ALL_W, i: true, src: 'system' },
    { name: 'Arial', css: 'Arial, Helvetica, sans-serif', w: [400, 700], i: true, src: 'system' },
    { name: 'Georgia', css: 'Georgia, serif', w: [400, 700], i: true, src: 'system' },
    {
      name: 'Times New Roman',
      css: "'Times New Roman', Times, serif",
      w: [400, 700],
      i: true,
      src: 'system',
    },
    {
      name: 'Courier New',
      css: "'Courier New', Courier, monospace",
      w: [400, 700],
      i: true,
      src: 'system',
    },
    { name: 'Verdana', css: 'Verdana, sans-serif', w: [400, 700], i: true, src: 'system' },
    {
      name: 'Trebuchet MS',
      css: "'Trebuchet MS', sans-serif",
      w: [400, 700],
      i: true,
      src: 'system',
    },
    { name: 'Impact', css: 'Impact, sans-serif', w: [400], i: false, src: 'system' },
    { name: 'Roboto', cat: 'sans-serif', w: ALL_W, i: true },
    { name: 'Open Sans', cat: 'sans-serif', w: [300, 400, 500, 600, 700, 800], i: true },
    { name: 'Lato', cat: 'sans-serif', w: [100, 300, 400, 700, 900], i: true },
    { name: 'Montserrat', cat: 'sans-serif', w: ALL_W, i: true },
    { name: 'Inter', cat: 'sans-serif', w: ALL_W, i: false },
    { name: 'Raleway', cat: 'sans-serif', w: ALL_W, i: true },
    { name: 'Josefin Sans', cat: 'sans-serif', w: [100, 200, 300, 400, 500, 600, 700], i: true },
    { name: 'Oswald', cat: 'sans-serif', w: [200, 300, 400, 500, 600, 700], i: false },
    { name: 'Bebas Neue', cat: 'sans-serif', w: [400], i: false },
    { name: 'Archivo Black', cat: 'sans-serif', w: [400], i: false },
    { name: 'Playfair Display', cat: 'serif', w: [400, 500, 600, 700, 800, 900], i: true },
    { name: 'Merriweather', cat: 'serif', w: [300, 400, 700, 900], i: true },
    { name: 'Source Serif 4', cat: 'serif', w: [200, 300, 400, 500, 600, 700, 800, 900], i: true },
    { name: 'Lora', cat: 'serif', w: [400, 500, 600, 700], i: true },
    { name: 'Cinzel', cat: 'serif', w: [400, 500, 600, 700, 800, 900], i: false },
    { name: 'Abril Fatface', cat: 'serif', w: [400], i: false },
    { name: 'Lobster', cat: 'cursive', w: [400], i: false },
    { name: 'Pacifico', cat: 'cursive', w: [400], i: false },
    { name: 'Dancing Script', cat: 'cursive', w: [400, 500, 600, 700], i: false },
    { name: 'Caveat', cat: 'cursive', w: [400, 500, 600, 700], i: false },
    { name: 'Permanent Marker', cat: 'cursive', w: [400], i: false },
    { name: 'Fira Code', cat: 'monospace', w: [300, 400, 500, 600, 700], i: false },
    { name: 'Space Mono', cat: 'monospace', w: [400, 700], i: true },
    { name: 'Press Start 2P', cat: 'monospace', w: [400], i: false },
  ];
  for (const ft of FONTS) {
    if (!ft.src) ft.src = 'google';
    if (!ft.css) ft.css = `'${ft.name}', ${ft.cat}`;
  }

  const fontByName = (name) =>
    FONTS.find((ft) => ft.name.toLowerCase() === String(name).toLowerCase()) || {
      name,
      css: `'${name}', sans-serif`,
      w: [400, 700],
      i: true,
      src: 'unknown',
    };

  // The family a font-family value starts with, matched to the catalogue.
  function fontFromCss(value) {
    const first = String(value || '')
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (!first) return 'System UI';
    const hit = FONTS.find(
      (ft) =>
        ft.name.toLowerCase() === first.toLowerCase() ||
        ft.css.split(',')[0].trim().replace(/['"]/g, '').toLowerCase() === first.toLowerCase(),
    );
    return hit ? hit.name : first;
  }

  const googleSpec = (ft) =>
    `family=${encodeURIComponent(ft.name).replace(/%20/g, '+')}:` +
    (ft.i
      ? `ital,wght@${[...ft.w.map((w) => `0,${w}`), ...ft.w.map((w) => `1,${w}`)].join(';')}`
      : `wght@${ft.w.join(';')}`);
  const googleUrl = (fonts) =>
    `https://fonts.googleapis.com/css2?${fonts.map(googleSpec).join('&')}&display=swap`;

  // Load a Google family (all its styles) once; re-wrap paragraph text in
  // it when it arrives, since line breaks depend on the real glyph widths.
  const loadedFonts = new Set();
  function ensureFont(name) {
    const ft = fontByName(name);
    if (ft.src !== 'google' || loadedFonts.has(ft.name)) return;
    loadedFonts.add(ft.name);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = googleUrl([ft]);
    link.onload = () =>
      document.fonts.load(`16px '${ft.name}'`).then(() => {
        for (const el of doc.querySelectorAll('text[data-box]'))
          if (typeFrom(el).family === ft.name) layoutText(el);
        drawSelection();
      });
    document.head.append(link);
  }

  // One small request that draws every catalogue name in its own face.
  let previewsLoaded = false;
  function loadFontPreviews() {
    if (previewsLoaded) return;
    previewsLoaded = true;
    const g = FONTS.filter((ft) => ft.src === 'google');
    const chars = [...new Set(g.map((ft) => ft.name).join(''))].join('');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?' +
      g.map((ft) => `family=${encodeURIComponent(ft.name).replace(/%20/g, '+')}`).join('&') +
      `&text=${encodeURIComponent(chars)}&display=swap`;
    document.head.append(link);
  }

  // Style menu entries for a family: [weight, italic, label].
  function fontStyles(name) {
    const ft = fontByName(name);
    const out = ft.w.map((w) => [w, false, WEIGHT_NAMES[w] || String(w)]);
    if (ft.i)
      for (const w of ft.w)
        out.push([w, true, w === 400 ? 'Italic' : `${WEIGHT_NAMES[w] || w} Italic`]);
    return out;
  }

  // Nearest style a family actually has.
  function fitStyle(name, weight, italic) {
    const ft = fontByName(name);
    const w = ft.w.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), ft.w[0]);
    return { weight: w, italic: italic && ft.i };
  }

  // ---- reading / writing a layer's character + paragraph settings
  function typeFrom(el) {
    const cs = getComputedStyle(el);
    const size = parseFloat(el.getAttribute('font-size')) || parseFloat(cs.fontSize) || 16;
    const bs = el.getAttribute('baseline-shift') || '';
    const deco = el.hasAttribute('data-deco')
      ? el.getAttribute('data-deco')
      : `${el.getAttribute('text-decoration') || ''} ${cs.textDecorationLine || ''}`;
    const anchor = el.getAttribute('text-anchor') || cs.textAnchor || 'start';
    return {
      family: fontFromCss(el.getAttribute('font-family') || cs.fontFamily),
      weight: parseInt(cs.fontWeight, 10) || 400,
      italic: /italic|oblique/.test(cs.fontStyle),
      size,
      leading: parseFloat(el.dataset.leading) || 0,
      tracking: el.dataset.tracking
        ? parseFloat(el.dataset.tracking)
        : Math.round(((parseFloat(el.getAttribute('letter-spacing')) || 0) / size) * 1000),
      shift: /^-?[\d.]+$/.test(bs) ? parseFloat(bs) : 0,
      script: bs === 'super' || bs === 'sub' ? bs : 'none',
      caps:
        el.style.textTransform === 'uppercase'
          ? 'all'
          : /small-caps/.test(el.getAttribute('font-variant') || '')
            ? 'small'
            : 'none',
      underline: /underline/.test(deco),
      strike: /line-through/.test(deco),
      align: { middle: 'middle', end: 'end' }[anchor] || 'start',
      box: parseFloat(el.dataset.box) || 0,
    };
  }

  function applyType(el, t, text) {
    const set = (k, v) => (v == null || v === '' ? el.removeAttribute(k) : el.setAttribute(k, v));
    for (const k of [
      'font-family',
      'font-weight',
      'font-style',
      'font-size',
      'letter-spacing',
      'text-anchor',
      'text-decoration',
      'font-variant',
      'baseline-shift',
    ])
      el.style.removeProperty(k);
    set('font-family', fontByName(t.family).css);
    set('font-weight', t.weight === 400 ? null : t.weight);
    set('font-style', t.italic ? 'italic' : null);
    set('font-size', f(t.size));
    set('letter-spacing', t.tracking ? f((t.tracking * t.size) / 1000) : null);
    el.dataset.tracking = t.tracking;
    if (!t.tracking) delete el.dataset.tracking;
    set('baseline-shift', t.script !== 'none' ? t.script : t.shift ? f(t.shift) : null);
    set('font-variant', t.caps === 'small' ? 'small-caps' : null);
    if (t.caps === 'all') el.style.textTransform = 'uppercase';
    else el.style.removeProperty('text-transform');
    if (!el.getAttribute('style')) el.removeAttribute('style');
    el.setAttribute('data-deco', decoOf(t.underline, t.strike));
    set('text-anchor', t.align === 'start' ? null : t.align);
    if (t.leading) el.dataset.leading = f(t.leading);
    else delete el.dataset.leading;
    if (t.box) el.dataset.box = f(t.box);
    else delete el.dataset.box;
    ensureFont(t.family);
    layoutText(el, text);
  }

  // ---- rich text: runs ----------------------------------------------------
  // A layer's content is a list of runs { t, o }: t is text (newlines
  // included) and o holds only the character settings that differ from the
  // layer's own (Photoshop's per-character styling). In the SVG each run is
  // a nested <tspan data-run> carrying just those attributes.
  const RUN_KEYS = [
    'family',
    'weight',
    'italic',
    'size',
    'tracking',
    'shift',
    'script',
    'caps',
    'underline',
    'strike',
    'fill',
    'fillA',
  ];
  const pickKeys = (o, keys) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
  const sameO = (a, b) => RUN_KEYS.every((k) => a[k] === b[k]);
  const decoOf = (u, s) => [u && 'underline', s && 'line-through'].filter(Boolean).join(' ');

  function mergeRuns(runs) {
    const out = [];
    for (const r of runs) {
      if (!r.t) continue;
      const last = out.at(-1);
      if (last && sameO(last.o, r.o)) last.t += r.t;
      else out.push({ t: r.t, o: { ...r.o } });
    }
    return out;
  }

  // Drop overrides that match the layer, so runs only say what's different.
  function pruneO(o, t) {
    const out = {};
    for (const k of RUN_KEYS) if (o[k] != null && o[k] !== t[k]) out[k] = o[k];
    return out;
  }

  // The overrides a run tspan carries (its own attributes, not inherited).
  function runFrom(ts, t) {
    const o = {};
    const a = (k) => ts.getAttribute(k);
    if (a('font-family')) o.family = fontFromCss(a('font-family'));
    if (a('font-weight'))
      o.weight = parseInt(a('font-weight'), 10) || (a('font-weight') === 'bold' ? 700 : 400);
    if (a('font-style')) o.italic = /italic|oblique/.test(a('font-style'));
    if (a('font-size')) o.size = parseFloat(a('font-size'));
    if (ts.dataset.tracking != null) o.tracking = parseFloat(ts.dataset.tracking);
    const bs = a('baseline-shift');
    if (bs === 'super' || bs === 'sub') o.script = bs;
    else if (bs) {
      o.shift = (parseFloat(bs) || 0) + (t.script === 'none' ? t.shift : 0);
      o.script = 'none';
    }
    if (a('font-variant') || ts.style.textTransform)
      o.caps =
        ts.style.textTransform === 'uppercase'
          ? 'all'
          : /small-caps/.test(a('font-variant') || '')
            ? 'small'
            : 'none';
    if (a('text-decoration')) {
      o.underline = /underline/.test(a('text-decoration'));
      o.strike = /line-through/.test(a('text-decoration'));
    }
    if (a('fill')) o.fill = a('fill');
    if (a('fill-opacity')) o.fillA = parseFloat(a('fill-opacity'));
    return pruneO(o, t);
  }

  // Attributes for one run tspan. Values that inherit badly are written
  // out in full: letter-spacing is absolute, so a run with its own size
  // gets its own; baseline-shift stacks, so it's written relative.
  function runAttrs(o, t) {
    const e = { ...t, ...o };
    const at = { 'data-run': '' };
    if (o.family != null) at['font-family'] = fontByName(o.family).css;
    if (o.weight != null) at['font-weight'] = o.weight;
    if (o.italic != null) at['font-style'] = o.italic ? 'italic' : 'normal';
    if (o.size != null) at['font-size'] = f(o.size);
    if (o.tracking != null || o.size != null) {
      const ls = (e.tracking * e.size) / 1000;
      if (ls || t.tracking) at['letter-spacing'] = f(ls);
      if (o.tracking != null) at['data-tracking'] = o.tracking;
    }
    if (o.script != null && o.script !== 'none') at['baseline-shift'] = o.script;
    else if (o.shift != null)
      at['baseline-shift'] = f(o.shift - (t.script === 'none' ? t.shift : 0));
    if (o.caps != null) {
      at['font-variant'] = o.caps === 'small' ? 'small-caps' : 'normal';
      at.style = `text-transform:${o.caps === 'all' ? 'uppercase' : 'none'}`;
    }
    if (o.fill != null) at.fill = o.fill;
    if (o.fillA != null) at['fill-opacity'] = f(o.fillA);
    return at;
  }

  // Text from other editors: a tspan with its own x / y / dy starts a line.
  function foreignText(el) {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.localName === 'tspan') {
        if (out && (n.hasAttribute('x') || n.hasAttribute('dy') || n.hasAttribute('y')))
          out += '\n';
        out += n.textContent;
      }
    }
    return out.replace(/\s*\n\s*/g, '\n').trim();
  }

  function rawRuns(el) {
    const lines = [...el.children].filter(
      (c) => c.localName === 'tspan' && c.hasAttribute('data-line'),
    );
    if (!lines.length) return mergeRuns([{ t: foreignText(el), o: {} }]);
    const t = typeFrom(el);
    const runs = [];
    lines.forEach((l, i) => {
      if (i) runs.push({ t: l.hasAttribute('data-soft') ? ' ' : '\n', o: runs.at(-1)?.o || {} });
      for (const n of l.childNodes) {
        if (n.nodeType === 3) runs.push({ t: n.textContent, o: {} });
        else if (n.localName === 'tspan') runs.push({ t: n.textContent, o: runFrom(n, t) });
      }
    });
    return mergeRuns(runs);
  }

  const rawText = (el) =>
    rawRuns(el)
      .map((r) => r.t)
      .join('');

  const measureCtx = document.createElement('canvas').getContext('2d');
  function measurer(t) {
    measureCtx.font = `${t.italic ? 'italic ' : ''}${t.caps === 'small' ? 'small-caps ' : ''}${t.weight} ${t.size}px ${fontByName(t.family).css}`;
    const ls = (t.tracking * t.size) / 1000;
    return (s) =>
      measureCtx.measureText(t.caps === 'all' ? s.toUpperCase() : s).width + ls * s.length;
  }

  // Width of a list of styled characters, each stretch in its own font.
  function charsWidth(chars, t) {
    let sum = 0;
    for (let k = 0; k < chars.length; ) {
      let j = k;
      while (j < chars.length && chars[j].o === chars[k].o) j++;
      sum += measurer({ ...t, ...chars[k].o })(
        chars
          .slice(k, j)
          .map((c) => c.ch)
          .join(''),
      );
      k = j;
    }
    return sum;
  }

  // Greedy word wrap of one paragraph (styled characters) to width w.
  function wrapChars(chars, w, t) {
    if (!chars.length) return [[]];
    const trimEnd = (arr) => {
      let e = arr.length;
      while (e && /\s/.test(arr[e - 1].ch)) e--;
      return arr.slice(0, e);
    };
    const words = [];
    let cur = [];
    for (const c of chars) {
      cur.push(c);
      if (/\s/.test(c.ch)) {
        words.push(cur);
        cur = [];
      }
    }
    if (cur.length) words.push(cur);
    const out = [];
    let line = [];
    for (const word of words) {
      if (!line.length || charsWidth(trimEnd([...line, ...word]), t) <= w) {
        line = [...line, ...word];
        // A single word wider than the box breaks between letters.
        while (charsWidth(trimEnd(line), t) > w && line.length > 1) {
          let k = line.length - 1;
          while (k > 1 && charsWidth(line.slice(0, k), t) > w) k--;
          out.push(line.slice(0, k));
          line = line.slice(k);
        }
      } else {
        out.push(trimEnd(line));
        line = word;
      }
    }
    out.push(trimEnd(line));
    return out;
  }

  const leadingOf = (t) => t.leading || t.size * 1.2;

  // Write content (a string, runs, or the layer's own runs) into the layer:
  // wrap, place each line (auto leading = 120% of its largest size, as in
  // Photoshop) and group characters back into run tspans.
  function layoutText(el, content) {
    const runs = mergeRuns(
      content == null
        ? rawRuns(el)
        : typeof content === 'string'
          ? [{ t: content, o: {} }]
          : content,
    );
    const t = typeFrom(el);
    const x0 = parseFloat(el.getAttribute('x')) || 0;
    const y0 = parseFloat(el.getAttribute('y')) || 0;
    const ax = t.box ? x0 + { start: 0, middle: t.box / 2, end: t.box }[t.align] : x0;
    const hard = [[]];
    for (const r of runs)
      for (const ch of r.t) ch === '\n' ? hard.push([]) : hard.at(-1).push({ ch, o: r.o });
    const lines = [];
    for (const h of hard)
      (t.box ? wrapChars(h, t.box, t) : [h]).forEach((p, i) =>
        lines.push({ chars: p, soft: i > 0 }),
      );
    // Decorations can't be switched off inside an underlined parent, so
    // when runs disagree each run carries its own and the layer none.
    const perRun = runs.some((r) => r.o.underline != null || r.o.strike != null);
    const layerDeco = decoOf(t.underline, t.strike);
    el.setAttribute('data-deco', layerDeco);
    if (perRun || !layerDeco) el.removeAttribute('text-decoration');
    else el.setAttribute('text-decoration', layerDeco);
    el.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    let y = y0;
    el.replaceChildren(
      ...lines.map(({ chars, soft }, i) => {
        const big = chars.length ? Math.max(...chars.map((c) => c.o.size ?? t.size)) : t.size;
        if (i) y += t.leading || big * 1.2;
        const line = mk('tspan', { x: f(ax), y: f(y), 'data-line': '' });
        if (soft) line.setAttribute('data-soft', '');
        for (let k = 0; k < chars.length; ) {
          let j = k;
          while (j < chars.length && chars[j].o === chars[k].o) j++;
          const text = chars
            .slice(k, j)
            .map((c) => c.ch)
            .join('');
          const o = chars[k].o;
          if (!Object.keys(o).length && !perRun) line.append(document.createTextNode(text));
          else {
            const ts = mk('tspan', runAttrs(o, t));
            if (perRun)
              ts.setAttribute(
                'text-decoration',
                decoOf(o.underline ?? t.underline, o.strike ?? t.strike) || 'none',
              );
            ts.textContent = text;
            line.append(ts);
          }
          k = j;
        }
        return line;
      }),
    );
  }

  // Text layers among the selection (including inside selected groups).
  function selectedTexts() {
    const out = [];
    for (const el of state.sel) {
      if (el.localName === 'text') out.push(el);
      else out.push(...el.querySelectorAll('text'));
    }
    return out;
  }

  // ---- on-canvas rich editor ------------------------------------------------
  // A contenteditable box styled like the layer, one span per run, placed
  // with the layer's own screen matrix so the caret sits on rotated text.
  // Selecting characters and changing a setting styles just those.
  const cssColor = (fill, a = 1) => {
    const h = hex(fill);
    if (!h) return fill;
    const n = parseInt(h.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  function spanCss(o, t) {
    const e = { ...t, ...o };
    const css = {
      fontFamily: fontByName(e.family).css,
      fontWeight: e.weight,
      fontStyle: e.italic ? 'italic' : 'normal',
      fontSize: `${e.size}px`,
      letterSpacing: `${(e.tracking * e.size) / 1000}px`,
      textTransform: e.caps === 'all' ? 'uppercase' : 'none',
      fontVariant: e.caps === 'small' ? 'small-caps' : 'normal',
      textDecoration: decoOf(e.underline, e.strike) || 'none',
      verticalAlign: e.script !== 'none' ? e.script : `${e.shift}px`,
    };
    if (o.fill != null || o.fillA != null)
      css.color =
        o.fill === 'none' ? 'transparent' : cssColor(o.fill ?? t.fill, o.fillA ?? t.fillA);
    return css;
  }

  function renderEditor(div, runs, t) {
    div.replaceChildren(
      ...runs.map((r) => {
        const s = document.createElement('span');
        s.dataset.o = JSON.stringify(r.o);
        Object.assign(s.style, spanCss(r.o, t));
        s.textContent = r.t;
        return s;
      }),
    );
    if (!runs.length || runs.at(-1).t.endsWith('\n'))
      div.append(Object.assign(document.createElement('br'), { className: 'sc-end' }));
  }

  // Runs back out of the editor, whatever the browser did to its DOM.
  function readEditor(div) {
    const runs = [];
    const walk = (node, o) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) runs.push({ t: n.textContent, o });
        else if (n.nodeName === 'BR') {
          if (!n.classList.contains('sc-end')) runs.push({ t: '\n', o });
        } else if (n.nodeType === 1) {
          if (/^(DIV|P)$/.test(n.nodeName) && runs.length && !runs.at(-1).t.endsWith('\n'))
            runs.push({ t: '\n', o });
          walk(n, n.dataset?.o ? JSON.parse(n.dataset.o) : o);
        }
      }
    };
    walk(div, {});
    return mergeRuns(runs);
  }

  // Character offsets of the editor's selection, and back.
  function editorRange(div) {
    const sel = getSelection();
    if (!sel.rangeCount || !div.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    const at = (node, off) => {
      const pre = document.createRange();
      pre.selectNodeContents(div);
      pre.setEnd(node, off);
      const tmp = document.createElement('div');
      tmp.append(pre.cloneContents());
      return readEditor(tmp).reduce((n, x) => n + x.t.length, 0);
    };
    const a = at(r.startContainer, r.startOffset);
    const b = at(r.endContainer, r.endOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  function setEditorRange(div, start, end) {
    const find = (pos) => {
      let n = 0;
      const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let last = null;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === 3) {
          if (pos <= n + node.length) return [node, pos - n];
          n += node.length;
          last = node;
        } else if (node.nodeName === 'BR' && !node.classList.contains('sc-end')) {
          if (pos <= n) return [node.parentNode, [...node.parentNode.childNodes].indexOf(node)];
          n += 1;
        }
      }
      return last ? [last, last.length] : [div, 0];
    };
    const r = document.createRange();
    r.setStart(...find(start));
    r.setEnd(...find(end));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  let typeEdit = null;
  function editTextLayer(el, isNew = false) {
    if (typeEdit) finishTypeEdit(true);
    const wrapEl = $('#sc-stage-wrap');
    const div = document.createElement('div');
    div.className = 'sc-type-edit';
    div.contentEditable = 'true';
    div.spellcheck = false;
    div.setAttribute('role', 'textbox');
    div.setAttribute('aria-multiline', 'true');
    div.setAttribute('aria-label', 'Edit text');
    const runs = rawRuns(el);
    const ed = { el, div, isNew, before: JSON.stringify(runs), range: null };
    // Layer-wide look (runs override it span by span).
    ed.restyle = () => {
      const t = typeFrom(el);
      const cs = getComputedStyle(el);
      ed.t = { ...t, fill: cs.fill, fillA: parseFloat(cs.fillOpacity) || 1 };
      Object.assign(div.style, spanCss({}, ed.t), {
        lineHeight: t.leading ? `${t.leading}px` : '1.2',
        textAlign: { start: 'left', middle: 'center', end: 'right' }[t.align],
        color:
          cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url')
            ? cssColor(cs.fill, ed.t.fillA)
            : '#000',
        opacity: parseFloat(cs.opacity) || 1,
        whiteSpace: t.box ? 'pre-wrap' : 'pre',
        width: t.box ? `${t.box}px` : 'auto',
        verticalAlign: 'baseline',
      });
    };
    ed.place = () => {
      const t = ed.t;
      const content = readEditor(div);
      const firstLine = [];
      for (const r of content) {
        firstLine.push(r);
        if (r.t.includes('\n')) break;
      }
      const big = Math.max(t.size, ...firstLine.map((r) => r.o.size ?? t.size));
      const lead = t.leading || big * 1.2;
      const w = t.box || div.offsetWidth;
      const x0 = parseFloat(el.getAttribute('x')) || 0;
      const y0 = parseFloat(el.getAttribute('y')) || 0;
      const bx = t.box ? x0 : x0 - { start: 0, middle: w / 2, end: w }[t.align];
      const by = y0 - ((lead - big) / 2 + big * 0.8);
      const M = el.getScreenCTM().translate(bx, by);
      const r = wrapEl.getBoundingClientRect();
      div.style.transform = `matrix(${M.a},${M.b},${M.c},${M.d},${M.e - r.left},${M.f - r.top})`;
    };
    ed.restyle();
    renderEditor(div, runs, ed.t);
    wrapEl.append(div);
    el.style.visibility = 'hidden';
    typeEdit = ed;
    ed.place();
    div.addEventListener('input', () => {
      const runsNow = readEditor(div);
      if (
        runsNow.length &&
        runsNow.at(-1).t.endsWith('\n') &&
        !div.lastChild?.classList?.contains('sc-end')
      )
        div.append(Object.assign(document.createElement('br'), { className: 'sc-end' }));
      ed.place();
    });
    div.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') finishTypeEdit(false);
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finishTypeEdit(true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
    });
    div.addEventListener('paste', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    // Clicks on the panels, options bar, font picker or paint chips keep the
    // edit open (they style the selected characters); anywhere else ends it.
    div.addEventListener('blur', () =>
      setTimeout(() => {
        if (typeEdit !== ed || document.activeElement === div) return;
        if (document.activeElement?.closest?.('.sc-options, .sc-panel, #sc-fontpop, .sc-chips'))
          return;
        finishTypeEdit(true);
      }, 0),
    );
    state.sel = [el];
    readTypeFromSelection();
    drawSelection();
    setTimeout(() => {
      div.focus();
      const len = runs.reduce((n, r) => n + r.t.length, 0);
      setEditorRange(div, isNew ? len : 0, len);
    }, 0);
  }

  // The panels follow the characters under the caret / selection.
  document.addEventListener('selectionchange', () => {
    const ed = typeEdit;
    if (!ed || document.activeElement !== ed.div) return;
    ed.range = editorRange(ed.div) || ed.range;
    if (!ed.range) return;
    const runs = readEditor(ed.div);
    const at = ed.range.start === ed.range.end ? Math.max(0, ed.range.start - 1) : ed.range.start;
    let pos = 0;
    let o = {};
    for (const r of runs) {
      if (at < pos + r.t.length) {
        o = r.o;
        break;
      }
      pos += r.t.length;
    }
    state.type = {
      ...typeFrom(ed.el),
      ...pickKeys(
        o,
        RUN_KEYS.filter((k) => k !== 'fill' && k !== 'fillA'),
      ),
    };
    syncTypeUI();
    if (o.fill && o.fill !== 'none') {
      state.fill = hex(o.fill) || state.fill;
      state.fillOn = true;
    } else if (o.fill === 'none') state.fillOn = false;
    else readStyle(ed.el);
    if (o.fillA != null) state.fillA = o.fillA;
    syncStyleUI();
  });

  // Style the selected characters (all of them when nothing is selected);
  // paragraph settings go to the layer.
  function applyToEdit(patch, refocus = true) {
    const ed = typeEdit;
    const div = ed.div;
    const layerPatch = pickKeys(patch, ['leading', 'align', 'box']);
    const runPatch = pickKeys(patch, RUN_KEYS);
    let runs = readEditor(div);
    const len = runs.reduce((n, r) => n + r.t.length, 0);
    const range = ed.range && ed.range.end > ed.range.start ? ed.range : { start: 0, end: len };
    if (Object.keys(layerPatch).length) {
      applyType(ed.el, { ...typeFrom(ed.el), ...layerPatch }, runs);
      ed.restyle();
    }
    if (Object.keys(runPatch).length) {
      const lt = ed.t;
      const next = [];
      let pos = 0;
      for (const r of runs) {
        const a = pos;
        const b = pos + r.t.length;
        pos = b;
        const cuts = [
          [a, Math.max(a, Math.min(b, range.start)), false],
          [Math.max(a, range.start), Math.min(b, range.end), true],
          [Math.max(a, Math.min(b, range.end)), b, false],
        ];
        for (const [s, e, hit] of cuts) {
          if (e <= s) continue;
          let o = r.o;
          if (hit) {
            o = { ...o, ...runPatch };
            if (runPatch.family)
              Object.assign(
                o,
                fitStyle(runPatch.family, o.weight ?? lt.weight, o.italic ?? lt.italic),
              );
            if (runPatch.shift != null) o.script = 'none';
            o = pruneO(o, lt);
          }
          next.push({ t: r.t.slice(s - a, e - a), o });
        }
      }
      runs = mergeRuns(next);
      renderEditor(div, runs, lt);
      if (runPatch.family) ensureFont(runPatch.family);
    }
    ed.place();
    if (refocus) {
      div.focus();
      setEditorRange(div, range.start, range.end);
      ed.range = range;
    }
  }

  function finishTypeEdit(keep) {
    const ed = typeEdit;
    if (!ed) return;
    typeEdit = null;
    const { el, div, isNew, before } = ed;
    const runs = readEditor(div);
    div.remove();
    el.style.removeProperty('visibility');
    if (!el.getAttribute('style')) el.removeAttribute('style');
    if (!keep) {
      if (isNew) {
        el.remove();
        state.sel = [];
      } else layoutText(el, JSON.parse(before));
      drawSelection();
      renderLayers();
      return;
    }
    if (
      !runs
        .map((r) => r.t)
        .join('')
        .trim()
    ) {
      el.remove();
      state.sel = [];
      if (isNew) {
        drawSelection();
        renderLayers();
      } else commit();
      return;
    }
    layoutText(el, runs);
    if (!isNew && JSON.stringify(rawRuns(el)) === before) return drawSelection();
    state.sel = [el];
    commit();
  }

  // ---- Type tool ------------------------------------------------------------
  tools.text = {
    hint: 'Click to add point text, or drag a box for paragraph text · Click text to edit it · Ctrl+Enter or click away finishes, Esc cancels',
    cursor: 'text',
    down(e, p) {
      // As in Photoshop, a click while typing only commits the text (the
      // editor's blur does that); the next click starts a new layer.
      if (typeEdit) {
        this.hit = this.g = null;
        return;
      }
      const hit = doc.contains(e.target) ? e.target.closest('text') : null;
      this.hit = hit;
      this.g = hit ? null : { p0: snapPt(p) };
    },
    move(e, p) {
      if (!this.g) return;
      const q = snapPt(p);
      const a = this.g.p0;
      guides.replaceChildren();
      mk(
        'rect',
        {
          x: Math.min(a.x, q.x),
          y: Math.min(a.y, q.y),
          width: Math.abs(q.x - a.x),
          height: Math.abs(q.y - a.y),
          class: 'sc-ov sc-ov-dash',
        },
        guides,
      );
    },
    up(e, p) {
      guides.replaceChildren();
      if (this.hit) {
        const el = this.hit;
        this.hit = null;
        setTimeout(() => editTextLayer(el), 0);
        return;
      }
      const g = this.g;
      this.g = null;
      if (!g) return;
      const q = snapPt(p);
      const w = Math.abs(q.x - g.p0.x);
      const h = Math.abs(q.y - g.p0.y);
      const area = w * state.zoom > 12 && h * state.zoom > 12;
      const t = { ...state.type, box: area ? w : 0 };
      const lead = leadingOf(t);
      const top = Math.min(g.p0.y, q.y);
      const el = mk('text', {
        ...newStyle('text'),
        x: f(area ? Math.min(g.p0.x, q.x) : g.p0.x),
        y: f(area ? top + (lead - t.size) / 2 + t.size * 0.8 : g.p0.y),
      });
      doc.append(el);
      applyType(el, t, '');
      renderLayers();
      setTimeout(() => editTextLayer(el, true), 0);
    },
    leave() {
      if (typeEdit) finishTypeEdit(true);
      guides.replaceChildren();
    },
  };

  // ---- options bar / Character / Paragraph panels ---------------------------
  function readTypeFromSelection() {
    const el = selectedTexts()[0];
    if (el) state.type = { ...typeFrom(el) };
    syncTypeUI();
    return !!el;
  }

  function syncTypeUI() {
    const t = state.type;
    for (const b of document.querySelectorAll('[data-type-show="family"]')) {
      b.textContent = t.family;
      b.style.fontFamily = fontByName(t.family).css;
    }
    for (const sel of document.querySelectorAll('select[data-type="style"]')) {
      sel.replaceChildren(
        ...fontStyles(t.family).map(([w, it, label]) => {
          const o = document.createElement('option');
          o.value = `${w}${it ? 'i' : ''}`;
          o.textContent = label;
          return o;
        }),
      );
      sel.value = `${t.weight}${t.italic ? 'i' : ''}`;
    }
    const show = {
      size: f(t.size),
      leading: t.leading ? f(t.leading) : '',
      tracking: t.tracking,
      shift: t.script !== 'none' ? '' : f(t.shift),
      box: t.box ? f(t.box) : '',
    };
    for (const el of document.querySelectorAll('input[data-type]'))
      if (document.activeElement !== el) el.value = show[el.dataset.type];
    const boxField = $('[data-type="box"]');
    if (boxField) boxField.disabled = !t.box;
    for (const b of document.querySelectorAll('[data-type-align]'))
      b.setAttribute('aria-checked', b.dataset.typeAlign === t.align);
    const on = {
      caps: t.caps === 'all',
      smallcaps: t.caps === 'small',
      super: t.script === 'super',
      sub: t.script === 'sub',
      underline: t.underline,
      strike: t.strike,
    };
    for (const b of document.querySelectorAll('[data-type-toggle]'))
      b.setAttribute('aria-pressed', !!on[b.dataset.typeToggle]);
    $('#sc-type-convert').textContent = t.box
      ? 'Convert to Point Text'
      : 'Convert to Paragraph Text';
  }

  // Change one setting on the text being edited, else on the selected text
  // layers (each keeps its other settings), and make it the default.
  function changeType(patch, final = true) {
    Object.assign(state.type, patch);
    if (patch.family)
      Object.assign(state.type, fitStyle(patch.family, state.type.weight, state.type.italic));
    ensureFont(state.type.family);
    if (typeEdit) {
      applyToEdit(patch, final);
      syncTypeUI();
      return;
    }
    const targets = selectedTexts();
    // Styling a whole layer clears the same setting from its characters.
    const keys = Object.keys(patch).filter((k) => RUN_KEYS.includes(k));
    if (patch.family) keys.push('weight', 'italic');
    for (const el of targets) {
      const t = { ...typeFrom(el), ...patch };
      if (patch.family) Object.assign(t, fitStyle(patch.family, t.weight, t.italic));
      const runs = rawRuns(el).map((r) => ({
        t: r.t,
        o: Object.fromEntries(Object.entries(r.o).filter(([k]) => !keys.includes(k))),
      }));
      applyType(el, t, runs);
    }
    syncTypeUI();
    if (!targets.length) return;
    if (final) commit();
    else drawSelection();
  }

  function convertTextKind() {
    const els = selectedTexts();
    if (!els.length) return say('Select a text layer first.');
    for (const el of els) {
      const t = typeFrom(el);
      const text = rawRuns(el);
      if (t.box) {
        // Paragraph → point: one line per paragraph, anchored where the box was.
        const x0 = parseFloat(el.getAttribute('x')) || 0;
        el.setAttribute('x', f(x0 + { start: 0, middle: t.box / 2, end: t.box }[t.align]));
        applyType(el, { ...t, box: 0 }, text);
      } else {
        const b = el.getBBox();
        el.setAttribute('x', f(b.x));
        applyType(el, { ...t, box: Math.max(b.width, t.size * 4) }, text);
      }
    }
    readTypeFromSelection();
    commit();
  }

  // ---- font picker ------------------------------------------------------------
  const fontPop = $('#sc-fontpop');
  const fontSearch = fontPop.querySelector('input');
  const fontList = fontPop.querySelector('ul');
  let fontActive = 0;
  function renderFontList() {
    const q = fontSearch.value.trim().toLowerCase();
    const groups = [
      ['System fonts', 'system'],
      ['Google Fonts', 'google'],
      ['Installed on this computer', 'local'],
    ];
    fontList.replaceChildren();
    let idx = 0;
    for (const [title, src] of groups) {
      const list = FONTS.filter((ft) => ft.src === src && ft.name.toLowerCase().includes(q));
      if (!list.length) continue;
      const h = document.createElement('li');
      h.className = 'sc-font-head';
      h.textContent = title;
      fontList.append(h);
      for (const ft of list) {
        const li = document.createElement('li');
        li.className = 'sc-font-item';
        li.setAttribute('role', 'option');
        li.dataset.font = ft.name;
        li.dataset.idx = idx++;
        li.setAttribute('aria-selected', ft.name === state.type.family);
        li.textContent = ft.name;
        li.style.fontFamily = ft.css;
        li.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          pickFont(ft.name);
        });
        fontList.append(li);
      }
    }
    if (!idx) {
      const li = document.createElement('li');
      li.className = 'sc-font-head';
      li.textContent = 'No fonts match';
      fontList.append(li);
    }
    fontActive = Math.max(
      0,
      [...fontList.querySelectorAll('.sc-font-item')].findIndex(
        (li) => li.dataset.font === state.type.family,
      ),
    );
    markFontActive();
  }
  function markFontActive() {
    const items = [...fontList.querySelectorAll('.sc-font-item')];
    items.forEach((li, i) => li.classList.toggle('active', i === fontActive));
    items[fontActive]?.scrollIntoView({ block: 'nearest' });
  }
  function openFontPicker(btn) {
    loadFontPreviews();
    fontPop.hidden = false;
    const r = btn.getBoundingClientRect();
    fontPop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - fontPop.offsetWidth - 4))}px`;
    const below = r.bottom + 2 + fontPop.offsetHeight < innerHeight;
    fontPop.style.top = `${below ? r.bottom + 2 : Math.max(4, r.top - fontPop.offsetHeight - 2)}px`;
    fontSearch.value = '';
    renderFontList();
    fontSearch.focus();
    $('#sc-local-fonts').hidden =
      !('queryLocalFonts' in window) || FONTS.some((ft) => ft.src === 'local');
  }
  function closeFontPicker() {
    fontPop.hidden = true;
  }
  function pickFont(name) {
    closeFontPicker();
    changeType({ family: name });
  }
  fontSearch.addEventListener('input', renderFontList);
  fontSearch.addEventListener('keydown', (e) => {
    const items = [...fontList.querySelectorAll('.sc-font-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      fontActive = clamp(fontActive + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
      markFontActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[fontActive]) pickFont(items[fontActive].dataset.font);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFontPicker();
    }
    e.stopPropagation();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!fontPop.hidden && !fontPop.contains(e.target) && !e.target.closest('[data-fontpick]'))
      closeFontPicker();
  });
  for (const b of document.querySelectorAll('[data-fontpick]'))
    b.addEventListener('click', () => (fontPop.hidden ? openFontPicker(b) : closeFontPicker()));

  // Chromium's Local Font Access lists the fonts installed on this computer.
  async function loadLocalFonts() {
    try {
      const data = await window.queryLocalFonts();
      const fam = new Map();
      for (const d of data) {
        if (FONTS.some((ft) => ft.name === d.family)) continue;
        const s = d.style.toLowerCase();
        const w = /thin|hairline/.test(s)
          ? 100
          : /extra ?light|ultra ?light/.test(s)
            ? 200
            : /light/.test(s)
              ? 300
              : /medium/.test(s)
                ? 500
                : /semi ?bold|demi/.test(s)
                  ? 600
                  : /extra ?bold|ultra ?bold/.test(s)
                    ? 800
                    : /black|heavy/.test(s)
                      ? 900
                      : /bold/.test(s)
                        ? 700
                        : 400;
        const e = fam.get(d.family) || { w: new Set(), i: false };
        e.w.add(w);
        if (/italic|oblique/.test(s)) e.i = true;
        fam.set(d.family, e);
      }
      for (const [name, e] of [...fam].sort((a, b) => a[0].localeCompare(b[0])))
        FONTS.push({
          name,
          css: `'${name}', sans-serif`,
          w: [...e.w].sort((a, b) => a - b),
          i: e.i,
          src: 'local',
        });
      say(
        `${fam.size} installed font families added. They only look right on computers that have them.`,
      );
      $('#sc-local-fonts').hidden = true;
      renderFontList();
    } catch {
      say('The browser did not allow access to installed fonts.');
    }
  }
  $('#sc-local-fonts').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    loadLocalFonts();
  });

  // ---- type controls ------------------------------------------------------------
  for (const sel of document.querySelectorAll('select[data-type="style"]'))
    sel.addEventListener('change', () =>
      changeType({ weight: parseInt(sel.value, 10), italic: sel.value.endsWith('i') }),
    );
  for (const el of document.querySelectorAll('input[data-type]')) {
    const key = el.dataset.type;
    const read = () => {
      const v = parseFloat(el.value);
      if (key === 'leading') return { leading: isFinite(v) && v > 0 ? v : 0 };
      if (!isFinite(v)) return null;
      if (key === 'shift') return { shift: v, script: 'none' };
      if (key === 'box') return state.type.box ? { box: Math.max(1, v) } : null;
      if (key === 'size') return { size: Math.max(0.5, v) };
      return { [key]: v };
    };
    el.addEventListener('input', () => {
      const p = read();
      if (p && !typeEdit) changeType(p, false);
    });
    el.addEventListener('change', () => {
      const p = read();
      if (p) changeType(p, true);
      syncTypeUI();
    });
    el.addEventListener('keydown', (e) => {
      // Swallow the key: focus may move to the canvas text editor while it's handled.
      if (e.key === 'Enter') {
        e.preventDefault();
        el.blur();
      }
    });
  }
  for (const b of document.querySelectorAll('[data-type-align]'))
    b.addEventListener('click', () => changeType({ align: b.dataset.typeAlign }));
  for (const b of document.querySelectorAll('[data-type-toggle]')) {
    b.addEventListener('click', () => {
      const k = b.dataset.typeToggle;
      const t = state.type;
      const patch = {
        caps: { caps: t.caps === 'all' ? 'none' : 'all' },
        smallcaps: { caps: t.caps === 'small' ? 'none' : 'small' },
        super: { script: t.script === 'super' ? 'none' : 'super' },
        sub: { script: t.script === 'sub' ? 'none' : 'sub' },
        underline: { underline: !t.underline },
        strike: { strike: !t.strike },
      }[k];
      changeType(patch);
    });
  }
  $('#sc-type-convert').addEventListener('click', convertTextKind);

  // Open the Properties group on its Character tab.
  function showCharacterPanel() {
    $('[data-tab="character"]').click();
    $('#sc-panel').classList.add('open');
  }

  // Raster of the artboard for pixel sampling, rebuilt lazily after edits.
  let rasterJob = null;
  function raster() {
    if (rasterJob) return rasterJob;
    rasterJob = new Promise((resolve) => {
      const s = clamp(2048 / Math.max(state.w, state.h), 1, 4);
      const url = URL.createObjectURL(new Blob([serialize()], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(state.w * s));
        c.height = Math.max(1, Math.round(state.h * s));
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ ctx, s, c });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    return rasterJob;
  }

  // Colour under doc point p, or a reason string when there's nothing to take.
  async function samplePixel(p) {
    if (p.x < 0 || p.y < 0 || p.x > state.w || p.y > state.h) return 'Outside the artboard.';
    const r = await raster();
    if (!r) return "Couldn't render the drawing to sample it.";
    let d;
    try {
      d = r.ctx.getImageData(
        Math.min(r.c.width - 1, Math.floor(p.x * r.s)),
        Math.min(r.c.height - 1, Math.floor(p.y * r.s)),
        1,
        1,
      ).data;
    } catch {
      return 'The drawing uses an external image, so the browser blocks pixel sampling.';
    }
    if (!d[3]) return 'Nothing there to sample (transparent).';
    const hx = '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
    return { hex: hx, a: +(d[3] / 255).toFixed(2) };
  }

  tools.eyedropper = {
    hint: 'Style: click a shape to copy its fill, stroke and opacity (onto the selection too) · Colour: click to take the exact pixel colour into the active paint · Alt-click sends it to the other paint',
    cursor: 'crosshair',
    async down(e, p) {
      if (state.eyedropMode === 'style') {
        const el = topLevel(e.target);
        if (!el) return say('Click a shape to copy its style.');
        const targets = state.sel.filter((x) => x !== el);
        const hit = e.target.closest?.(SHAPE_SEL);
        readStyle(hit && doc.contains(hit) ? hit : el);
        if (!targets.length) return say('Style picked up — new shapes will use it.');
        for (const t of targets)
          for (const k of ['fill', 'stroke', 'width', 'opacity']) applyStyle(t, k);
        commit();
        return say(`Style applied to ${targets.length} object${targets.length > 1 ? 's' : ''}.`);
      }
      const c = await samplePixel(p);
      if (typeof c === 'string') return say(c);
      const k = e.altKey ? (state.active === 'fill' ? 'stroke' : 'fill') : state.active;
      state[k] = c.hex;
      state[k + 'On'] = true;
      state[k + 'A'] = c.a;
      styleChanged(k, true);
      say(
        `${k === 'fill' ? 'Fill' : 'Stroke'} set to ${c.hex}${c.a < 1 ? ` at ${Math.round(c.a * 100)}%` : ''}.`,
      );
    },
    // In Colour mode, a ring around the cursor previews the sampled colour.
    async move(e, p) {
      if (state.eyedropMode !== 'pixel') return;
      const stamp = (this.stamp = (this.stamp || 0) + 1);
      const c = await samplePixel(p);
      if (stamp !== this.stamp || state.tool !== 'eyedropper') return;
      guides.replaceChildren();
      if (typeof c === 'string') return;
      const z = state.zoom;
      mk(
        'circle',
        {
          cx: p.x,
          cy: p.y,
          r: 16 / z,
          class: 'sc-eyedrop-ring',
          stroke: c.hex,
          'stroke-opacity': c.a,
          'stroke-width': 8,
        },
        guides,
      );
      mk('circle', { cx: p.x, cy: p.y, r: 20 / z, class: 'sc-eyedrop-ring sc-ov' }, guides);
      $('#sc-eyedrop-note').textContent =
        `${c.hex}${c.a < 1 ? ` · ${Math.round(c.a * 100)}%` : ''}`;
    },
    leave() {
      this.stamp = (this.stamp || 0) + 1;
      guides.replaceChildren();
      $('#sc-eyedrop-note').textContent = '';
    },
  };

  tools.hand = {
    hint: 'Drag to pan · Ctrl/⌘ + wheel or pinch to zoom',
    cursor: 'grab',
  };

  tools.eraser = {
    hint: 'Rub to erase · Object deletes whatever you touch, Cut splits strokes',
    cursor: 'none',
    down(e, p) {
      this.trail = [p];
      this.hits = new Set();
      this.collect(e);
      this.redraw(p);
    },
    move(e, p) {
      if (this.trail) {
        this.trail.push(p);
        this.collect(e);
      }
      this.redraw(p);
    },
    collect(e) {
      const r = state.eraserSize;
      const probes = [[0, 0]];
      for (let i = 0; i < 8; i++)
        probes.push([Math.cos((i * Math.PI) / 4) * r, Math.sin((i * Math.PI) / 4) * r]);
      for (const [dx, dy] of probes) {
        for (const n of document.elementsFromPoint(e.clientX + dx, e.clientY + dy)) {
          const el = doc.contains(n) && n !== doc ? n.closest('text') || n : null;
          if (el && !this.hits.has(el)) {
            this.hits.add(el);
            if (state.eraserMode === 'object') el.style.opacity = '0.2';
          }
        }
      }
    },
    redraw(p) {
      guides.replaceChildren();
      const r = state.eraserSize / state.zoom;
      if (this.trail?.length) {
        mk(
          'path',
          {
            d: 'M' + this.trail.map((q) => `${f(q.x)} ${f(q.y)}`).join('L'),
            class: 'sc-erase-trail',
            'stroke-width': 2 * r,
          },
          guides,
        );
      }
      if (p) {
        this.last = p;
        mk('circle', { cx: p.x, cy: p.y, r, class: 'sc-eraser-ring' }, guides);
      } else if (this.last)
        mk('circle', { cx: this.last.x, cy: this.last.y, r, class: 'sc-eraser-ring' }, guides);
    },
    up() {
      const hits = [...(this.hits || [])];
      const trail = this.trail;
      this.trail = null;
      this.hits = null;
      this.redraw(this.last);
      if (!hits.length) return;
      if (state.eraserMode === 'object') {
        hits.forEach((el) => el.remove());
        commit();
        return;
      }
      let changed = 0;
      let skipped = 0;
      for (const el of hits) {
        const r = cutElement(el, trail, state.eraserSize / state.zoom);
        if (r === 'skip') skipped++;
        else if (r) changed++;
      }
      if (changed) commit();
      if (skipped)
        say(
          `Cut leaves filled shapes and groups alone (${skipped} skipped) — use Object mode to delete them.`,
        );
    },
    leave() {
      this.trail = null;
      this.hits = null;
      this.last = null;
      guides.replaceChildren();
    },
    cancel() {
      this.leave();
    },
  };

  // Split a stroke-only geometry element wherever the eraser trail passed.
  // Returns true if the element changed, false if untouched, 'skip' if the
  // element can't be cut (filled shape, group, text, image).
  function cutElement(el, trail, rDoc) {
    if (!(el instanceof SVGGeometryElement)) return 'skip';
    const cs = getComputedStyle(el);
    if (
      cs.fill !== 'none' &&
      parseFloat(cs.fillOpacity) > 0 &&
      !['line', 'polyline'].includes(el.localName)
    )
      return 'skip';
    const M = fullM(el);
    const inv = M.inverse();
    const scale = Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) || 1;
    const r = rDoc / scale + (parseFloat(cs.strokeWidth) || 0) / 2;
    const lt = trail.map((q) => inv.transformPoint(new DOMPoint(q.x, q.y)));
    const len = el.getTotalLength();
    if (!len) return false;
    const step = Math.max(len / 4000, Math.min(r / 3, 2));
    const near = (q) => {
      if (lt.length === 1) return dist(q, lt[0]) < r;
      for (let i = 1; i < lt.length; i++) if (segDist(q, lt[i - 1], lt[i]) < r) return true;
      return false;
    };
    const runs = [];
    let run = [];
    let prev = null;
    let erased = false;
    let jumps = 0;
    for (let s = 0; s <= len + step / 2; s += step) {
      const q = el.getPointAtLength(Math.min(s, len));
      if (prev && dist(q, prev) > step * 4) {
        jumps++;
        if (run.length) runs.push(run);
        run = [];
      }
      prev = q;
      if (near(q)) {
        erased = true;
        if (run.length) runs.push(run);
        run = [];
      } else run.push({ x: q.x, y: q.y });
    }
    if (run.length) runs.push(run);
    if (!erased) return false;
    // A closed single-subpath shape wraps: glue the tail run onto the head.
    const first = el.getPointAtLength(0);
    if (
      !jumps &&
      runs.length > 1 &&
      dist(first, el.getPointAtLength(len)) < step * 1.5 &&
      runs[0][0] &&
      dist(runs[0][0], first) < 1e-6
    ) {
      const tail = runs.pop();
      runs[0] = tail.concat(runs[0]);
    }
    const skip = new Set([
      'd',
      'points',
      'x',
      'y',
      'width',
      'height',
      'rx',
      'ry',
      'cx',
      'cy',
      'r',
      'x1',
      'y1',
      'x2',
      'y2',
      'id',
      'pathLength',
    ]);
    const pieces = runs
      .filter((run) => run.length >= 2)
      .map((run) => {
        const p = mk('path', { d: smoothD(rdp(run, step * 0.35)) });
        for (const a of el.attributes) if (!skip.has(a.name)) p.setAttribute(a.name, a.value);
        if (!p.hasAttribute('fill')) p.setAttribute('fill', 'none');
        return p;
      });
    el.replaceWith(...pieces);
    return true;
  }

  // ---------------------------------------------------------------------
  // Point editing
  //
  // A path is modelled as subpaths of nodes: { x, y, hin, hout } in the
  // element's local coordinates, where hin / hout are absolute control
  // points (or null). The segment a → b is a straight line when a.hout and
  // b.hin are both null, otherwise a cubic. Every SVG path command (H, V,
  // S, Q, T and arcs included) normalises into that, and basic shapes
  // (rect, ellipse, circle, line, polyline, polygon) convert to it too; a
  // shape only becomes a <path> once a point is actually changed.
  // ---------------------------------------------------------------------
  const EDITABLE = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
  const KAPPA = 0.5522847498;
  const fp = (n) => +(+n).toFixed(3) || 0;

  // Endpoint arc → cubic Béziers (SVG spec, appendix B.2.4), at most 90° each.
  function arcToCubics(p0, rx, ry, phiDeg, large, sweep, p) {
    if (!rx || !ry) return [[p0, p, p]];
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const phi = (phiDeg * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (p0.x - p.x) / 2;
    const dy = (p0.y - p.y) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let k = Math.sqrt(Math.max(0, num / den));
    if (large === sweep) k = -k;
    const cx1 = (k * rx * y1) / ry;
    const cy1 = (-k * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (p0.x + p.x) / 2;
    const cy = sin * cx1 + cos * cy1 + (p0.y + p.y) / 2;
    const ang = (ux, uy, vx, vy) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
    const step = dt / n;
    const h = (4 / 3) * Math.tan(step / 4);
    const pt = (t) => {
      const x = rx * Math.cos(t);
      const y = ry * Math.sin(t);
      return { x: cos * x - sin * y + cx, y: sin * x + cos * y + cy };
    };
    const dpt = (t) => {
      const x = -rx * Math.sin(t);
      const y = ry * Math.cos(t);
      return { x: cos * x - sin * y, y: sin * x + cos * y };
    };
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = t1 + i * step;
      const b = a + step;
      const pa = i ? pt(a) : p0;
      const pb = i === n - 1 ? p : pt(b);
      const da = dpt(a);
      const db = dpt(b);
      out.push([
        { x: pa.x + h * da.x, y: pa.y + h * da.y },
        { x: pb.x - h * db.x, y: pb.y - h * db.y },
        pb,
      ]);
    }
    return out;
  }

  function parsePathD(d) {
    const subs = [];
    let i = 0;
    const s = d || '';
    const ws = () => {
      while (i < s.length && /[\s,]/.test(s[i])) i++;
    };
    const num = () => {
      ws();
      const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(s.slice(i));
      if (!m) throw new Error('bad number');
      i += m[0].length;
      return parseFloat(m[0]);
    };
    const flag = () => {
      ws();
      const c = s[i++];
      if (c !== '0' && c !== '1') throw new Error('bad flag');
      return c === '1';
    };
    let cur = { x: 0, y: 0 };
    let start = { x: 0, y: 0 };
    let sub = null;
    let prevCmd = '';
    let prevCtrl = null;
    const ensureSub = () => {
      if (!sub || sub.closed) {
        sub = { nodes: [{ x: cur.x, y: cur.y, hin: null, hout: null }], closed: false };
        subs.push(sub);
        start = { ...cur };
      }
    };
    const lineTo = (p) => {
      ensureSub();
      sub.nodes.push({ x: p.x, y: p.y, hin: null, hout: null });
      cur = p;
    };
    const curveTo = (c1, c2, p) => {
      ensureSub();
      sub.nodes.at(-1).hout = c1;
      sub.nodes.push({ x: p.x, y: p.y, hin: c2, hout: null });
      cur = p;
    };
    let cmd = '';
    try {
      for (;;) {
        ws();
        if (i >= s.length) break;
        if (/[a-zA-Z]/.test(s[i])) cmd = s[i++];
        else if (!cmd) break;
        else if (cmd === 'M') cmd = 'L';
        else if (cmd === 'm') cmd = 'l';
        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        const P = (x, y) => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
        let ctrl = null;
        if (C === 'M') {
          cur = P(num(), num());
          sub = { nodes: [{ x: cur.x, y: cur.y, hin: null, hout: null }], closed: false };
          subs.push(sub);
          start = { ...cur };
        } else if (C === 'L') lineTo(P(num(), num()));
        else if (C === 'H') lineTo({ x: (rel ? cur.x : 0) + num(), y: cur.y });
        else if (C === 'V') lineTo({ x: cur.x, y: (rel ? cur.y : 0) + num() });
        else if (C === 'C') {
          const c1 = P(num(), num());
          const c2 = P(num(), num());
          const p = P(num(), num());
          curveTo(c1, c2, p);
          ctrl = c2;
        } else if (C === 'S') {
          const c1 =
            'CS'.includes(prevCmd) && prevCtrl
              ? { x: 2 * cur.x - prevCtrl.x, y: 2 * cur.y - prevCtrl.y }
              : { ...cur };
          const c2 = P(num(), num());
          const p = P(num(), num());
          curveTo(c1, c2, p);
          ctrl = c2;
        } else if (C === 'Q' || C === 'T') {
          const q =
            C === 'Q'
              ? P(num(), num())
              : 'QT'.includes(prevCmd) && prevCtrl
                ? { x: 2 * cur.x - prevCtrl.x, y: 2 * cur.y - prevCtrl.y }
                : { ...cur };
          const p = P(num(), num());
          const p0 = cur;
          curveTo(
            { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
            { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
            p,
          );
          ctrl = q;
        } else if (C === 'A') {
          const rx = num();
          const ry = num();
          const rot = num();
          const large = flag();
          const sweep = flag();
          const p = P(num(), num());
          for (const [c1, c2, q] of arcToCubics(cur, rx, ry, rot, large, sweep, p)) {
            if (c1 === q) lineTo(q);
            else curveTo(c1, c2, q);
          }
        } else if (C === 'Z') {
          if (sub && !sub.closed) {
            const n = sub.nodes;
            const first = n[0];
            const last = n.at(-1);
            if (
              n.length > 1 &&
              Math.abs(last.x - first.x) < 1e-9 &&
              Math.abs(last.y - first.y) < 1e-9
            ) {
              first.hin = last.hin;
              n.pop();
            }
            sub.closed = true;
          }
          cur = { ...start };
        } else throw new Error('bad command');
        prevCmd = C;
        prevCtrl = ctrl;
      }
    } catch {
      /* keep everything parsed up to the error, as browsers do */
    }
    return subs.filter((sp) => sp.nodes.length);
  }

  function nodesD(subs) {
    let d = '';
    const P = (p) => `${fp(p.x)} ${fp(p.y)}`;
    const seg = (a, b) =>
      a.hout || b.hin ? `C${P(a.hout || a)} ${P(b.hin || b)} ${P(b)}` : `L${P(b)}`;
    for (const sp of subs) {
      const n = sp.nodes;
      if (!n.length) continue;
      d += `M${P(n[0])}`;
      for (let i = 1; i < n.length; i++) d += seg(n[i - 1], n[i]);
      if (sp.closed)
        d += (n.length > 1 && (n.at(-1).hout || n[0].hin) ? seg(n.at(-1), n[0]) : '') + 'Z';
    }
    return d;
  }

  // Basic shapes → the same node model.
  function shapeNodes(el) {
    const N = (x, y, hin = null, hout = null) => ({ x, y, hin, hout });
    const v = (name) => el[name]?.baseVal?.value ?? 0;
    switch (el.localName) {
      case 'path':
        return parsePathD(el.getAttribute('d'));
      case 'line':
        return [{ nodes: [N(v('x1'), v('y1')), N(v('x2'), v('y2'))], closed: false }];
      case 'polyline':
      case 'polygon': {
        const pts = [...el.points].map((p) => N(p.x, p.y));
        return pts.length ? [{ nodes: pts, closed: el.localName === 'polygon' }] : [];
      }
      case 'rect': {
        const x = v('x');
        const y = v('y');
        const w = v('width');
        const h = v('height');
        let rx = el.hasAttribute('rx') ? v('rx') : null;
        let ry = el.hasAttribute('ry') ? v('ry') : null;
        if (rx == null) rx = ry ?? 0;
        if (ry == null) ry = rx;
        rx = Math.min(rx, w / 2);
        ry = Math.min(ry, h / 2);
        if (!rx || !ry)
          return [{ nodes: [N(x, y), N(x + w, y), N(x + w, y + h), N(x, y + h)], closed: true }];
        const kx = rx * KAPPA;
        const ky = ry * KAPPA;
        const r = x + w;
        const b = y + h;
        return [
          {
            closed: true,
            nodes: [
              N(x + rx, y, { x: x + rx - kx, y }, null),
              N(r - rx, y, null, { x: r - rx + kx, y }),
              N(r, y + ry, { x: r, y: y + ry - ky }, null),
              N(r, b - ry, null, { x: r, y: b - ry + ky }),
              N(r - rx, b, { x: r - rx + kx, y: b }, null),
              N(x + rx, b, null, { x: x + rx - kx, y: b }),
              N(x, b - ry, { x, y: b - ry + ky }, null),
              N(x, y + ry, null, { x, y: y + ry - ky }),
            ],
          },
        ];
      }
      case 'circle':
      case 'ellipse': {
        const cx = v('cx');
        const cy = v('cy');
        const rx = el.localName === 'circle' ? v('r') : v('rx');
        const ry = el.localName === 'circle' ? v('r') : v('ry');
        const kx = rx * KAPPA;
        const ky = ry * KAPPA;
        return [
          {
            closed: true,
            nodes: [
              N(cx + rx, cy, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
              N(cx, cy + ry, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
              N(cx - rx, cy, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
              N(cx, cy - ry, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }),
            ],
          },
        ];
      }
    }
    return [];
  }

  const SHAPE_GEOMETRY = [
    'x',
    'y',
    'width',
    'height',
    'rx',
    'ry',
    'cx',
    'cy',
    'r',
    'x1',
    'y1',
    'x2',
    'y2',
    'points',
  ];

  // Swap a basic shape for an equivalent <path>, keeping style + transform.
  function toPath(el) {
    if (el.localName === 'path') return el;
    const p = mk('path');
    for (const a of el.attributes)
      if (!SHAPE_GEOMETRY.includes(a.name)) p.setAttribute(a.name, a.value);
    // A line / polyline has no default fill; a path does.
    if (['line', 'polyline'].includes(el.localName) && !p.hasAttribute('fill'))
      p.setAttribute('fill', 'none');
    el.replaceWith(p);
    return p;
  }

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  function bezierPt(a, b, t) {
    const p1 = a.hout || a;
    const p2 = b.hin || b;
    const q0 = lerp(a, p1, t);
    const q1 = lerp(p1, p2, t);
    const q2 = lerp(p2, b, t);
    return lerp(lerp(q0, q1, t), lerp(q1, q2, t), t);
  }

  function segments(subs) {
    const out = [];
    subs.forEach((sp, si) => {
      const n = sp.nodes;
      for (let i = 0; i < n.length - 1; i++) out.push({ si, i, j: i + 1 });
      if (sp.closed && n.length > 1) out.push({ si, i: n.length - 1, j: 0 });
    });
    return out;
  }

  function isSmooth(nd) {
    if (!nd.hin || !nd.hout) return false;
    const a = Math.atan2(nd.hin.y - nd.y, nd.hin.x - nd.x);
    const b = Math.atan2(nd.hout.y - nd.y, nd.hout.x - nd.x);
    // Smooth = the two handles point in opposite directions.
    const diff = (((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return Math.abs(diff - Math.PI) < 0.05;
  }

  const clone = (subs) =>
    subs.map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n) => ({
        ...n,
        hin: n.hin && { ...n.hin },
        hout: n.hout && { ...n.hout },
      })),
    }));

  tools.node = {
    hint: 'Click a shape to edit its points · Drag points or handles (Alt breaks a smooth point) · Double-click a line to add a point, a point to toggle corner / smooth · Del removes points · Esc ends',
    cursor: 'default',
    el: null,
    subs: [],
    picked: [],
    target(el) {
      if (el && !EDITABLE.has(el.localName)) {
        say(
          el.localName === 'g'
            ? 'Click one of the shapes inside the group to edit its points.'
            : `A ${el.localName} has no points to edit.`,
        );
        el = null;
      }
      this.el = el;
      this.path = el ? treePath(el) : null;
      this.subs = el ? shapeNodes(el) : [];
      this.picked = [];
      state.sel = el ? [el] : [];
      if (el) readStyle(el);
      renderLayers();
      this.redraw();
    },
    // Re-find the target after undo / redo replaced the DOM.
    restored() {
      const el = this.path && fromTreePath(this.path);
      if (!el || !EDITABLE.has(el.localName)) return this.target(null);
      const picked = this.picked;
      this.el = el;
      this.subs = shapeNodes(el);
      this.picked = picked.filter(([si, ni]) => this.subs[si]?.nodes[ni]);
      state.sel = [el];
      this.redraw();
    },
    M() {
      return fullM(this.el);
    },
    toLocal(p) {
      const q = this.M().inverse().transformPoint(new DOMPoint(p.x, p.y));
      return { x: q.x, y: q.y };
    },
    toDoc(p) {
      const q = this.M().transformPoint(new DOMPoint(p.x, p.y));
      return { x: q.x, y: q.y };
    },
    isPicked(si, ni) {
      return this.picked.some(([a, b]) => a === si && b === ni);
    },
    write() {
      if (this.el.localName !== 'path') {
        this.el = toPath(this.el);
        state.sel = [this.el];
      }
      this.el.setAttribute('d', nodesD(this.subs));
      this.redraw();
    },
    redraw() {
      const layer = $('#sc-nodes');
      layer.replaceChildren();
      if (state.tool !== 'node' || !this.el) return;
      if (!this.el.isConnected) return this.target(null);
      const z = state.zoom;
      const m = this.M();
      const T = (p) => {
        const q = m.transformPoint(new DOMPoint(p.x, p.y));
        return { x: q.x, y: q.y };
      };
      const docSubs = this.subs.map((sp) => ({
        closed: sp.closed,
        nodes: sp.nodes.map((n) => ({
          ...T(n),
          hin: n.hin && T(n.hin),
          hout: n.hout && T(n.hout),
        })),
      }));
      mk('path', { d: nodesD(docSubs), class: 'sc-ov' }, layer);
      const s = 10 / z;
      docSubs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          if (!this.isPicked(si, ni)) return;
          for (const which of ['hin', 'hout']) {
            const h = n[which];
            if (!h) continue;
            mk('line', { x1: n.x, y1: n.y, x2: h.x, y2: h.y, class: 'sc-ov' }, layer);
            mk(
              'circle',
              { cx: h.x, cy: h.y, r: 4 / z, class: 'sc-hnd', 'data-hnd': `${si}:${ni}:${which}` },
              layer,
            );
          }
        }),
      );
      docSubs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          const on = this.isPicked(si, ni);
          const attrs = { class: 'sc-node' + (on ? ' on' : ''), 'data-node': `${si}:${ni}` };
          if (isSmooth(this.subs[si].nodes[ni]))
            mk('circle', { cx: n.x, cy: n.y, r: s / 1.7, ...attrs }, layer);
          else mk('rect', { x: n.x - s / 2, y: n.y - s / 2, width: s, height: s, ...attrs }, layer);
        }),
      );
      const n = this.picked.length;
      $('#sc-pos').dataset.sel =
        `${n} of ${docSubs.reduce((a, sp) => a + sp.nodes.length, 0)} points selected`;
    },
    down(e, p) {
      const hnd = e.target.closest?.('[data-hnd]');
      const node = e.target.closest?.('[data-node]');
      if (hnd) {
        const [si, ni, which] = hnd.dataset.hnd.split(':');
        const nd = this.subs[+si].nodes[+ni];
        this.g = { mode: 'handle', nd, which, smooth: isSmooth(nd) };
        return;
      }
      if (node) {
        const [si, ni] = node.dataset.node.split(':').map(Number);
        if (e.shiftKey) {
          this.picked = this.isPicked(si, ni)
            ? this.picked.filter(([a, b]) => a !== si || b !== ni)
            : [...this.picked, [si, ni]];
          this.redraw();
          this.g = null;
          return;
        }
        if (!this.isPicked(si, ni)) this.picked = [[si, ni]];
        this.g = {
          mode: 'move',
          p0: p,
          orig: clone(this.subs),
          lead: this.toDoc(this.subs[si].nodes[ni]),
        };
        this.redraw();
        return;
      }
      const el = editableFrom(e.target) || topLevel(e.target);
      if (el && el !== this.el) {
        this.target(el);
        this.targetedAt = e.timeStamp;
        this.g = null;
        return;
      }
      if (!el && !this.el) return;
      this.g = { mode: 'marquee', p0: p, base: e.shiftKey ? [...this.picked] : [] };
      if (!e.shiftKey) {
        this.picked = [];
        this.redraw();
      }
    },
    move(e, p) {
      const g = this.g;
      if (!g || !this.el) return;
      if (g.mode === 'marquee') {
        const x = Math.min(g.p0.x, p.x);
        const y = Math.min(g.p0.y, p.y);
        const w = Math.abs(p.x - g.p0.x);
        const h = Math.abs(p.y - g.p0.y);
        guides.replaceChildren();
        mk('rect', { x, y, width: w, height: h, class: 'sc-ov sc-ov-fill sc-ov-dash' }, guides);
        const hit = [];
        this.subs.forEach((sp, si) =>
          sp.nodes.forEach((n, ni) => {
            const q = this.toDoc(n);
            if (q.x >= x && q.x <= x + w && q.y >= y && q.y <= y + h) hit.push([si, ni]);
          }),
        );
        const key = ([a, b]) => `${a}:${b}`;
        const seen = new Set(g.base.map(key));
        this.picked = [...g.base, ...hit.filter((k) => !seen.has(key(k)))];
        this.redraw();
        return;
      }
      if (g.mode === 'handle') {
        const nd = g.nd;
        const h = this.toLocal(p);
        nd[g.which] = h;
        const other = g.which === 'hin' ? 'hout' : 'hin';
        if (g.smooth && !e.altKey && nd[other]) {
          const len = Math.hypot(nd[other].x - nd.x, nd[other].y - nd.y);
          const dx = h.x - nd.x;
          const dy = h.y - nd.y;
          const d = Math.hypot(dx, dy) || 1;
          nd[other] = { x: nd.x - (dx / d) * len, y: nd.y - (dy / d) * len };
        }
        g.changed = true;
        this.write();
        return;
      }
      // Move picked points; Shift locks to an axis, Snap puts the grabbed point on the grid.
      let dx = p.x - g.p0.x;
      let dy = p.y - g.p0.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (state.snap) {
        const s = snapPt({ x: g.lead.x + dx, y: g.lead.y + dy });
        dx = s.x - g.lead.x;
        dy = s.y - g.lead.y;
      }
      this.shift(g.orig, dx, dy);
      g.changed = true;
      this.write();
    },
    // Offset picked points (and their handles) by a doc-space vector.
    shift(from, dx, dy) {
      const inv = this.M().inverse();
      const o = inv.transformPoint(new DOMPoint(0, 0));
      const v = inv.transformPoint(new DOMPoint(dx, dy));
      const lx = v.x - o.x;
      const ly = v.y - o.y;
      const add = (q) => q && { x: q.x + lx, y: q.y + ly };
      for (const [si, ni] of this.picked) {
        const src = from[si].nodes[ni];
        const dst = this.subs[si].nodes[ni];
        dst.x = src.x + lx;
        dst.y = src.y + ly;
        dst.hin = add(src.hin);
        dst.hout = add(src.hout);
      }
    },
    up() {
      const g = this.g;
      this.g = null;
      guides.replaceChildren();
      if (g?.changed) commit();
    },
    dblclick(e) {
      if (!this.el) return;
      const node = e.target.closest?.('[data-node]');
      if (node) {
        const [si, ni] = node.dataset.node.split(':').map(Number);
        this.picked = [[si, ni]];
        const nd = this.subs[si].nodes[ni];
        this.setKind(nd.hin || nd.hout ? 'corner' : 'smooth');
        return;
      }
      // The first click of this double-click picked the shape; don't also add a point.
      if (editableFrom(e.target) !== this.el || e.timeStamp - (this.targetedAt ?? -1e9) < 500)
        return;
      this.insertAt(this.toLocal(toDoc(e)));
    },
    // Split the segment nearest q (local coords) with a new point.
    insertAt(q) {
      let best = null;
      for (const s of segments(this.subs)) {
        const a = this.subs[s.si].nodes[s.i];
        const b = this.subs[s.si].nodes[s.j];
        for (let k = 1; k < 64; k++) {
          const t = k / 64;
          const d = dist(bezierPt(a, b, t), q);
          if (!best || d < best.d) best = { ...s, t, d };
        }
      }
      if (!best) return;
      const sp = this.subs[best.si];
      const a = sp.nodes[best.i];
      const b = sp.nodes[best.j];
      const t = best.t;
      let nd;
      if (!a.hout && !b.hin) nd = { ...lerp(a, b, t), hin: null, hout: null };
      else {
        const p1 = a.hout || a;
        const p2 = b.hin || b;
        const q0 = lerp(a, p1, t);
        const q1 = lerp(p1, p2, t);
        const q2 = lerp(p2, b, t);
        const r0 = lerp(q0, q1, t);
        const r1 = lerp(q1, q2, t);
        nd = { ...lerp(r0, r1, t), hin: r0, hout: r1 };
        a.hout = q0;
        b.hin = q2;
      }
      const at = best.j === 0 ? sp.nodes.length : best.j;
      sp.nodes.splice(at, 0, nd);
      this.picked = [[best.si, at]];
      this.write();
      commit();
    },
    // 'corner' retracts handles; 'smooth' grows tangent handles from the neighbours.
    setKind(kind) {
      if (!this.el || !this.picked.length) return say('Select a point first.');
      for (const [si, ni] of this.picked) {
        const sp = this.subs[si];
        const n = sp.nodes;
        const nd = n[ni];
        if (kind === 'corner') {
          nd.hin = nd.hout = null;
          continue;
        }
        const prev = n[ni - 1] || (sp.closed ? n.at(-1) : null);
        const next = n[ni + 1] || (sp.closed ? n[0] : null);
        const ax = (next || nd).x - (prev || nd).x;
        const ay = (next || nd).y - (prev || nd).y;
        const al = Math.hypot(ax, ay);
        if (!al) continue;
        const ux = ax / al;
        const uy = ay / al;
        nd.hin = prev
          ? { x: nd.x - ux * (dist(nd, prev) / 3), y: nd.y - uy * (dist(nd, prev) / 3) }
          : null;
        nd.hout = next
          ? { x: nd.x + ux * (dist(nd, next) / 3), y: nd.y + uy * (dist(nd, next) / 3) }
          : null;
      }
      this.write();
      commit();
    },
    removePicked() {
      if (!this.el || !this.picked.length) return;
      const kill = new Set(this.picked.map(([a, b]) => `${a}:${b}`));
      this.subs = this.subs
        .map((sp, si) => ({ ...sp, nodes: sp.nodes.filter((_, ni) => !kill.has(`${si}:${ni}`)) }))
        .filter((sp) => sp.nodes.length >= 2);
      this.picked = [];
      if (!this.subs.length) {
        this.el.remove();
        this.target(null);
      } else this.write();
      commit();
    },
    toggleClosed() {
      if (!this.el) return;
      const sis = new Set(this.picked.length ? this.picked.map(([si]) => si) : [0]);
      for (const si of sis) if (this.subs[si]) this.subs[si].closed = !this.subs[si].closed;
      this.write();
      commit();
    },
    key(e) {
      if (!this.el) return false;
      const k = e.key;
      const arrows = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (k === 'Delete' || k === 'Backspace') this.removePicked();
      else if (k === 'Escape' || k === 'Enter') {
        const el = this.el;
        setTool('select');
        setSel([el]);
      } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') {
        this.picked = this.subs.flatMap((sp, si) => sp.nodes.map((_, ni) => [si, ni]));
        this.redraw();
      } else if (arrows[k] && this.picked.length && !e.ctrlKey && !e.metaKey) {
        const s = e.shiftKey ? 10 : 1;
        this.shift(clone(this.subs), arrows[k][0] * s, arrows[k][1] * s);
        this.write();
        commit();
      } else return false;
      return true;
    },
    enter(prev) {
      const el = prev.length === 1 && EDITABLE.has(prev[0].localName) ? prev[0] : null;
      this.target(el);
    },
    leave() {
      this.g = null;
      this.el = null;
      this.subs = [];
      this.picked = [];
      $('#sc-nodes').replaceChildren();
    },
    cancel() {
      this.g = null;
      guides.replaceChildren();
    },
  };

  // ---------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------
  function transformSel(Tfn) {
    const box = selBox();
    if (!box) return;
    const T = Tfn(box);
    for (const el of state.sel) transformDoc(el, T);
    noteTransform(T, box);
    commit();
  }

  // ---- Transform Again --------------------------------------------------
  // The last transform is kept relative to the centre of what it was applied
  // to, so repeating it rotates / scales about the new selection's centre
  // (and Again with Copy builds Photoshop-style step-and-repeat patterns).
  let lastT = null;
  function noteTransform(T, box) {
    if (!T || !box) return;
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    lastT = new DOMMatrix()
      .translate(-c.x, -c.y)
      .multiply(T)
      .multiply(new DOMMatrix().translate(c.x, c.y));
  }
  function transformAgain(copy) {
    if (!lastT) return say('Nothing to repeat yet — transform something first.');
    if (!state.sel.length) return say('Select something to transform.');
    if (copy) {
      state.sel = inDocOrder(state.sel).map((el) => {
        const c = el.cloneNode(true);
        for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id');
        el.after(c);
        return c;
      });
    }
    const box = selBox();
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const T = new DOMMatrix()
      .translate(c.x, c.y)
      .multiply(lastT)
      .multiply(new DOMMatrix().translate(-c.x, -c.y));
    for (const el of state.sel) transformDoc(el, T);
    commit();
  }

  // ---- Free Transform session (Photoshop's Ctrl+T) ------------------------
  // Handles act per mode (free / scale / rotate / skew), the options bar
  // shows X Y W H, angle and skew; Enter commits, Esc rolls the whole
  // session back.
  function beginTransform(mode) {
    if (!state.sel.length) return say('Select something to transform first.');
    if (state.tool !== 'select') setTool('select');
    if (state.tf) {
      state.tf.mode = mode;
    } else {
      const box = selBox();
      state.tf = {
        mode,
        entry: hIdx,
        paths: state.sel.map(treePath),
        angle: 0,
        skx: 0,
        sky: 0,
        el0: state.sel[0],
        m0: fullM(state.sel[0]),
        box0: box,
      };
    }
    updateOptions();
    drawSelection();
    $('#sc-hint').textContent = {
      free: 'Free Transform: drag corners to scale, the top knob to rotate · Enter commits, Esc cancels',
      scale:
        'Scale: drag any handle (Shift keeps proportions, Alt from centre) · Enter commits, Esc cancels',
      rotate:
        'Rotate: drag any handle around the centre (Shift snaps to 15°) · Enter commits, Esc cancels',
      skew: 'Skew: drag an edge handle along its edge (Shift snaps to 15°) · Enter commits, Esc cancels',
    }[mode];
  }
  function endTransform(keep) {
    const tf = state.tf;
    if (!tf) return;
    state.tf = null;
    if (keep) {
      // Transform Again repeats the whole session as one step.
      if (tf.el0.isConnected && hIdx > tf.entry)
        noteTransform(fullM(tf.el0).multiply(tf.m0.inverse()), tf.box0);
    } else if (hIdx > tf.entry) {
      hist.length = tf.entry + 1;
      hIdx = tf.entry;
      restore(hist[hIdx]);
      state.sel = tf.paths.map(fromTreePath).filter(Boolean);
    }
    updateOptions();
    $('#sc-hint').textContent = tools[state.tool].hint;
    drawSelection();
    renderLayers();
  }

  // Keep the session's number fields in step with the selection.
  function syncTransformFields(box) {
    if (!state.tf) return;
    const vals = {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      angle: state.tf.angle,
      skx: state.tf.skx,
      sky: state.tf.sky,
    };
    for (const el of document.querySelectorAll('[data-tf]'))
      if (document.activeElement !== el) el.value = f(vals[el.dataset.tf]);
  }

  // A number field changed: turn the new value into a transform of the selection.
  function applyTransformField(key, v, final) {
    const box = selBox();
    if (!box || !isFinite(v)) return;
    const tf = state.tf;
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const about = (x, y, m) =>
      new DOMMatrix().translate(x, y).multiply(m).multiply(new DOMMatrix().translate(-x, -y));
    const linked = $('#sc-tf-link').getAttribute('aria-pressed') === 'true';
    let T;
    if (key === 'x') T = new DOMMatrix().translate(v - box.x, 0);
    else if (key === 'y') T = new DOMMatrix().translate(0, v - box.y);
    else if (key === 'w' || key === 'h') {
      if (v <= 0 || !box.w || !box.h) return;
      const s = key === 'w' ? v / box.w : v / box.h;
      const sx = key === 'w' || linked ? s : 1;
      const sy = key === 'h' || linked ? s : 1;
      T = about(box.x, box.y, new DOMMatrix().scale(sx, sy));
    } else if (key === 'angle') {
      T = about(c.x, c.y, new DOMMatrix().rotate(v - tf.angle));
      tf.angle = v;
    } else {
      const d = clamp(v, -89, 89) - tf[key];
      T = about(c.x, c.y, key === 'skx' ? new DOMMatrix().skewX(d) : new DOMMatrix().skewY(d));
      tf[key] = clamp(v, -89, 89);
    }
    for (const el of state.sel) transformDoc(el, T);
    noteTransform(T, box);
    if (final) commit();
    else drawSelection();
  }

  function rotateSel(deg) {
    transformSel((b) => {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      return new DOMMatrix().translate(cx, cy).rotate(deg).translate(-cx, -cy);
    });
    if (state.tf) state.tf.angle += deg;
  }

  function nextGroupName() {
    let n = 0;
    for (const g of doc.querySelectorAll('g[data-name]')) {
      const m = /^Group (\d+)$/.exec(g.getAttribute('data-name'));
      if (m) n = Math.max(n, +m[1]);
    }
    return `Group ${n + 1}`;
  }

  const cmds = {
    delete() {
      if (!state.sel.length) return;
      state.sel.forEach((el) => el.remove());
      state.sel = [];
      commit();
    },
    duplicate() {
      if (!state.sel.length) return;
      const clones = inDocOrder(state.sel).map((el) => {
        const c = el.cloneNode(true);
        for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id');
        el.after(c);
        transformDoc(c, new DOMMatrix().translate(10, 10));
        return c;
      });
      state.sel = clones;
      commit();
      readStyle(clones[0]);
    },
    selectAll() {
      setSel(items().filter((el) => el.getAttribute('display') !== 'none'));
    },
    front() {
      inDocOrder(state.sel).forEach((el) => el.parentNode.append(el));
      commit();
    },
    back() {
      inDocOrder(state.sel)
        .reverse()
        .forEach((el) => el.parentNode.prepend(el));
      commit();
    },
    forward() {
      for (const el of inDocOrder(state.sel).reverse()) {
        let n = el.nextElementSibling;
        while (n && !selectable(n)) n = n.nextElementSibling;
        if (n && !state.sel.includes(n)) n.after(el);
      }
      commit();
    },
    backward() {
      for (const el of inDocOrder(state.sel)) {
        let n = el.previousElementSibling;
        while (n && !selectable(n)) n = n.previousElementSibling;
        if (n && !state.sel.includes(n)) n.before(el);
      }
      commit();
    },
    // Wrap the selected layers in a new group where the frontmost one was
    // (Photoshop's Ctrl+G); with nothing selected, add an empty group on top.
    group() {
      const els = normalizeSel(state.sel);
      const g = mk('g', { 'data-name': nextGroupName() });
      if (!els.length) doc.append(g);
      else {
        els.at(-1).after(g);
        for (const el of els) reparent(el, g);
      }
      state.sel = [g];
      commit();
    },
    ungroup() {
      const out = [];
      let blocked = 0;
      for (const g of inDocOrder(state.sel)) {
        if (g.localName !== 'g') {
          out.push(g);
          continue;
        }
        if (['clip-path', 'mask', 'filter'].some((a) => g.hasAttribute(a) || g.style?.[a])) {
          blocked++;
          out.push(g);
          continue;
        }
        const Mg = getM(g);
        const gOpacity = parseFloat(g.getAttribute('opacity') ?? 1);
        const inherit = [...g.attributes].filter(
          (a) => !['transform', 'opacity', 'id', 'class', 'style'].includes(a.name),
        );
        for (const c of [...g.childNodes]) {
          if (c.nodeType !== 1) continue;
          if (!NON_GRAPHIC.has(c.localName)) {
            setM(c, Mg.multiply(getM(c)));
            for (const a of inherit) if (!c.hasAttribute(a.name)) c.setAttribute(a.name, a.value);
            if (gOpacity < 1)
              c.setAttribute('opacity', f(gOpacity * parseFloat(c.getAttribute('opacity') ?? 1)));
            out.push(c);
          }
          g.before(c);
        }
        g.remove();
      }
      if (blocked) say(`${blocked} group(s) carry a clip / mask / filter and were left grouped.`);
      state.sel = out;
      commit();
    },
    flipH() {
      transformSel((b) =>
        new DOMMatrix()
          .translate(b.x + b.w / 2, 0)
          .scale(-1, 1)
          .translate(-(b.x + b.w / 2), 0),
      );
    },
    flipV() {
      transformSel((b) =>
        new DOMMatrix()
          .translate(0, b.y + b.h / 2)
          .scale(1, -1)
          .translate(0, -(b.y + b.h / 2)),
      );
    },
    alignLeft: () => alignSel('left'),
    alignHCenter: () => alignSel('hcenter'),
    alignRight: () => alignSel('right'),
    alignTop: () => alignSel('top'),
    alignVCenter: () => alignSel('vcenter'),
    alignBottom: () => alignSel('bottom'),
    distributeH: () => distributeSel('x'),
    distributeV: () => distributeSel('y'),
  };

  // Line the selection up on an edge or centre of its own bounding box, or
  // of the artboard when only one object is selected (Photoshop's rule).
  function alignSel(how) {
    if (!state.sel.length) return say('Select the objects to align first.');
    const ref = state.sel.length === 1 ? { x: 0, y: 0, w: state.w, h: state.h } : selBox();
    if (!ref) return;
    for (const el of state.sel) {
      const b = bboxDoc(el);
      if (!b) continue;
      const dx = {
        left: ref.x - b.x,
        hcenter: ref.x + ref.w / 2 - (b.x + b.w / 2),
        right: ref.x + ref.w - (b.x + b.w),
      }[how];
      const dy = {
        top: ref.y - b.y,
        vcenter: ref.y + ref.h / 2 - (b.y + b.h / 2),
        bottom: ref.y + ref.h - (b.y + b.h),
      }[how];
      transformDoc(el, new DOMMatrix().translate(dx || 0, dy || 0));
    }
    commit();
  }

  // Equal gaps between neighbours along one axis; the outermost two stay put.
  function distributeSel(axis) {
    const list = state.sel.map((el) => ({ el, b: bboxDoc(el) })).filter((i) => i.b);
    if (list.length < 3) return say('Select three or more objects to distribute.');
    const size = axis === 'x' ? 'w' : 'h';
    list.sort((a, b) => a.b[axis] + a.b[size] / 2 - (b.b[axis] + b.b[size] / 2));
    const first = list[0].b;
    const end = Math.max(...list.map((i) => i.b[axis] + i.b[size]));
    const gap = (end - first[axis] - list.reduce((n, i) => n + i.b[size], 0)) / (list.length - 1);
    let at = first[axis];
    for (const { el, b } of list) {
      const d = at - b[axis];
      const T = axis === 'x' ? new DOMMatrix().translate(d, 0) : new DOMMatrix().translate(0, d);
      transformDoc(el, T);
      at += b[size] + gap;
    }
    commit();
  }

  function nudge(dx, dy) {
    if (!state.sel.length) return;
    const T = new DOMMatrix().translate(dx, dy);
    for (const el of state.sel) transformDoc(el, T);
    commit();
  }

  // ---------------------------------------------------------------------
  // Import (open / place / paste) — sanitised
  // ---------------------------------------------------------------------
  function sanitize(root) {
    root
      .querySelectorAll('script, foreignObject, iframe, object, embed')
      .forEach((n) => n.remove());
    for (const n of root.querySelectorAll('animate, set'))
      if (/href/i.test(n.getAttribute('attributeName') || '')) n.remove();
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) {
        const v = a.value.trim().toLowerCase();
        if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name);
        else if (
          (a.localName === 'href' || a.name === 'xlink:href') &&
          (v.startsWith('javascript:') || (v.startsWith('data:') && !v.startsWith('data:image/')))
        )
          el.removeAttributeNS(a.namespaceURI, a.localName);
      }
    }
  }

  // Bake <style> rules into inline styles so imported CSS can't leak into
  // the editor's own UI. Specificity is approximated by source order.
  function inlineStyles(root) {
    for (const st of [...root.querySelectorAll('style')]) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(st.textContent);
        const assigned = new Map();
        for (const rule of sheet.cssRules) {
          if (!(rule instanceof CSSStyleRule)) continue;
          let targets;
          try {
            targets = root.querySelectorAll(rule.selectorText);
          } catch {
            continue;
          }
          for (const el of targets) {
            const m = assigned.get(el) || [];
            for (const prop of rule.style) m.push([prop, rule.style.getPropertyValue(prop)]);
            assigned.set(el, m);
          }
        }
        for (const [el, props] of assigned) {
          const own = el.getAttribute('style') || '';
          el.setAttribute(
            'style',
            props.map(([k, v]) => `${k}:${v}`).join(';') + (own ? ';' + own : ''),
          );
        }
      } catch {
        /* unparsable stylesheet — drop it */
      }
      st.remove();
    }
  }

  // Rename incoming ids that already exist in the drawing, and repoint refs.
  function dedupeIds(root, againstDrawing) {
    const map = new Map();
    for (const el of root.querySelectorAll('[id]')) {
      const id = el.id;
      if (!id.startsWith('sc-') && !(againstDrawing && document.getElementById(id))) continue;
      let n = 2;
      while (document.getElementById(`${id}-${n}`)) n++;
      map.set(id, `${id}-${n}`);
      el.id = `${id}-${n}`;
    }
    if (!map.size) return;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) {
        let v = a.value;
        for (const [o, nw] of map) {
          v = v.split(`url(#${o})`).join(`url(#${nw})`).split(`url("#${o}")`).join(`url(#${nw})`);
          if (v === `#${o}`) v = `#${nw}`;
        }
        if (v !== a.value) el.setAttributeNS(a.namespaceURI, a.name, v);
      }
    }
  }

  const INHERITED = [
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'font-family',
    'font-size',
    'font-weight',
  ];

  // Paint set on the root <svg> (icon sets love fill="none"
  // stroke="currentColor") would be lost when the root is unwrapped, so
  // push it down onto each top-level child. currentColor has no meaning
  // outside the source page; pin it to the root's colour (or black).
  function inheritRootPaint(root) {
    const own = Object.fromEntries(
      (root.getAttribute('style') || '')
        .split(';')
        .map((d) => d.split(':').map((x) => x.trim()))
        .filter(([k, v]) => k && v),
    );
    const color = own.color || root.getAttribute('color') || '#000000';
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const k of ['fill', 'stroke'])
        if (/^currentcolor$/i.test(el.getAttribute(k) || '')) el.setAttribute(k, color);
    }
    const paint = {};
    for (const k of INHERITED) {
      const v = own[k] || root.getAttribute(k);
      if (v) paint[k] = /^currentcolor$/i.test(v) ? color : v;
    }
    for (const c of root.children) {
      if (NON_GRAPHIC.has(c.localName)) continue;
      for (const [k, v] of Object.entries(paint)) if (!c.hasAttribute(k)) c.setAttribute(k, v);
    }
  }

  function parseSvg(text, { dedupe = true } = {}) {
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = xml.documentElement;
    if (xml.querySelector('parsererror') || root.localName !== 'svg')
      throw new Error('Not a valid SVG file');
    sanitize(root);
    inlineStyles(root);
    inheritRootPaint(root);
    dedupeIds(root, dedupe);
    const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const num = (v) => (v && !String(v).endsWith('%') ? parseFloat(v) : NaN);
    let [minX, minY, w, h] =
      vb.length === 4 && vb.every(isFinite)
        ? vb
        : [0, 0, num(root.getAttribute('width')), num(root.getAttribute('height'))];
    if (!(w > 0)) w = 800;
    if (!(h > 0)) h = 600;
    const defsOut = [];
    const nodes = [];
    for (const c of [...root.childNodes]) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'defs')
        defsOut.push(...[...c.childNodes].map((n) => document.importNode(n, true)));
      else if (!NON_GRAPHIC.has(c.localName)) nodes.push(document.importNode(c, true));
    }
    return {
      minX,
      minY,
      w,
      h,
      defs: defsOut,
      nodes,
      clip: root.getAttribute('data-svgcraft') === 'clip',
    };
  }

  // Every family named by a text layer or one of its runs.
  const docFamilies = () =>
    [...doc.querySelectorAll('text, tspan[font-family]')].map((el) =>
      el.localName === 'text' ? typeFrom(el).family : fontFromCss(el.getAttribute('font-family')),
    );
  const loadDocFonts = () => docFamilies().forEach(ensureFont);

  function openSvg(text, name) {
    const s = parseSvg(text, { dedupe: false });
    tools[state.tool].leave?.();
    doc.replaceChildren();
    defs.replaceChildren(...s.defs);
    const shift = s.minX || s.minY ? new DOMMatrix().translate(-s.minX, -s.minY) : null;
    for (const n of s.nodes) {
      if (shift) setM(n, shift.multiply(getM(n)));
      doc.append(n);
    }
    setSize(s.w, s.h);
    loadDocFonts();
    if (name) state.fileName = name.replace(/\.svg$/i, '');
    state.sel = [];
    fit();
    commit();
  }

  function placeSvg(text, name = 'Pasted SVG') {
    const s = parseSvg(text);
    defs.append(...s.defs);
    if (s.clip) {
      // Our own clipboard: drop the pieces back where they were, nudged.
      for (const n of s.nodes) {
        setM(n, new DOMMatrix().translate(10, 10).multiply(getM(n)));
        doc.append(n);
      }
      state.sel = s.nodes;
    } else {
      const g = mk('g', { 'data-name': name }, doc);
      g.append(...s.nodes);
      const k = Math.min(1, (state.w * 0.9) / s.w, (state.h * 0.9) / s.h);
      const tx = (state.w - s.w * k) / 2;
      const ty = (state.h - s.h * k) / 2;
      setM(g, new DOMMatrix().translate(tx, ty).scale(k).translate(-s.minX, -s.minY));
      state.sel = [g];
    }
    loadDocFonts();
    setTool('select');
    commit();
  }

  function placeImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, (state.w * 0.9) / img.width, (state.h * 0.9) / img.height);
      const w = img.width * k;
      const h = img.height * k;
      const el = mk(
        'image',
        {
          href: dataUrl,
          x: f((state.w - w) / 2),
          y: f((state.h - h) / 2),
          width: f(w),
          height: f(h),
        },
        doc,
      );
      state.sel = [el];
      setTool('select');
      commit();
    };
    img.src = dataUrl;
  }

  function importFile(file, mode) {
    if (!file) return;
    const r = new FileReader();
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      r.onload = () => placeImage(r.result);
      r.readAsDataURL(file);
      return;
    }
    r.onload = () => {
      try {
        const replace = mode === 'open' || (mode === 'auto' && !items().length);
        if (replace) openSvg(r.result, file.name);
        else placeSvg(r.result, file.name);
        say(`${replace ? 'Opened' : 'Imported'} ${file.name}`);
      } catch (err) {
        say(err.message || 'Could not read that file');
      }
    };
    r.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------
  // Google families used by text in the drawing.
  function usedGoogleFonts() {
    const names = new Set(docFamilies());
    return FONTS.filter((ft) => ft.src === 'google' && names.has(ft.name));
  }

  // @font-face rules with the font files inlined, for PNG export: an SVG
  // drawn as an image may not load anything from the network.
  const embedCache = new Map();
  async function embeddedFontCss(fonts) {
    let out = '';
    for (const ft of fonts) {
      if (!embedCache.has(ft.name)) {
        embedCache.set(
          ft.name,
          (async () => {
            let css = await (await fetch(googleUrl([ft]))).text();
            for (const url of new Set(css.match(/https:[^)'"]+/g) || [])) {
              const buf = await (await fetch(url)).arrayBuffer();
              let bin = '';
              const bytes = new Uint8Array(buf);
              for (let k = 0; k < bytes.length; k += 0x8000)
                bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
              css = css.split(url).join(`data:font/woff2;base64,${btoa(bin)}`);
            }
            return css;
          })().catch(() => {
            embedCache.delete(ft.name);
            return '';
          }),
        );
      }
      out += await embedCache.get(ft.name);
    }
    return out;
  }

  function serialize({ selection = false, fontCss = '' } = {}) {
    const root = document.createElementNS(NS, 'svg');
    let box = { x: 0, y: 0, w: state.w, h: state.h };
    if (selection) {
      box = selBox() || box;
      root.setAttribute('data-svgcraft', 'clip');
    }
    root.setAttribute('width', f(box.w));
    root.setAttribute('height', f(box.h));
    root.setAttribute('viewBox', [box.x, box.y, box.w, box.h].map(f).join(' '));
    const nl = () => document.createTextNode('\n  ');
    if (defs.children.length || fontCss) {
      const d = document.createElementNS(NS, 'defs');
      if (fontCss) {
        const st = document.createElementNS(NS, 'style');
        st.textContent = fontCss;
        d.append(st);
      }
      for (const c of defs.childNodes) d.append(c.cloneNode(true));
      root.append(nl(), d);
    }
    for (const el of selection ? normalizeSel(state.sel) : [...doc.children]) {
      const c = el.cloneNode(true);
      // A nested layer copied on its own keeps where it sits and how it looks.
      if (selection && el.parentNode !== doc) {
        setM(c, fullM(el));
        bakeInherited(el, c);
      }
      root.append(nl(), c);
    }
    root.append(document.createTextNode('\n'));
    let s = new XMLSerializer().serializeToString(root);
    if (s.includes('xlink:') && !s.includes('xmlns:xlink'))
      s = s.replace('<svg ', `<svg xmlns:xlink="${XLINK}" `);
    return s;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // An exported SVG links the Google Fonts it uses, so browsers draw it right.
  const fontImport = () => {
    const g = usedGoogleFonts();
    return g.length ? `@import url('${googleUrl(g)}');` : '';
  };

  function exportSvg() {
    download(
      new Blob([serialize({ fontCss: fontImport() })], { type: 'image/svg+xml' }),
      `${state.fileName}.svg`,
    );
  }

  async function exportPng(scale = 2) {
    const g = usedGoogleFonts();
    if (g.length) say('Embedding fonts…');
    const fontCss = await embeddedFontCss(g);
    if (g.length && !fontCss)
      say('Could not fetch the fonts (offline?) — the PNG uses fallback fonts.');
    const url = URL.createObjectURL(new Blob([serialize({ fontCss })], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(state.w * scale);
      c.height = Math.round(state.h * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      try {
        c.toBlob(
          (b) => (b ? download(b, `${state.fileName}.png`) : say('PNG export failed')),
          'image/png',
        );
      } catch {
        say('PNG export blocked — the drawing references an external image.');
      }
    };
    img.onerror = () => say('PNG export failed');
    img.src = url;
  }

  async function copySvg() {
    const text = serialize({ selection: state.sel.length > 0, fontCss: fontImport() });
    try {
      await navigator.clipboard.writeText(text);
      say(state.sel.length ? 'Copied the selection as SVG' : 'Copied the drawing as SVG');
    } catch {
      say('Clipboard unavailable');
    }
  }

  // ---------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------
  const TOOL_META = {
    select: ['arrow-pointer', 'Move'],
    node: ['bezier-curve', 'Edit Points'],
    pencil: ['pencil', 'Pencil'],
    pen: ['pen-nib', 'Pen'],
    eraser: ['eraser', 'Eraser'],
    rect: ['square', 'Rectangle'],
    ellipse: ['circle', 'Ellipse'],
    line: ['slash', 'Line'],
    text: ['font', 'Type'],
    eyedropper: ['eye-dropper', 'Eyedropper'],
    hand: ['hand', 'Hand'],
  };

  // Options bar: the transform session's fields while one is open,
  // otherwise the groups whose data-for lists the current tool.
  function updateOptions() {
    const key = state.tf ? 'transform' : state.tool;
    for (const o of document.querySelectorAll('.sc-opt'))
      o.classList.toggle('on', o.dataset.for.split(' ').includes(key));
    const [ic, label] = state.tf
      ? {
          free: ['vector-square', 'Free Transform'],
          scale: ['maximize', 'Scale'],
          rotate: ['rotate', 'Rotate'],
          skew: ['italic', 'Skew'],
        }[state.tf.mode]
      : TOOL_META[state.tool];
    const oi = $('#sc-opt-icon');
    oi.dataset.icon = ic;
    oi.innerHTML = icon(ic);
    $('#sc-opt-name').textContent = label;
  }

  function setTool(name) {
    if (!tools[name]) return;
    if (state.tf && name !== 'select') endTransform(true);
    const prev = state.sel;
    const changed = name !== state.tool;
    if (changed) {
      tools[state.tool].leave?.();
      if (!['select', 'hand', 'eyedropper'].includes(name)) state.sel = [];
    }
    state.tool = name;
    for (const b of document.querySelectorAll('[data-tool]'))
      b.setAttribute('aria-pressed', b.dataset.tool === name);
    updateOptions();
    stage.style.cursor = tools[name].cursor;
    $('#sc-hint').textContent = tools[name].hint;
    if (changed) tools[name].enter?.(prev);
    if (changed && name === 'text') $('[data-tab="character"]').click();
    drawSelection();
    renderLayers();
  }

  function syncStyleUI() {
    for (const k of ['fill', 'stroke']) {
      $(`#sc-${k}-on`).checked = state[k + 'On'];
      $(`#sc-${k}-color`).value = state[k];
      $(`#sc-${k}-hex`).value = state[k];
      const a = Math.round(state[k + 'A'] * 100);
      $(`#sc-${k}-a`).value = a;
      $(`#sc-${k}-a-out`).textContent = a + '%';
      const chip = $(`#sc-${k}-chip`);
      chip.classList.toggle('none', !state[k + 'On']);
      chip.style.setProperty(
        '--chip',
        state[k] +
          Math.round(state[k + 'A'] * 255)
            .toString(16)
            .padStart(2, '0'),
      );
      chip.closest('.sc-paint').classList.toggle('active', state.active === k);
    }
    // Toolbar chips (Photoshop's foreground / background squares).
    for (const k of ['fill', 'stroke']) {
      const chip = $(`#sc-tb-${k}`);
      chip.classList.toggle('none', !state[k + 'On']);
      chip.classList.toggle('active', state.active === k);
      chip.style.setProperty('--chip', $(`#sc-${k}-chip`).style.getPropertyValue('--chip'));
    }
    // Every field bound to the same setting (options bar + panels) shows it.
    const show = { strokeWidth: f(state.strokeWidth), opacity: Math.round(state.opacity * 100) };
    for (const el of document.querySelectorAll('[data-bind]'))
      if (document.activeElement !== el) el.value = show[el.dataset.bind];
  }

  // Push a style change to the selection; `final` commits it to history.
  function styleChanged(key, final) {
    syncStyleUI();
    if (typeEdit && key === 'fill') {
      applyToEdit({ fill: state.fillOn ? state.fill : 'none', fillA: state.fillA }, final);
      return;
    }
    const targets = state.tool === 'node' && tools.node.el ? [tools.node.el] : state.sel;
    if (!targets.length) return;
    for (const el of targets) applyStyle(el, key);
    if (final) commit();
    else drawSelection();
  }

  function wireStyle() {
    for (const k of ['fill', 'stroke']) {
      $(`#sc-${k}-on`).addEventListener('change', (e) => {
        state[k + 'On'] = e.target.checked;
        styleChanged(k, true);
      });
      const color = $(`#sc-${k}-color`);
      color.addEventListener('input', () => {
        state[k] = color.value;
        state[k + 'On'] = true;
        styleChanged(k, false);
      });
      color.addEventListener('change', () => styleChanged(k, true));
      const hx = $(`#sc-${k}-hex`);
      hx.addEventListener('change', () => {
        const v = hex(hx.value.trim().startsWith('#') ? hx.value.trim() : '#' + hx.value.trim());
        if (v && /^#[0-9a-f]{6}$/.test(v)) {
          state[k] = v;
          state[k + 'On'] = true;
        }
        styleChanged(k, true);
      });
      const a = $(`#sc-${k}-a`);
      a.addEventListener('input', () => {
        state[k + 'A'] = a.value / 100;
        styleChanged(k, false);
      });
      a.addEventListener('change', () => styleChanged(k, true));
      $(`#sc-${k}-chip`).addEventListener('click', () => {
        state.active = k;
        syncStyleUI();
      });
      $(`#sc-${k}-chip`)
        .closest('.sc-paint')
        .addEventListener('pointerdown', () => {
          state.active = k;
          syncStyleUI();
        });
    }
    for (const el of document.querySelectorAll('[data-bind]')) {
      const key = el.dataset.bind;
      const read = () => {
        const v = parseFloat(el.value);
        if (!isFinite(v)) return false;
        const c = clamp(v, +el.min, +el.max);
        state[key] = key === 'opacity' ? c / 100 : c;
        return true;
      };
      const k = key === 'strokeWidth' ? 'width' : 'opacity';
      el.addEventListener('input', () => read() && styleChanged(k, false));
      el.addEventListener('change', () => {
        read();
        styleChanged(k, true);
        syncStyleUI();
      });
    }
    // Clicking the active toolbar chip opens its colour picker; otherwise it
    // just becomes the active paint.
    for (const k of ['fill', 'stroke']) {
      $(`#sc-tb-${k}`).addEventListener('click', () => {
        if (state.active === k) $(`#sc-${k}-color`).click();
        state.active = k;
        syncStyleUI();
      });
    }

    const pal = $('#sc-palette');
    for (const c of PALETTE) {
      const b = document.createElement('button');
      b.setAttribute('aria-label', c === 'none' ? 'No paint' : c);
      if (c === 'none') b.className = 'none';
      else b.style.background = c;
      b.addEventListener('click', (e) => {
        const k = e.shiftKey ? (state.active === 'fill' ? 'stroke' : 'fill') : state.active;
        if (c === 'none') state[k + 'On'] = false;
        else {
          state[k] = c;
          state[k + 'On'] = true;
        }
        styleChanged(k, true);
      });
      pal.append(b);
    }
  }

  function swapPaint() {
    [state.fill, state.stroke] = [state.stroke, state.fill];
    [state.fillOn, state.strokeOn] = [state.strokeOn, state.fillOn];
    [state.fillA, state.strokeA] = [state.strokeA, state.fillA];
    syncStyleUI();
    if (state.sel.length) {
      for (const el of state.sel) {
        applyStyle(el, 'fill');
        applyStyle(el, 'stroke');
      }
      commit();
    }
  }

  // A tool-option number field (smoothing, eraser size, font size).
  function bindNumber(id, key) {
    const el = $(id);
    const read = () => {
      const v = parseFloat(el.value);
      if (!isFinite(v)) return;
      state[key] = clamp(v, +el.min, +el.max);
      tools[state.tool].redraw?.();
    };
    el.addEventListener('input', read);
    el.addEventListener('change', () => (el.value = state[key]));
    read();
  }

  // Scrubby labels: drag a field's label sideways to change its value
  // (Shift = 10× faster), as in Photoshop's options bar.
  function wireScrubbers() {
    for (const lab of document.querySelectorAll('.sc-scrub')) {
      const input = lab.parentElement.querySelector('input');
      lab.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        lab.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const v0 = parseFloat(input.value) || 0;
        const step = parseFloat(input.step) || 1;
        const move = (ev) => {
          const d = Math.round((ev.clientX - x0) / 3) * step * (ev.shiftKey ? 10 : 1);
          const v = clamp(+(v0 + d).toFixed(3), +input.min, +input.max);
          if (String(v) === input.value) return;
          input.value = v;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const up = () => {
          lab.removeEventListener('pointermove', move);
          lab.removeEventListener('pointerup', up);
          lab.removeEventListener('pointercancel', up);
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        lab.addEventListener('pointermove', move);
        lab.addEventListener('pointerup', up);
        lab.addEventListener('pointercancel', up);
      });
    }
  }

  // Pointer plumbing --------------------------------------------------------
  let gesture = null;
  let pinch = null;
  let spaceDown = false;
  const pointers = new Map();

  function abortGesture() {
    if (gesture?.tool) {
      gesture.tool.cancel?.();
      if (hIdx >= 0) restore(hist[hIdx]);
    }
    gesture = null;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.isPrimary) pointers.clear();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && e.pointerType === 'touch') {
      abortGesture();
      const [a, b] = [...pointers.values()];
      pinch = {
        d: dist(a, b),
        z: state.zoom,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        px: state.panX,
        py: state.panY,
      };
      return;
    }
    if (pointers.size > 1) return;
    stage.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceDown || state.tool === 'hand') {
      e.preventDefault();
      gesture = { pan: true, sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY };
      stage.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const t = tools[state.tool];
    gesture = { tool: t };
    t.down?.(e, toDoc(e));
  });

  stage.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toDoc(e);
    $('#sc-pos').textContent =
      `${$('#sc-pos').dataset.sel || ''}   ${Math.round(p.x)}, ${Math.round(p.y)}`;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const r = stage.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = clamp((pinch.z * dist(a, b)) / pinch.d, 0.02, 64);
      const ox = pinch.mid.x - r.left;
      const oy = pinch.mid.y - r.top;
      const dx = (ox - pinch.px) / pinch.z;
      const dy = (oy - pinch.py) / pinch.z;
      state.zoom = z;
      state.panX = ox - dx * z + (mid.x - pinch.mid.x);
      state.panY = oy - dy * z + (mid.y - pinch.mid.y);
      applyView();
      return;
    }
    if (gesture?.pan) {
      state.panX = gesture.px + e.clientX - gesture.sx;
      state.panY = gesture.py + e.clientY - gesture.sy;
      applyView();
    } else if (gesture?.tool) gesture.tool.move?.(e, p);
    else if (!pointers.size || e.pointerType !== 'touch') tools[state.tool].move?.(e, p);
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (gesture?.pan) stage.style.cursor = spaceDown ? 'grab' : tools[state.tool].cursor;
    else if (gesture?.tool) gesture.tool.up?.(e, toDoc(e));
    gesture = null;
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('pointerleave', () => {
    if (state.tool === 'eraser' && !gesture) guides.replaceChildren();
  });
  // Pointer capture retargets dblclick to the stage itself, so hand the tool
  // the element that is actually under the cursor.
  stage.addEventListener('dblclick', (e) => {
    const target = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    const { clientX, clientY, timeStamp } = e;
    tools[state.tool].dblclick?.({ target, clientX, clientY, timeStamp });
  });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(state.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else {
        state.panX -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        state.panY -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        applyView();
      }
    },
    { passive: false },
  );

  // Keyboard ------------------------------------------------------------
  const TOOL_KEYS = {
    v: 'select',
    a: 'node',
    p: 'pencil',
    b: 'pen',
    e: 'eraser',
    r: 'rect',
    o: 'ellipse',
    l: 'line',
    t: 'text',
    i: 'eyedropper',
    h: 'hand',
  };

  window.addEventListener('keydown', (e) => {
    if (openMenu && e.key === 'Escape') {
      closeMenus();
      return;
    }
    const typing = e.target.matches?.(
      'input:not([type=range]):not([type=checkbox]), textarea, select',
    );
    if (typing || e.target.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === ' ') {
      if (!spaceDown) {
        spaceDown = true;
        if (!gesture) stage.style.cursor = 'grab';
      }
      e.preventDefault();
      return;
    }
    if (state.tf && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      endTransform(e.key === 'Enter');
      return;
    }
    // Browsers keep Ctrl+T / Ctrl+Shift+T for tabs, so Alt stands in.
    if (e.altKey && e.code === 'KeyT') {
      e.preventDefault();
      if (e.shiftKey) transformAgain(mod);
      else if (!mod) beginTransform('free');
      return;
    }
    if (tools[state.tool].key?.(e)) {
      e.preventDefault();
      return;
    }
    if (mod) {
      const map = {
        z: () => (e.shiftKey ? redo() : undo()),
        y: redo,
        s: exportSvg,
        o: () => openPicker('open'),
        d: cmds.duplicate,
        a: cmds.selectAll,
        g: () => (e.shiftKey ? cmds.ungroup() : cmds.group()),
        ']': cmds.front,
        '[': cmds.back,
      };
      if (map[k]) {
        e.preventDefault();
        map[k]();
      }
      return;
    }
    if (e.altKey) return;
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      nudge(arrows[k][0] * s, arrows[k][1] * s);
    } else if (k === 'delete' || k === 'backspace') {
      e.preventDefault();
      cmds.delete();
    } else if (k === 'escape') setSel([]);
    else if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
    else if (k === 'x') swapPaint();
    else if (k === ']') cmds.forward();
    else if (k === '[') cmds.backward();
    else if (k === '+' || k === '=') zoomAt(state.zoom * 1.25);
    else if (k === '-' || k === '_') zoomAt(state.zoom / 1.25);
    else if (k === '0') fit();
    else if (k === '1') zoomAt(1);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      spaceDown = false;
      if (!gesture) stage.style.cursor = tools[state.tool].cursor;
    }
  });

  // Clipboard: copy / cut the selection as SVG, paste SVG markup or images.
  document.addEventListener('copy', (e) => {
    if (e.target.matches?.('input, textarea') || e.target.isContentEditable || !state.sel.length)
      return;
    e.clipboardData.setData('text/plain', serialize({ selection: true }));
    e.preventDefault();
  });
  document.addEventListener('cut', (e) => {
    if (e.target.matches?.('input, textarea') || e.target.isContentEditable || !state.sel.length)
      return;
    e.clipboardData.setData('text/plain', serialize({ selection: true }));
    e.preventDefault();
    cmds.delete();
  });
  document.addEventListener('paste', (e) => {
    if (e.target.matches?.('input, textarea') || e.target.isContentEditable) return;
    const file = [...(e.clipboardData?.files || [])][0];
    if (file) {
      e.preventDefault();
      importFile(file, 'place');
      return;
    }
    const text = e.clipboardData?.getData('text/plain') || '';
    if (/<svg[\s>]/i.test(text)) {
      e.preventDefault();
      try {
        placeSvg(text.slice(text.search(/<svg[\s>]/i)));
      } catch (err) {
        say(err.message);
      }
    }
  });

  // Drag & drop ---------------------------------------------------------
  const drop = $('#sc-drop');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++;
    drop.classList.add('on');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      drop.classList.remove('on');
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    drop.classList.remove('on');
    for (const file of e.dataTransfer?.files || []) importFile(file, 'auto');
  });

  // Files -------------------------------------------------------------
  let pickMode = 'open';
  function openPicker(mode) {
    pickMode = mode;
    $('#sc-file').click();
  }
  $('#sc-file').addEventListener('change', (e) => {
    importFile(e.target.files[0], pickMode);
    e.target.value = '';
  });

  function newDoc() {
    if (!items().length) return;
    tools[state.tool].leave?.();
    doc.replaceChildren();
    defs.replaceChildren();
    state.sel = [];
    state.fileName = 'drawing';
    commit();
    say('New drawing — Ctrl+Z brings the old one back');
  }

  // Grid / snap / theme -----------------------------------------------------
  function setGridOn(on) {
    state.grid = on;
    $('#sc-grid').checked = on;
    $('[data-action="toggleGrid"]').setAttribute('aria-checked', on);
    setGrid();
  }
  function setSnapOn(on) {
    state.snap = on;
    $('#sc-snap').checked = on;
    $('[data-action="toggleSnap"]').setAttribute('aria-checked', on);
  }

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : darkQuery.matches;
  };
  function setTheme(mode) {
    const root = document.documentElement;
    if (mode === 'system') delete root.dataset.theme;
    else root.dataset.theme = mode;
    try {
      if (mode === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* storage blocked — the choice lasts for this visit only */
    }
    syncTheme();
  }
  function syncTheme() {
    const mode = document.documentElement.dataset.theme || 'system';
    for (const b of document.querySelectorAll('[data-theme-opt]'))
      b.setAttribute('aria-checked', b.dataset.themeOpt === mode);
    const btn = $('#sc-theme-btn');
    btn.firstElementChild.innerHTML = icon(isDark() ? 'sun' : 'moon');
    btn.dataset.tip = isDark() ? 'Switch to light' : 'Switch to dark';
  }
  darkQuery.addEventListener('change', syncTheme);

  // Actions: every menu item and button with data-action="name" -------------
  const actions = {
    ...cmds,
    new: newDoc,
    open: () => openPicker('open'),
    place: () => openPicker('place'),
    exportSvg,
    exportPng1: () => exportPng(1),
    exportPng2: () => exportPng(2),
    exportPng4: () => exportPng(4),
    copySvg,
    undo,
    redo,
    deselect: () => setSel([]),
    swapPaint,
    paintNone() {
      state[state.active + 'On'] = false;
      styleChanged(state.active, true);
    },
    zoomIn: () => zoomAt(state.zoom * 1.25),
    zoomOut: () => zoomAt(state.zoom / 1.25),
    fit,
    zoom100: () => zoomAt(1),
    toggleGrid: () => setGridOn(!state.grid),
    toggleSnap: () => setSnapOn(!state.snap),
    themeSystem: () => setTheme('system'),
    themeDark: () => setTheme('dark'),
    themeLight: () => setTheme('light'),
    toggleTheme: () => setTheme(isDark() ? 'light' : 'dark'),
    showCharacter: showCharacterPanel,
    freeTransform: () => beginTransform('free'),
    tfScale: () => beginTransform('scale'),
    tfRotate: () => beginTransform('rotate'),
    tfSkew: () => beginTransform('skew'),
    tfCommit: () => endTransform(true),
    tfCancel: () => endTransform(false),
    rot180: () => rotateSel(180),
    rot90cw: () => rotateSel(90),
    rot90ccw: () => rotateSel(-90),
    again: () => transformAgain(false),
    againCopy: () => transformAgain(true),
    // The browser's own eyedropper (Chromium) reaches anywhere on screen.
    async pickFromScreen() {
      try {
        const { sRGBHex } = await new window.EyeDropper().open();
        const k = state.active;
        state[k] = hex(sRGBHex);
        state[k + 'On'] = true;
        styleChanged(k, true);
      } catch {
        /* cancelled with Esc */
      }
    },
  };
  $('#sc-screen-pick').hidden = !('EyeDropper' in window);
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('[data-action]');
    if (!a || a.disabled) return;
    closeMenus();
    actions[a.dataset.action]?.();
  });

  // Menu bar: click to open, hover to switch while one is open, arrows to move.
  let openMenu = null;
  function closeSubs() {
    for (const sm of document.querySelectorAll('.sc-submenu')) {
      sm.querySelector('.sc-sub-list').hidden = true;
      sm.querySelector('.sc-sub-btn').setAttribute('aria-expanded', 'false');
    }
  }
  function openSub(sm, focusFirst) {
    closeSubs();
    const btn = sm.querySelector('.sc-sub-btn');
    const list = sm.querySelector('.sc-sub-list');
    list.hidden = false;
    const r = btn.getBoundingClientRect();
    const right = r.right + list.offsetWidth + 4 > innerWidth;
    list.style.left = `${Math.max(4, right ? r.left - list.offsetWidth : r.right)}px`;
    list.style.top = `${Math.max(4, Math.min(r.top - 4, innerHeight - list.offsetHeight - 4))}px`;
    btn.setAttribute('aria-expanded', 'true');
    if (focusFirst) list.querySelector('button').focus();
  }
  for (const sm of document.querySelectorAll('.sc-submenu')) {
    const btn = sm.querySelector('.sc-sub-btn');
    btn.addEventListener('pointerenter', () => openSub(sm));
    btn.addEventListener('click', () => openSub(sm, true));
    sm.querySelector('.sc-sub-list').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeSubs();
      btn.focus();
    });
  }
  // Hovering any other item of a menu folds an open submenu away.
  for (const b of document.querySelectorAll('.sc-menu > .sc-menu-list > button'))
    b.addEventListener('pointerenter', closeSubs);

  function closeMenus() {
    closeSubs();
    if (!openMenu) return;
    openMenu.querySelector('.sc-menu-btn').setAttribute('aria-expanded', 'false');
    openMenu.querySelector('.sc-menu-list').hidden = true;
    openMenu = null;
  }
  function showMenu(m, focusFirst) {
    closeMenus();
    const btn = m.querySelector('.sc-menu-btn');
    const list = m.querySelector('.sc-menu-list');
    list.hidden = false;
    const r = btn.getBoundingClientRect();
    list.style.left = `${Math.max(4, Math.min(r.left, innerWidth - list.offsetWidth - 4))}px`;
    list.style.top = `${r.bottom + 2}px`;
    btn.setAttribute('aria-expanded', 'true');
    openMenu = m;
    if (focusFirst) list.querySelector('button').focus();
  }
  const menus = [...document.querySelectorAll('.sc-menu')];
  menus.forEach((m, mi) => {
    const btn = m.querySelector('.sc-menu-btn');
    const list = m.querySelector('.sc-menu-list');
    btn.addEventListener('click', (e) =>
      openMenu === m ? closeMenus() : showMenu(m, e.detail === 0),
    );
    btn.addEventListener('pointerenter', () => openMenu && openMenu !== m && showMenu(m));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        showMenu(m, true);
      }
    });
    list.addEventListener('keydown', (e) => {
      if (e.target.closest('.sc-sub-list')) return;
      const items = [
        ...list.querySelectorAll(':scope > button, :scope > .sc-submenu > .sc-sub-btn'),
      ];
      const at = items.indexOf(document.activeElement);
      const go = (d) => items[(at + d + items.length) % items.length].focus();
      const hop = (d) => showMenu(menus[(mi + d + menus.length) % menus.length], true);
      const keys = {
        ArrowDown: () => go(1),
        ArrowUp: () => go(-1),
        ArrowRight: () =>
          document.activeElement.classList.contains('sc-sub-btn')
            ? openSub(document.activeElement.parentElement, true)
            : hop(1),
        ArrowLeft: () => hop(-1),
        Escape: () => {
          closeMenus();
          btn.focus();
        },
      };
      if (!keys[e.key]) return;
      e.preventDefault();
      e.stopPropagation();
      keys[e.key]();
    });
  });
  document.addEventListener('pointerdown', (e) => {
    if (openMenu && !openMenu.contains(e.target)) closeMenus();
  });
  window.addEventListener('blur', closeMenus);

  // Dropping on the empty part of the Layers list sends layers to the back.
  const layerList = $('#sc-layers');
  layerList.addEventListener('dragover', (e) => {
    if (!dragEls || e.target !== layerList) return;
    e.preventDefault();
    clearDropMarks();
    layerList.classList.add('drop-end');
  });
  layerList.addEventListener('dragleave', (e) => {
    if (e.target === layerList) layerList.classList.remove('drop-end');
  });
  layerList.addEventListener('drop', (e) => {
    if (!dragEls || e.target !== layerList) return;
    e.preventDefault();
    moveLayers(dragEls, null, 'end');
  });

  for (const b of document.querySelectorAll('[data-autosel]')) {
    b.addEventListener('click', () => {
      state.autoSelect = b.dataset.autosel;
      for (const x of document.querySelectorAll('[data-autosel]'))
        x.setAttribute('aria-checked', x === b);
    });
    b.setAttribute('aria-checked', b.dataset.autosel === state.autoSelect);
  }

  // Panel tabs (Color | Swatches).
  for (const group of document.querySelectorAll('[data-tabs]')) {
    const tabs = [...group.querySelectorAll('[data-tab]')];
    for (const t of tabs) {
      t.addEventListener('click', () => {
        for (const x of tabs) {
          x.setAttribute('aria-selected', x === t);
          group.querySelector(`[data-pane="${x.dataset.tab}"]`).hidden = x !== t;
        }
      });
    }
  }

  // Remaining controls ------------------------------------------------------
  const zoomInput = $('#sc-zoom-input');
  zoomInput.addEventListener('change', () => {
    const v = parseFloat(zoomInput.value);
    if (v > 0) zoomAt(v / 100);
    else updateTitle();
  });
  zoomInput.addEventListener('keydown', (e) => {
    // Swallow the key: focus may move to the canvas text editor while it's handled.
    if (e.key === 'Enter') {
      e.preventDefault();
      zoomInput.blur();
    }
  });
  for (const id of ['#sc-w', '#sc-h']) {
    $(id).addEventListener('change', () => {
      setSize($('#sc-w').value, $('#sc-h').value);
      commit();
    });
  }
  $('#sc-grid').addEventListener('change', (e) => setGridOn(e.target.checked));
  $('#sc-snap').addEventListener('change', (e) => setSnapOn(e.target.checked));
  $('#sc-grid-size').addEventListener('change', (e) => {
    state.gridSize = clamp(+e.target.value || 20, 2, 500);
    e.target.value = state.gridSize;
    setGrid();
  });
  $('#sc-panel-toggle').addEventListener('click', (e) => {
    const open = $('#sc-panel').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });
  for (const b of document.querySelectorAll('[data-tool]'))
    b.addEventListener('click', () => setTool(b.dataset.tool));
  for (const b of document.querySelectorAll('[data-node-cmd]')) {
    b.addEventListener('click', () => {
      const n = tools.node;
      const c = b.dataset.nodeCmd;
      if (c === 'delete') n.removePicked();
      else if (c === 'close') n.toggleClosed();
      else n.setKind(c);
    });
  }
  for (const b of document.querySelectorAll('[data-eraser]')) {
    b.addEventListener('click', () => {
      state.eraserMode = b.dataset.eraser;
      for (const x of document.querySelectorAll('[data-eraser]'))
        x.setAttribute('aria-checked', x === b);
    });
  }
  for (const el of document.querySelectorAll('[data-tf]')) {
    el.addEventListener('input', () =>
      applyTransformField(el.dataset.tf, parseFloat(el.value), false),
    );
    el.addEventListener('change', () => {
      applyTransformField(el.dataset.tf, parseFloat(el.value), true);
      drawSelection();
    });
    el.addEventListener('keydown', (e) => {
      // Swallow the key: focus may move to the canvas text editor while it's handled.
      if (e.key === 'Enter') {
        e.preventDefault();
        el.blur();
      }
    });
  }
  $('#sc-tf-link').addEventListener('click', (e) => {
    const b = e.currentTarget;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on);
    b.firstElementChild.innerHTML = icon(on ? 'link' : 'link-slash');
  });
  for (const b of document.querySelectorAll('[data-eyedrop]')) {
    b.addEventListener('click', () => {
      state.eyedropMode = b.dataset.eyedrop;
      for (const x of document.querySelectorAll('[data-eyedrop]'))
        x.setAttribute('aria-checked', x === b);
      tools.eyedropper.leave();
    });
    b.setAttribute('aria-checked', b.dataset.eyedrop === state.eyedropMode);
  }
  document.querySelector('[data-eraser="object"]').setAttribute('aria-checked', 'true');
  document.querySelector('[data-eraser="cut"]').setAttribute('aria-checked', 'false');

  window.addEventListener('resize', () => {
    closeMenus();
    applyView();
  });

  // Boot ----------------------------------------------------------------
  hydrateIcons();
  syncTheme();
  wireStyle();
  wireScrubbers();
  bindNumber('#sc-smooth', 'smoothing');
  bindNumber('#sc-eraser-size', 'eraserSize');
  syncTypeUI();
  syncStyleUI();
  setGrid();
  setTool('select');
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved?.svg) {
      openSvg(saved.svg, saved.name);
      hist.splice(0, hist.length - 1);
      hIdx = 0;
      afterChange();
      restored = true;
    }
  } catch {
    /* no saved drawing, or storage blocked */
  }
  if (!restored) {
    setSize(800, 600);
    fit();
    commit();
  }

  // Exposed for the smoke test and for poking at from the console.
  window.svgcraft = {
    state,
    serialize,
    openSvg,
    placeSvg,
    setTool,
    undo,
    redo,
    cmds,
    commit,
    parsePathD,
    nodesD,
    shapeNodes,
    tools,
  };
})();
