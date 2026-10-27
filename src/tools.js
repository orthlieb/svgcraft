// SVGCraft — The drawing tools.
'use strict';

// ---------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------
const tools = {};

tools.select = {
  hint: 'Click to select · Shift-click adds · Drag to move · Handles scale (Shift keeps ratio, Alt from centre) · Arrows nudge · Double-click a shape to edit its points, or text to edit it',
  // Photoshop's Move tool: the arrow with its four-way cross.
  cursor: cursorFor['move+move'],
  down(e, p) {
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
      noteStep({ rot: 'Rotate', skew: 'Skew', scale: 'Scale' }[this.g.mode]);
      // The pointer is captured by the stage: it keeps the circle arrow
      // while turning, wherever the handle goes.
      if (this.g.mode === 'rot') stage.style.cursor = cursorFor.rotate;
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
    g.T = T;
    g.changed = true;
    drawSelection();
  },
  up() {
    const g = this.g;
    this.g = null;
    guides.replaceChildren();
    if (!g) return;
    if (g.mode === 'rot') stage.style.cursor = this.cursor;
    if (g.mode === 'marquee') setSel(state.sel);
    else if (g.mode === 'corner') {
      if (g.changed) commit();
    } else if (g.changed) {
      if (state.tf && g.mode === 'rot') state.tf.angle += g.deg;
      if (state.tf && g.mode === 'skew')
        state.tf[g.k === 'n' || g.k === 's' ? 'skx' : 'sky'] += g.deg;
      noteTransform(g.T, g.box);
      commit();
    }
  },
  dblclick(e) {
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
    if (this.g?.mode === 'rot') stage.style.cursor = this.cursor;
    this.g = null;
    guides.replaceChildren();
  },
};

tools.pencil = {
  hint: 'Drag to draw freehand · Smoothing lives in the panel',
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
  // A * to start a path, an o over its first point to close it.
  get cursor() {
    const pts = this.pts;
    if (!pts.length) return cursorFor['pen+new'];
    const g = this.ghost;
    const closing = pts.length >= 2 && g && dist(g, pts[0]) < 8 / state.zoom;
    return cursorFor[closing ? 'pen+close' : 'pen'];
  },
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
      this.ghost =
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
    this.ghost = null;
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
        // A click: Photoshop's Create box, for an exact size.
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
