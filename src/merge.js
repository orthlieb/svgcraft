// SVGCraft — Layer → Merge Down / Merge Layers / Merge Group, Merge Visible.
'use strict';

// Photoshop's merges bake layers into one layer of pixels. Here the layers
// stay vectors and nothing on screen changes:
// - shapes alike in every way that shows (fill, stroke, opacity, dashes…)
//   become one path: side by side, their outlines are simply joined;
//   overlapping, they're united, which only looks the same for opaque
//   fills with no stroke;
// - anything else (other styles, overlapping strokes or see-through
//   colours, text, images, effects, animations) becomes one group, with
//   the alike shapes in it joined the same way: three red shapes and a
//   blue one become a group of one red path and the blue shape. A shape
//   only joins others lower down when nothing between them overlaps it,
//   so the stacking, and the picture, stay as they were.
// The merged layer takes the place of the topmost one and, as in
// Photoshop, Merge Down keeps the lower layer's name, the others the
// topmost's.

// What a shape looks like, apart from where it is.
const MERGE_STYLE = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'mix-blend-mode',
  'filter',
  'clip-path',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'paint-order',
  'visibility',
  'display',
  'vector-effect',
];
const MERGE_KEEP_APART = [
  'data-sc-fx',
  'data-sc-anim',
  'data-sc-stroke-align',
  'data-sc-clipper',
  'data-sc-lock',
  'data-sc-textpath',
];
function mergeStyle(el) {
  const cs = getComputedStyle(el);
  return MERGE_STYLE.map((k) => cs.getPropertyValue(k)).join('|');
}
const mergeable = (el) =>
  el.matches(BOOL_SHAPES) && !MERGE_KEEP_APART.some((a) => el.hasAttribute(a));

// The shapes to join, or null when they can't be one path without looking
// different.
function mergePlan(leaves) {
  if (leaves.length < 2 || !leaves.every(mergeable)) return null;
  const style = mergeStyle(leaves[0]);
  if (!leaves.every((el) => mergeStyle(el) === style)) return null;
  const cs = getComputedStyle(leaves[0]);
  const stroked = cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0;
  // A stroke is drawn in its shape's own space: kept only when all share
  // one scale and rotation (then the path takes that space).
  const L = fullM(leaves[0]);
  const sameLinear = (M) => ['a', 'b', 'c', 'd'].every((k) => Math.abs(M[k] - L[k]) < 1e-6);
  if (stroked && !leaves.every((el) => sameLinear(fullM(el)))) return null;
  const boxes = leaves.map((el) => bboxDoc(el, fullM(el)));
  const overlap = boxes.some((a, i) => boxes.slice(i + 1).some((b) => boxesMeet(a, b)));
  const solid = parseFloat(cs.opacity) * parseFloat(cs.fillOpacity) >= 1;
  if (overlap && (stroked || !solid || cs.fill === 'none')) return null;
  return { unite: overlap };
}

// Shapes (in document order) sorted into runs that can each be one path:
// a shape joins the nearest run below it that looks the same, if no
// layer between them overlaps it (it moves down to that run's place).
function alikeRuns(els) {
  const runs = [];
  for (const el of els) {
    const style = mergeable(el) ? mergeStyle(el) : null;
    const box = bboxDoc(el, fullM(el));
    let home = null;
    for (let i = runs.length - 1; i >= 0 && style; i--) {
      const r = runs[i];
      if (r.style === style && mergePlan([...r.els, el])) {
        home = r;
        break;
      }
      if (r.boxes.some((b) => b && box && boxesMeet(b, box))) break;
    }
    if (home) {
      home.els.push(el);
      home.boxes.push(box);
    } else runs.push({ style, els: [el], boxes: [box] });
  }
  return runs.map((r) => r.els);
}
// One path drawing alike shapes `leaves` (in document order), put after
// `after`; plan from mergePlan.
function joinShapes(P, leaves, plan, after) {
  const bottom = leaves[0];
  // The path's own space: the bottom shape's, from where the top one sits.
  const local = fullM(bottom);
  const inv = local.inverse();
  const T = new P.Matrix(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f);
  const rule = getComputedStyle(bottom).fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  let joined = null;
  for (const el of leaves) {
    const it = new P.CompoundPath({ pathData: docPathData(el), fillRule: rule, insert: false });
    if (!joined) joined = it;
    else if (plan.unite) joined = joined.unite(it, { insert: false });
    else joined.addChildren(it.removeChildren());
  }
  joined.transform(T);
  const made = pathLike(bottom, []);
  bakeInherited(bottom, made);
  made.setAttribute('d', joined.pathData);
  after.after(made);
  setM(made, parentM(made).inverse().multiply(local));
  return made;
}

