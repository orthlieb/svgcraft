// SVGCraft — The drawing tools.
'use strict';

// ---------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------
const tools = {};

tools.select = {
  hint: 'Click to select · Shift-click adds · Ctrl/⌘-click picks inside a group · Drag to move · Handles scale (Shift keeps ratio, Alt from centre) · Arrows nudge · Double-click a group to work inside it, a shape to edit its points, or text to edit it',
  // The Move tool: the arrow with its four-way cross.
  cursor: cursorFor['move+move'],
  down(e, p) {
    // A gradient's end handles, shown on a shape painted with one: the
    // Gradient tool's handles, dragged with the Move tool.
    if (e.target.closest?.('[data-grad-h]')) {
      this.g = { mode: 'grad' };
      return tools.gradient.down(e, p);
    }
    // An animation's pivot (the ⊕ the Animation tab shows).
    if (e.target.closest?.('[data-anim-origin]') && animTarget()) {
      const el = animTarget();
      if (refuseLocked([el], 'edit')) return;
      this.g = { mode: 'pivot', el };
      return;
    }
    const ch = e.target.closest?.('[data-corner-h]');
    if (ch && cornerTarget()) {
      const el = cornerTarget();
      if (refuseLocked([el], 'edit')) return;
      noteStep('Corner Radius');
      this.g = {
        mode: 'corner',
        k: ch.dataset.cornerH,
        el,
        r0: getRadii(el),
        M: fullM(el),
        geo: rectGeom(el),
      };
      return;
    }
    const h = e.target.closest?.('[data-handle]');
    const box = selBox();
    // A Distort / Perspective corner.
    if (h && /^q\d$/.test(h.dataset.handle) && isQuadMode()) {
      this.g = {
        mode: 'quad',
        i: +h.dataset.handle[1],
        p0: p,
        q0: state.tf.quad.map((q) => ({ ...q })),
      };
      noteStep(state.tf.mode === 'perspective' ? 'Perspective' : 'Distort');
      return;
    }
    if (h && box) {
      if (refuseLocked(state.sel)) return;
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
      if (this.g.mode === 'scale') this.g.strokes = strokesOf(state.sel);
      noteStep({ rot: 'Rotate', skew: 'Skew', scale: 'Scale' }[this.g.mode]);
      // The pointer is captured by the stage: it keeps the circle arrow
      // while turning, wherever the handle goes.
      if (this.g.mode === 'rot') stage.style.cursor = cursorFor.rotate;
      return;
    }
    // Ctrl/⌘-click picks the exact shape, inside its groups.
    const deep = e.ctrlKey || e.metaKey;
    const el = pickLayer(e.target, deep);
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
      this.g = { mode: 'marquee', p0: p, base: e.shiftKey ? [...state.sel] : [], deep };
      if (!e.shiftKey) setSel([]);
      return;
    }
    // A locked layer stays selected but doesn't move.
    if (state.sel.some((x) => lockOf(x) || x.querySelector?.('[data-sc-lock]'))) {
      this.g = null;
      refuseLocked(state.sel);
      return;
    }
    this.g = { mode: 'move', p0: p, box: selBox(), m0: state.sel.map(getM) };
  },
  move(e, p) {
    const g = this.g;
    if (!g) return;
    if (g.mode === 'grad') return tools.gradient.move(e, p);
    if (g.mode === 'marquee') {
      const x = Math.min(g.p0.x, p.x);
      const y = Math.min(g.p0.y, p.y);
      const w = Math.abs(p.x - g.p0.x);
      const h = Math.abs(p.y - g.p0.y);
      guides.replaceChildren();
      marquee('rect', { x, y, width: w, height: h }, guides);
      const hit = (g.deep ? leafLayers().filter(inScope) : scopeItems()).filter((el) => {
        const b = el.getAttribute('display') !== 'none' && bboxDoc(el);
        return b && b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y;
      });
      state.sel = normalizeSel([...g.base, ...hit]);
      drawSelection();
      return;
    }
    if (g.mode === 'quad') {
      // The corner to where it's dragged (on the grid, with Snap).
      const c = g.q0[g.i];
      const to = snapPt({ x: c.x + p.x - g.p0.x, y: c.y + p.y - g.p0.y });
      state.tf.quad = dragQuad(g.q0, g.i, to.x - c.x, to.y - c.y, state.tf.mode === 'perspective');
      applyQuad();
      g.changed = true;
      drawSelection();
      return;
    }
    if (g.mode === 'pivot') {
      g.origin = pivotFrom(g.el, p);
      markPivot(pivotAt(g.el, g.origin));
      return;
    }
    if (g.mode === 'corner') {
      // Distance from the corner along its inward diagonal sets the radius.
      const q = g.M.inverse().transformPoint(new DOMPoint(p.x, p.y));
      const { x, y, w, h } = g.geo;
      const d = {
        tl: (q.x - x + (q.y - y)) / 2,
        tr: (x + w - q.x + (q.y - y)) / 2,
        br: (x + w - q.x + (y + h - q.y)) / 2,
        bl: (q.x - x + (y + h - q.y)) / 2,
      }[g.k];
      const rr = Math.round(clamp(d, 0, Math.min(w, h) / 2));
      const one = e.altKey || !state.radiusLinked;
      const next = one ? { ...g.r0, [g.k]: rr } : { tl: rr, tr: rr, br: rr, bl: rr };
      g.el = setRadii(g.el, next);
      g.changed = true;
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
      if (g.box) {
        const lockX = e.shiftKey && !dx;
        const lockY = e.shiftKey && !dy;
        ({ dx, dy } = snapBox(g.box, dx, dy));
        if (lockX) dx = 0;
        if (lockY) dy = 0;
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
    if (g.strokes) keepStrokes(g.strokes, T);
    syncPatterns(state.sel);
    syncGradients(state.sel);
    g.T = T;
    g.changed = true;
    drawSelection();
  },
  up() {
    const g = this.g;
    this.g = null;
    guides.replaceChildren();
    if (!g) return;
    if (g.mode === 'grad') return tools.gradient.up();
    if (g.mode === 'rot') stage.style.cursor = this.cursor;
    if (g.mode === 'marquee') setSel(state.sel);
    else if (g.mode === 'pivot') {
      if (g.origin) setPivot(g.origin);
    } else if (g.mode === 'corner') {
      if (g.changed) commit();
    } else if (g.changed) {
      if (state.tf && g.mode === 'rot') state.tf.angle += g.deg;
      if (state.tf && g.mode === 'skew')
        state.tf[g.k === 'n' || g.k === 's' ? 'skx' : 'sky'] += g.deg;
      noteTransform(g.T, g.box);
      // Outside a Free Transform (which keeps its own record of the
      // matrix), a scaled rectangle or ellipse takes its new size.
      if (g.strokes && !state.tf) for (const el of state.sel) bakeScale(el);
      commit();
    }
  },
  dblclick(e) {
    // Double-click the pivot: back to the centre.
    if (e.target.closest?.('[data-anim-origin]')) return setPivot(null);
    // Double-click an instance to edit its symbol; double-click outside
    // the symbol being edited to finish.
    const inst = doc.contains(e.target) ? e.target.closest('use') : null;
    if (inst && symbolOf(inst)) {
      enterIso(inst);
      return;
    }
    if (iso && !topLevel(e.target)) {
      exitIso();
      return;
    }
    // Double-click a group to work inside it; off the isolated group, to
    // step back out.
    const top = topIn(e.target);
    if (top?.localName === 'g') {
      enterScope(top);
      return;
    }
    if (scope && !top) {
      leaveScope();
      return;
    }
    const shape = editableFrom(e.target);
    if (shape) {
      setTool('node');
      tools.node.target(shape);
      return;
    }
    const el = doc.contains(e.target) ? e.target.closest('text') : null;
    if (el && inScope(el)) editTextLayer(el);
  },
  cancel() {
    if (this.g?.mode === 'rot') stage.style.cursor = this.cursor;
    this.g = null;
    guides.replaceChildren();
  },
};

// The Pencil's line, simplified as Object → Path → Simplify does: the
// points it was drawn through thinned to within Smoothing (screen pixels,
// so it feels the same at any zoom), then smooth curves through them,
// except where it turns by more than Corners, which stay sharp.
function pencilD(pts) {
  if (pts.length < 3) return smoothD(pts);
  const eps = (state.smoothing * 0.45) / state.zoom;
  const keep = state.smoothing ? rdp(pts, eps) : pts;
  if (keep.length < 3) return smoothD(keep);
  return nodesD([{ closed: false, nodes: smoothNodes(keep, false, state.pencilCorners, false) }]);
}

tools.pencil = {
  hint: 'Drag to draw freehand, simplified as you go · Smoothing and Corners are in the options bar',
  cursor: cursorFor.pencil,
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
    // Simplified as it's drawn (once a frame).
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.el?.setAttribute('d', pencilD(this.pts));
      });
  },
  up() {
    if (!this.el) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.el.setAttribute('d', pencilD(this.pts));
    this.el = null;
    commit();
  },
  cancel() {
    this.el?.remove();
    this.el = null;
  },
};

