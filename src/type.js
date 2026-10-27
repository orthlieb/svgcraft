// SVGCraft — Type: text layers, rich text and text on a path.
'use strict';

// ---------------------------------------------------------------------
// Type (Photoshop-style)
//
// A text layer is <text x y> with one <tspan data-line> per line, each
// absolutely positioned (x = the alignment anchor, y = baseline + n ×
// leading) so empty lines keep their place. Paragraph text carries
// data-box (its width); its soft-wrapped lines are marked data-soft so
// the original string can be rebuilt for editing. Character settings
// live in ordinary SVG attributes, so exports render anywhere.
// ---------------------------------------------------------------------
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const WEIGHT_NAMES = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};
const ALL_W = [100, 200, 300, 400, 500, 600, 700, 800, 900];
// name, CSS stack, weights, has italics, source: the system fonts here,
// then every Google family. Google weights are the ones each family
// really ships, so every requested style exists.
const FONTS = [
  { name: 'System UI', css: 'system-ui, sans-serif', w: ALL_W, i: true, src: 'system' },
  { name: 'Arial', css: 'Arial, Helvetica, sans-serif', w: [400, 700], i: true, src: 'system' },
  { name: 'Georgia', css: 'Georgia, serif', w: [400, 700], i: true, src: 'system' },
  {
    name: 'Times New Roman',
    css: "'Times New Roman', Times, serif",
    w: [400, 700],
    i: true,
    src: 'system',
  },
  {
    name: 'Courier New',
    css: "'Courier New', Courier, monospace",
    w: [400, 700],
    i: true,
    src: 'system',
  },
  { name: 'Verdana', css: 'Verdana, sans-serif', w: [400, 700], i: true, src: 'system' },
  {
    name: 'Trebuchet MS',
    css: "'Trebuchet MS', sans-serif",
    w: [400, 700],
    i: true,
    src: 'system',
  },
  { name: 'Impact', css: 'Impact, sans-serif', w: [400], i: false, src: 'system' },
];
// Google Fonts: the whole catalogue (google-fonts.js, from the Google Fonts
// listing), with the styles each family really ships. The popular ones are
// what the picker shows first.
const FONT_CATS = {
  s: ['Sans serif', 'sans-serif'],
  r: ['Serif', 'serif'],
  d: ['Display', 'sans-serif'],
  h: ['Handwriting', 'cursive'],
  m: ['Monospace', 'monospace'],
};
const POPULAR_FONTS = new Set([
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Inter',
  'Poppins',
  'Raleway',
  'Nunito',
  'Work Sans',
  'DM Sans',
  'Rubik',
  'Quicksand',
  'Josefin Sans',
  'Oswald',
  'Bebas Neue',
  'Anton',
  'Archivo Black',
  'Playfair Display',
  'Merriweather',
  'Source Serif 4',
  'Lora',
  'EB Garamond',
  'Libre Baskerville',
  'Roboto Slab',
  'Cinzel',
  'Abril Fatface',
  'Righteous',
  'Lobster',
  'Pacifico',
  'Dancing Script',
  'Caveat',
  'Great Vibes',
  'Permanent Marker',
  'Fira Code',
  'JetBrains Mono',
  'Space Mono',
  'Press Start 2P',
]);
const hundreds = (s) => [...s].map((d) => d * 100);
for (const line of window.SC_GOOGLE_FONTS || []) {
  const [name, cat, w, iw] = line.split('|');
  if (!FONT_CATS[cat]) continue;
  FONTS.push({
    name,
    cat,
    css: `'${name}', ${FONT_CATS[cat][1]}`,
    w: hundreds(w),
    iw: hundreds(iw),
    src: 'google',
    pop: POPULAR_FONTS.has(name),
  });
}
// Every family lists its italic weights (iw); `i` says it has any.
for (const ft of FONTS) {
  ft.iw ??= ft.i ? ft.w : [];
  ft.i = ft.iw.length > 0;
}

