// SVGCraft — Transforms, bounding boxes and painted boxes; moving layers between groups.
'use strict';

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
  const v = [m.a, m.b, m.c, m.d, m.e, m.f].map((n, i) => +n.toFixed(i < 4 ? 5 : 3) || 0);
  if (v.join(' ') === '1 0 0 1 0 0') el.removeAttribute('transform');
  else el.setAttribute('transform', `matrix(${v.join(' ')})`);
}

// Axis-aligned bounding box of an element (at any depth), in document
// units; pass m to measure it under another matrix instead.
function bboxDoc(el, m = fullM(el)) {
  // A clipping group is as big as its window (Illustrator's rule).
  const cl = clipperOf(el);
  if (cl) return bboxDoc(cl, m.multiply(getM(cl)));
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

const isShown = (el) => !el.closest('[display="none"]');

// Like unionBox, but the area that actually gets painted, in document
// coordinates: hidden layers are left out, and strokes count as drawn —
// their width and position (centre / inside / outside), mitre tips at sharp
// corners, round joins, square and round caps — as do effects (drop
// shadow, outer glow, blur). Cropping, Define Pattern and Copy as SVG use it
// so nothing gets shaved off.
function paintBox(els) {
  let box = null;
  const grow = (b) => {
    if (!b) return;
    box = box
      ? {
          x1: Math.min(box.x1, b.x1),
          y1: Math.min(box.y1, b.y1),
          x2: Math.max(box.x2, b.x2),
          y2: Math.max(box.y2, b.y2),
        }
      : { ...b };
  };
  for (const el of els) grow(layerPaintBox(el));
  return box && { x: box.x1, y: box.y1, w: box.x2 - box.x1, h: box.y2 - box.y1 };
}

function layerPaintBox(el, depth = 0) {
  if (!isShown(el)) return null;
  let b = null;
  const sym = symbolOf(el);
  if (sym) {
    // A symbol instance paints what its symbol's content paints, where
    // the instance puts it: measure a stand-in group built in its place.
    if (depth > 8) return null;
    const g = mk('g');
    setM(g, useM(el));
    g.append(...[...sym.children].map((c) => c.cloneNode(true)));
    for (const n of [g, ...g.querySelectorAll('[id]')]) n.removeAttribute('id');
    el.parentNode.insertBefore(g, el);
    for (const a of INHERITED) if (el.hasAttribute(a)) g.setAttribute(a, el.getAttribute(a));
    try {
      for (const c of g.children) {
        if (!selectable(c)) continue;
        const cb = layerPaintBox(c, depth + 1);
        if (cb)
          b = b
            ? {
                x1: Math.min(b.x1, cb.x1),
                y1: Math.min(b.y1, cb.y1),
                x2: Math.max(b.x2, cb.x2),
                y2: Math.max(b.y2, cb.y2),
              }
            : cb;
      }
    } finally {
      g.remove();
    }
  } else if (el.localName === 'g') {
    const cl = clipperOf(el);
    for (const c of el.children) {
      if (!selectable(c) || c === cl) continue;
      const cb = layerPaintBox(c, depth);
      if (cb)
        b = b
          ? {
              x1: Math.min(b.x1, cb.x1),
              y1: Math.min(b.y1, cb.y1),
              x2: Math.max(b.x2, cb.x2),
              y2: Math.max(b.y2, cb.y2),
            }
          : cb;
    }
    // Nothing is painted outside the clipping shape's outline.
    const w = cl && bboxDoc(cl);
    if (b && w) {
      b = {
        x1: Math.max(b.x1, w.x),
        y1: Math.max(b.y1, w.y),
        x2: Math.min(b.x2, w.x + w.w),
        y2: Math.min(b.y2, w.y + w.h),
      };
      if (b.x1 >= b.x2 || b.y1 >= b.y2) b = null;
    }
  } else b = outlineBox(el);
  return b && withEffects(el, b);
}

// The stroke's reach either side of the outline (local units).
function strokeReach(el) {
  const cs = getComputedStyle(el);
  if (!cs.stroke || cs.stroke === 'none' || cs.strokeOpacity === '0') return 0;
  const w = strokeW(el);
  const a = alignOf(el);
  return a === 'inside' ? 0 : a === 'outside' ? w : w / 2;
}

// Bounds of one shape as painted: its outline, offset by the stroke along
// the normal at many points of every segment (in its own coordinates, so a
// non-uniform scale is honoured), plus joins and caps.
function outlineBox(el) {
  const M = fullM(el);
  const pts = [];
  const add = (x, y) => pts.push(new DOMPoint(x, y).matrixTransform(M));
  const half = strokeReach(el);
  if (!EDITABLE.has(el.localName) || !half) {
    let b;
    try {
      b = el.getBBox();
    } catch {
      return null;
    }
    if (!b || (!b.width && !b.height && !el.childNodes.length && !half)) return null;
    for (const [x, y] of [
      [b.x - half, b.y - half],
      [b.x + b.width + half, b.y - half],
      [b.x - half, b.y + b.height + half],
      [b.x + b.width + half, b.y + b.height + half],
    ])
      add(x, y);
  } else {
    const cs = getComputedStyle(el);
    const join = cs.strokeLinejoin;
    const cap = cs.strokeLinecap;
    const limit = parseFloat(cs.strokeMiterlimit) || 4;
    const unit = (x, y) => {
      const l = Math.hypot(x, y);
      return l > 1e-9 ? [x / l, y / l] : null;
    };
    const circle = (p) => {
      add(p.x - half, p.y);
      add(p.x + half, p.y);
      add(p.x, p.y - half);
      add(p.x, p.y + half);
    };
    for (const sp of shapeNodes(el)) {
      const n = sp.nodes;
      if (!n.length) continue;
      if (n.length === 1) {
        if (cap !== 'butt') circle(n[0]);
        continue;
      }
      const segs = [];
      for (let i = 1; i < n.length; i++) segs.push([n[i - 1], n[i]]);
      if (sp.closed) segs.push([n.at(-1), n[0]]);
      // Start and end directions of each segment, for joins and caps.
      const dirs = [];
      for (const [a, b] of segs) {
        const p0 = a;
        const p1 = a.hout || a;
        const p2 = b.hin || b;
        const p3 = b;
        const at = (t) => {
          const u = 1 - t;
          return {
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
          };
        };
        const tan = (t) => {
          const u = 1 - t;
          return unit(
            3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
            3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
          );
        };
        const chord = unit(p3.x - p0.x, p3.y - p0.y);
        const curved = a.hout || b.hin;
        const steps = curved ? 24 : 1;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const p = at(t);
          const d = (curved && tan(t)) || chord;
          add(p.x, p.y);
          if (d) {
            add(p.x - d[1] * half, p.y + d[0] * half);
            add(p.x + d[1] * half, p.y - d[0] * half);
          }
        }
        dirs.push([(curved && tan(0)) || chord, (curved && tan(1)) || chord]);
      }
      // Joins between consecutive segments.
      const joins = sp.closed ? segs.length : segs.length - 1;
      for (let i = 0; i < joins; i++) {
        const vin = dirs[i][1];
        const vout = dirs[(i + 1) % segs.length][0];
        const v = segs[i][1];
        if (!vin || !vout) continue;
        if (join === 'round') circle(v);
        else if (join === 'miter' || join === 'miter-clip' || join === 'arcs') {
          // Angle between the two directions; the tip sits on the outer
          // bisector, half / sin(θ/2) from the vertex, unless the mitre
          // limit turns it into a bevel.
          const cos = clamp(-(vin[0] * vout[0] + vin[1] * vout[1]), -1, 1);
          const theta = Math.acos(cos);
          const sinHalf = Math.sin(theta / 2);
          if (sinHalf > 1e-6 && 1 / sinHalf <= limit) {
            const bis = unit(vout[0] - vin[0], vout[1] - vin[1]);
            if (bis) add(v.x - bis[0] * (half / sinHalf), v.y - bis[1] * (half / sinHalf));
          }
        }
      }
      // Caps on the ends of an open path.
      if (!sp.closed && cap !== 'butt') {
        const ends = [
          [n[0], dirs[0][0], -1],
          [n.at(-1), dirs.at(-1)[1], 1],
        ];
        for (const [p, d, sgn] of ends) {
          if (cap === 'round' || !d) circle(p);
          else {
            const ex = p.x + d[0] * half * sgn;
            const ey = p.y + d[1] * half * sgn;
            add(ex - d[1] * half, ey + d[0] * half);
            add(ex + d[1] * half, ey - d[0] * half);
          }
        }
      }
    }
  }
  if (!pts.length) return null;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

// Grow a layer's painted box by its effects (document pixels).
function withEffects(el, b) {
  if (!el.hasAttribute('data-sc-fx')) return b;
  const fx = readFx(el);
  let out = { ...b };
  const pad = (r, by) => ({ x1: r.x1 - by, y1: r.y1 - by, x2: r.x2 + by, y2: r.y2 + by });
  const union = (p, q) => ({
    x1: Math.min(p.x1, q.x1),
    y1: Math.min(p.y1, q.y1),
    x2: Math.max(p.x2, q.x2),
    y2: Math.max(p.y2, q.y2),
  });
  if (fx.bl.on) out = pad(out, fx.bl.r * 2);
  if (fx.og.on) out = union(out, pad(out, fx.og.s));
  if (fx.ds.on) {
    const t = (fx.ds.a * Math.PI) / 180;
    const dx = -Math.cos(t) * fx.ds.d;
    const dy = Math.sin(t) * fx.ds.d;
    const sh = { x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy };
    out = union(out, pad(sh, fx.ds.s));
  }
  return out;
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
    if (['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'].includes(n.localName))
      return n;
  return null;
}

// Element-local → document transform, through every enclosing group.
// Inside a <symbol> it stops at the symbol: its content is drawn in
// document coordinates, as an instance with no transform shows it.
function fullM(el) {
  let m = getM(el);
  for (let n = el.parentNode; n && n !== doc && n.localName !== 'symbol'; n = n.parentNode)
    m = getM(n).multiply(m);
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
    for (let a = el.parentNode; a && a !== doc; a = a.parentNode) if (els.includes(a)) return false;
    return true;
  });

// What a canvas click picks: the whole top-level item (Auto-Select: Group)
// or the exact shape under the cursor (Auto-Select: Layer), within the
// isolated group if there is one (src/scope.js).
function pickLayer(node) {
  if (state.autoSelect !== 'layer') return topIn(node);
  if (!inScope(node)) return null;
  const t = node.closest('text');
  return t && inScope(t) ? t : node;
}
const leafLayers = () =>
  [...doc.querySelectorAll('*')].filter(
    (el) =>
      !NON_GRAPHIC.has(el.localName) &&
      el.localName !== 'g' &&
      !el.parentNode.closest?.('text, defs, clipPath, mask, pattern, marker, symbol'),
  );
