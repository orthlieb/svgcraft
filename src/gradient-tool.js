// SVGCraft — A gradient's handles on the canvas (once the Gradient tool).
'use strict';

// ---- gradient handles ----------------------------------------------------------
// The Move tool hands a drag on a gradient's end handle here (src/tools.js);
// there's no Gradient tool of its own any more (setTool maps it to Move).
tools.gradient = {
  hint: 'Drag across the selection to lay the active paint’s gradient (Shift snaps to 45°; radial drags from the centre out) · Drag the end handles to adjust',
  cursor: 'crosshair',
  down(e, p) {
    const targets = gradTargets();
    if (!targets.length) return warn('Select the shapes to fill first.');
    if (refuseLocked(targets, 'edit')) return;
    const k = state.active;
    state[k + 'Pat'] = null;
    if (!state[k + 'Grad'] || !state[k + 'On']) {
      state[k + 'Grad'] = {
        type: state.gradType || 'linear',
        stops: GRAD_PRESETS.fade[1](state[k]),
        angle: 0,
      };
      state[k + 'On'] = true;
      state.gradStop = 0;
      syncStyleUI();
    }
    const h = e.target.closest?.('[data-grad-h]');
    this.g = h
      ? { mode: 'handle', k: h.dataset.gradH, el: targets[0] }
      : { mode: 'drag', p0: p, targets };
  },
  move(e, p) {
    const g = this.g;
    if (!g) return;
    const k = state.active;
    const model = state[k + 'Grad'];
    if (g.mode === 'handle') {
      const ge = document.getElementById(paintRef(g.el, k));
      if (!ge) return;
      // In the gradient's own space (see gradSpace).
      const sp = gradSpace(g.el, ge.hasAttribute('data-stretch'));
      const q = fullM(g.el).multiply(sp.toLocal).inverse().transformPoint(new DOMPoint(p.x, p.y));
      const geo = geoOf(ge);
      if (ge.localName === 'radialGradient') {
        if (g.k === 'a') Object.assign(geo, { cx: q.x, cy: q.y });
        else geo.r = Math.hypot(q.x - geo.cx, q.y - geo.cy);
      } else if (g.k === 'a') Object.assign(geo, { x1: q.x, y1: q.y });
      else Object.assign(geo, { x2: q.x, y2: q.y });
      writeGrad(ge, model, geo);
      layGrad(g.el, ge, sp);
      if (ge.localName === 'linearGradient')
        model.angle = Math.round((Math.atan2(-(geo.y2 - geo.y1), geo.x2 - geo.x1) * 180) / Math.PI);
      g.changed = true;
      drawSelection();
      return;
    }
    const q = e.shiftKey ? constrain45(g.p0, p) : p;
    if (dist(g.p0, q) * state.zoom < 3) return;
    for (const el of g.targets) {
      const inv = fullM(el).multiply(gradSpace(el, !!model.stretch).toLocal).inverse();
      const a = inv.transformPoint(new DOMPoint(g.p0.x, g.p0.y));
      const b = inv.transformPoint(new DOMPoint(q.x, q.y));
      setGradPaint(
        el,
        k,
        model,
        model.type === 'radial'
          ? { cx: a.x, cy: a.y, r: Math.hypot(b.x - a.x, b.y - a.y) }
          : { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
      );
      setPaintAttr(el, `${k}-opacity`, f(state[k + 'A']), 1);
    }
    if (model.type === 'linear')
      model.angle = Math.round((Math.atan2(-(q.y - g.p0.y), q.x - g.p0.x) * 180) / Math.PI);
    g.changed = true;
    drawSelection();
  },
  up() {
    const g = this.g;
    this.g = null;
    if (g?.changed) {
      commit();
      syncStyleUI();
    }
  },
};

tools.hand = {
  hint: 'Drag to pan · Ctrl/⌘ + wheel or pinch to zoom',
  cursor: 'grab',
};

// Zoom (Z), as in Photoshop: click steps in, Alt-click (or the options
// bar's Zoom Out) steps out. Scrubby Zoom: drag right to zoom in and left
// to zoom out about where you pressed. Without it, drag a box to fill the
// window with that area.
tools.zoom = {
  hint: 'Click to zoom in · Alt-click to zoom out · drag left / right to zoom',
  get cursor() {
    return state.zoomOut !== keysDown.alt ? 'zoom-out' : 'zoom-in';
  },
  down(e) {
    const r = stage.getBoundingClientRect();
    this.g = {
      sx: e.clientX,
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      p0: toDoc(e),
      z: state.zoom,
      out: state.zoomOut !== e.altKey,
      moved: false,
    };
  },
  move(e, p) {
    const g = this.g;
    if (!g) return;
    if (!g.moved && Math.abs(e.clientX - g.sx) < 3 && dist(g.p0, p) * state.zoom < 3) return;
    g.moved = true;
    if (state.scrubby) {
      zoomAt(g.z * Math.exp((e.clientX - g.sx) * 0.01), g.x, g.y);
      return;
    }
    guides.replaceChildren();
    mk(
      'rect',
      {
        x: Math.min(g.p0.x, p.x),
        y: Math.min(g.p0.y, p.y),
        width: Math.abs(p.x - g.p0.x),
        height: Math.abs(p.y - g.p0.y),
        class: 'sc-ov sc-ov-dash',
      },
      guides,
    );
  },
  up(e, p) {
    const g = this.g;
    this.g = null;
    guides.replaceChildren();
    if (!g) return;
    if (!g.moved) return zoomAt(zoomStep(state.zoom, g.out), g.x, g.y);
    if (state.scrubby) return;
    const w = Math.abs(p.x - g.p0.x);
    const h = Math.abs(p.y - g.p0.y);
    if (g.out || w * state.zoom < 4 || h * state.zoom < 4)
      return zoomAt(zoomStep(state.zoom, g.out), g.x, g.y);
    const r = stage.getBoundingClientRect();
    state.zoom = clamp(Math.min(r.width / w, r.height / h), 0.02, 64);
    state.panX = r.width / 2 - (Math.min(g.p0.x, p.x) + w / 2) * state.zoom;
    state.panY = r.height / 2 - (Math.min(g.p0.y, p.y) + h / 2) * state.zoom;
    applyView();
  },
  leave() {
    this.g = null;
    guides.replaceChildren();
  },
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
        if (el && !this.hits.has(el) && lockOf(el) !== 'all') {
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