// Families by lower-case name; installed fonts are added as they're listed.
const fontIndex = new Map();
const fontByName = (name) => {
  const k = String(name).toLowerCase();
  let ft = fontIndex.get(k);
  if (!ft) {
    ft = FONTS.find((x) => x.name.toLowerCase() === k);
    if (ft) fontIndex.set(k, ft);
  }
  return (
    ft || {
      name,
      css: `'${name}', sans-serif`,
      w: [400, 700],
      iw: [400, 700],
      i: true,
      src: 'unknown',
    }
  );
};

// The family a font-family value starts with, matched to the catalogue.
function fontFromCss(value) {
  const first = String(value || '')
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!first) return 'System UI';
  const hit = FONTS.find(
    (ft) =>
      ft.name.toLowerCase() === first.toLowerCase() ||
      ft.css.split(',')[0].trim().replace(/['"]/g, '').toLowerCase() === first.toLowerCase(),
  );
  return hit ? hit.name : first;
}

const googleSpec = (ft) =>
  `family=${encodeURIComponent(ft.name).replace(/%20/g, '+')}:` +
  (ft.i
    ? `ital,wght@${[...ft.w.map((w) => `0,${w}`), ...ft.iw.map((w) => `1,${w}`)].join(';')}`
    : `wght@${ft.w.join(';')}`);
const googleUrl = (fonts) =>
  `https://fonts.googleapis.com/css2?${fonts.map(googleSpec).join('&')}&display=swap`;

// Load a Google family (all its styles) once; re-wrap paragraph text in
// it when it arrives, since line breaks depend on the real glyph widths.
const loadedFonts = new Set();
function ensureFont(name) {
  const ft = fontByName(name);
  if (ft.src !== 'google' || loadedFonts.has(ft.name)) return;
  loadedFonts.add(ft.name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = googleUrl([ft]);
  link.onload = () =>
    document.fonts.load(`16px '${ft.name}'`).then(() => {
      // Re-wrap paragraphs that use it, as the layer's font or in a run.
      for (const el of doc.querySelectorAll('text[data-box]'))
        if (typeFrom(el).family === ft.name || el.innerHTML.includes(ft.name)) layoutText(el);
      drawSelection();
    });
  document.head.append(link);
}

// The font picker draws each Google family's name in its own face: as
// names scroll into view they're queued, then fetched together, each cut
// down to just the letters of the names.
const previewed = new Set();
let previewQueue = [];
function previewFont(ft) {
  if (ft.src !== 'google' || previewed.has(ft.name)) return;
  previewed.add(ft.name);
  previewQueue.push(ft);
  if (previewQueue.length === 1) requestAnimationFrame(flushPreviews);
}
function flushPreviews() {
  const g = previewQueue;
  previewQueue = [];
  for (let k = 0; k < g.length; k += 30) {
    const part = g.slice(k, k + 30);
    const chars = [...new Set(part.map((ft) => ft.name).join(''))].join('');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?' +
      part
        .map((ft) => {
          // Asking for a weight a family doesn't have fails the whole request.
          const w = ft.w.includes(400) ? 400 : ft.w[0];
          return `family=${encodeURIComponent(ft.name).replace(/%20/g, '+')}:wght@${w}`;
        })
        .join('&') +
      `&text=${encodeURIComponent(chars)}&display=swap`;
    document.head.append(link);
  }
}

// Style menu entries for a family: [weight, italic, label].
function fontStyles(name) {
  const ft = fontByName(name);
  const out = ft.w.map((w) => [w, false, WEIGHT_NAMES[w] || String(w)]);
  for (const w of ft.iw)
    out.push([w, true, w === 400 ? 'Italic' : `${WEIGHT_NAMES[w] || w} Italic`]);
  return out;
}

// Nearest style a family actually has.
function fitStyle(name, weight, italic) {
  const ft = fontByName(name);
  const it = italic && ft.i;
  const ws = it ? ft.iw : ft.w;
  const w = ws.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), ws[0]);
  return { weight: w, italic: it };
}