// The Pen draws new paths point by point. Over the selected shapes (or the
// path it drew or changed last) it also edits: an open path's end point
// carries the path on, a point on it is deleted, a line of it gets a new
// point. Shift draws a new path anyway.
tools.pen = {
  hint: 'Click for corners · Drag for curves · Click the first point to close · Enter or double-click finishes · Backspace removes the last point · Esc ends · On a selected path: click an end point to carry it on, a point to delete it, a line to add one (Shift for a new path)',
  // * to start a path, o to close it; on a selected path, / to carry it
  // on from an end, + to add a point, − to delete one.
  get cursor() {
    const pts = this.pts;
    if (!pts.length) {
      const h = this.hover;
      return cursorFor[
        h ? { cont: 'pen+cont', add: 'pen+add', del: 'pen+sub' }[h.kind] : 'pen+new'
      ];
    }
    const g = this.ghost;
    return cursorFor[g && this.closesAt(g) ? 'pen+close' : 'pen'];
  },
  pts: [],
  kept: [],
  // Edit the shapes that were selected when the Pen was picked.
  enter(prev) {
    this.keep(prev || []);
  },
  keep(els) {
    this.kept = pointShapes(els).map(treePath);
  },
  // The shapes the Pen edits: the selection (picked in Layers, say), or
  // those it kept.
  editable() {
    const els = state.sel.length
      ? pointShapes(state.sel)
      : this.kept.map(fromTreePath).filter((el) => el && EDITABLE.has(el.localName));
    return els.filter((el) => el.isConnected && lockOf(el) !== 'all');
  },
  // What the Pen would do at p, idle: carry on an open path from its end,
  // delete a point, or add one on a line. Nearest first, within a few
  // pixels.
  hoverAt(p) {
    const r = 6 / state.zoom;
    let best = null;
    const take = (h) => {
      if (h.d <= r && (!best || h.rank < best.rank || (h.rank === best.rank && h.d < best.d)))
        best = h;
    };
    for (const el of this.editable()) {
      const subs = shapeNodes(el);
      const M = fullM(el);
      const T = (q) => {
        const o = M.transformPoint(new DOMPoint(q.x, q.y));
        return { x: o.x, y: o.y };
      };
      subs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          const d = dist(T(n), p);
          const end =
            !sp.closed && sp.nodes.length >= 2 && (ni === 0 || ni === sp.nodes.length - 1);
          if (end) take({ kind: 'cont', el, si, first: ni === 0, d, rank: 0 });
          else take({ kind: 'del', el, si, ni, d, rank: 1 });
        }),
      );
      const s = nearestOnSubs(subs, T, p, false);
      if (s) take({ kind: 'add', el, seg: s, d: s.d, rank: 2 });
    }
    return best;
  },
  down(e, p) {
    const raw = p;
    p = snapPt(p);
    const pts = this.pts;
    if (!pts.length && !e.shiftKey) {
      const h = this.hoverAt(raw);
      if (h?.kind === 'del') return this.deletePoint(h);
      if (h?.kind === 'add') return this.addPoint(h);
      if (h?.kind === 'cont') return this.carryOn(h);
    }
    if (pts.length && e.shiftKey) p = constrain45(pts.at(-1), p);
    if (this.closesAt(p)) {
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
    if (!this.el && !this.cont) this.el = mk('path', newStyle('open'), doc);
    this.dragging = true;
    this.render();
  },
  // Would a click at p close the path: on its first point, or, carrying a
  // path on, on its other end.
  closesAt(p) {
    const pts = this.pts;
    const r = 8 / state.zoom;
    if (this.cont) return dist(p, this.cont.other) < r;
    return pts.length >= 2 && dist(p, pts[0]) < r;
  },
  // A shape's points, as a path (a line or polyline becomes one).
  asPath(el) {
    if (el.localName === 'path') return el;
    const p = toPath(el);
    state.sel = state.sel.map((x) => (x === el ? p : x));
    return p;
  },
  deletePoint(h) {
    const subs = shapeNodes(h.el);
    subs[h.si].nodes.splice(h.ni, 1);
    const left = subs.filter((sp) => sp.nodes.length >= 2);
    if (!left.length) {
      state.sel = state.sel.filter((x) => x !== h.el);
      h.el.remove();
      say('Point deleted, and with it the path.');
    } else {
      const el = this.asPath(h.el);
      el.removeAttribute('data-rect');
      el.removeAttribute('data-radii');
      el.setAttribute('d', nodesD(left));
      this.keep([el]);
    }
    this.hover = null;
    commit();
    this.redraw();
  },
  addPoint(h) {
    const subs = shapeNodes(h.el);
    insertNode(subs, h.seg);
    const el = this.asPath(h.el);
    el.removeAttribute('data-rect');
    el.removeAttribute('data-radii');
    el.setAttribute('d', nodesD(subs));
    this.keep([el]);
    this.hover = null;
    commit();
    this.redraw();
  },
  // Carry an open path on from an end: the Pen draws on from it, into the
  // same path, in its local coordinates; a drag from the end pulls out its
  // outgoing handle.
  carryOn(h) {
    const el = this.asPath(h.el);
    const subs = shapeNodes(el);
    const flip = (nodes) => nodes.map((n) => ({ ...n, hin: n.hout, hout: n.hin })).reverse();
    // Work as if from the last point; one carried on from the first is
    // turned round, and back again when written.
    if (h.first) subs[h.si].nodes = flip(subs[h.si].nodes);
    const M = fullM(el);
    const D = (q) => q && M.transformPoint(new DOMPoint(q.x, q.y));
    const nodes = subs[h.si].nodes;
    const end = nodes.at(-1);
    const xy = (q) => q && { x: q.x, y: q.y };
    this.cont = {
      el,
      d0: el.getAttribute('d'),
      subs,
      si: h.si,
      first: h.first,
      flip,
      Mi: M.inverse(),
      other: xy(D(nodes[0])),
    };
    this.pts = [{ ...xy(D(end)), hin: xy(D(end.hin)), hout: null, anchor: true }];
    this.lastDown = 0;
    this.dragging = true;
    this.hover = null;
    this.render();
  },
  // The carried-on path's points with the Pen's, in its local coordinates.
  contSubs(closed) {
    const c = this.cont;
    const L = (q) => {
      if (!q) return null;
      const o = c.Mi.transformPoint(new DOMPoint(q.x, q.y));
      return { x: o.x, y: o.y };
    };
    const own = c.subs[c.si].nodes;
    const added = this.pts.map((n) => ({ ...L(n), hin: L(n.hin), hout: L(n.hout) }));
    const end = { ...own.at(-1), hout: added[0].hout };
    let nodes = [...own.slice(0, -1), end, ...added.slice(1)];
    if (c.first) nodes = c.flip(nodes);
    return c.subs.map((sp, si) => (si === c.si ? { closed, nodes } : sp));
  },
  move(e, p) {
    if (this.dragging) {
      const a = this.pts.at(-1);
      if (dist(p, a) > 2 / state.zoom) {
        a.hout = { x: p.x, y: p.y };
        // The end a path is carried on from keeps its incoming handle.
        if (!a.anchor) a.hin = { x: 2 * a.x - p.x, y: 2 * a.y - p.y };
      }
    } else {
      this.ghost =
        this.pts.length && e.shiftKey ? constrain45(this.pts.at(-1), snapPt(p)) : snapPt(p);
      if (!this.pts.length) this.hover = e.shiftKey ? null : this.hoverAt(p);
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
    if (this.cont) this.cont.el.setAttribute('d', nodesD(this.contSubs(false)));
    else if (this.el) this.el.setAttribute('d', this.d(false));
    this.redraw();
  },
  redraw() {
    guides.replaceChildren();
    const pts = this.pts;
    const z = state.zoom;
    if (!pts.length) return this.drawEditable();
    const last = pts.at(-1);
    if (this.ghost && !this.dragging) {
      const c1 = last.hout || last;
      mk(
        'path',
        {
          d: `M${last.x} ${last.y}C${c1.x} ${c1.y} ${this.ghost.x} ${this.ghost.y} ${this.ghost.x} ${this.ghost.y}`,
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
    // The point a click closes the path on, filled in.
    const first = this.cont ? this.cont.other : pts[0];
    const marks = this.cont ? [first, ...pts] : pts;
    marks.forEach((a) => {
      const s = (a === first ? 9 : 7) / z;
      mk(
        'rect',
        {
          x: a.x - s / 2,
          y: a.y - s / 2,
          width: s,
          height: s,
          class: 'sc-anchor' + (a === first ? ' sc-anchor-first' : ''),
        },
        guides,
      );
    });
  },
  // Idle: the outline and points of the paths the Pen can edit, and what
  // a click would do under the pointer.
  drawEditable() {
    const z = state.zoom;
    for (const el of this.editable()) {
      const M = fullM(el);
      const T = (q) => q && M.transformPoint(new DOMPoint(q.x, q.y));
      const subs = shapeNodes(el).map((sp) => ({
        closed: sp.closed,
        nodes: sp.nodes.map((n) => ({ ...xyOf(T(n)), hin: xyOf(T(n.hin)), hout: xyOf(T(n.hout)) })),
      }));
      mk('path', { d: nodesD(subs), class: 'sc-ov' }, guides);
      const s = 6 / z;
      for (const sp of subs)
        for (const n of sp.nodes)
          mk(
            'rect',
            { x: n.x - s / 2, y: n.y - s / 2, width: s, height: s, class: 'sc-anchor' },
            guides,
          );
    }
    const h = this.hover;
    if (h && h.kind !== 'add') {
      const sp = shapeNodes(h.el)[h.si];
      const n = sp?.nodes[h.kind === 'cont' ? (h.first ? 0 : sp.nodes.length - 1) : h.ni];
      if (!n) return;
      const q = fullM(h.el).transformPoint(new DOMPoint(n.x, n.y));
      const s = 9 / z;
      mk(
        'rect',
        { x: q.x - s / 2, y: q.y - s / 2, width: s, height: s, class: 'sc-anchor sc-anchor-first' },
        guides,
      );
    }
  },
  finish(closed) {
    if (this.cont) {
      const c = this.cont;
      while (this.pts.length > 1 && dist(this.pts.at(-1), this.pts.at(-2)) < 1e-6) this.pts.pop();
      const same = !closed && this.pts.length < 2 && !this.pts[0]?.hout;
      if (same) c.el.setAttribute('d', c.d0);
      else c.el.setAttribute('d', nodesD(this.contSubs(closed)));
      this.keep([c.el]);
      this.reset();
      if (!same) commit();
      return;
    }
    const el = this.el;
    // A double-click lands two clicks on one spot — drop the duplicate.
    while (this.pts.length > 1 && dist(this.pts.at(-1), this.pts.at(-2)) < 1e-6) this.pts.pop();
    if (el && this.pts.length >= 2) {
      el.setAttribute('d', this.d(closed));
      if (closed) {
        for (const a of [...el.attributes]) if (a.name !== 'd') el.removeAttribute(a.name);
        for (const [k, v] of Object.entries(newStyle('shape'))) el.setAttribute(k, v);
      }
      this.keep([el]);
      this.reset();
      commit();
    } else this.cancel();
  },
  cancel() {
    if (this.cont) this.cont.el.setAttribute('d', this.cont.d0);
    else this.el?.remove();
    this.reset();
  },
  reset() {
    this.el = null;
    this.cont = null;
    this.pts = [];
    this.ghost = null;
    this.hover = null;
    this.dragging = false;
    this.redraw();
  },
  restored() {
    this.redraw();
  },
  key(e) {
    if (!this.pts.length) return false;
    if (e.key === 'Enter') this.finish(false);
    else if (e.key === 'Escape') this.finish(false);
    else if (e.key === 'Backspace' || e.key === 'Delete') {
      // The end a path is carried on from isn't the Pen's to take away.
      if (this.cont && this.pts.length === 1) this.cancel();
      else {
        this.pts.pop();
        if (!this.pts.length) this.cancel();
        else this.render();
      }
    } else return false;
    return true;
  },
  leave() {
    if (this.pts.length) this.finish(false);
    this.kept = [];
    guides.replaceChildren();
  },
};
const xyOf = (q) => q && { x: q.x, y: q.y };

// The Shape tools (src/shapes.js has the group, triangle, polygon and
// custom shape): drag a box, Shift for equal sides, Alt from the centre;
// a click without dragging asks for an exact size instead.
function shapeTool(kind, hint) {
  const tag = kind === 'triangle' || kind === 'polygon' ? 'polygon' : kind;
  return {
    hint,
    cursor: 'crosshair',
    down(e, p) {
      this.p0 = snapPt(p);
      this.el = mk(tag, newStyle(kind === 'line' ? 'line' : 'shape'), doc);
      if (kind === 'line') setArrows(this.el, state.arrows);
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
      if (tag === 'polygon') {
        writeShape(this.el, newShape(kind, { x, y, w: W, h: H }));
        return;
      }
      const attrs =
        kind === 'rect'
          ? { x, y, width: W, height: H }
          : { cx: x + W / 2, cy: y + H / 2, rx: W / 2, ry: H / 2 };
      for (const [k, v] of Object.entries(attrs)) this.el.setAttribute(k, f(v));
      if (kind === 'rect' && state.radius) {
        const r = Math.min(state.radius, W / 2, H / 2);
        this.el.setAttribute('rx', f(r));
        this.el.setAttribute('ry', f(r));
      }
    },
    up() {
      const el = this.el;
      this.el = null;
      if (!el) return;
      const b = bboxDoc(el);
      if (!b || (b.w * state.zoom < 2 && b.h * state.zoom < 2)) {
        el.remove();
        // A click: the Create box, for an exact size.
        if (kind !== 'line') openCreateShape(kind, this.p0);
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
  'Drag for a rectangle · Shift for a square · Alt draws from the centre · Click for an exact size',
);
tools.ellipse = shapeTool(
  'ellipse',
  'Drag for an ellipse · Shift for a circle · Alt draws from the centre · Click for an exact size',
);
tools.line = shapeTool('line', 'Drag for a line · Shift snaps to 45° · Alt draws from the centre');
tools.triangle = shapeTool(
  'triangle',
  'Drag for a triangle · Shift for equal sides · Alt draws from the centre · Click for an exact size',
);
tools.polygon = shapeTool(
  'polygon',
  'Drag for a polygon or star · Shift for equal sides · Alt draws from the centre · Click for an exact size',
);
