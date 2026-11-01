// SVGCraft — The Shape Builder tool (Shift+M).
'use strict';

// With two or more shapes selected, the Shape Builder splits them into the
// regions their outlines make. The region under the pointer is shaded. Drag
// across regions to merge them into one shape, styled like the region the
// drag began in; click one to split it out on its own; Alt-drag or Alt-click
// to delete regions. Every region left becomes a shape of its own, styled
// like the topmost shape covering it and put where that shape was in the
// stack, and they all stay selected so you can go on building. One undo
// step each time. Paper.js (src/commands.js) does the geometry.
let sb = null; // { P, regions: [{ item, src }], ops: the selected shapes }
let sbJob = 0;

// A selected shape (or a group of them) as one Paper.js item, or null.
function sbItem(P, el) {
  const leaves =
    el.localName === 'g'
      ? [...el.querySelectorAll(BOOL_SHAPES)]
      : el.matches(BOOL_SHAPES)
        ? [el]
        : [];
  let item = null;
  for (const lf of leaves) {
    const it = new P.CompoundPath({
      pathData: docPathData(lf),
      fillRule: getComputedStyle(lf).fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
      insert: false,
    });
    item = item ? item.unite(it, { insert: false }) : it;
  }
  return item;
}

const sbArea = (it) => (it ? (it.children || [it]).reduce((a, c) => a + Math.abs(c.area), 0) : 0);

// An item's separate pieces: each outer outline with the holes inside it.
function sbPieces(P, item) {
  const kids = item.children ? [...item.children] : [item];
  if (kids.length < 2) return [item];
  const inside = (a, b) => b !== a && b.contains(a.interiorPoint);
  const depth = (k) => kids.filter((o) => inside(k, o)).length;
  const outers = kids.filter((k) => depth(k) % 2 === 0);
  if (outers.length < 2) return [item];
  return outers.map((o) => {
    const holes = kids.filter(
      (h) => depth(h) % 2 === 1 && inside(h, o) && depth(h) === depth(o) + 1,
    );
    return new P.CompoundPath({
      children: [o, ...holes].map((c) => c.clone({ insert: false })),
      insert: false,
    });
  });
}

// The regions the selected shapes make, bottom shape first.
async function sbBuild() {
  const job = ++sbJob;
  sb = null;
  guides.replaceChildren();
  const ops = normalizeSel(state.sel).filter(
    (el) => el.matches(BOOL_SHAPES) || (el.localName === 'g' && el.querySelector(BOOL_SHAPES)),
  );
  if (ops.length < 2) return;
  let P;
  try {
    P = await loadPaper();
  } catch {
    return warn('Couldn’t load the shape engine (vendor/paper-core.min.js).');
  }
  if (job !== sbJob || state.tool !== 'shapebuilder') return;
  let regions = [];
  let all = null;
  for (const el of ops) {
    const item = sbItem(P, el);
    if (!item) continue;
    const next = [];
    for (const r of regions) {
      const both = r.item.intersect(item, { insert: false });
      if (sbArea(both) > 0.01) next.push({ item: both, src: el });
      const rest = r.item.subtract(item, { insert: false });
      if (sbArea(rest) > 0.01) next.push({ item: rest, src: r.src });
    }
    const own = all ? item.subtract(all, { insert: false }) : item;
    if (sbArea(own) > 0.01) next.push({ item: own, src: el });
    all = all ? all.unite(item, { insert: false }) : item;
    regions = next;
  }
  regions = regions.flatMap((r) => sbPieces(P, r.item).map((item) => ({ item, src: r.src })));
  sb = { P, regions, ops };
  sbDraw([]);
}

const sbHit = (p) => sb?.regions.find((r) => r.item.contains(new sb.P.Point(p.x, p.y))) || null;

// Every region's outline, and shaded: those marked by a drag, else the one
// under the pointer.
function sbDraw(regions, del) {
  guides.replaceChildren();
  for (const r of sb?.regions || [])
    mk('path', { d: r.item.pathData, class: 'sc-sb-edge' }, guides);
  for (const r of regions)
    mk('path', { d: r.item.pathData, class: 'sc-sb-region' + (del ? ' del' : '') }, guides);
}

// Merge (or delete) the marked regions; every other region becomes a shape.
function sbApply(marked, del) {
  const { P, regions, ops } = sb;
  if (refuseLocked(ops, 'edit')) return;
  const made = [];
  for (const r of regions) {
    if (marked.includes(r)) continue;
    const path = shapeFromItem(P, r.src, r.item);
    r.src.before(path);
    made.push(path);
  }
  if (!del) {
    let merged = marked[0].item;
    for (const r of marked.slice(1)) merged = merged.unite(r.item, { insert: false });
    const path = shapeFromItem(P, marked[0].src, merged);
    marked[0].src.before(path);
    made.push(path);
  }
  for (const el of ops) el.remove();
  noteStep('Shape Builder');
  state.sel = inDocOrder(made);
  commit();
  if (state.sel[0]) readStyle(state.sel[0]);
  const n = marked.length;
  say(
    del
      ? `Deleted ${n} region${n > 1 ? 's' : ''}.`
      : n > 1
        ? `Merged ${n} regions into one shape.`
        : 'Split the region out as a shape of its own.',
  );
  sbBuild();
}

tools.shapebuilder = {
  hint: 'Select two or more shapes · Drag across regions to merge them · Click one to split it out · Alt-drag or Alt-click deletes',
  get cursor() {
    return 'crosshair';
  },
  enter() {
    sbBuild().then(() => {
      if (state.tool === 'shapebuilder' && !sb)
        warn('Select two or more overlapping shapes, then build with the Shape Builder.');
    });
  },
  leave() {
    sbJob++;
    sb = null;
    this.g = null;
    guides.replaceChildren();
  },
  restored() {
    sbBuild();
  },
  down(e, p) {
    if (!sb) return;
    const r = sbHit(p);
    this.g = { marked: r ? [r] : [], del: e.altKey };
    sbDraw(this.g.marked, this.g.del);
  },
  move(e, p) {
    if (!sb) return;
    const r = sbHit(p);
    const g = this.g;
    if (g) {
      if (r && !g.marked.includes(r)) g.marked.push(r);
      sbDraw(g.marked, g.del);
    } else sbDraw(r ? [r] : [], e.altKey);
  },
  up() {
    const g = this.g;
    this.g = null;
    sbDraw([]);
    if (sb && g?.marked.length) sbApply(g.marked, g.del);
  },
  cancel() {
    this.g = null;
    guides.replaceChildren();
  },
};