// ---- reading / writing a layer's character + paragraph settings
function typeFrom(el) {
  const cs = getComputedStyle(el);
  const size = parseFloat(el.getAttribute('font-size')) || parseFloat(cs.fontSize) || 16;
  const bs = el.getAttribute('baseline-shift') || '';
  const deco = el.hasAttribute('data-deco')
    ? el.getAttribute('data-deco')
    : `${el.getAttribute('text-decoration') || ''} ${cs.textDecorationLine || ''}`;
  const anchor = el.getAttribute('text-anchor') || cs.textAnchor || 'start';
  return {
    family: fontFromCss(el.getAttribute('font-family') || cs.fontFamily),
    weight: parseInt(cs.fontWeight, 10) || 400,
    italic: /italic|oblique/.test(cs.fontStyle),
    size,
    leading: parseFloat(el.dataset.leading) || 0,
    tracking: el.dataset.tracking
      ? parseFloat(el.dataset.tracking)
      : Math.round(((parseFloat(el.getAttribute('letter-spacing')) || 0) / size) * 1000),
    shift: /^-?[\d.]+$/.test(bs) ? parseFloat(bs) : 0,
    script: bs === 'super' || bs === 'sub' ? bs : 'none',
    caps:
      el.style.textTransform === 'uppercase'
        ? 'all'
        : /small-caps/.test(el.getAttribute('font-variant') || '')
          ? 'small'
          : 'none',
    underline: /underline/.test(deco),
    strike: /line-through/.test(deco),
    align: { middle: 'middle', end: 'end' }[anchor] || 'start',
    box: parseFloat(el.dataset.box) || 0,
  };
}

function applyType(el, t, text) {
  const set = (k, v) => (v == null || v === '' ? el.removeAttribute(k) : el.setAttribute(k, v));
  for (const k of [
    'font-family',
    'font-weight',
    'font-style',
    'font-size',
    'letter-spacing',
    'text-anchor',
    'text-decoration',
    'font-variant',
    'baseline-shift',
  ])
    el.style.removeProperty(k);
  set('font-family', fontByName(t.family).css);
  set('font-weight', t.weight === 400 ? null : t.weight);
  set('font-style', t.italic ? 'italic' : null);
  set('font-size', f(t.size));
  set('letter-spacing', t.tracking ? f((t.tracking * t.size) / 1000) : null);
  el.dataset.tracking = t.tracking;
  if (!t.tracking) delete el.dataset.tracking;
  set('baseline-shift', t.script !== 'none' ? t.script : t.shift ? f(t.shift) : null);
  set('font-variant', t.caps === 'small' ? 'small-caps' : null);
  if (t.caps === 'all') el.style.textTransform = 'uppercase';
  else el.style.removeProperty('text-transform');
  if (!el.getAttribute('style')) el.removeAttribute('style');
  el.setAttribute('data-deco', decoOf(t.underline, t.strike));
  set('text-anchor', t.align === 'start' ? null : t.align);
  if (t.leading) el.dataset.leading = f(t.leading);
  else delete el.dataset.leading;
  if (t.box) el.dataset.box = f(t.box);
  else delete el.dataset.box;
  ensureFont(t.family);
  layoutText(el, text);
}

// ---- rich text: runs ----------------------------------------------------
// A layer's content is a list of runs { t, o }: t is text (newlines
// included) and o holds only the character settings that differ from the
// layer's own (Photoshop's per-character styling). In the SVG each run is
// a nested <tspan data-run> carrying just those attributes.
const RUN_KEYS = [
  'family',
  'weight',
  'italic',
  'size',
  'tracking',
  'shift',
  'script',
  'caps',
  'underline',
  'strike',
  'fill',
  'fillA',
];
const pickKeys = (o, keys) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
const sameO = (a, b) => RUN_KEYS.every((k) => a[k] === b[k]);
const decoOf = (u, s) => [u && 'underline', s && 'line-through'].filter(Boolean).join(' ');

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.t) continue;
    const last = out.at(-1);
    if (last && sameO(last.o, r.o)) last.t += r.t;
    else out.push({ t: r.t, o: { ...r.o } });
  }
  return out;
}

