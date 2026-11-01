// SVGCraft — A gradient's handles on the canvas: dragging them.
'use strict';

// The Move tool shows the active paint's gradient handles on a single
// selected shape (drawGradAnnotator) and hands a press on one here
// (src/tools.js): the round handle moves the start (a radial gradient's
// centre), the other the end (its radius). There's no Gradient tool of its
// own: setTool maps one remembered from before to Move.
tools.gradient = {
  down(e) {
    const h = e.target.closest?.('[data-grad-h]');
    const targets = gradTargets();
    if (!h || !targets.length || refuseLocked(targets, 'edit')) return;
    this.g = { k: h.dataset.gradH, el: targets[0] };
  },
  move(e, p) {
    const g = this.g;
    if (!g) return;
    const k = state.active;
    const model = state[k + 'Grad'];
    const ge = document.getElementById(paintRef(g.el, k));
    if (!ge || !model) return;
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
