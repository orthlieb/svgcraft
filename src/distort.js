// SVGCraft — Object → Transform → Distort and Perspective: four corner
// handles, each pulled where you like (Distort) or in mirrored pairs along
// an edge (Perspective). SVG's own transforms can only make straight-line
// (affine) changes, so the shapes' points are moved instead: through the
// projective map from the selection's box to the four corners.
'use strict';

const QUAD_MODES = new Set(['distort', 'perspective']);
const isQuadMode = () => QUAD_MODES.has(state.tf?.mode);

// The projective map taking the unit square's corners (0,0) (1,0) (1,1)
// (0,1) to q[0..3] (Heckbert's square-to-quad): [u, v] → [x, y].
function squareToQuad(q) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  return (u, v) => {
    const w = g * u + h * v + 1 || 1e-9;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

// A cubic segment a → b (with handles) split in two at t.
function splitCubicAt(a, b, t) {
  const p1 = a.hout || a;
  const p2 = b.hin || b;
  const l = (s, e) => ({ x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t });
  const q0 = l(a, p1);
  const q1 = l(p1, p2);
  const q2 = l(p2, b);
  const r0 = l(q0, q1);
  const r1 = l(q1, q2);
  const m = l(r0, r1);
  return { aOut: q0, mid: { ...m, hin: r0, hout: r1 }, bIn: q2 };
}

// Curved segments split into `n` so their mapped handles stay close to the
// true (rational) curve; straight ones stay straight under the map.
function subdivideSubs(subs, n) {
  return subs.map((sp) => {
    const src = sp.nodes.map((nd) => ({
      ...nd,
      hin: nd.hin && { ...nd.hin },
      hout: nd.hout && { ...nd.hout },
    }));
    const N = src.length;
    const out = [];
    const segs = sp.closed ? N : N - 1;
    for (let i = 0; i < N; i++) {
      out.push(src[i]);
      if (i >= segs) continue;
      const a = out.at(-1);
      const b = src[(i + 1) % N];
      if (!a.hout && !b.hin) continue;
      // Split off 1/n, 1/(n-1), … of what's left, so the pieces are even.
      let cur = a;
      for (let k = n; k > 1; k--) {
        const s = splitCubicAt(cur, b, 1 / k);
        cur.hout = s.aOut;
        b.hin = s.bIn;
        out.push(s.mid);
        cur = s.mid;
      }
    }
    return { closed: sp.closed, nodes: out };
  });
}

// The shapes a distort reshapes: paths and basic shapes in the selection,
// groups' too. The rest (text, images, symbols) can't be.
const DISTORTABLE = 'path,rect,circle,ellipse,line,polyline,polygon';
function distortTargets(sel) {
  const ok = [];
  let left = 0;
  for (const el of sel) {
    const all = el.matches(DISTORTABLE) ? [el] : [...el.querySelectorAll(DISTORTABLE)];
    ok.push(...all.filter((x) => !x.closest('defs, clipPath, mask, pattern, symbol, marker')));
    left += el.matches(DISTORTABLE)
      ? 0
      : el.matches('text, image, use')
        ? 1
        : el.querySelectorAll('text, image, use').length;
  }
  return { ok: [...new Set(ok)], left };
}

// Start a Distort / Perspective session (from beginTransform): the four
// corners of the selection's box, and each shape's points as they were.
function beginQuad(tf) {
  const { ok, left } = distortTargets(state.sel);
  if (!ok.length) {
    warn('Distort and Perspective work on paths and shapes: text, images and symbols can’t be.');
    return false;
  }
  if (left) say('Text, images and symbols can’t be distorted: they stay as they are.');
  const b = selBox();
  tf.quad = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
  tf.qbox = b;
  tf.qshapes = ok.map((el) => ({ path: treePath(el), subs: subdivideSubs(shapeNodes(el), 4) }));
  return true;
}

// Reshape every target through the map from the box to the corners.
function applyQuad() {
  const tf = state.tf;
  const map = squareToQuad(tf.quad);
  const b = tf.qbox;
  const P = (p, M, Mi) => {
    const d = new DOMPoint(p.x, p.y).matrixTransform(M);
    const q = map((d.x - b.x) / (b.w || 1), (d.y - b.y) / (b.h || 1));
    const l = new DOMPoint(q.x, q.y).matrixTransform(Mi);
    return { x: fp(l.x), y: fp(l.y) };
  };
  for (const s of tf.qshapes) {
    let el = fromTreePath(s.path);
    if (!el) continue;
    if (el.localName !== 'path') {
      const p = toPath(el);
      state.sel = state.sel.map((x) => (x === el ? p : x));
      el = p;
    }
    el.removeAttribute('data-rect');
    el.removeAttribute('data-radii');
    const M = fullM(el);
    const Mi = M.inverse();
    const subs = s.subs.map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n) => ({
        ...P(n, M, Mi),
        hin: n.hin && P(n.hin, M, Mi),
        hout: n.hout && P(n.hout, M, Mi),
      })),
    }));
    el.setAttribute('d', nodesD(subs));
  }
}

// The corners' handles and the outline between them (from drawSelection).
function drawQuad() {
  const q = state.tf.quad;
  const z = state.zoom;
  mk('polygon', { points: q.map((p) => `${p.x},${p.y}`).join(' '), class: 'sc-ov' }, selLayer);
  const hs = 8 / z;
  q.forEach((p, i) =>
    mk(
      'rect',
      {
        x: p.x - hs / 2,
        y: p.y - hs / 2,
        width: hs,
        height: hs,
        class: 'sc-handle',
        'data-handle': `q${i}`,
        style: 'cursor:move',
      },
      selLayer,
    ),
  );
}

// A corner dragged from where it was by (dx, dy), from the corners at the
// drag's start. Perspective moves its partner on the same edge the other
// way: along the top or bottom for a sideways drag, along the side for an
// up-and-down one.
function dragQuad(q0, i, dx, dy, perspective) {
  const q = q0.map((p) => ({ ...p }));
  if (!perspective) {
    q[i] = { x: q0[i].x + dx, y: q0[i].y + dy };
    return q;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    const j = [1, 0, 3, 2][i];
    q[i].x += dx;
    q[j].x -= dx;
  } else {
    const j = [3, 2, 1, 0][i];
    q[i].y += dy;
    q[j].y -= dy;
  }
  return q;
}