// Drop overrides that match the layer, so runs only say what's different.
function pruneO(o, t) {
  const out = {};
  for (const k of RUN_KEYS) if (o[k] != null && o[k] !== t[k]) out[k] = o[k];
  return out;
}

// The overrides a run tspan carries (its own attributes, not inherited).
function runFrom(ts, t) {
  const o = {};
  const a = (k) => ts.getAttribute(k);
  if (a('font-family')) o.family = fontFromCss(a('font-family'));
  if (a('font-weight'))
    o.weight = parseInt(a('font-weight'), 10) || (a('font-weight') === 'bold' ? 700 : 400);
  if (a('font-style')) o.italic = /italic|oblique/.test(a('font-style'));
  if (a('font-size')) o.size = parseFloat(a('font-size'));
  if (ts.dataset.tracking != null) o.tracking = parseFloat(ts.dataset.tracking);
  const bs = a('baseline-shift');
  if (bs === 'super' || bs === 'sub') o.script = bs;
  else if (bs) {
    o.shift = (parseFloat(bs) || 0) + (t.script === 'none' ? t.shift : 0);
    o.script = 'none';
  }
  if (a('font-variant') || ts.style.textTransform)
    o.caps =
      ts.style.textTransform === 'uppercase'
        ? 'all'
        : /small-caps/.test(a('font-variant') || '')
          ? 'small'
          : 'none';
  if (a('text-decoration')) {
    o.underline = /underline/.test(a('text-decoration'));
    o.strike = /line-through/.test(a('text-decoration'));
  }
  if (a('fill')) o.fill = a('fill');
  if (a('fill-opacity')) o.fillA = parseFloat(a('fill-opacity'));
  return pruneO(o, t);
}

// Attributes for one run tspan. Values that inherit badly are written
// out in full: letter-spacing is absolute, so a run with its own size
// gets its own; baseline-shift stacks, so it's written relative.
function runAttrs(o, t) {
  const e = { ...t, ...o };
  const at = { 'data-run': '' };
  if (o.family != null) at['font-family'] = fontByName(o.family).css;
  if (o.weight != null) at['font-weight'] = o.weight;
  if (o.italic != null) at['font-style'] = o.italic ? 'italic' : 'normal';
  if (o.size != null) at['font-size'] = f(o.size);
  if (o.tracking != null || o.size != null) {
    const ls = (e.tracking * e.size) / 1000;
    if (ls || t.tracking) at['letter-spacing'] = f(ls);
    if (o.tracking != null) at['data-tracking'] = o.tracking;
  }
  if (o.script != null && o.script !== 'none') at['baseline-shift'] = o.script;
  else if (o.shift != null) at['baseline-shift'] = f(o.shift - (t.script === 'none' ? t.shift : 0));
  if (o.caps != null) {
    at['font-variant'] = o.caps === 'small' ? 'small-caps' : 'normal';
    at.style = `text-transform:${o.caps === 'all' ? 'uppercase' : 'none'}`;
  }
  if (o.fill != null) at.fill = o.fill;
  if (o.fillA != null) at['fill-opacity'] = f(o.fillA);
  return at;
}

// Text from other editors: a tspan with its own x / y / dy starts a line.
function foreignText(el) {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.localName === 'tspan') {
      if (out && (n.hasAttribute('x') || n.hasAttribute('dy') || n.hasAttribute('y'))) out += '\n';
      out += n.textContent;
    }
  }
  return out.replace(/\s*\n\s*/g, '\n').trim();
}

