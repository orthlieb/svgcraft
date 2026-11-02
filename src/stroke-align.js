// SVGCraft — Inside / outside stroke alignment.
'use strict';

// ---- stroke alignment ---------------------------------------------------
// Align: Inside / Center / Outside. SVG strokes are always
// centred, so an aligned stroke is drawn twice as wide (stroke-width holds
// 2× the width you set) and half of it is hidden: an inside stroke is
// clipped to the shape; an outside one paints under the fill
// (paint-order), and with no fill a mask hides the inner half. The clip /
// mask lives in defs as sc-sa-N, holds a copy of the shape's geometry and
// is kept in step by syncStrokeAlign(). data-stroke-align records the
// choice. Only closed shapes can be aligned.
const alignOf = (t) => t.getAttribute?.('data-stroke-align') || 'center';
// The stroke width as set (half the drawn width when aligned).
const strokeW = (t) =>
  (parseFloat(getComputedStyle(t).strokeWidth) || 0) / (alignOf(t) === 'center' ? 1 : 2);
function closedShape(t) {
  if (['rect', 'circle', 'ellipse', 'polygon'].includes(t.localName)) return true;
  if (t.localName !== 'path') return false;
  const subs = (t.getAttribute('d') || '').split(/(?=[Mm])/).filter((x) => x.trim());
  return subs.length > 0 && subs.every((x) => /[Zz]\s*$/.test(x));
}
function setStrokeAlign(t, align) {
  if (!closedShape(t)) align = 'center';
  const w = strokeW(t);
  if (align === 'center') t.removeAttribute('data-stroke-align');
  else t.setAttribute('data-stroke-align', align);
  if (t.getAttribute('stroke-width') != null || align !== 'center')
    t.setAttribute('stroke-width', f(align === 'center' ? w : 2 * w));
  if (align === 'outside') t.setAttribute('paint-order', 'stroke');
  else if (t.getAttribute('paint-order') === 'stroke') t.removeAttribute('paint-order');
  refreshDash(t);
}

const SA_GEOM = ['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points'];
const saRef = (t, k) => /^url\(#(sc-sa-\d+)\)$/.exec(t.getAttribute(k) || '')?.[1];
function syncStrokeAlign() {
  const owned = new Set();
  for (const t of doc.querySelectorAll('[data-stroke-align]')) {
    // A shape that's been opened (or wasn't closed) goes back to centre.
    if (!closedShape(t)) {
      setStrokeAlign(t, 'center');
      continue;
    }
    const align = alignOf(t);
    const cs = getComputedStyle(t);
    const filled = cs.fill !== 'none' && parseFloat(cs.fillOpacity) > 0;
    const k = align === 'inside' ? 'clip-path' : align === 'outside' && !filled ? 'mask' : null;
    for (const other of ['clip-path', 'mask'])
      if (other !== k && saRef(t, other)) t.removeAttribute(other);
    if (!k) continue;
    const tag = k === 'clip-path' ? 'clipPath' : 'mask';
    let id = saRef(t, k);
    let host = id && defs.querySelector(`#${id}`);
    if (!host || host.localName !== tag || owned.has(id)) {
      let n = 1;
      while (defs.querySelector(`#sc-sa-${n}`) || owned.has(`sc-sa-${n}`)) n++;
      id = `sc-sa-${n}`;
      host = mk(tag, { id, 'data-sc-sa': '' }, defs);
      t.setAttribute(k, `url(#${id})`);
    }
    owned.add(id);
    // Rebuild the geometry copy only when it has changed.
    const geo = mk(t.localName);
    for (const a of SA_GEOM) if (t.hasAttribute(a)) geo.setAttribute(a, t.getAttribute(a));
    if (cs.fillRule === 'evenodd')
      geo.setAttribute(tag === 'mask' ? 'fill-rule' : 'clip-rule', 'evenodd');
    const kids = [geo];
    if (tag === 'clipPath') host.setAttribute('clipPathUnits', 'userSpaceOnUse');
    else {
      let b;
      try {
        b = t.getBBox();
      } catch {
        b = { x: 0, y: 0, width: 0, height: 0 };
      }
      const pad = strokeW(t) * 2 + 2;
      const area = {
        x: f(b.x - pad),
        y: f(b.y - pad),
        width: f(b.width + 2 * pad),
        height: f(b.height + 2 * pad),
      };
      for (const [a, v] of Object.entries({ maskUnits: 'userSpaceOnUse', ...area }))
        host.setAttribute(a, v);
      const bg = mk('rect');
      for (const [a, v] of Object.entries(area)) bg.setAttribute(a, v);
      bg.setAttribute('fill', '#fff');
      geo.setAttribute('fill', '#000');
      kids.unshift(bg);
    }
    const html = kids.map((c) => c.outerHTML).join('');
    if (host.innerHTML !== html) host.replaceChildren(...kids);
  }
  // Drop references and defs nothing aligned uses any more.
  for (const t of doc.querySelectorAll('[clip-path], [mask]'))
    for (const k of ['clip-path', 'mask']) {
      const id = saRef(t, k);
      if (id && !owned.has(id)) t.removeAttribute(k);
    }
  const kept = keptIds();
  for (const host of defs.querySelectorAll('[data-sc-sa]'))
    if (!owned.has(host.id) && !kept.has(host.id)) host.remove();
}
let saQueued = false;
new MutationObserver(() => {
  if (saQueued) return;
  saQueued = true;
  queueMicrotask(() => {
    saQueued = false;
    syncStrokeAlign();
  });
}).observe(doc, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: [
    ...SA_GEOM,
    'data-stroke-align',
    'fill',
    'fill-opacity',
    'fill-rule',
    'style',
    'stroke-width',
  ],
});

