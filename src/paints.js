// SVGCraft — Gradients and patterns as paints.
'use strict';

// ---- gradients --------------------------------------------------------------
// A paint gradient is { type: 'linear' | 'radial', stops: [{ o, c, a }],
// angle } (angle as in Photoshop: 0° = left → right, 90° = bottom → top).
// Each shape gets a gradient of its own, in its own coordinates
// (userSpaceOnUse), so angles stay true on wide shapes and the gradient
// travels with the shape. Ours carry data-sc-grad; unused ones are pruned.
const evenStops = (cs) => cs.map((c, i) => ({ o: i / (cs.length - 1), c, a: 1 }));
const GRAD_PRESETS = {
  fade: [
    'Colour → Transparent',
    (c) => [
      { o: 0, c, a: 1 },
      { o: 1, c, a: 0 },
    ],
  ],
  bw: ['Black → White', () => evenStops(['#000000', '#ffffff'])],
  wb: ['White → Black', () => evenStops(['#ffffff', '#000000'])],
  sunset: ['Sunset', () => evenStops(['#facc15', '#f97316', '#db2777', '#7c3aed'])],
  ocean: ['Ocean', () => evenStops(['#67e8f9', '#0ea5e9', '#1e3a8a'])],
  rainbow: [
    'Rainbow',
    () => evenStops(['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6']),
  ],
  gold: ['Gold', () => evenStops(['#b8892f', '#f5d76e', '#fff2b2', '#c8a24a'])],
  mint: ['Mint', () => evenStops(['#d1fae5', '#14b8a6'])],
};
const GRAD_SHAPES = 'path,rect,circle,ellipse,line,polyline,polygon,text,use';
let gradReset = false; // next gradient write re-derives geometry (angle / type changed)

const cloneGrad = (g) => g && { ...g, stops: g.stops.map((s) => ({ ...s })) };
const stopList = (g) => g.stops.map((s) => `${cssColor(s.c, s.a)} ${f(s.o * 100)}%`).join(', ');
// CSS previews: a left-to-right bar for the editor, the real look for chips
// (CSS angles run clockwise from "to top"; Photoshop's anticlockwise from 3 o'clock).
const gradCss = (g) => `linear-gradient(90deg, ${stopList(g)})`;
const chipCss = (g) =>
  g.type === 'radial'
    ? `radial-gradient(circle, ${stopList(g)})`
    : `linear-gradient(${90 - g.angle}deg, ${stopList(g)})`;

function newGradId() {
  let n = 1;
  while (document.getElementById(`sc-grad-${n}`)) n++;
  return `sc-grad-${n}`;
}
const urlId = (v) => (String(v || '').match(/url\(\s*["']?#([^"')]+)["']?\s*\)/) || [])[1] || null;
const paintRef = (el, attr) => urlId(el.getAttribute(attr));
const refCount = (id) =>
  doc.querySelectorAll(`[fill="url(#${id})"], [stroke="url(#${id})"]`).length;

// Stops of a gradient, following href chains (imported files reuse stops).
function stopsOf(g) {
  for (let n = g, i = 0; n && i < 6; i++) {
    const st = n.querySelectorAll(':scope > stop');
    if (st.length)
      return [...st].map((s) => {
        const off = s.getAttribute('offset') || '0';
        const col =
          s.getAttribute('stop-color') ||
          s.style.stopColor ||
          getComputedStyle(s).stopColor ||
          '#000';
        const op = parseFloat(s.getAttribute('stop-opacity') ?? (s.style.stopOpacity || 1));
        return {
          o: clamp(off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0, 0, 1),
          c: hex(col) || '#000000',
          a: clamp((isFinite(op) ? op : 1) * colorAlpha(col), 0, 1),
        };
      });
    const h = n.getAttribute('href') || n.getAttributeNS(XLINK, 'href');
    n = h ? document.getElementById(h.slice(1)) : null;
  }
  return [];
}

