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
    eraserSize: 12,
    smoothing: 4,
    fontSize: 32,
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

  // Axis-aligned bounding box of a top-level element, in document units.
  function bboxDoc(el) {
    let b;
    try {
      b = el.getBBox();
    } catch {
      return null;
    }
    if (!b || (b.width === 0 && b.height === 0 && b.x === 0 && b.y === 0 && !el.childNodes.length))
      return null;
    const m = getM(el);
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

  function topLevel(node) {
    if (!node || !doc.contains(node) || node === doc) return null;
    while (node.parentNode !== doc) node = node.parentNode;
    return selectable(node) ? node : null;
  }

  function selectable(el) {
    return el.nodeType === 1 && !NON_GRAPHIC.has(el.localName);
  }

  const items = () => [...doc.children].filter(selectable);
  const inDocOrder = (els) => items().filter((el) => els.includes(el));

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
    $('#sc-undo').disabled = hIdx <= 0;
    $('#sc-redo').disabled = hIdx >= hist.length - 1;
    state.sel = state.sel.filter((el) => el.parentNode === doc);
    drawSelection();
    renderLayers();
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
    $('#sc-zoom-pct').textContent = Math.round(state.zoom * 100) + '%';
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
    state.sel = els;
    if (els.length) readStyle(els[0]);
    drawSelection();
    renderLayers();
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
    if (!state.sel.length) return;
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
    if (state.tool !== 'select') return;
    const top = { x: box.x + box.w / 2, y: box.y };
    mk('line', { x1: top.x, y1: top.y, x2: top.x, y2: top.y - 22 / z, class: 'sc-ov' }, selLayer);
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
      const cursor = {
        n: 'ns',
        s: 'ns',
        e: 'ew',
        w: 'ew',
        nw: 'nwse',
        se: 'nwse',
        ne: 'nesw',
        sw: 'nesw',
      }[k];
      mk(
        'rect',
        {
          x: p.x - hs / 2,
          y: p.y - hs / 2,
          width: hs,
          height: hs,
          class: 'sc-handle',
          'data-handle': k,
          style: `cursor:${cursor}-resize`,
        },
        selLayer,
      );
    }
  }

  function layerName(el) {
    const tag = el.localName;
    const id = el.id ? ` #${el.id}` : '';
    if (tag === 'text') return `text “${(el.textContent || '').trim().slice(0, 24)}”`;
    if (tag === 'g') return `group (${el.children.length})${id}`;
    if (tag === 'path') return `path${id}`;
    return tag + id;
  }

  function renderLayers() {
    const ol = $('#sc-layers');
    ol.replaceChildren();
    const list = items().reverse();
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'sc-empty';
      li.textContent = 'Nothing here yet — draw something or drop an SVG.';
      ol.append(li);
      return;
    }
    for (const el of list.slice(0, 500)) {
      const li = document.createElement('li');
      const hidden = el.getAttribute('display') === 'none';
      li.className = (state.sel.includes(el) ? 'sel ' : '') + (hidden ? 'hidden' : '');
      const eye = document.createElement('button');
      eye.textContent = hidden ? '◌' : '●';
      eye.setAttribute('aria-label', hidden ? 'Show' : 'Hide');
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hidden) el.removeAttribute('display');
        else el.setAttribute('display', 'none');
        commit();
      });
      const name = document.createElement('span');
      name.className = 'sc-layer-name';
      name.textContent = layerName(el);
      li.append(eye, name);
      li.addEventListener('click', (e) => {
        if (hidden) return;
        if (e.shiftKey) toggleSel(el);
        else setSel([el]);
      });
      ol.append(li);
    }
  }

  // ---------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------
  const tools = {};

  tools.select = {
    hint: 'Click to select · Shift-click adds · Drag to move · Handles scale (Shift keeps ratio, Alt from centre) · Arrows nudge · Double-click text to edit',
    cursor: 'default',
    down(e, p) {
      const h = e.target.closest?.('[data-handle]');
      const box = selBox();
      if (h && box) {
        this.g = {
          mode: h.dataset.handle === 'rot' ? 'rot' : 'scale',
          k: h.dataset.handle,
          p0: p,
          box,
          m0: state.sel.map(getM),
        };
        return;
      }
      const el = topLevel(e.target);
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
        const hit = items().filter((el) => {
          const b = el.getAttribute('display') !== 'none' && bboxDoc(el);
          return b && b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y;
        });
        state.sel = [...new Set([...g.base, ...hit])];
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
      } else {
        const c = { x: g.box.x + g.box.w / 2, y: g.box.y + g.box.h / 2 };
        let deg =
          ((Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(g.p0.y - c.y, g.p0.x - c.x)) * 180) /
          Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        T = new DOMMatrix().translate(c.x, c.y).rotate(deg).translate(-c.x, -c.y);
      }
      state.sel.forEach((el, i) => setM(el, T.multiply(g.m0[i])));
      g.changed = true;
      drawSelection();
    },
    up() {
      const g = this.g;
      this.g = null;
      guides.replaceChildren();
      if (!g) return;
      if (g.mode === 'marquee') setSel(state.sel);
      else if (g.changed) commit();
    },
    dblclick(e) {
      const el = topLevel(e.target);
      if (el?.localName !== 'text') return;
      const r = el.getBoundingClientRect();
      editText(r.left, r.bottom, el.textContent, r.height, (t) => {
        if (t == null || t === el.textContent) return;
        if (t) el.textContent = t;
        else el.remove();
        commit();
      });
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

  tools.text = {
    hint: 'Click to place text · Double-click text with the Select tool to edit it',
    cursor: 'text',
    up(e, p) {
      p = snapPt(p);
      const m = view.getScreenCTM();
      const s = new DOMPoint(p.x, p.y).matrixTransform(m);
      editText(s.x, s.y, '', state.fontSize * state.zoom, (t) => {
        if (t) place(t);
      });
      const place = (t) => {
        const el = mk(
          'text',
          {
            ...newStyle('text'),
            x: f(p.x),
            y: f(p.y),
            'font-size': state.fontSize,
            'font-family': 'system-ui, sans-serif',
          },
          doc,
        );
        el.textContent = t;
        state.sel = [el];
        commit();
      };
    },
  };

  // Inline text field floated over the stage (prompt() is blocked in many
  // embedded/sandboxed pages). (x, y) is the screen baseline-left point.
  // Enter or blur commits, Escape cancels; onDone(null) on cancel.
  function editText(x, y, initial, px, onDone) {
    const wrap = $('#sc-stage-wrap');
    const r = wrap.getBoundingClientRect();
    const size = clamp(px, 12, 96);
    const input = document.createElement('input');
    input.className = 'sc-text-input';
    input.value = initial;
    input.style.left = `${x - r.left}px`;
    input.style.top = `${y - r.top - size * 1.15}px`;
    input.style.fontSize = `${size}px`;
    input.style.color = state.fillOn ? state.fill : state.stroke;
    wrap.append(input);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      input.remove();
      onDone(value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value);
      else if (e.key === 'Escape') finish(null);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(input.value));
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

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
          const el = topLevel(n);
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
    const M = getM(el);
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
  // Commands
  // ---------------------------------------------------------------------
  function transformSel(Tfn) {
    const box = selBox();
    if (!box) return;
    const T = Tfn(box);
    for (const el of state.sel) setM(el, T.multiply(getM(el)));
    commit();
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
      const src = inDocOrder(state.sel);
      let anchor = src.at(-1);
      const clones = src.map((el) => {
        const c = el.cloneNode(true);
        c.removeAttribute('id');
        setM(c, new DOMMatrix().translate(10, 10).multiply(getM(el)));
        anchor.after(c);
        anchor = c;
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
      inDocOrder(state.sel).forEach((el) => doc.append(el));
      commit();
    },
    back() {
      inDocOrder(state.sel)
        .reverse()
        .forEach((el) => doc.prepend(el));
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
    group() {
      const els = inDocOrder(state.sel);
      if (!els.length) return;
      const g = mk('g');
      els.at(-1).after(g);
      g.append(...els);
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
  };

  function nudge(dx, dy) {
    if (!state.sel.length) return;
    const T = new DOMMatrix().translate(dx, dy);
    for (const el of state.sel) setM(el, T.multiply(getM(el)));
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
    if (name) state.fileName = name.replace(/\.svg$/i, '');
    state.sel = [];
    fit();
    commit();
  }

  function placeSvg(text) {
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
      const g = mk('g', {}, doc);
      g.append(...s.nodes);
      const k = Math.min(1, (state.w * 0.9) / s.w, (state.h * 0.9) / s.h);
      const tx = (state.w - s.w * k) / 2;
      const ty = (state.h - s.h * k) / 2;
      setM(g, new DOMMatrix().translate(tx, ty).scale(k).translate(-s.minX, -s.minY));
      state.sel = [g];
    }
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
        else placeSvg(r.result);
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
  function serialize({ selection = false } = {}) {
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
    if (defs.children.length) {
      const d = document.createElementNS(NS, 'defs');
      for (const c of defs.childNodes) d.append(c.cloneNode(true));
      root.append(nl(), d);
    }
    for (const el of selection ? inDocOrder(state.sel) : [...doc.children]) {
      const c = el.cloneNode(true);
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

  function exportSvg() {
    download(new Blob([serialize()], { type: 'image/svg+xml' }), `${state.fileName}.svg`);
  }

  function exportPng() {
    const scale = +$('#sc-png-scale').value || 1;
    const url = URL.createObjectURL(new Blob([serialize()], { type: 'image/svg+xml' }));
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
    const text = serialize({ selection: state.sel.length > 0 });
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
  function setTool(name) {
    if (!tools[name]) return;
    if (name !== state.tool) {
      tools[state.tool].leave?.();
      if (name !== 'select' && name !== 'hand') state.sel = [];
    }
    state.tool = name;
    for (const b of document.querySelectorAll('[data-tool]'))
      b.setAttribute('aria-pressed', b.dataset.tool === name);
    for (const s of document.querySelectorAll('.sc-tool-opts'))
      s.classList.toggle('on', s.dataset.for === name);
    stage.style.cursor = tools[name].cursor;
    $('#sc-hint').textContent = tools[name].hint;
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
    $('#sc-stroke-w').value = state.strokeWidth;
    $('#sc-stroke-w-out').textContent = f(state.strokeWidth);
    $('#sc-opacity').value = Math.round(state.opacity * 100);
    $('#sc-opacity-out').textContent = Math.round(state.opacity * 100) + '%';
  }

  // Push a style change to the selection; `final` commits it to history.
  function styleChanged(key, final) {
    syncStyleUI();
    if (!state.sel.length) return;
    for (const el of state.sel) applyStyle(el, key);
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
    const w = $('#sc-stroke-w');
    w.addEventListener('input', () => {
      state.strokeWidth = +w.value;
      styleChanged('width', false);
    });
    w.addEventListener('change', () => styleChanged('width', true));
    const op = $('#sc-opacity');
    op.addEventListener('input', () => {
      state.opacity = op.value / 100;
      styleChanged('opacity', false);
    });
    op.addEventListener('change', () => styleChanged('opacity', true));

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

  function bindRange(id, key, fmt = (v) => v) {
    const el = $(id);
    const out = $(id + '-out');
    const upd = () => {
      state[key] = +el.value;
      out.textContent = fmt(+el.value);
      tools[state.tool].redraw?.();
    };
    el.addEventListener('input', upd);
    upd();
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
  stage.addEventListener('dblclick', (e) => tools[state.tool].dblclick?.(e));
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
    p: 'pencil',
    b: 'pen',
    e: 'eraser',
    r: 'rect',
    o: 'ellipse',
    l: 'line',
    t: 'text',
    h: 'hand',
  };

  window.addEventListener('keydown', (e) => {
    const typing = e.target.matches?.(
      'input:not([type=range]):not([type=checkbox]), textarea, select',
    );
    if (typing) return;
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
    if (e.target.matches?.('input, textarea') || !state.sel.length) return;
    e.clipboardData.setData('text/plain', serialize({ selection: true }));
    e.preventDefault();
  });
  document.addEventListener('cut', (e) => {
    if (e.target.matches?.('input, textarea') || !state.sel.length) return;
    e.clipboardData.setData('text/plain', serialize({ selection: true }));
    e.preventDefault();
    cmds.delete();
  });
  document.addEventListener('paste', (e) => {
    if (e.target.matches?.('input, textarea')) return;
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

  // Buttons -------------------------------------------------------------
  let pickMode = 'open';
  function openPicker(mode) {
    pickMode = mode;
    $('#sc-file').click();
  }
  $('#sc-file').addEventListener('change', (e) => {
    importFile(e.target.files[0], pickMode);
    e.target.value = '';
  });
  $('#sc-open').addEventListener('click', () => openPicker('open'));
  $('#sc-place').addEventListener('click', () => openPicker('place'));
  $('#sc-new').addEventListener('click', () => {
    if (!items().length) return;
    tools[state.tool].leave?.();
    doc.replaceChildren();
    defs.replaceChildren();
    state.sel = [];
    state.fileName = 'drawing';
    commit();
    say('New drawing — Ctrl+Z brings the old one back');
  });
  $('#sc-export-svg').addEventListener('click', exportSvg);
  $('#sc-export-png').addEventListener('click', exportPng);
  $('#sc-copy-svg').addEventListener('click', copySvg);
  $('#sc-undo').addEventListener('click', undo);
  $('#sc-redo').addEventListener('click', redo);
  $('#sc-zoom-in').addEventListener('click', () => zoomAt(state.zoom * 1.25));
  $('#sc-zoom-out').addEventListener('click', () => zoomAt(state.zoom / 1.25));
  $('#sc-zoom-pct').addEventListener('click', fit);
  for (const id of ['#sc-w', '#sc-h']) {
    $(id).addEventListener('change', () => {
      setSize($('#sc-w').value, $('#sc-h').value);
      commit();
    });
  }
  $('#sc-grid').addEventListener('change', (e) => {
    state.grid = e.target.checked;
    setGrid();
  });
  $('#sc-snap').addEventListener('change', (e) => (state.snap = e.target.checked));
  $('#sc-grid-size').addEventListener('change', (e) => {
    state.gridSize = clamp(+e.target.value || 20, 2, 500);
    setGrid();
  });
  $('#sc-panel-toggle').addEventListener('click', () => $('#sc-panel').classList.toggle('open'));
  for (const b of document.querySelectorAll('[data-tool]'))
    b.addEventListener('click', () => setTool(b.dataset.tool));
  for (const b of document.querySelectorAll('[data-cmd]'))
    b.addEventListener('click', () => cmds[b.dataset.cmd]());
  for (const b of document.querySelectorAll('[data-eraser]')) {
    b.addEventListener('click', () => {
      state.eraserMode = b.dataset.eraser;
      for (const x of document.querySelectorAll('[data-eraser]'))
        x.setAttribute('aria-checked', x === b);
    });
  }
  document.querySelector('[data-eraser="object"]').setAttribute('aria-checked', 'true');
  document.querySelector('[data-eraser="cut"]').setAttribute('aria-checked', 'false');

  window.addEventListener('resize', () => applyView());

  // Boot ----------------------------------------------------------------
  wireStyle();
  bindRange('#sc-smooth', 'smoothing');
  bindRange('#sc-eraser-size', 'eraserSize');
  bindRange('#sc-font-size', 'fontSize');
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
  window.svgcraft = { state, serialize, openSvg, placeSvg, setTool, undo, redo, cmds, commit };
})();
