// SVGCraft — Commands: arrange, group, align and Combine Shapes.
'use strict';

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------
function transformSel(Tfn) {
  const box = selBox();
  if (!box || refuseLocked(state.sel)) return;
  const T = Tfn(box);
  for (const el of state.sel) transformDoc(el, T);
  noteTransform(T, box);
  commit();
}

// ---- Combine shapes (boolean operations) ---------------------------------------
// Paper.js (MIT, vendor/paper-core.min.js) does the curve-preserving
// geometry. It's loaded the first time a boolean is used. As in
// Illustrator, Unite / Intersect / Exclude keep the topmost shape's style
// and Subtract Front keeps the backmost's; a group counts as one shape.
const BOOL_SHAPES = 'path,rect,circle,ellipse,line,polyline,polygon';
let paperJob = null;
function loadPaper() {
  if (window.paper?.CompoundPath) return Promise.resolve(window.paper);
  paperJob ||= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/paper-core.min.js';
    sc.onload = () => {
      window.paper.setup(new window.paper.Size(1, 1));
      resolve(window.paper);
    };
    sc.onerror = () => {
      paperJob = null;
      reject(new Error('paper.js failed to load'));
    };
    document.head.append(sc);
  });
  return paperJob;
}

// A shape's outline in document coordinates, every subpath closed.
function docPathData(el) {
  const M = fullM(el);
  const T = (p) => {
    const q = new DOMPoint(p.x, p.y).matrixTransform(M);
    return { x: q.x, y: q.y };
  };
  return nodesD(
    shapeNodes(el).map((sp) => ({
      closed: true,
      nodes: sp.nodes.map((n) => ({
        ...T(n),
        hin: n.hin && T(n.hin),
        hout: n.hout && T(n.hout),
      })),
    })),
  );
}

const COMBINE_LABEL = {
  unite: 'Unite',
  subtract: 'Subtract Front',
  intersect: 'Intersect',
  exclude: 'Exclude',
};

async function combineShapes(op) {
  const sel = normalizeSel(state.sel);
  if (refuseLocked(sel, 'edit')) return;
  if (sel.length < 2) return warn('Select two or more shapes to combine.');
  let P;
  try {
    P = await loadPaper();
  } catch {
    return warn('Couldn’t load the shape engine (vendor/paper-core.min.js).');
  }
  const operands = [];
  let skipped = 0;
  for (const el of sel) {
    const leaves =
      el.localName === 'g'
        ? [...el.querySelectorAll(BOOL_SHAPES)]
        : el.matches(BOOL_SHAPES)
          ? [el]
          : [];
    if (!leaves.length) {
      skipped++;
      continue;
    }
    let item = null;
    for (const lf of leaves) {
      const it = new P.CompoundPath({
        pathData: docPathData(lf),
        fillRule: getComputedStyle(lf).fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        insert: false,
      });
      item = item ? item.unite(it, { insert: false }) : it;
    }
    operands.push({ el, item });
  }
  if (operands.length < 2)
    return warn(
      skipped
        ? 'Text and images can’t be combined. Select two or more shapes.'
        : 'Select two or more shapes to combine.',
    );
  let result;
  if (op === 'subtract') {
    const [back, ...front] = operands;
    let cut = front[0].item;
    for (const o of front.slice(1)) cut = cut.unite(o.item, { insert: false });
    result = back.item.subtract(cut, { insert: false });
  } else {
    result = operands[0].item;
    for (const o of operands.slice(1)) result = result[op](o.item, { insert: false });
  }
  // Exclude's compound area is signed and can cancel to zero, so measure
  // each part on its own.
  const parts = result?.children || [result];
  if (!result || !result.pathData || parts.every((c) => !c || Math.abs(c.area) < 1e-6))
    return warn(
      op === 'intersect'
        ? 'The shapes don’t overlap, so there’s nothing to keep.'
        : 'Nothing would be left, so nothing changed.',
    );

  // The result takes its style source's place, style and coordinate space
  // (its own transform included, so gradients stay put).
  const src = (op === 'subtract' ? operands[0] : operands.at(-1)).el;
  const styleEl = src.localName === 'g' ? src.querySelector(BOOL_SHAPES) : src;
  const space = src.localName === 'g' ? parentM(src) : fullM(src);
  const inv = space.inverse();
  result.transform(new P.Matrix(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f));
  const path = mk('path');
  const skip = [
    'd',
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
    'id',
    'data-rect',
    'data-radii',
    'transform',
    'pathLength',
    'fill-rule',
    'data-name',
  ];
  for (const a of styleEl.attributes)
    if (!skip.includes(a.name)) path.setAttribute(a.name, a.value);
  if (styleEl !== src) bakeInherited(styleEl, path);
  if (src.localName !== 'g' && src.getAttribute('transform'))
    path.setAttribute('transform', src.getAttribute('transform'));
  if (src.getAttribute('data-name')) path.setAttribute('data-name', src.getAttribute('data-name'));
  path.setAttribute('d', result.pathData);
  src.before(path);
  for (const o of operands) o.el.remove();
  state.sel = [path];
  commit();
  readStyle(path);
  say(
    `${COMBINE_LABEL[op]}: ${operands.length} shapes → 1${skipped ? ` (${skipped} text / image layer${skipped > 1 ? 's' : ''} skipped)` : ''}.`,
  );
}
