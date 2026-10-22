// SVGCraft — Fill, stroke and transparency.
'use strict';

// ---------------------------------------------------------------------
// Style (colour + transparency)
// ---------------------------------------------------------------------
function hex(c) {
  if (!c) return null;
  if (c[0] === '#') {
    if (c.length === 4) return '#' + [...c.slice(1)].map((ch) => ch + ch).join('');
    return c.slice(0, 7).toLowerCase();
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(/[\s,/]+/).map(Number);
  return (
    '#' + [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('')
  );
}

function colorAlpha(c) {
  const m = c && c.match(/rgba\([^)]*[,/]\s*([\d.]+%?)\s*\)/);
  if (!m) return 1;
  return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
}

function paintTargets(el) {
  return el.localName === 'g' ? [el, ...el.querySelectorAll(SHAPE_SEL)] : [el];
}

function setPaintAttr(el, name, value, defaultValue) {
  el.style?.removeProperty(name);
  if (value == null || value === defaultValue) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

// Dash patterns in multiples of the stroke width, as Photoshop sizes them.
// Round and square caps add half a width to each end of a dash, so the
// pattern is shortened to keep the look (and turns dots round).
// data-dash holds a preset name or, for Custom, the dash / gap lengths in
// stroke widths ("4 2 1 2"), as Photoshop's dash / gap fields do.
const customDash = (d) => (/^[\d.]/.test(d || '') ? d.split(/[\s,]+/).map(Number) : null);
function dashArray(dash, w, cap) {
  w = Math.max(w || 1, 0.25);
  const own = customDash(dash);
  if (own) return own.map((n) => f(n * w)).join(' ');
  const capped = cap === 'round' || cap === 'square';
  const pat = {
    dash: capped ? [3, 3] : [4, 2],
    dot: capped ? [0, 2] : [1, 1],
    long: capped ? [7, 4] : [8, 3],
  }[dash];
  return pat ? pat.map((n) => f(n * w)).join(' ') : null;
}

// Re-derive an element's dashes after its width or cap changed.
function refreshDash(t) {
  const d = t.getAttribute('data-dash');
  if (!d) return;
  t.setAttribute('stroke-dasharray', dashArray(d, strokeW(t), getComputedStyle(t).strokeLinecap));
}