function rawRuns(el) {
  // Text on a path: one line of runs inside the <textPath>.
  const tp = tpOf(el);
  if (tp) {
    const t = typeFrom(el);
    const runs = [];
    for (const n of tp.childNodes) {
      if (n.nodeType === 3) runs.push({ t: n.textContent, o: {} });
      else if (n.localName === 'tspan') runs.push({ t: n.textContent, o: runFrom(n, t) });
    }
    return mergeRuns(runs);
  }
  const lines = [...el.children].filter(
    (c) => c.localName === 'tspan' && c.hasAttribute('data-line'),
  );
  if (!lines.length) return mergeRuns([{ t: foreignText(el), o: {} }]);
  const t = typeFrom(el);
  const runs = [];
  lines.forEach((l, i) => {
    if (i) runs.push({ t: l.hasAttribute('data-soft') ? ' ' : '\n', o: runs.at(-1)?.o || {} });
    for (const n of l.childNodes) {
      if (n.nodeType === 3) runs.push({ t: n.textContent, o: {} });
      else if (n.localName === 'tspan') runs.push({ t: n.textContent, o: runFrom(n, t) });
    }
  });
  return mergeRuns(runs);
}

const rawText = (el) =>
  rawRuns(el)
    .map((r) => r.t)
    .join('');

const measureCtx = document.createElement('canvas').getContext('2d');
function measurer(t) {
  measureCtx.font = `${t.italic ? 'italic ' : ''}${t.caps === 'small' ? 'small-caps ' : ''}${t.weight} ${t.size}px ${fontByName(t.family).css}`;
  const ls = (t.tracking * t.size) / 1000;
  return (s) =>
    measureCtx.measureText(t.caps === 'all' ? s.toUpperCase() : s).width + ls * s.length;
}

// Width of a list of styled characters, each stretch in its own font.
function charsWidth(chars, t) {
  let sum = 0;
  for (let k = 0; k < chars.length; ) {
    let j = k;
    while (j < chars.length && chars[j].o === chars[k].o) j++;
    sum += measurer({ ...t, ...chars[k].o })(
      chars
        .slice(k, j)
        .map((c) => c.ch)
        .join(''),
    );
    k = j;
  }
  return sum;
}

// Greedy word wrap of one paragraph (styled characters) to width w.
function wrapChars(chars, w, t) {
  if (!chars.length) return [[]];
  const trimEnd = (arr) => {
    let e = arr.length;
    while (e && /\s/.test(arr[e - 1].ch)) e--;
    return arr.slice(0, e);
  };
  const words = [];
  let cur = [];
  for (const c of chars) {
    cur.push(c);
    if (/\s/.test(c.ch)) {
      words.push(cur);
      cur = [];
    }
  }
  if (cur.length) words.push(cur);
  const out = [];
  let line = [];
  for (const word of words) {
    if (!line.length || charsWidth(trimEnd([...line, ...word]), t) <= w) {
      line = [...line, ...word];
      // A single word wider than the box breaks between letters.
      while (charsWidth(trimEnd(line), t) > w && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && charsWidth(line.slice(0, k), t) > w) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    } else {
      out.push(trimEnd(line));
      line = word;
    }
  }
  out.push(trimEnd(line));
  return out;
}

const leadingOf = (t) => t.leading || t.size * 1.2;