// ---- strokes keep their width when scaled -------------------------------
// Scaling with the handles or the size fields leaves every stroke the width
// it was set to, as in a drawing app with Scale Strokes off. While it's
// scaled each stroked shape's width is divided by the scale; when it's done
// a rectangle, ellipse, circle or line that isn't turned takes the new size
// into its own geometry, so its stroke is even all round and its width is
// the one set. (A turned shape, a path or a group keeps the transform, with
// its stroke widths divided by the overall scale.)
// The stroked shapes in els (at any depth), with their drawn widths.
function strokesOf(els) {
  const out = [];
  for (const el of els)
    for (const t of [el, ...el.querySelectorAll(SHAPE_SEL)]) {
      if (!t.matches?.(SHAPE_SEL) || t.localName === 'tspan') continue;
      const cs = getComputedStyle(t);
      if (cs.stroke && cs.stroke !== 'none') out.push({ t, w: parseFloat(cs.strokeWidth) || 0 });
    }
  return out;
}
// T: the scale done since the widths were read.
function keepStrokes(list, T) {
  const k = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c)) || 1;
  for (const { t, w } of list) {
    t.style?.removeProperty('stroke-width');
    // Finer than f(): a shape that takes the scale into its geometry
    // multiplies it back (see bakeScale).
    t.setAttribute('stroke-width', +(w / k).toFixed(4));
    refreshDash(t);
  }
}
// The geometry a scale can be taken into: plain paint (a gradient or pattern
// is laid out in the shape's own space) and no clip or mask of its own.
function bakeable(el) {
  if (!['rect', 'ellipse', 'circle', 'line'].includes(el.localName)) return false;
  for (const k of ['fill', 'stroke'])
    if (/url\(/.test(el.getAttribute(k) || '') || /url\(/.test(el.style?.[k] || '')) return false;
  for (const k of ['clip-path', 'mask']) if (el.hasAttribute(k) && !saRef(el, k)) return false;
  const m = getM(el);
  if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6) return false;
  return el.localName !== 'circle' || Math.abs(Math.abs(m.a) - Math.abs(m.d)) < 1e-4;
}
// Take el's own transform into its geometry, its stroke drawn as wide as
// before.
function bakeScale(el) {
  if (!bakeable(el)) return false;
  const m = getM(el);
  const cs = getComputedStyle(el);
  const stroked = cs.stroke && cs.stroke !== 'none';
  const sw = (parseFloat(cs.strokeWidth) || 0) * Math.sqrt(Math.abs(m.a * m.d));
  const [sx, sy] = [Math.abs(m.a), Math.abs(m.d)];
  const X = (x) => m.a * x + m.e;
  const Y = (y) => m.d * y + m.f;
  const v = (k) => parseFloat(el.getAttribute(k)) || 0;
  const set = (k, n) => el.setAttribute(k, f(n));
  if (el.localName === 'rect') {
    const [x, y] = [X(v('x')), Y(v('y'))];
    const [w, h] = [v('width') * sx, v('height') * sy];
    // A flip leaves the corner it started from on the far side.
    set('x', m.a < 0 ? x - w : x);
    set('y', m.d < 0 ? y - h : y);
    set('width', w);
    set('height', h);
  } else if (el.localName === 'line') {
    for (const [a, b] of [
      ['x1', 'y1'],
      ['x2', 'y2'],
    ]) {
      set(a, X(v(a)));
      set(b, Y(v(b)));
    }
  } else {
    set('cx', X(v('cx')));
    set('cy', Y(v('cy')));
    if (el.localName === 'circle') set('r', v('r') * sx);
    else {
      set('rx', v('rx') * sx);
      set('ry', v('ry') * sy);
    }
  }
  el.removeAttribute('transform');
  if (stroked) {
    el.style?.removeProperty('stroke-width');
    el.setAttribute('stroke-width', f(sw));
    refreshDash(el);
  }
  return true;
}
