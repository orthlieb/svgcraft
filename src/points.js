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

tools.node = {
  hint: 'Click a shape to edit its points · Drag points or handles (Alt breaks a smooth point) · Double-click a line to add a point, a point to toggle corner / smooth · Del removes points · Esc ends',
  // Over a shape to pick up: Direct Selection's white arrow. Elsewhere the
  // marquee's: a cross, or the lasso; + with Shift, − with Alt.
  get cursor() {
    if (this.over || !this.el) return cursorFor.direct;
    const lasso = state.marquee === 'lasso';
    const badge = keysDown.shift ? '+add' : keysDown.alt ? '+sub' : '';
    return cursorFor[(lasso ? 'lasso' : 'cross') + badge];
  },
  el: null,
  subs: [],
  picked: [],
  target(el) {
    if (el && refuseLocked([el], 'edit')) el = null;
    if (el && !EDITABLE.has(el.localName)) {
      warn(
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
    this.el.removeAttribute('data-rect');
    this.el.removeAttribute('data-radii');
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
    // As in Photoshop, a drag begun with Alt takes points away from what's
    // picked, and one begun with Shift adds to it.
    const cut = e.altKey;
    const keep = cut || e.shiftKey;
    this.g = { mode: 'marquee', p0: p, pts: [p], cut, base: keep ? [...this.picked] : [] };
    if (!keep) {
      this.picked = [];
      this.redraw();
    }
  },
  move(e, p) {
    const g = this.g;
    if (!g) {
      const el = editableFrom(e.target) || topLevel(e.target);
      this.over = !!el && el !== this.el;
    }
    if (!g || !this.el) return;
    if (g.mode === 'marquee') {
      // A rectangle or an oval (the options bar), corner to corner, or from
      // its centre with Alt, as Photoshop's marquees; or freeform, a lasso
      // drawn round the points.
      const cls = 'sc-ov sc-ov-fill sc-ov-dash';
      guides.replaceChildren();
      let inside;
      if (state.marquee === 'lasso') {
        const pts = g.pts;
        pts.push(p);
        mk('polygon', { points: pts.map((q) => `${q.x},${q.y}`).join(' '), class: cls }, guides);
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
          mk('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, class: cls }, guides);
        else mk('rect', { x, y, width: w, height: h, class: cls }, guides);
        inside = (q) =>
          oval
            ? w > 0 &&
              h > 0 &&
              ((q.x - x - w / 2) / (w / 2)) ** 2 + ((q.y - y - h / 2) / (h / 2)) ** 2 <= 1
            : q.x >= x && q.x <= x + w && q.y >= y && q.y <= y + h;
      }
      const hit = [];
      this.subs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          if (inside(this.toDoc(n))) hit.push([si, ni]);
        }),
      );
      const key = ([a, b]) => `${a}:${b}`;
      const seen = new Set(g.base.map(key));
      if (g.cut) {
        const gone = new Set(hit.map(key));
        this.picked = g.base.filter((k) => !gone.has(key(k)));
      } else this.picked = [...g.base, ...hit.filter((k) => !seen.has(key(k)))];
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
    if (editableFrom(e.target) !== this.el || e.timeStamp - (this.targetedAt ?? -1e9) < 500) return;
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
    if (!this.el || !this.picked.length) return warn('Select a point first.');
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
