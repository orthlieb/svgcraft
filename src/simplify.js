// SVGCraft — Object → Path → Simplify…: fewer points and smoother outlines
// for paths with too many (a detailed Image Trace, a scan, a shaky hand).
'use strict';

// Each subpath of `subs` (shapeNodes' model, local units) simplified to
// within `tol` of its outline. The outline is sampled, thinned with
// Ramer–Douglas–Peucker, then given smooth handles, except where it turns
// by more than `corner` degrees (or everywhere, with `straight`), where the
// point stays a corner. With `specks`, closed subpaths smaller than about
// twice the tolerance go.
function simplifySubs(subs, tol, { corner = 60, straight = false, specks = true } = {}) {
  const out = [];
  for (const sp of subs) {
    const n = sp.nodes;
    if (n.length < 2) continue;
    // The outline as points: curves sampled finely enough for the tolerance.
    const pts = [];
    const segs = n.length - (sp.closed ? 0 : 1);
    for (let i = 0; i < segs; i++) {
      const a = n[i];
      const b = n[(i + 1) % n.length];
      pts.push({ x: a.x, y: a.y });
      if (a.hout || b.hin) {
        const len = dist(a, a.hout || a) + dist(a.hout || a, b.hin || b) + dist(b.hin || b, b);
        const steps = Math.min(64, Math.max(2, Math.ceil(len / Math.max(tol / 2, 0.01))));
        for (let k = 1; k < steps; k++) pts.push(bezierPt(a, b, k / steps));
      }
    }
    if (!sp.closed) pts.push({ x: n.at(-1).x, y: n.at(-1).y });
    if (sp.closed && specks) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < tol * 2)
        continue;
    }
    // Thin the points. A closed outline is cut in two at the point farthest
    // from its start, so both halves keep their ends.
    let keep;
    if (sp.closed) {
      let far = 0;
      let best = -1;
      pts.forEach((p, i) => {
        const d = dist(p, pts[0]);
        if (d > best) [best, far] = [d, i];
      });
      const a = rdp(pts.slice(0, far + 1), tol);
      const b = rdp([...pts.slice(far), pts[0]], tol);
      keep = [...a, ...b.slice(1, -1)];
      if (keep.length < 3) continue;
    } else keep = rdp(pts, tol);
    out.push({ closed: sp.closed, nodes: smoothNodes(keep, sp.closed, corner, straight) });
  }
  return out;
}

// Points → nodes: tangent handles a third of the way to each neighbour,
// except at corners (and an open line's ends).
function smoothNodes(pts, closed, corner, straight) {
  const N = pts.length;
  const lim = (corner * Math.PI) / 180;
  return pts.map((p, i) => {
    const prev = pts[i - 1] || (closed ? pts[N - 1] : null);
    const next = pts[i + 1] || (closed ? pts[0] : null);
    const nd = { x: fp(p.x), y: fp(p.y), hin: null, hout: null };
    if (straight || !prev || !next) return nd;
    const a = Math.atan2(p.y - prev.y, p.x - prev.x);
    const b = Math.atan2(next.y - p.y, next.x - p.x);
    const turn = Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (turn > lim) return nd;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    const li = dist(p, prev) / 3;
    const lo = dist(p, next) / 3;
    nd.hin = { x: fp(p.x - (tx / tl) * li), y: fp(p.y - (ty / tl) * li) };
    nd.hout = { x: fp(p.x + (tx / tl) * lo), y: fp(p.y + (ty / tl) * lo) };
    return nd;
  });
}

const countNodes = (subs) => subs.reduce((a, sp) => a + sp.nodes.length, 0);