// Merge `els` (in document order) into one layer where the topmost is.
async function mergeInto(els, name) {
  if (refuseLocked(els, 'edit')) return;
  const top = els.at(-1);
  // Shapes, or a group's shapes for Merge Group.
  const single = els.length === 1 && els[0].localName === 'g';
  const leaves = single ? [...els[0].querySelectorAll('*')].filter(selectable) : els;
  const plan = (!single || dissolvable(els[0])) && mergePlan(leaves);
  // Not all alike: the alike ones joined in a group (in Merge Group, only
  // when its layers are its own children, so nothing nested moves).
  const sorted =
    plan || (single && !leaves.every((el) => el.parentNode === els[0])) ? null : alikeRuns(leaves);
  const runs = sorted?.some((r) => r.length > 1) ? sorted : null;
  let P = null;
  if (plan || runs) {
    try {
      P = await loadPaper();
    } catch {
      return warn('Couldn’t load the shape engine (vendor/paper-core.min.js).');
    }
  }
  let made;
  if (plan) {
    made = joinShapes(P, leaves, plan, top);
    for (const el of els) el.remove();
  } else {
    if (single && !runs)
      return say('This group’s layers can’t become one path; it stays as it is.');
    made = single ? els[0] : mk('g');
    if (!single) top.after(made);
    for (const run of runs || leaves.map((el) => [el])) {
      if (run.length > 1) {
        const p = joinShapes(P, run, mergePlan(run), run.at(-1));
        made.append(p);
        for (const el of run) el.remove();
      } else reparent(run[0], made);
    }
  }
  if (name) made.setAttribute('data-name', name);
  else made.removeAttribute('data-name');
  state.sel = [made];
  commit();
  readStyle(made);
  const joined = runs ? runs.filter((r) => r.length > 1).length : 0;
  say(
    plan
      ? `Merged ${leaves.length} shapes into one path.`
      : joined
        ? `Merged ${leaves.length} layers into a group of ${runs.length}: the alike shapes are joined into ${joined === 1 ? 'one path' : `${joined} paths`}.`
        : `Merged ${els.length} layers into one group: none could join without changing how it looks.`,
  );
}

// The selected layer and the one below it (Ctrl+E with one layer).
const layerBelow = (el) => {
  let n = el?.previousElementSibling;
  while (n && !selectable(n)) n = n.previousElementSibling;
  return n;
};
const mergeTargets = () => {
  const sel = normalizeSel(state.sel);
  if (sel.length > 1) return { kind: 'layers', els: sel };
  const el = sel[0];
  if (!el) return null;
  if (el.localName === 'g') return { kind: 'group', els: [el] };
  const below = layerBelow(el);
  return below ? { kind: 'down', els: [below, el] } : null;
};
// Ctrl+E: Merge Down, Merge Layers or Merge Group, as the selection has it.
function mergeDown() {
  const t = mergeTargets();
  if (!t) return warn('Select a layer with one below it, several layers, or a group.');
  const name = (el) => el.getAttribute('data-name');
  // Merge Down keeps the lower layer's name; the others the topmost's.
  mergeInto(t.els, t.kind === 'down' ? name(t.els[0]) : name(t.els.at(-1)));
}
const MERGE_LABEL = { down: 'Merge Down', layers: 'Merge Layers', group: 'Merge Group' };
const mergeLabel = () => MERGE_LABEL[mergeTargets()?.kind] || 'Merge Down';

// Ctrl+Shift+E: every visible layer at the top level; hidden ones stay.
const visibleLayers = () => items().filter((el) => el.getAttribute('display') !== 'none');
function mergeVisible() {
  const els = visibleLayers();
  if (els.length < 2) return warn('There need to be two or more visible layers to merge.');
  mergeInto(els, els.at(-1).getAttribute('data-name'));
}