function readGrad(g) {
  if (!g || !/^(linear|radial)Gradient$/.test(g.localName)) return null;
  const type = g.localName === 'radialGradient' ? 'radial' : 'linear';
  let angle = 0;
  if (type === 'linear') {
    const v = (k, d) => parseFloat(g.getAttribute(k) ?? d);
    angle = Math.round(
      (Math.atan2(-(v('y2', 0) - v('y1', 0)), v('x2', 1) - v('x1', 0)) * 180) / Math.PI,
    );
  }
  const stops = stopsOf(g).sort((a, b) => a.o - b.o);
  if (!stops.length) return null;
  return { type, stops, angle, stretch: g.hasAttribute('data-stretch') };
}
// The gradient model behind an element's fill or stroke (computed, so
// inherited and CSS paints count too), or null.
const gradFor = (el, attr) => readGrad(document.getElementById(urlId(getComputedStyle(el)[attr])));

// Across box b at `angle`, edge to edge (radial: from the centre out to
// the farther side).
function defaultGeo(b, type, angle) {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (type === 'radial') return { cx, cy, r: Math.max(b.width, b.height) / 2 || 1 };
  const t = (angle * Math.PI) / 180;
  const dx = Math.cos(t);
  const dy = -Math.sin(t);
  const half = (Math.abs(b.width * dx) + Math.abs(b.height * dy)) / 2 || 1;
  return { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half };
}
// A gradient keeps its angle when its shape is stretched or skewed, and a
// radial one stays round, unless it's set to stretch with the shape
// (data-stretch). It's laid out in the shape's space as the page shows it,
// the shape's turn aside: `toLocal` maps that space to the shape's own (the
// gradientTransform), `box` is the shape's box in it. After each change the
// gradient is fitted to that box again, keeping its angle and where it sits
// in the box (data-fit: its centre as fractions of the box, and its length
// against the box's).
function gradSpace(el, stretch) {
  let b;
  try {
    b = el.getBBox();
  } catch {
    b = { x: 0, y: 0, width: 0, height: 0 };
  }
  const flat = { toLocal: new DOMMatrix(), box: b };
  if (stretch) return flat;
  const M = fullM(el);
  const turn = (Math.atan2(M.b, M.a) * 180) / Math.PI;
  const Q = new DOMMatrix().rotate(-turn).multiply(new DOMMatrix([M.a, M.b, M.c, M.d, 0, 0]));
  if (Math.abs(Q.a * Q.d - Q.b * Q.c) < 1e-9) return flat;
  const pts = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ].map(([x, y]) => Q.transformPoint(new DOMPoint(x, y)));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    toLocal: Q.inverse(),
    box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  };
}
const gradSpan = (b, t) => Math.abs(b.width * Math.cos(t)) + Math.abs(b.height * Math.sin(t)) || 1;
function gradFit(geo, b) {
  const w = b.width || 1;
  const h = b.height || 1;
  if ('r' in geo) return [(geo.cx - b.x) / w, (geo.cy - b.y) / h, geo.r / (Math.max(w, h) / 2)];
  const t = Math.atan2(geo.y2 - geo.y1, geo.x2 - geo.x1);
  const len = Math.hypot(geo.x2 - geo.x1, geo.y2 - geo.y1);
  return [
    ((geo.x1 + geo.x2) / 2 - b.x) / w,
    ((geo.y1 + geo.y2) / 2 - b.y) / h,
    len / gradSpan(b, t),
  ];
}
// Geometry from a fit in box b; a linear one keeps geo's direction.
function geoFromFit([fx, fy, k], b, geo) {
  const cx = b.x + fx * (b.width || 1);
  const cy = b.y + fy * (b.height || 1);
  if ('r' in geo) return { cx, cy, r: (k * Math.max(b.width || 1, b.height || 1)) / 2 };
  const t = Math.atan2(geo.y2 - geo.y1, geo.x2 - geo.x1);
  const half = (k * gradSpan(b, t)) / 2;
  const [dx, dy] = [Math.cos(t) * half, Math.sin(t) * half];
  return { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy };
}
const nearlyIdentity = (m) =>
  [m.a - 1, m.b, m.c, m.d - 1, m.e, m.f].every((v) => Math.abs(v) < 1e-6);
// g's gradientTransform and fit, for el in space sp.
function layGrad(el, g, sp) {
  const S = paintSpaceM(el);
  const T = (S ? S.inverse() : new DOMMatrix()).multiply(sp.toLocal);
  if (nearlyIdentity(T)) g.removeAttribute('gradientTransform');
  else g.setAttribute('gradientTransform', matrixAttr(T));
  if (g.hasAttribute('data-stretch')) return g.removeAttribute('data-fit');
  g.setAttribute(
    'data-fit',
    gradFit(geoOf(g), sp.box)
      .map((v) => +v.toFixed(5))
      .join(' '),
  );
}

