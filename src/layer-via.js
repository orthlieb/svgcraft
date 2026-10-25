// SVGCraft — Layer → New → Layer via Copy and Layer via Cut.
'use strict';

// Photoshop's Layer via Copy (Ctrl+J) and Layer via Cut (Ctrl+Shift+J) put
// the selected part of a layer on a new layer above it. Here the part is
// either the segments between points picked with Edit Points, or whole
// layers: Copy duplicates them in place, Cut lifts shapes picked inside a
// group out onto layers of their own, looking just the same.

const copyNode = (nd) => ({ ...nd, hin: nd.hin && { ...nd.hin }, hout: nd.hout && { ...nd.hout } });

// A node model split at its picked points: `take`, the segments with both
// ends picked (runs of them, open; a closed subpath picked all round stays
// closed), and `keep`, the rest. Where a run is taken out, the paths either
// side end at its end points, so the parts still meet there.
function splitAtPicked(subs, isPicked) {
  const take = [];
  const keep = [];
  subs.forEach((sp, si) => {
    const n = sp.nodes.length;
    const segs = [];
    for (let i = 0; i < n - 1; i++) segs.push([i, i + 1]);
    if (sp.closed && n > 1) segs.push([n - 1, 0]);
    const on = segs.map(([a, b]) => isPicked(si, a) && isPicked(si, b));
    const whole = { closed: sp.closed, nodes: sp.nodes.map(copyNode) };
    if (!on.includes(true)) return keep.push(whole);
    if (!on.includes(false)) return take.push(whole);
    // Walk the segments from a change of state, so no run wraps around.
    const k0 = sp.closed ? on.findIndex((v, k) => v !== on.at(k - 1)) : 0;
    let run = null;
    for (let m = 0; m < segs.length; m++) {
      const k = (k0 + m) % segs.length;
      if (run?.on !== on[k]) {
        run = { on: on[k], closed: false, nodes: [copyNode(sp.nodes[segs[k][0]])] };
        (on[k] ? take : keep).push(run);
      }
      run.nodes.push(copyNode(sp.nodes[segs[k][1]]));
    }
  });
  // An open run has no handle before its first point or after its last.
  for (const r of [...take, ...keep])
    if (!r.closed) {
      r.nodes[0].hin = null;
      r.nodes.at(-1).hout = null;
    }
  const clean = (list) => list.map(({ closed, nodes }) => ({ closed, nodes }));
  return { take: clean(take), keep: clean(keep) };
}

// With Edit Points: the picked part of its path, or null if no segment has
// both ends picked.
function pickedPart() {
  const t = tools.node;
  if (state.tool !== 'node' || !t.el || t.picked.length < 2) return null;
  const part = splitAtPicked(t.subs, (si, ni) => t.isPicked(si, ni));
  return part.take.length ? part : null;
}

// A new path drawn like `el` (its style, transform and effects), with the
// given node model.
function pathLike(el, subs) {
  const p = mk('path');
  const skip = ['id', 'd', 'data-name', 'data-rect', 'data-radii', 'data-sc-clipper'];
  for (const a of el.attributes)
    if (!SHAPE_GEOMETRY.includes(a.name) && !skip.includes(a.name)) p.setAttribute(a.name, a.value);
  // A line / polyline has no default fill; a path does.
  if (['line', 'polyline'].includes(el.localName) && !p.hasAttribute('fill'))
    p.setAttribute('fill', 'none');
  p.setAttribute('d', nodesD(subs));
  return p;
}

// The new layer, above the one it came from, ends up selected with the
// Move tool, as in Photoshop.
function selectNew(els) {
  setTool('select');
  state.sel = els;
  commit();
  readStyle(els[0]);
}

function layerViaCopy() {
  const part = pickedPart();
  if (part) {
    const el = tools.node.el;
    const p = pathLike(el, part.take);
    el.after(p);
    return selectNew([p]);
  }
  if (!state.sel.length) return say('Select layers, or points with Edit Points, to copy.');
  cmds.duplicate(0);
}

// Shapes picked inside a group that Layer via Cut can lift out (not the
// shape a clipping group clips with).
const liftable = () =>
  state.sel.filter(
    (el) => el.parentNode !== doc && doc.contains(el) && !el.hasAttribute('data-sc-clipper'),
  );

function layerViaCut() {
  const part = pickedPart();
  if (part) {
    const t = tools.node;
    const el = t.el;
    if (refuseLocked([el], 'edit')) return;
    const p = pathLike(el, part.take);
    el.after(p);
    if (part.keep.length) {
      t.subs = part.keep;
      t.picked = [];
      t.write();
    } else t.el.remove();
    return selectNew([p]);
  }
  const els = inDocOrder(liftable());
  if (!els.length)
    return say('Pick a shape inside a group (Auto-Select: Layer), or points with Edit Points.');
  if (refuseLocked(els, 'edit')) return;
  // Each goes just above the top-level layer it was in, in the same order.
  const after = new Map(els.map((el) => [el, topLevel(el).nextSibling]));
  for (const el of els) reparent(el, doc, after.get(el));
  selectNew(els);
  say(`Layer via Cut: ${els.length} layer${els.length > 1 ? 's' : ''} out of the group.`);
}
