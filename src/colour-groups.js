// SVGCraft — Layer → Group by Colour…
'use strict';

// Takes the drawing's groups apart and puts its layers into one group per
// fill colour (stroke colour for shapes with no fill; gradients and
// patterns by which one), named after the colour or its swatch.
//
// The drawing must look the same afterwards. Moving a layer into a group
// further down the stack puts it under everything stacked between, so a
// layer only joins its colour's latest group when nothing of another
// colour in between overlaps it (bounding boxes, so it errs on the side
// of a new group); otherwise its colour starts another group ("Red 2").
// Groups whose look depends on being a group (a clipping mask, layer
// style, filter, blend mode, opacity below 100%, an animation) or that are
// locked stay whole and are grouped as one layer.

// Can this group be taken apart without changing how anything looks?
function dissolvable(g) {
  if (g.localName !== 'g' || g.hasAttribute('data-sc-lock')) return false;
  // An animated group moves as one; handed down, each layer would spin or
  // pulse about its own centre.
  const own = ['clip-path', 'mask', 'filter', 'data-sc-clip', 'data-sc-fx', 'data-sc-anim'];
  if (own.some((a) => g.hasAttribute(a))) return false;
  if (g.style?.clipPath || g.style?.mask || g.style?.filter) return false;
  if (g.style?.mixBlendMode && g.style.mixBlendMode !== 'normal') return false;
  // A group's opacity applies to it as a whole; handed down to layers that
  // overlap, they'd show through each other.
  const op = parseFloat(g.getAttribute('opacity') ?? g.style?.opacity ?? 1);
  return !(op < 1);
}

// The colour a layer is grouped by: { key, name }.
function colourOf(el) {
  if (el.localName === 'g') {
    const keys = new Map();
    for (const c of el.querySelectorAll('*'))
      if (c instanceof SVGGeometryElement || c.localName === 'text') {
        const k = colourOf(c);
        keys.set(k.key, k);
      }
    return keys.size === 1 ? [...keys.values()][0] : { key: 'mixed', name: 'Mixed' };
  }
  if (el.localName === 'image') return { key: 'image', name: 'Images' };
  const cs = getComputedStyle(el);
  let paint = cs.fill;
  let opacity = parseFloat(cs.fillOpacity);
  if (!paint || paint === 'none') {
    paint = cs.stroke;
    opacity = parseFloat(cs.strokeOpacity);
  }
  if (!paint || paint === 'none') return { key: 'none', name: 'No colour' };
  const ref = paint.match(/url\(["']?[^#]*#([^"')]+)/);
  if (ref) {
    const p = document.getElementById(ref[1]);
    return { key: `url:${ref[1]}`, name: p?.getAttribute('data-name') || ref[1] };
  }
  const h = hex(paint);
  if (!h) return { key: paint, name: paint };
  const a = paint.match(/rgba\([^)]*,\s*([\d.]+)\)/);
  const alpha = +(a ? +a[1] : 1) * (isFinite(opacity) ? opacity : 1);
  const key = alpha < 1 ? `${h}@${+alpha.toFixed(2)}` : h;
  const sw = lib.swatches.find(
    (s) => s.c.toLowerCase() === h && Math.abs((s.a ?? 1) - alpha) < 0.01,
  );
  return { key, name: sw?.name || (alpha < 1 ? `${h} ${Math.round(alpha * 100)}%` : h) };
}

// Where a layer paints, hidden ones included (they may be shown later).
function colourBox(el) {
  doc.setAttribute('data-sc-thumbs', '');
  const b = bboxDoc(el, fullM(el));
  doc.removeAttribute('data-sc-thumbs');
  return b;
}
const boxesMeet = (a, b) =>
  a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// The plan for the layers, bottom first: groups of { key, name, members }.
function planColourGroups(layers) {
  const groups = [];
  for (const el of layers) {
    const c = colourOf(el);
    const box = colourBox(el);
    let target = null;
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].key === c.key) {
        target = groups[i];
        break;
      }
      // Something of another colour between here and that group overlaps.
      if (groups[i].boxes.some((b) => boxesMeet(b, box))) break;
    }
    if (!target) groups.push((target = { ...c, members: [], boxes: [] }));
    target.members.push(el);
    target.boxes.push(box);
  }
  return groups;
}

async function groupByColour() {
  if (!items().length) return;
  if (refuseLocked(items(), 'edit')) return;
  const ok = await ask('Group by Colour', {
    text:
      'All groups in the drawing are taken apart, and the objects regrouped and ' +
      'reordered, one group per colour. Overlapping objects keep their stacking, so a ' +
      'colour may get a second group. Groups with a clipping mask, effect, blend mode, ' +
      'opacity or animation, and locked ones, stay whole. Undo puts it all back.',
    ok: 'Group by Colour',
  });
  if (!ok || !doc.isConnected) return;
  // Take apart every group that can be, from the outside in.
  let again = true;
  while (again) {
    again = false;
    for (const g of items())
      if (dissolvable(g)) {
        dissolveGroup(g);
        again = true;
      }
  }
  const layers = items();
  const plan = planColourGroups(layers);
  const seen = new Map();
  const made = [];
  for (const grp of plan) {
    const n = (seen.get(grp.key) || 0) + 1;
    seen.set(grp.key, n);
    const g = mk('g', { 'data-name': n > 1 ? `${grp.name} ${n}` : grp.name });
    doc.append(g);
    for (const el of grp.members) g.append(el);
    made.push(g);
  }
  state.sel = made;
  commit();
  const colours = seen.size;
  say(
    `Grouped ${layers.length} object${layers.length === 1 ? '' : 's'} by colour: ` +
      `${colours} colour${colours === 1 ? '' : 's'} in ${made.length} group${made.length === 1 ? '' : 's'}.`,
  );
}