function geoOf(g) {
  const v = (k) => parseFloat(g.getAttribute(k)) || 0;
  return g.localName === 'radialGradient'
    ? { cx: v('cx'), cy: v('cy'), r: v('r') }
    : { x1: v('x1'), y1: v('y1'), x2: v('x2'), y2: v('y2') };
}
function writeGrad(g, model, geo) {
  g.setAttribute('gradientUnits', 'userSpaceOnUse');
  g.setAttribute('data-sc-grad', '');
  for (const [k, v] of Object.entries(geo)) g.setAttribute(k, f(v));
  g.replaceChildren(
    ...model.stops.map((s) =>
      mk('stop', { offset: f(s.o), 'stop-color': s.c, 'stop-opacity': s.a < 1 ? f(s.a) : null }),
    ),
  );
}

// A gradient or pattern set on a symbol instance (<use>) is resolved by
// each shape inside the symbol, in that shape's own coordinates, not the
// instance's: the library's symbols, drawn at 512 and scaled to 64, would
// get a gradient an eighth of its handles' length. This is the matrix
// from those coordinates to the instance's (its x/y and the parts' shared
// transform), or null when there's nothing to undo or the parts disagree.
function paintSpaceM(el) {
  if (el.localName !== 'use') return null;
  const sym = typeof symbolOf === 'function' ? symbolOf(el) : null;
  const parts = sym ? [...sym.children].filter((c) => c instanceof SVGGraphicsElement) : [];
  if (!parts.length) return null;
  const m = getM(parts[0]);
  const same = (a) => ['a', 'b', 'c', 'd', 'e', 'f'].every((k) => Math.abs(a[k] - m[k]) < 1e-6);
  if (!parts.every((c) => same(getM(c)))) return null;
  const M = new DOMMatrix()
    .translate(parseFloat(el.getAttribute('x')) || 0, parseFloat(el.getAttribute('y')) || 0)
    .multiply(m);
  return M.isIdentity ? null : M;
}
const matrixAttr = (m) =>
  `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(6)).join(' ')})`;

// Point el's fill / stroke at a gradient of its own. Its geometry is kept
// unless gradReset or a geo is passed; a gradient shared with another
// element (a duplicate) is split off first.
function setGradPaint(el, attr, model, geo = null) {
  const tag = model.type === 'radial' ? 'radialGradient' : 'linearGradient';
  const stretch = !!model.stretch;
  const id = paintRef(el, attr);
  let g = id && document.getElementById(id);
  const mine = g && g.hasAttribute('data-sc-grad') && g.localName === tag && defs.contains(g);
  // Its geometry stays, unless it changes how it's laid out.
  const keep = mine && !gradReset && g.hasAttribute('data-stretch') === stretch ? geoOf(g) : null;
  if (!mine || refCount(id) > 1) {
    g = mk(tag);
    g.id = newGradId();
    defs.append(g);
  }
  const sp = gradSpace(el, stretch);
  writeGrad(g, model, geo || keep || defaultGeo(sp.box, model.type, model.angle));
  g.toggleAttribute('data-stretch', stretch);
  layGrad(el, g, sp);
  el.style?.removeProperty(attr);
  el.setAttribute(attr, `url(#${g.id})`);
}