// Write content (a string, runs, or the layer's own runs) into the layer:
// wrap, place each line (auto leading = 120% of its largest size, as in
// Photoshop) and group characters back into run tspans.
function layoutText(el, content) {
  const runs = mergeRuns(
    content == null ? rawRuns(el) : typeof content === 'string' ? [{ t: content, o: {} }] : content,
  );
  const t = typeFrom(el);
  const x0 = parseFloat(el.getAttribute('x')) || 0;
  const y0 = parseFloat(el.getAttribute('y')) || 0;
  const ax = t.box ? x0 + { start: 0, middle: t.box / 2, end: t.box }[t.align] : x0;
  const hard = [[]];
  for (const r of runs)
    for (const ch of r.t) ch === '\n' ? hard.push([]) : hard.at(-1).push({ ch, o: r.o });
  const lines = [];
  for (const h of hard)
    (t.box ? wrapChars(h, t.box, t) : [h]).forEach((p, i) => lines.push({ chars: p, soft: i > 0 }));
  // Decorations can't be switched off inside an underlined parent, so
  // when runs disagree each run carries its own and the layer none.
  const perRun = runs.some((r) => r.o.underline != null || r.o.strike != null);
  const layerDeco = decoOf(t.underline, t.strike);
  el.setAttribute('data-deco', layerDeco);
  if (perRun || !layerDeco) el.removeAttribute('text-decoration');
  else el.setAttribute('text-decoration', layerDeco);
  el.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  // Characters grouped back into text nodes and run tspans.
  const runNodes = (chars) => {
    const out = [];
    for (let k = 0; k < chars.length; ) {
      let j = k;
      while (j < chars.length && chars[j].o === chars[k].o) j++;
      const text = chars
        .slice(k, j)
        .map((c) => c.ch)
        .join('');
      const o = chars[k].o;
      if (!Object.keys(o).length && !perRun) out.push(document.createTextNode(text));
      else {
        const ts = mk('tspan', runAttrs(o, t));
        if (perRun)
          ts.setAttribute(
            'text-decoration',
            decoOf(o.underline ?? t.underline, o.strike ?? t.strike) || 'none',
          );
        ts.textContent = text;
        out.push(ts);
      }
      k = j;
    }
    return out;
  };
  // Text on a path is one line: its runs go inside the <textPath>, and
  // line breaks become spaces.
  const tp = tpOf(el);
  if (tp) {
    const chars = [];
    for (const r of runs) for (const ch of r.t) chars.push({ ch: ch === '\n' ? ' ' : ch, o: r.o });
    tp.replaceChildren(...runNodes(chars));
    if (el.firstChild !== tp || el.childNodes.length > 1) el.replaceChildren(tp);
    return;
  }
  let y = y0;
  el.replaceChildren(
    ...lines.map(({ chars, soft }, i) => {
      const big = chars.length ? Math.max(...chars.map((c) => c.o.size ?? t.size)) : t.size;
      if (i) y += t.leading || big * 1.2;
      const line = mk('tspan', { x: f(ax), y: f(y), 'data-line': '' });
      if (soft) line.setAttribute('data-soft', '');
      line.append(...runNodes(chars));
      return line;
    }),
  );
}

// Text layers among the selection (including inside selected groups).
function selectedTexts() {
  const out = [];
  for (const el of state.sel) {
    if (el.localName === 'text') out.push(el);
    else out.push(...el.querySelectorAll('text'));
  }
  return out;
}

// ---- text on a path (Illustrator's Type on a Path) --------------------------
// <text data-sc-textpath="<path layer id>"><textPath href="#sc-tp-N"
// startOffset="…%">runs…</textPath></text>. SVG lays the text along the
// referenced path in the text's own coordinates and ignores that path's
// transform, so the textPath points at a generated copy of the path layer's
// geometry (sc-tp-N in defs, data-sc-tp), mapped into the text's space and
// kept in step by syncTextPaths(): moving, transforming or point-editing
// the path layer re-flows the text. If the path layer goes away, the text
// keeps the last copy and stays where it was. data-sc-flip on the text puts
// it on the other side of the path, by running the copy backwards (Chromium
// ignores textPath's side attribute).
const TP_SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const tpOf = (el) => (el?.localName === 'text' ? el.querySelector(':scope > textPath') : null);
const isTP = (el) => !!tpOf(el);
const tpRef = (tp) => /^#(sc-tp-\d+)$/.exec(tp.getAttribute('href') || '')?.[1];
// The generated path a textPath runs along (any id, as imports rename them).
const tpHost = (tp) => {
  const h = tp.getAttribute('href') || tp.getAttributeNS(XLINK, 'href') || '';
  const n = h.startsWith('#') ? document.getElementById(h.slice(1)) : null;
  return n?.localName === 'path' ? n : null;
};
const tpOffset = (tp) => clamp(parseFloat(tp.getAttribute('startOffset')) || 0, 0, 100);
// The path layer a text-on-path is linked to, if it's still in the drawing.
function tpSource(el) {
  const id = el.getAttribute('data-sc-textpath');
  const src = id && document.getElementById(id);
  return src && doc.contains(src) && TP_SHAPES.has(src.localName) && src !== el ? src : null;
}