// ---- the dialog: Amount, Corners, Straight lines, Remove specks, with a
// live preview and the point count. Cancel puts the drawing back; OK is one
// undo step.
const simpDlg = $('#sc-simplify');
const simp = { base: null, paths: [], items: [] };
const simpVal = (k) => simpDlg.querySelector(`[data-simp="${k}"] input`);
const simpOpts = () => ({
  // 0–100 → a tolerance of up to 10 document pixels, finer at the low end.
  tol: 0.05 + (+simpVal('amount').value / 100) ** 2 * 10,
  corner: +simpVal('corner').value,
  straight: simpDlg.querySelector('[data-simp-opt="straight"]').checked,
  specks: simpDlg.querySelector('[data-simp-opt="specks"]').checked,
});
// Paths, polygons and polylines in the selection (in groups too).
const SIMPLIFIABLE = 'path,polygon,polyline';
function simplifyPreview() {
  const o = simpOpts();
  const on = simpDlg.querySelector('[data-simp-preview]').checked;
  let before = 0;
  let after = 0;
  for (const it of simp.items) {
    // Measured in document pixels: the shape's own scale divides it.
    const m = fullM(it.el);
    const s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const subs = simplifySubs(it.subs, o.tol / s, o);
    before += countNodes(it.subs);
    after += countNodes(subs);
    it.next = subs;
    it.el.setAttribute('d', on ? nodesD(subs) || 'M0 0' : it.d);
  }
  simpDlg.querySelector('[data-simp-count]').textContent =
    `${before.toLocaleString()} points → ${after.toLocaleString()}`;
  drawSelection();
}
function openSimplify() {
  const els = shapesIn(state.sel, SIMPLIFIABLE);
  if (!els.length) return warn('Select a path, or a group of them, to simplify.');
  if (refuseLocked(state.sel, 'edit')) return;
  closeMenus();
  simp.base = snapshot();
  simp.paths = state.sel.map(treePath);
  // Polygons and polylines become paths (the outline gets curves); Cancel
  // puts them back with the rest.
  simp.items = els.map((el) => {
    const subs = shapeNodes(el);
    // Preview off shows a path's own data, as written.
    const own = el.localName === 'path' ? el.getAttribute('d') : null;
    const p = toPath(el);
    if (p !== el) state.sel = state.sel.map((s) => (s === el ? p : s));
    p.removeAttribute('data-rect');
    p.removeAttribute('data-radii');
    const d = own ?? nodesD(subs);
    p.setAttribute('d', d);
    return { el: p, subs, d };
  });
  simpDlg.querySelector('[data-simp-preview]').checked = true;
  showDialog(simpDlg, () => closeSimplify(false));
  simplifyPreview();
  setTimeout(() => simpDlg.querySelector('.sc-primary-btn').focus(), 0);
}
function closeSimplify(ok) {
  if (!simpDlg.open) return;
  hideDialog(simpDlg);
  if (!ok) {
    restore(simp.base, true);
    state.sel = simp.paths.map(fromTreePath).filter(Boolean);
    drawSelection();
    return;
  }
  const before = simp.items.reduce((a, it) => a + countNodes(it.subs), 0);
  let after = 0;
  for (const it of simp.items) {
    const subs = it.next || it.subs;
    after += countNodes(subs);
    // A path left with nothing (all specks) goes.
    if (!subs.length) {
      state.sel = state.sel.filter((s) => s !== it.el);
      it.el.remove();
    } else it.el.setAttribute('d', nodesD(subs));
  }
  commit();
  drawSelection();
  say(`Simplify: ${before.toLocaleString()} points → ${after.toLocaleString()}.`);
}
// A slider and its number move together; either previews (once a frame).
let simpFrame = 0;
const simpSchedule = () => {
  cancelAnimationFrame(simpFrame);
  simpFrame = requestAnimationFrame(simplifyPreview);
};
for (const row of simpDlg.querySelectorAll('[data-simp]')) {
  const [range, num] = row.querySelectorAll('input');
  for (const [from, to] of [
    [range, num],
    [num, range],
  ])
    from.addEventListener('input', () => {
      to.value = from.value;
      simpSchedule();
    });
}
for (const c of simpDlg.querySelectorAll('[data-simp-opt], [data-simp-preview]'))
  c.addEventListener('change', simplifyPreview);
simpDlg.querySelector('[data-simp-btn="ok"]').addEventListener('click', () => closeSimplify(true));
simpDlg
  .querySelector('[data-simp-btn="cancel"]')
  .addEventListener('click', () => closeSimplify(false));
simpDlg.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.closest('button')) return;
  e.preventDefault();
  closeSimplify(true);
});
