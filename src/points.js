// SVGCraft — Point editing (Edit Points).
'use strict';

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

// The shapes Direct Selection edits for `els`: each shape with points, and
// a group's shapes (visible, not locked), so picking a layer in Layers
// picks the shapes in it.
function pointShapes(els) {
  const ok = (el) =>
    EDITABLE.has(el.localName) &&
    lockOf(el) !== 'all' &&
    !el.closest('defs, clipPath, mask, pattern, symbol, marker, [display="none"]') &&
    el.checkVisibility?.() !== false;
  const out = [];
  for (const el of els)
    if (EDITABLE.has(el.localName)) out.push(el);
    else if (el.querySelectorAll)
      out.push(...[...el.querySelectorAll([...EDITABLE].join(','))].filter(ok));
  return [...new Set(out)];
}

// Direct Selection edits the points of one or more shapes, its targets:
// the layer picked in Layers (a group's shapes), or a shape clicked on the
// canvas. A marquee picks points on the targets wherever the drag starts;
// with "All objects" on, on every shape it takes in. Each picked point is
// [target, subpath, node].
tools.node = {
  hint: 'Drag round points to pick them · Click a shape to edit just it · Drag points or handles (Alt breaks a smooth point) · Double-click a line to add a point, a point to toggle corner / smooth · Del removes points · Esc ends',
  // Over a shape to pick up: Direct Selection's white arrow. Elsewhere the
  // marquee's: a cross, or the lasso; + with Shift, − with Alt. Point
  // Select has no marquee, so it keeps the arrow, with the same badges.
  get cursor() {
    const badge = keysDown.shift ? '+add' : keysDown.alt ? '+sub' : '';
    if (state.marquee === 'arrow' && this.el) return cursorFor['direct' + badge];
    if ((this.over && state.marquee === 'arrow') || (!this.el && state.marquee === 'arrow'))
      return cursorFor.direct;
    const lasso = state.marquee === 'lasso';
    return cursorFor[(lasso ? 'lasso' : 'cross') + badge];
  },
  targets: [],
  picked: [],
  // The shape the one-shape commands (Layer via Copy / Cut, the style
  // panels, snapping) work on: the one with the picked points, or the first.
  get main() {
    return this.picked[0]?.[0] || this.targets[0] || null;
  },
  get el() {
    return this.main?.el || null;
  },
  get subs() {
    return this.main?.subs || [];
  },
  set subs(v) {
    if (this.main) this.main.subs = v;
  },
  els() {
    return this.targets.map((t) => t.el);
  },
  // Edit the points of these shapes (state.sel becomes `sel`, by default
  // the shapes themselves).
  setTargets(shapes, sel = shapes) {
    this.targets = shapes.map((el) => ({ el, path: treePath(el), subs: shapeNodes(el) }));
    this.picked = [];
    state.sel = sel;
    if (sel[0]) readStyle(sel[0]);
    renderLayers();
    this.redraw();
  },
  // Edit one shape (a click on it), or none.
  target(el) {
    if (el && refuseLocked([el], 'edit')) el = null;
    if (el && !EDITABLE.has(el.localName)) {
      const inner = el.localName === 'g' ? pointShapes([el]) : [];
      if (inner.length) return this.setTargets(inner, [el]);
      warn(
        el.localName === 'g'
          ? 'This group has no shapes with points to edit.'
          : `A ${el.localName} has no points to edit.`,
      );
      el = null;
    }
    this.setTargets(el ? [el] : []);
  },
  // The layers picked in Layers (or with the Move tool before): their
  // shapes' points.
  fromSel(els) {
    if (els.some((el) => lockOf(el) === 'all')) refuseLocked(els, 'edit');
    this.setTargets(pointShapes(els), els);
  },
  // Re-find the targets after undo / redo replaced the DOM.
  restored() {
    const keep = [];
    for (const t of this.targets) {
      const el = fromTreePath(t.path);
      if (!el || !EDITABLE.has(el.localName)) continue;
      t.el = el;
      t.subs = shapeNodes(el);
      keep.push(t);
    }
    this.targets = keep;
    this.picked = this.picked.filter(([t, si, ni]) => keep.includes(t) && t.subs[si]?.nodes[ni]);
    if (keep.length && !state.sel.every((el) => el.isConnected)) state.sel = this.els();
    this.redraw();
  },
  M(t = this.main) {
    return fullM(t.el);
  },
  toLocal(p, t = this.main) {
    const q = this.M(t).inverse().transformPoint(new DOMPoint(p.x, p.y));
    return { x: q.x, y: q.y };
  },
  toDoc(p, t = this.main) {
    const q = this.M(t).transformPoint(new DOMPoint(p.x, p.y));
    return { x: q.x, y: q.y };
  },
  isPicked(si, ni, t = this.main) {
    return this.picked.some(([a, b, c]) => a === t && b === si && c === ni);
  },
  // The targets with picked points.
  pickedTargets() {
    return [...new Set(this.picked.map(([t]) => t))];
  },
  // Write the targets' node models back as path data (all, or those given).
  write(list = this.targets) {
    for (const t of list) {
      if (!t.el.isConnected) continue;
      if (t.el.localName !== 'path') {
        const was = t.el;
        t.el = toPath(t.el);
        state.sel = state.sel.map((s) => (s === was ? t.el : s));
      }
      t.el.removeAttribute('data-rect');
      t.el.removeAttribute('data-radii');
      t.el.setAttribute('d', nodesD(t.subs));
      t.path = treePath(t.el);
    }
    this.redraw();
  },
  redraw() {
    const layer = $('#sc-nodes');
    layer.replaceChildren();
    if (state.tool !== 'node') return;
    if (this.targets.some((t) => !t.el.isConnected)) {
      this.targets = this.targets.filter((t) => t.el.isConnected);
      this.picked = this.picked.filter(([t]) => this.targets.includes(t));
    }
    const z = state.zoom;
    const s = 10 / z;
    let total = 0;
    this.targets.forEach((t, ti) => {
      const m = this.M(t);
      const T = (p) => {
        const q = m.transformPoint(new DOMPoint(p.x, p.y));
        return { x: q.x, y: q.y };
      };
      const docSubs = t.subs.map((sp) => ({
        closed: sp.closed,
        nodes: sp.nodes.map((n) => ({
          ...T(n),
          hin: n.hin && T(n.hin),
          hout: n.hout && T(n.hout),
        })),
      }));
      mk('path', { d: nodesD(docSubs), class: 'sc-ov' }, layer);
      docSubs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          if (!this.isPicked(si, ni, t)) return;
          for (const which of ['hin', 'hout']) {
            const h = n[which];
            if (!h) continue;
            mk('line', { x1: n.x, y1: n.y, x2: h.x, y2: h.y, class: 'sc-ov' }, layer);
            mk(
              'circle',
              {
                cx: h.x,
                cy: h.y,
                r: 4 / z,
                class: 'sc-hnd',
                'data-hnd': `${ti}:${si}:${ni}:${which}`,
              },
              layer,
            );
          }
        }),
      );
      docSubs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          total++;
          const on = this.isPicked(si, ni, t);
          const attrs = {
            class: 'sc-node' + (on ? ' on' : ''),
            'data-node': `${ti}:${si}:${ni}`,
          };
          if (isSmooth(t.subs[si].nodes[ni]))
            mk('circle', { cx: n.x, cy: n.y, r: s / 1.7, ...attrs }, layer);
          else mk('rect', { x: n.x - s / 2, y: n.y - s / 2, width: s, height: s, ...attrs }, layer);
        }),
      );
    });
    $('#sc-pos').dataset.sel = this.targets.length
      ? `${this.picked.length} of ${total} points selected`
      : '';
  },
  // Show which markers are picked, without drawing them again (handles
  // follow at the end of the drag).
  markPicked() {
    const on = new Set(this.picked.map(([t, si, ni]) => `${this.targets.indexOf(t)}:${si}:${ni}`));
    for (const n of $('#sc-nodes').querySelectorAll('[data-node]'))
      n.classList.toggle('on', on.has(n.dataset.node));
    let total = 0;
    for (const t of this.targets) for (const sp of t.subs) total += sp.nodes.length;
    $('#sc-pos').dataset.sel = `${this.picked.length} of ${total} points selected`;
  },
  // [target, subpath, node] from a data-node or data-hnd value.
  ref(v) {
    const [ti, si, ni, which] = v.split(':');
    return [this.targets[+ti], +si, +ni, which];
  },
  down(e, p) {
    const hnd = e.target.closest?.('[data-hnd]');
    const node = e.target.closest?.('[data-node]');
    if (hnd) {
      const [t, si, ni, which] = this.ref(hnd.dataset.hnd);
      const nd = t.subs[si].nodes[ni];
      this.g = { mode: 'handle', t, nd, which, smooth: isSmooth(nd) };
      return;
    }
    if (node) {
      const [t, si, ni] = this.ref(node.dataset.node);
      const same = ([a, b, c]) => a === t && b === si && c === ni;
      // Shift-click adds the point to the pick, Alt-click takes it away.
      if (e.shiftKey || e.altKey) {
        const rest = this.picked.filter((k) => !same(k));
        this.picked = e.altKey ? rest : [...rest, [t, si, ni]];
        this.redraw();
        this.g = null;
        return;
      }
      if (!this.picked.some(same)) this.picked = [[t, si, ni]];
      this.g = {
        mode: 'move',
        p0: p,
        orig: new Map(this.targets.map((x) => [x, clone(x.subs)])),
        lead: this.toDoc(t.subs[si].nodes[ni], t),
      };
      this.redraw();
      return;
    }
    const hit = editableFrom(e.target) || topIn(e.target);
    const el = inScope(hit) ? hit : null;
    // A click on a shape edits just it, unless it is already the one shape
    // being edited.
    const only = this.targets.length === 1 && this.targets[0].el === editableFrom(e.target);
    const mine = !!el && only;
    // Point Select (no marquee): a click on another shape edits it; off the
    // points, a click clears the pick (Shift or Alt keeps it).
    if (state.marquee === 'arrow') {
      this.g = null;
      if (el && !mine) {
        this.target(el);
        this.targetedAt = e.timeStamp;
        return;
      }
      if (!e.shiftKey && !e.altKey && this.picked.length) {
        this.picked = [];
        this.redraw();
      }
      return;
    }
    // A marquee, wherever the drag starts. A click (no drag) on another
    // shape edits that shape instead (see up()).
    const cut = e.altKey;
    const keep = cut || e.shiftKey;
    this.g = {
      mode: 'marquee',
      p0: p,
      pts: [p],
      cut,
      base: keep ? [...this.picked] : [],
      // A click without a drag on another shape: edit it.
      clickOn: el && !mine ? el : null,
      // No shape to edit and "All objects" off: the marquee edits the
      // topmost shape it takes points of (see within()).
      free: !this.targets.length && !state.pointsAll,
    };
  },
  move(e, p) {
    const g = this.g;
    if (!g) {
      const hit = editableFrom(e.target) || topIn(e.target);
      const el = inScope(hit) ? hit : null;
      this.over =
        !!el && !(this.targets.length === 1 && this.targets[0].el === editableFrom(e.target));
    }
    if (!g) return;
    if (g.mode === 'marquee') {
      // Not a drag until it has gone a few pixels: a click on another shape
      // edits it.
      if (!g.dragging) {
        if (Math.hypot(p.x - g.p0.x, p.y - g.p0.y) * state.zoom < 4) return;
        g.dragging = true;
        if (!g.cut && !e.shiftKey) {
          this.picked = [];
          this.redraw();
        }
      }
      // A rectangle or an oval (the options bar), corner to corner, or from
      // its centre with Alt, as the usual marquees; or freeform, a lasso
      // drawn round the points.
      guides.replaceChildren();
      let inside;
      if (state.marquee === 'lasso') {
        const pts = g.pts;
        pts.push(p);
        marquee('polygon', { points: pts.map((q) => `${q.x},${q.y}`).join(' ') }, guides);
        // Even-odd: a ray from the point crosses the outline an odd number of times.
        inside = (q) => {
          let odd = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i];
            const b = pts[j];
            if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x)
              odd = !odd;
          }
          return odd;
        };
      } else {
        const dx = Math.abs(p.x - g.p0.x);
        const dy = Math.abs(p.y - g.p0.y);
        // Alt pressed during the drag draws from the centre; the Alt that
        // began a cut has to be let go of first.
        if (g.cut && !e.altKey) g.altFree = true;
        const [x, y, w, h] =
          e.altKey && (!g.cut || g.altFree)
            ? [g.p0.x - dx, g.p0.y - dy, 2 * dx, 2 * dy]
            : [Math.min(g.p0.x, p.x), Math.min(g.p0.y, p.y), dx, dy];
        const oval = state.marquee === 'oval';
        if (oval)
          marquee('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }, guides);
        else marquee('rect', { x, y, width: w, height: h }, guides);
        inside = (q) =>
          oval
            ? w > 0 &&
              h > 0 &&
              ((q.x - x - w / 2) / (w / 2)) ** 2 + ((q.y - y - h / 2) / (h / 2)) ** 2 <= 1
            : q.x >= x && q.x <= x + w && q.y >= y && q.y <= y + h;
      }
      if (g.free) {
        const el = this.within(inside);
        if (el !== this.targets[0]?.el) this.target(el);
        if (!el) return;
      } else if (state.pointsAll) {
        // Every shape the marquee takes points of becomes a target too (and
        // stays one for this drag), beside those with points already picked.
        for (const c of this.cands())
          if (!this.els().includes(c.el) && c.pts.some(inside)) {
            this.targets.push({ el: c.el, path: treePath(c.el), subs: shapeNodes(c.el) });
            g.grown = true;
          }
      }
      // The targets' points in document space, worked out once a drag.
      g.docPts ||= new Map();
      const hit = [];
      for (const t of this.targets) {
        if (!g.docPts.has(t)) {
          const m = this.M(t);
          g.docPts.set(
            t,
            t.subs.map((sp) => sp.nodes.map((n) => new DOMPoint(n.x, n.y).matrixTransform(m))),
          );
        }
        g.docPts.get(t).forEach((sp, si) =>
          sp.forEach((q, ni) => {
            if (inside(q)) hit.push([t, si, ni]);
          }),
        );
      }
      const key = ([t, si, ni]) => `${this.targets.indexOf(t)}:${si}:${ni}`;
      const base = new Set(g.base.map(key));
      const hits = new Set(hit.map(key));
      if (g.cut) this.picked = g.base.filter((k) => !hits.has(key(k)));
      else this.picked = [...g.base, ...hit.filter((h) => !base.has(key(h)))];
      if (state.pointsAll) state.sel = this.pickedTargets().map((t) => t.el);
      // New shapes taken in need their markers drawn; otherwise just mark
      // the picked ones (drawing thousands of markers each move is slow).
      if (g.grown) {
        g.grown = false;
        this.redraw();
      } else this.markPicked();
      return;
    }
    if (g.mode === 'handle') {
      const nd = g.nd;
      const h = this.toLocal(p, g.t);
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
      this.write([g.t]);
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
    this.write(this.pickedTargets());
  },
  // Offset picked points (and their handles) by a doc-space vector; `from`
  // maps each target to its nodes before the move.
  shift(from, dx, dy) {
    for (const t of this.pickedTargets()) {
      const inv = this.M(t).inverse();
      const o = inv.transformPoint(new DOMPoint(0, 0));
      const v = inv.transformPoint(new DOMPoint(dx, dy));
      const lx = v.x - o.x;
      const ly = v.y - o.y;
      const add = (q) => q && { x: q.x + lx, y: q.y + ly };
      const src0 = from.get(t);
      for (const [pt, si, ni] of this.picked) {
        if (pt !== t) continue;
        const src = src0[si].nodes[ni];
        const dst = t.subs[si].nodes[ni];
        dst.x = src.x + lx;
        dst.y = src.y + ly;
        dst.hin = add(src.hin);
        dst.hout = add(src.hout);
      }
    }
  },
  // Every shape a marquee can take points of, topmost first, with its
  // points in document space; read once per drag.
  cands() {
    const g = this.g;
    g.cands ||= [...scopeRoot().querySelectorAll([...EDITABLE].join(','))]
      .reverse()
      .filter(
        (el) => !el.closest('[data-sc-lock], [display="none"], defs, clipPath, mask, pattern'),
      )
      .filter((el) => el.checkVisibility())
      .map((el) => {
        const M = fullM(el);
        const pts = shapeNodes(el).flatMap((sp) =>
          sp.nodes.map((n) => new DOMPoint(n.x, n.y).matrixTransform(M)),
        );
        return { el, pts };
      });
    return g.cands;
  },
  // The topmost shape that can be edited with a point inside the marquee
  // (`inside` tests a document point), or null.
  within(inside) {
    return this.cands().find((c) => c.pts.some(inside))?.el || null;
  },
  up(e) {
    const g = this.g;
    this.g = null;
    guides.replaceChildren();
    if (g?.mode === 'marquee' && g.dragging) this.redraw();
    if (g?.mode === 'marquee' && !g.dragging) {
      // A click: on another shape, edit it; elsewhere, clear the pick.
      if (g.clickOn) {
        this.target(g.clickOn);
        this.targetedAt = e?.timeStamp ?? performance.now();
      } else if (!g.base.length && this.picked.length) {
        this.picked = [];
        this.redraw();
      }
      return;
    }
    if (g?.changed) commit();
  },
  dblclick(e) {
    if (!this.targets.length) return;
    const node = e.target.closest?.('[data-node]');
    if (node) {
      const [t, si, ni] = this.ref(node.dataset.node);
      this.picked = [[t, si, ni]];
      const nd = t.subs[si].nodes[ni];
      this.setKind(nd.hin || nd.hout ? 'corner' : 'smooth');
      return;
    }
    // The first click of this double-click picked the shape; don't also add a point.
    const t = this.targets.find((x) => x.el === editableFrom(e.target));
    if (!t || e.timeStamp - (this.targetedAt ?? -1e9) < 500) return;
    this.insertAt(this.toLocal(toDoc(e), t), t);
  },
  // Split the segment of target t nearest q (its local coords) with a new point.
  insertAt(q, t = this.main) {
    let best = null;
    for (const s of segments(t.subs)) {
      const a = t.subs[s.si].nodes[s.i];
      const b = t.subs[s.si].nodes[s.j];
      for (let k = 1; k < 64; k++) {
        const u = k / 64;
        const d = dist(bezierPt(a, b, u), q);
        if (!best || d < best.d) best = { ...s, t: u, d };
      }
    }
    if (!best) return;
    const sp = t.subs[best.si];
    const a = sp.nodes[best.i];
    const b = sp.nodes[best.j];
    const u = best.t;
    let nd;
    if (!a.hout && !b.hin) nd = { ...lerp(a, b, u), hin: null, hout: null };
    else {
      const p1 = a.hout || a;
      const p2 = b.hin || b;
      const q0 = lerp(a, p1, u);
      const q1 = lerp(p1, p2, u);
      const q2 = lerp(p2, b, u);
      const r0 = lerp(q0, q1, u);
      const r1 = lerp(q1, q2, u);
      nd = { ...lerp(r0, r1, u), hin: r0, hout: r1 };
      a.hout = q0;
      b.hin = q2;
    }
    const at = best.j === 0 ? sp.nodes.length : best.j;
    sp.nodes.splice(at, 0, nd);
    this.picked = [[t, best.si, at]];
    this.write([t]);
    commit();
  },
  // 'corner' retracts handles; 'smooth' grows tangent handles from the neighbours.
  setKind(kind) {
    if (!this.picked.length) return warn('Select a point first.');
    for (const [t, si, ni] of this.picked) {
      const sp = t.subs[si];
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
    this.write(this.pickedTargets());
    commit();
  },
  removePicked() {
    if (!this.picked.length) return;
    const hit = this.pickedTargets();
    for (const t of hit) {
      const kill = new Set(this.picked.filter(([x]) => x === t).map(([, a, b]) => `${a}:${b}`));
      t.subs = t.subs
        .map((sp, si) => ({ ...sp, nodes: sp.nodes.filter((_, ni) => !kill.has(`${si}:${ni}`)) }))
        .filter((sp) => sp.nodes.length >= 2);
    }
    this.picked = [];
    const gone = hit.filter((t) => !t.subs.length);
    for (const t of gone) t.el.remove();
    this.targets = this.targets.filter((t) => !gone.includes(t));
    state.sel = state.sel.filter((el) => el.isConnected);
    this.write(hit.filter((t) => !gone.includes(t)));
    commit();
  },
  toggleClosed() {
    if (!this.targets.length) return;
    const by = this.picked.length
      ? this.picked.map(([t, si]) => [t, si])
      : this.targets.map((t) => [t, 0]);
    const seen = new Set();
    for (const [t, si] of by) {
      const k = `${this.targets.indexOf(t)}:${si}`;
      if (seen.has(k) || !t.subs[si]) continue;
      seen.add(k);
      t.subs[si].closed = !t.subs[si].closed;
    }
    this.write([...new Set(by.map(([t]) => t))]);
    commit();
  },
  key(e) {
    if (!this.targets.length) return false;
    const k = e.key;
    const arrows = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (k === 'Delete' || k === 'Backspace') this.removePicked();
    else if (k === 'Escape' || k === 'Enter') {
      const sel = state.sel.filter((el) => el.isConnected);
      setTool('select');
      setSel(sel.length ? sel : this.els());
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') {
      this.picked = this.targets.flatMap((t) =>
        t.subs.flatMap((sp, si) => sp.nodes.map((_, ni) => [t, si, ni])),
      );
      this.redraw();
    } else if (arrows[k] && this.picked.length && !e.ctrlKey && !e.metaKey) {
      const s = e.shiftKey ? 10 : 1;
      this.shift(
        new Map(this.targets.map((t) => [t, clone(t.subs)])),
        arrows[k][0] * s,
        arrows[k][1] * s,
      );
      this.write(this.pickedTargets());
      commit();
    } else return false;
    return true;
  },
  enter(prev) {
    this.fromSel(prev);
  },
  leave() {
    this.g = null;
    this.targets = [];
    this.picked = [];
    $('#sc-nodes').replaceChildren();
  },
  cancel() {
    this.g = null;
    guides.replaceChildren();
  },
};