// After shapes are scaled or skewed: their gradients fitted to them again,
// at their own angle (`els` and what's in them, or the whole drawing).
// One from before data-fit is taken as laid out in the shape's own space.
function syncGradients(els) {
  for (const el of paintedBy(els))
    for (const attr of ['fill', 'stroke']) {
      const g = document.getElementById(paintRef(el, attr) || '');
      if (!g?.hasAttribute('data-sc-grad') || g.hasAttribute('data-stretch')) continue;
      const sp = gradSpace(el, false);
      let geo = geoOf(g);
      let fit = (g.getAttribute('data-fit') || '').split(' ').map(Number);
      if (fit.length !== 3 || !fit.every(isFinite)) {
        const Q = sp.toLocal.inverse();
        const P = (x, y) => Q.transformPoint(new DOMPoint(x, y));
        if ('r' in geo) {
          const c = P(geo.cx, geo.cy);
          const s = Math.sqrt(Math.abs(Q.a * Q.d - Q.b * Q.c));
          geo = { cx: c.x, cy: c.y, r: geo.r * s };
        } else {
          const [a, b] = [P(geo.x1, geo.y1), P(geo.x2, geo.y2)];
          geo = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        }
        fit = gradFit(geo, sp.box);
      }
      const want = geoFromFit(fit, sp.box, geo);
      const now = geoOf(g);
      const T = paintSpaceM(el);
      const tf = (T ? T.inverse() : new DOMMatrix()).multiply(sp.toLocal);
      const same =
        Object.keys(want).every((k) => Math.abs(want[k] - now[k]) < 0.01) &&
        (nearlyIdentity(tf)
          ? !g.hasAttribute('gradientTransform')
          : g.getAttribute('gradientTransform') === matrixAttr(tf));
      if (!same) setGradPaint(el, attr, { ...readGrad(g), stretch: false }, want);
    }
}

function pruneGradients() {
  const kept = keptIds();
  for (const g of defs.querySelectorAll(':scope > [data-sc-grad], :scope > [data-sc-pat]'))
    if (!refCount(g.id) && !doc.querySelector(`[style*="#${g.id}"]`) && !kept.has(g.id)) g.remove();
}

// ---- patterns -----------------------------------------------------------------
// A paint pattern is { id, name, w, h, svg, scale, angle }: svg is the tile's
// markup, drawn in 0..w × 0..h. Built-in tiles draw in currentColor, so the
// paint's colour is their ink (the <pattern> carries it as `color`). As with
// gradients, each shape gets a <pattern> of its own (data-sc-pat), in its own
// coordinates and starting at its top-left corner, so it travels with it.
const BUILTIN_PATTERNS = [
  ['Stripes', 8, 8, '<rect width="8" height="3" fill="currentColor"/>'],
  [
    'Diagonal',
    8,
    8,
    '<path d="M-2 2l4-4M0 8l8-8M6 10l4-4" stroke="currentColor" stroke-width="2"/>',
  ],
  ['Dots', 10, 10, '<circle cx="5" cy="5" r="2.2" fill="currentColor"/>'],
  ['Grid', 10, 10, '<path d="M0 .5h10M.5 0v10" stroke="currentColor" fill="none"/>'],
  ['Checks', 16, 16, '<path d="M0 0h8v8H0zM8 8h8v8H8z" fill="currentColor"/>'],
  [
    'Crosshatch',
    8,
    8,
    '<path d="M-2 2l4-4M0 8l8-8M6 10l4-4M-2 6l4 4M0 0l8 8M6-2l4 4" stroke="currentColor" fill="none"/>',
  ],
  [
    'Waves',
    20,
    10,
    '<path d="M0 5q5-5 10 0t10 0" stroke="currentColor" stroke-width="1.5" fill="none"/>',
  ],
  [
    'Bricks',
    20,
    10,
    '<path d="M0 .5h20M0 5.5h20M5 .5v5M15 5.5v5" stroke="currentColor" fill="none"/>',
  ],
  ['Triangles', 12, 12, '<path d="M6 2l4 8H2z" fill="currentColor"/>'],
];

