// SVGCraft — Rounded rectangles and live corners.
'use strict';

// ---- rounded rectangles -------------------------------------------------
// Equal radii stay a plain <rect rx>; unequal ones become a <path> that
// remembers it's a rectangle (data-rect, data-radii) so the radii stay
// editable — until its points are edited, when it becomes a plain path.
const CORNERS = ['tl', 'tr', 'br', 'bl'];
function rectGeom(el) {
  if (el.localName === 'rect') {
    const v = (k) => el[k].baseVal.value;
    return { x: v('x'), y: v('y'), w: v('width'), h: v('height') };
  }
  const [x, y, w, h] = (el.getAttribute('data-rect') || '').split(' ').map(Number);
  return { x, y, w, h };
}
// A path is a rounded rectangle only while data-rect holds a real x y w h
// (a hand-edited or damaged file may not).
const isCornerShape = (el) =>
  el &&
  (el.localName === 'rect' ||
    (el.localName === 'path' &&
      /^\s*(-?[\d.]+(e-?\d+)?\s+){3}-?[\d.]+(e-?\d+)?\s*$/i.test(
        el.getAttribute('data-rect') || '',
      )));
function getRadii(el) {
  if (el.localName === 'rect') {
    const r = el.hasAttribute('rx')
      ? el.rx.baseVal.value
      : el.hasAttribute('ry')
        ? el.ry.baseVal.value
        : 0;
    return { tl: r, tr: r, br: r, bl: r };
  }
  const [tl, tr, br, bl] = (el.getAttribute('data-radii') || '0 0 0 0').split(' ').map(Number);
  return { tl, tr, br, bl };
}
function roundedRectD({ x, y, w, h }, r) {
  const a = (rr, ex, ey) =>
    rr ? `A${f(rr)} ${f(rr)} 0 0 1 ${f(ex)} ${f(ey)}` : `L${f(ex)} ${f(ey)}`;
  return (
    `M${f(x + r.tl)} ${f(y)}H${f(x + w - r.tr)}` +
    a(r.tr, x + w, y + r.tr) +
    `V${f(y + h - r.br)}` +
    a(r.br, x + w - r.br, y + h) +
    `H${f(x + r.bl)}` +
    a(r.bl, x, y + h - r.bl) +
    `V${f(y + r.tl)}` +
    a(r.tl, x + r.tl, y) +
    'Z'
  );
}
// Set the radii; returns the element now standing in for el (it may
// have switched between <rect> and <path>).
function setRadii(el, radii) {
  const g = rectGeom(el);
  const max = Math.min(g.w, g.h) / 2;
  const r = Object.fromEntries(CORNERS.map((k) => [k, clamp(+radii[k] || 0, 0, max)]));
  const equal = CORNERS.every((k) => r[k] === r.tl);
  const geomAttrs = ['x', 'y', 'width', 'height', 'rx', 'ry', 'd', 'data-rect', 'data-radii'];
  const swap = (tag) => {
    const n = mk(tag);
    for (const at of el.attributes)
      if (!geomAttrs.includes(at.name)) n.setAttribute(at.name, at.value);
    el.replaceWith(n);
    state.sel = state.sel.map((x) => (x === el ? n : x));
    return n;
  };
  let out = el;
  if (equal) {
    if (el.localName !== 'rect') {
      out = swap('rect');
      for (const [k, v] of Object.entries({ x: g.x, y: g.y, width: g.w, height: g.h }))
        out.setAttribute(k, f(v));
    }
    if (r.tl) {
      out.setAttribute('rx', f(r.tl));
      out.setAttribute('ry', f(r.tl));
    } else {
      out.removeAttribute('rx');
      out.removeAttribute('ry');
    }
  } else {
    if (el.localName !== 'path') out = swap('path');
    out.setAttribute('data-rect', [g.x, g.y, g.w, g.h].map(f).join(' '));
    out.setAttribute('data-radii', CORNERS.map((k) => f(r[k])).join(' '));
    out.setAttribute('d', roundedRectD(g, r));
  }
  return out;
}
const cornerTarget = () =>
  state.sel.length === 1 && isCornerShape(state.sel[0]) ? state.sel[0] : null;

function syncCornerUI() {
  const el = cornerTarget();
  $('#sc-corner-props').hidden = !el;
  const link = $('#sc-corner-link');
  link.setAttribute('aria-pressed', state.radiusLinked);
  link.firstElementChild.innerHTML = icon(state.radiusLinked ? 'link' : 'link-slash');
  const all = $('[data-corner-all]');
  if (document.activeElement !== all) all.value = f(el ? getRadii(el).tl : state.radius);
  if (!el) return;
  const r = getRadii(el);
  for (const inp of document.querySelectorAll('[data-corner]'))
    if (document.activeElement !== inp) inp.value = f(r[inp.dataset.corner]);
}