// The path layer's geometry in the text's coordinates (backwards if flipped).
function tpGeometry(el, src) {
  const M = fullM(el).inverse().multiply(fullM(src));
  const T = (p) => {
    const q = new DOMPoint(p.x, p.y).matrixTransform(M);
    return { x: q.x, y: q.y };
  };
  let subs = shapeNodes(src).map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({ ...T(n), hin: n.hin && T(n.hin), hout: n.hout && T(n.hout) })),
  }));
  if (el.hasAttribute('data-sc-flip'))
    subs = subs.reverse().map((sp) => {
      const n = sp.nodes.map((nd) => ({ ...nd, hin: nd.hout, hout: nd.hin })).reverse();
      // A closed path keeps its starting point.
      if (sp.closed) n.unshift(n.pop());
      return { closed: sp.closed, nodes: n };
    });
  return nodesD(subs);
}

function syncTextPaths() {
  const owned = new Set();
  for (const el of doc.querySelectorAll('text[data-sc-textpath]')) {
    const tp = tpOf(el);
    if (!tp) continue;
    const old = tpHost(tp);
    let id = tpRef(tp);
    let host = id && old?.closest('#sc-defs') ? old : null;
    if (!host || owned.has(id)) {
      let n = 1;
      while (document.getElementById(`sc-tp-${n}`) || owned.has(`sc-tp-${n}`)) n++;
      id = `sc-tp-${n}`;
      host = mk('path', { id, 'data-sc-tp': '' }, defs);
      // Start from the copy it had (a deleted path layer's last shape).
      if (old) host.setAttribute('d', old.getAttribute('d') || '');
      tp.setAttribute('href', `#${id}`);
    }
    tp.removeAttributeNS(XLINK, 'href');
    owned.add(id);
    const src = tpSource(el);
    if (src) {
      const d = tpGeometry(el, src);
      if (host.getAttribute('d') !== d) host.setAttribute('d', d);
    }
  }
  // Symbols (and layers set aside while editing one) may use it too.
  const kept = keptIds();
  for (const host of defs.querySelectorAll(':scope > path[data-sc-tp]'))
    if (!owned.has(host.id) && !kept.has(host.id)) host.remove();
}
let tpQueued = false;
new MutationObserver(() => {
  if (tpQueued) return;
  tpQueued = true;
  queueMicrotask(() => {
    tpQueued = false;
    syncTextPaths();
  });
}).observe(doc, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: [
    ...SA_GEOM,
    'x1',
    'y1',
    'x2',
    'y2',
    'transform',
    'id',
    'data-sc-textpath',
    'data-sc-flip',
    'href',
  ],
});

// Point and direction (degrees) at a fraction of a text-on-path's path.
function tpPointAt(el, frac) {
  const host = tpHost(tpOf(el));
  if (!host) return null;
  let len;
  try {
    len = host.getTotalLength();
  } catch {
    return null;
  }
  const s = clamp(frac, 0, 1) * len;
  const p = host.getPointAtLength(s);
  const a = host.getPointAtLength(Math.max(0, Math.min(len, s - 0.5)));
  const b = host.getPointAtLength(Math.max(0, Math.min(len, s + 0.5)));
  return { x: p.x, y: p.y, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI || 0 };
}

// Object → Text on Path: the selected text layer runs along the selected shape.
function textOnPath() {
  const sel = normalizeSel(state.sel);
  const texts = sel.filter((el) => el.localName === 'text');
  const shapes = sel.filter((el) => TP_SHAPES.has(el.localName));
  if (sel.length !== 2 || texts.length !== 1 || shapes.length !== 1)
    return warn('Select one text layer and one path or shape (Shift-click both) first.');
  const [el] = texts;
  const [src] = shapes;
  if (refuseLocked([el], 'edit')) return;
  if (typeEdit) finishTypeEdit(true);
  if (!src.id) {
    let n = 1;
    while (document.getElementById(`textpath-${n}`)) n++;
    src.id = `textpath-${n}`;
  }
  const runs = rawRuns(el);
  let tp = tpOf(el);
  if (!tp) {
    const t = typeFrom(el);
    tp = mk('textPath', {
      href: '#',
      startOffset: `${{ start: 0, middle: 50, end: 100 }[t.align]}%`,
    });
    el.replaceChildren(tp);
    for (const a of ['x', 'y', 'data-box', 'data-leading']) el.removeAttribute(a);
  }
  el.setAttribute('data-sc-textpath', src.id);
  layoutText(el, runs);
  syncTextPaths();
  state.sel = [el];
  commit();
  readTypeFromSelection();
  say('Text on Path: move or edit the path and the text follows. Hide the path if you like.');
}