function newDefId(prefix) {
  let n = 1;
  while (document.getElementById(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

// The pattern model behind an element's fill or stroke, or null. Only
// SVGCraft's own patterns read back; imported ones are left as they are.
function patFor(el, attr) {
  const p = document.getElementById(urlId(getComputedStyle(el)[attr]));
  if (!p || p.localName !== 'pattern' || !p.hasAttribute('data-sc-pat')) return null;
  const n = (k, d) => parseFloat(p.getAttribute(k)) || d;
  return {
    id: p.getAttribute('data-sc-pat'),
    name: p.getAttribute('data-name') || 'Pattern',
    w: n('width', 10),
    h: n('height', 10),
    svg: p.innerHTML,
    scale: n('data-scale', 1),
    angle: parseFloat(p.getAttribute('data-angle')) || 0,
    withShape: p.hasAttribute('data-with-shape'),
  };
}
// The ink a pattern paint was given (its `color`), for the colour fields.
const patInk = (el, attr) =>
  hex(document.getElementById(urlId(getComputedStyle(el)[attr])).getAttribute('color'));

// A pattern's transform: its tile starts at the shape's top-left corner and
// turns with the shape. Unless it scales with the shape (withShape), it
// keeps its size when the shape is scaled, stretched or skewed: the shape's
// scale and skew are undone, keeping only its rotation.
function patTransform(el, model) {
  let b;
  try {
    b = el.getBBox();
  } catch {
    b = { x: 0, y: 0 };
  }
  const sc = clamp(model.scale || 1, 0.05, 50);
  let keep = '';
  if (!model.withShape) {
    const M = fullM(el);
    const L = new DOMMatrix([M.a, M.b, M.c, M.d, 0, 0]);
    const C = L.inverse().rotate((Math.atan2(M.b, M.a) * 180) / Math.PI);
    if (![C.a - 1, C.b, C.c, C.d - 1].every((v) => Math.abs(v) < 1e-6) && isFinite(C.a))
      keep = `${matrixAttr(C)} `;
  }
  return (
    (paintSpaceM(el) ? `${matrixAttr(paintSpaceM(el).inverse())} ` : '') +
    `translate(${f(b.x)} ${f(b.y)}) ${keep}rotate(${f(model.angle || 0)}) scale(${f(sc)})`
  );
}

function setPatPaint(el, attr, model, ink) {
  const id = paintRef(el, attr);
  let p = id && document.getElementById(id);
  const mine = p && p.hasAttribute('data-sc-pat') && defs.contains(p);
  if (!mine || refCount(id) > 1) {
    p = mk('pattern', { id: newDefId('sc-pat') });
    defs.append(p);
  }
  const sc = clamp(model.scale || 1, 0.05, 50);
  for (const [k, v] of Object.entries({
    patternUnits: 'userSpaceOnUse',
    width: f(model.w),
    height: f(model.h),
    patternTransform: patTransform(el, model),
    color: ink,
    'data-sc-pat': model.id || '',
    'data-name': model.name,
    'data-scale': f(sc),
    'data-angle': f(model.angle || 0),
  }))
    p.setAttribute(k, v);
  p.toggleAttribute('data-with-shape', !!model.withShape);
  if (p.innerHTML !== model.svg) p.innerHTML = model.svg;
  el.style?.removeProperty(attr);
  el.setAttribute(attr, `url(#${p.id})`);
}

// What in `els` (or the whole drawing) is painted with a url(#…).
function paintedBy(els) {
  const Q = '[fill^="url(#"], [stroke^="url(#"]';
  return els
    ? els.flatMap((el) => [...(el.matches?.(Q) ? [el] : []), ...el.querySelectorAll(Q)])
    : [...doc.querySelectorAll(Q)];
}
// After shapes are scaled: their patterns back to their own size (`els`
// and what's in them, or the whole drawing).
function syncPatterns(els) {
  for (const el of paintedBy(els))
    for (const attr of ['fill', 'stroke']) {
      if (!el.getAttribute(attr)?.startsWith('url(#')) continue;
      const model = patFor(el, attr);
      if (!model || model.withShape) continue;
      const p = document.getElementById(paintRef(el, attr));
      if (p?.getAttribute('patternTransform') !== patTransform(el, model))
        setPatPaint(el, attr, model, patInk(el, attr));
    }
}

// A CSS background showing the tile, for chips and the Patterns panel.
function patCss(p, ink, px = 1) {
  const s = (p.scale || 1) * px;
  const svg =
    `<svg xmlns="${NS}" width="${f(p.w * s)}" height="${f(p.h * s)}" ` +
    `viewBox="0 0 ${f(p.w)} ${f(p.h)}" color="${ink}">${p.svg}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / ${f(p.w * s)}px ${f(p.h * s)}px repeat`;
}

// Shapes a gradient lands on: the selection, with groups opened up.
function gradTargets() {
  const out = [];
  for (const el of state.sel) {
    if (el.matches(GRAD_SHAPES)) out.push(el);
    else out.push(...el.querySelectorAll(GRAD_SHAPES));
  }
  return out;
}
