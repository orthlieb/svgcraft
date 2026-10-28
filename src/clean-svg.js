// SVGCraft — File → Export Clean SVG.
'use strict';

// ---- File → Export Clean SVG… ------------------------------------------------
// The drawing as plain SVG for the web or another app, without what SVGCraft
// keeps to reopen it editable: every data-* attribute (layer names, locks,
// effects settings, guides…), unreferenced ids and unused defs, hidden
// layers, comments, attribute-free groups and default-valued attributes.
// Numbers are rounded. Effects, clips, masks, gradients and patterns stay
// as the real SVG that draws them, so it looks the same.
const CLEAN_KEY = 'svgcraft.cleanSvg';
const CLEAN_DEFAULTS = {
  decimals: 2,
  meta: true,
  hidden: true,
  responsive: true,
  currentColor: false,
  minify: true,
};
const NUM_ATTRS = new Set(
  (
    'd points x y width height cx cy r rx ry x1 y1 x2 y2 fx fy dx dy transform viewBox ' +
    'stroke-width stroke-dasharray stroke-dashoffset offset startOffset font-size ' +
    'letter-spacing stdDeviation gradientTransform patternTransform'
  ).split(' '),
);
const DEFAULT_ATTRS = {
  opacity: '1',
  'fill-opacity': '1',
  'stroke-opacity': '1',
  'stroke-miterlimit': '4',
  'fill-rule': 'nonzero',
  'stroke-dasharray': 'none',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  visibility: 'visible',
  display: 'inline',
};
// An animation's values are rounded like the geometry they move; timing,
// opacity and colours are left alone.
const ANIM_NUM_ATTRS = new Set(['values', 'from', 'to', 'by']);
const ANIM_GEOMETRY = /^(transform|stroke-dash(array|offset)|[xy]|[cr]x|[cr]y|r|width|height|d)$/;
// Elements whose whitespace is content.
const TEXTY = new Set(['text', 'tspan', 'textPath', 'style', 'title', 'desc']);
const REF_RE = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/g;
// An animation started or stopped by an element's event: "logo.click+1s".
const EVENT_RE =
  /([A-Za-z_][\w:-]*)\.(click|mouseover|mouseout|mousedown|mouseup|begin|end|repeat)\b/g;
const isTiming = (n) => n === 'begin' || n === 'end';

function roundNumbers(v, dp) {
  return v.replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, (n) => {
    const r = +(+n).toFixed(dp);
    return String(Object.is(r, -0) ? 0 : r);
  });
}
// Path data with rounded numbers and no needless spaces.
const tightPath = (d) =>
  d
    .replace(/\s*,\s*|\s+/g, ' ')
    .replace(/\s*([A-Za-z])\s*/g, '$1')
    .replace(/ -/g, '-')
    .trim();