// Object → Release Text on Path: back to one line of point text where the
// text started on the path.
function releaseTextOnPath(els = normalizeSel(state.sel)) {
  const targets = els.filter(isTP);
  if (!targets.length) return warn('Select a text-on-path layer to release.');
  if (refuseLocked(targets, 'edit')) return;
  if (typeEdit) finishTypeEdit(true);
  for (const el of targets) {
    const p = tpPointAt(el, tpOffset(tpOf(el)) / 100) || { x: 0, y: 0 };
    const runs = rawRuns(el);
    el.replaceChildren();
    el.removeAttribute('data-sc-textpath');
    el.removeAttribute('data-sc-flip');
    el.setAttribute('x', f(p.x));
    el.setAttribute('y', f(p.y));
    layoutText(el, runs);
  }
  commit();
  readTypeFromSelection();
}

// ---- text-on-path options (Properties panel)
const tpTarget = () => (state.sel.length === 1 && isTP(state.sel[0]) ? state.sel[0] : null);
const tpCanMake = () => {
  const sel = state.sel;
  return (
    sel.length === 2 &&
    sel.some((el) => el.localName === 'text') &&
    sel.some((el) => TP_SHAPES.has(el.localName))
  );
};
function syncTextPathUI() {
  const el = tpTarget();
  $('#sc-tp-props').hidden = !el && !tpCanMake();
  $('#sc-tp-opts').hidden = !el;
  $('#sc-tp-make').hidden = !!el;
  if (!el) return;
  const tp = tpOf(el);
  const off = $('#sc-tp-offset');
  if (document.activeElement !== off) off.value = f(tpOffset(tp));
  const align = typeFrom(el).align;
  for (const b of document.querySelectorAll('[data-tp-align]'))
    b.setAttribute('aria-checked', b.dataset.tpAlign === align);
  $('#sc-tp-flip').setAttribute('aria-pressed', el.hasAttribute('data-sc-flip'));
  $('#sc-tp-unlinked').hidden = !!tpSource(el);
}
function tpChange(fn, final = true) {
  const el = tpTarget();
  if (!el || refuseLocked([el], 'edit')) return syncTextPathUI();
  fn(el, tpOf(el));
  if (final) commit();
  else drawSelection();
  readTypeFromSelection();
}
{
  const off = $('#sc-tp-offset');
  const setOff = (final) =>
    tpChange(
      (el, tp) => tp.setAttribute('startOffset', `${f(clamp(+off.value || 0, 0, 100))}%`),
      final,
    );
  off.addEventListener('input', () => setOff(false));
  off.addEventListener('change', () => setOff(true));
  for (const b of document.querySelectorAll('[data-tp-align]'))
    b.addEventListener('click', () =>
      tpChange((el, tp) => {
        const a = b.dataset.tpAlign;
        if (a === 'start') el.removeAttribute('text-anchor');
        else el.setAttribute('text-anchor', a);
        tp.setAttribute('startOffset', `${{ start: 0, middle: 50, end: 100 }[a]}%`);
      }),
    );
  $('#sc-tp-flip').addEventListener('click', () =>
    tpChange((el) => el.toggleAttribute('data-sc-flip')),
  );
  $('#sc-tp-release').addEventListener('click', () => releaseTextOnPath());
  $('#sc-tp-make').addEventListener('click', () => textOnPath());
}