function cleanSvgText(text, o) {
  const d = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = d.documentElement;
  const all = () => [root, ...root.querySelectorAll('*')];
  const inDefs = (el) => !!el.closest('defs');
  // Comments and processing instructions.
  const walker = d.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.remove();
  // Hidden layers.
  if (o.hidden)
    for (const el of [...root.querySelectorAll('*')])
      if (
        !inDefs(el) &&
        el.isConnected &&
        (el.getAttribute('display') === 'none' ||
          /display\s*:\s*none/.test(el.getAttribute('style') || ''))
      )
        el.remove();
  // File Info.
  if (!o.meta)
    for (const el of [...root.children])
      if (['title', 'desc', 'metadata'].includes(el.localName)) el.remove();
  // SVGCraft's own attributes, defaults, and rounding.
  for (const el of all()) {
    const anim = ANIM_KEY_TAGS.includes(el.localName);
    for (const a of [...el.attributes]) {
      const n = a.name;
      if (anim) {
        if (ANIM_NUM_ATTRS.has(n) && ANIM_GEOMETRY.test(el.getAttribute('attributeName') || ''))
          el.setAttribute(n, roundNumbers(a.value, o.decimals));
        else if (n === 'path' && el.localName === 'animateMotion')
          el.setAttribute(n, tightPath(roundNumbers(a.value, o.decimals)));
        continue;
      }
      if (n.startsWith('data-') || n === 'xml:space') el.removeAttribute(n);
      else if (DEFAULT_ATTRS[n] === a.value.trim()) el.removeAttribute(n);
      else if (NUM_ATTRS.has(n) && n !== 'viewBox') {
        let v = roundNumbers(a.value, o.decimals);
        if (n === 'd' || n === 'points') v = tightPath(v);
        el.setAttribute(n, v);
      }
    }
    // (An animation's fill="freeze" isn't paint.)
    if (o.currentColor && !inDefs(el) && !anim) {
      for (const k of ['fill', 'stroke']) {
        const v = el.getAttribute(k);
        if (v && v !== 'none' && !v.startsWith('url(') && v !== 'currentColor')
          el.setAttribute(k, 'currentColor');
      }
      const st = el.getAttribute('style');
      if (st)
        el.setAttribute(
          'style',
          st.replace(/\b(fill|stroke)\s*:\s*(?!none|url\(|currentColor)[^;]+/g, '$1:currentColor'),
        );
    }
  }
  if (o.responsive) {
    root.removeAttribute('width');
    root.removeAttribute('height');
  }
  // Ids and defs: keep only what's reachable from the drawing.
  const refsIn = (el) => {
    const out = [];
    for (const a of el.attributes) {
      for (const m of a.value.matchAll(REF_RE)) out.push(m[1]);
      if ((a.name === 'href' || a.name === 'xlink:href') && a.value.startsWith('#'))
        out.push(a.value.slice(1));
      if (isTiming(a.name)) for (const m of a.value.matchAll(EVENT_RE)) out.push(m[1]);
    }
    if (el.localName === 'style') for (const m of el.textContent.matchAll(REF_RE)) out.push(m[1]);
    return out;
  };
  const byId = new Map(
    all()
      .filter((el) => el.id)
      .map((el) => [el.id, el]),
  );
  const reached = new Set();
  const queue = all().filter((el) => !inDefs(el) || el.localName === 'style');
  while (queue.length) {
    const el = queue.pop();
    for (const id of refsIn(el)) {
      const t = byId.get(id);
      if (!t || reached.has(id)) continue;
      reached.add(id);
      queue.push(t, ...t.querySelectorAll('*'));
    }
  }
  for (const def of root.querySelectorAll('defs > *'))
    if (def.localName !== 'style' && !(def.id && reached.has(def.id))) def.remove();
  for (const el of all()) if (el.id && !reached.has(el.id)) el.removeAttribute('id');
  // Groups: drop empty ones, and unwrap those with no attributes.
  for (const g of [...root.querySelectorAll('g')].reverse()) {
    if (!g.isConnected) continue;
    if (!g.children.length && !g.id) g.remove();
    // A group's animations animate it, so it stays.
    else if (
      !g.attributes.length &&
      ![...g.children].some((c) => ANIM_KEY_TAGS.includes(c.localName))
    )
      g.replaceWith(...g.childNodes);
  }
  for (const defsEl of root.querySelectorAll('defs')) if (!defsEl.children.length) defsEl.remove();
  if (o.minify) {
    // Short ids, and no whitespace between elements.
    const names = new Map();
    let n = 0;
    // Letters only (a, b, … z, aa, ab…): an id starting with a digit isn't a
    // valid name, and an animation's "a.click" couldn't name it.
    const short = (k) =>
      (k < 26 ? '' : short(Math.floor(k / 26) - 1)) + String.fromCharCode(97 + (k % 26));
    for (const id of reached) if (byId.get(id)?.isConnected) names.set(id, short(n++));
    const fix = (v) => v.replace(REF_RE, (m, id) => (names.has(id) ? `url(#${names.get(id)})` : m));
    for (const el of all()) {
      if (el.id && names.has(el.id)) el.id = names.get(el.id);
      for (const a of [...el.attributes]) {
        if ((a.name === 'href' || a.name === 'xlink:href') && names.has(a.value.slice(1)))
          el.setAttribute(a.name, `#${names.get(a.value.slice(1))}`);
        else if (a.value.includes('url(')) el.setAttribute(a.name, fix(a.value));
        else if (isTiming(a.name))
          el.setAttribute(
            a.name,
            a.value.replace(EVENT_RE, (m, id, ev) =>
              names.has(id) ? `${names.get(id)}.${ev}` : m,
            ),
          );
      }
      if (el.localName === 'style') el.textContent = fix(el.textContent);
    }
    const ws = d.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const blank = [];
    while (ws.nextNode())
      if (!ws.currentNode.data.trim() && !TEXTY.has(ws.currentNode.parentNode.localName))
        blank.push(ws.currentNode);
    for (const t of blank) t.remove();
  }
  let s = new XMLSerializer().serializeToString(d);
  if (!s.includes('xlink:')) s = s.replace(/\s+xmlns:xlink="[^"]*"/, '');
  return s + (o.minify ? '' : '\n');
}

function cleanOptions() {
  const o = stored(CLEAN_KEY, {});
  return { ...CLEAN_DEFAULTS, ...(o && typeof o === 'object' ? o : {}) };
}
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
function exportCleanSvg(o) {
  const full = serialize({ fontCss: fontImport() });
  const clean = cleanSvgText(full, o);
  download(new Blob([clean], { type: 'image/svg+xml' }), `${state.fileName}.min.svg`);
  const before = new Blob([full]).size;
  const after = new Blob([clean]).size;
  say(`Exported ${state.fileName}.min.svg: ${kb(after)} (${kb(before)} as SVGCraft saves it).`);
}

const csDlg = $('#sc-cleansvg');
function openCleanSvg() {
  const o = cleanOptions();
  for (const el of csDlg.querySelectorAll('[data-cs]')) {
    const k = el.dataset.cs;
    if (el.type === 'checkbox') el.checked = !!o[k];
    else el.value = o[k];
  }
  showDialog(csDlg, () => closeCleanSvg(false));
  setTimeout(() => csDlg.querySelector('[data-cs-btn="ok"]').focus(), 0);
}
function closeCleanSvg(ok) {
  hideDialog(csDlg);
  if (!ok) return;
  const o = {};
  for (const el of csDlg.querySelectorAll('[data-cs]'))
    o[el.dataset.cs] =
      el.type === 'checkbox' ? el.checked : clamp(Math.round(+el.value) || 0, 0, 6);
  store(CLEAN_KEY, o);
  exportCleanSvg(o);
}
csDlg.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.target.closest('[data-cs-btn="cancel"]')) {
    e.preventDefault();
    closeCleanSvg(true);
  } else if (e.key === 'Escape') closeCleanSvg(false);
});
csDlg.querySelector('[data-cs-btn="ok"]').addEventListener('click', () => closeCleanSvg(true));
csDlg.querySelector('[data-cs-btn="cancel"]').addEventListener('click', () => closeCleanSvg(false));
