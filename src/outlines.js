// SVGCraft — Type → Create Outlines.
'use strict';

// ---- Create Outlines -------------------------------------------------------------
// Illustrator's Type → Create Outlines: each
// text layer becomes a group of filled paths that look the same. The
// browser has already laid the text out, so every character goes exactly
// where it's drawn on screen (kerning, tracking, lines, alignment and
// baseline shifts included); only the glyph shapes come from the font
// file, read by opentype.js (MIT, vendor/opentype.min.js), which loads the
// first time it's needed.
let otJob = null;
function loadOpentype() {
  if (window.opentype?.parse) return Promise.resolve(window.opentype);
  otJob ||= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/opentype.min.js';
    sc.onload = () => resolve(window.opentype);
    sc.onerror = () => {
      otJob = null;
      reject(new Error('opentype.js failed to load'));
    };
    document.head.append(sc);
  });
  return otJob;
}

// Font files come from Fontsource's CDN as WOFF (opentype.js can't read
// WOFF2), one file per subset; latin first, the others only when a
// character needs them.
const FONTSOURCE = 'https://cdn.jsdelivr.net/fontsource/fonts/';
const FS_SUBSETS = [
  'latin',
  'latin-ext',
  'cyrillic',
  'cyrillic-ext',
  'greek',
  'greek-ext',
  'vietnamese',
];
const fsId = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
// Open families that stand in for system fonts whose files can't be read,
// metric-compatible where one exists (Arimo, Tinos and Cousine match
// Arial, Times New Roman and Courier New letter for letter).
const ARIMO = { name: 'Arimo', w: [400, 500, 600, 700], i: true };
const TINOS = { name: 'Tinos', w: [400, 700], i: true };
const COUSINE = { name: 'Cousine', w: [400, 700], i: true };
const ROBOTO = { name: 'Roboto', w: ALL_W, i: true };
const ANTON = { name: 'Anton', w: [400], i: false };
const OUTLINE_SUBS = {
  'system ui': ROBOTO,
  'system-ui': ROBOTO,
  arial: ARIMO,
  helvetica: ARIMO,
  'helvetica neue': ARIMO,
  'liberation sans': ARIMO,
  'sans-serif': ARIMO,
  'times new roman': TINOS,
  times: TINOS,
  'liberation serif': TINOS,
  serif: TINOS,
  'courier new': COUSINE,
  courier: COUSINE,
  'liberation mono': COUSINE,
  monospace: COUSINE,
  georgia: { name: 'Gelasio', w: [400, 500, 600, 700], i: true },
  verdana: { name: 'DejaVu Sans', w: [400, 700], i: true },
  'trebuchet ms': { name: 'Fira Sans', w: ALL_W, i: true },
  impact: ANTON,
  fantasy: ANTON,
  cursive: { name: 'Dancing Script', w: [400, 500, 600, 700], i: false },
};
const CHROMIUM = !!navigator.userAgentData?.brands?.some((b) => b.brand === 'Chromium');
const GENERICS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

// Parsed fonts by URL. Only successes stay, so a failed download is tried
// again next time.
const fontFiles = new Map();
function fetchFont(url) {
  if (!fontFiles.has(url)) {
    const job = (async () => {
      const ot = await loadOpentype();
      const res = await fetch(url);
      return res.ok ? ot.parse(await res.arrayBuffer()) : null;
    })().catch(() => null);
    fontFiles.set(url, job);
    job.then((ft) => ft || fontFiles.delete(url));
  }
  return fontFiles.get(url);
}

// A face: where a family / weight / italic gets its glyphs. `ready` is its
// main (latin) font, or null when it couldn't be downloaded.
function fsFace(spec, weight, italic, subFor) {
  const ital = italic && spec.i !== false;
  const w0 = spec.w
    ? spec.w.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a))
    : weight;
  // A family outside the catalogue: its weights and italics are unknown.
  const tries = [[w0, ital]];
  if (!spec.w && ital) tries.push([w0, false]);
  if (!spec.w && w0 !== 400) tries.push([400, ital]);
  const file = (sub, [w, it]) =>
    `${FONTSOURCE}${fsId(spec.name)}@latest/${sub}-${w}-${it ? 'italic' : 'normal'}.woff`;
  const face = { name: spec.name, subFor, subsets: FS_SUBSETS, synthItalic: false, w: w0 };
  face.ready = (async () => {
    for (const t of tries) {
      const ft = await fetchFont(file('latin', t));
      if (!ft) continue;
      face.pick = t;
      face.w = t[0];
      face.synthItalic = italic && !t[1];
      return ft;
    }
    return null;
  })();
  const memo = new Map([['latin', face.ready]]);
  face.font = (sub) => {
    if (!memo.has(sub))
      memo.set(
        sub,
        face.ready.then((l) => l && fetchFont(file(sub, face.pick))),
      );
    return memo.get(sub);
  };
  return face;
}

// Fonts installed on this computer, read through Local Font Access, but
// only once the browser already allows it (the font picker asks), so
// creating outlines never pops up a permission prompt.
let installedJob = null;
async function installedFonts() {
  if (!('queryLocalFonts' in window)) return [];
  try {
    const p = await navigator.permissions.query({ name: 'local-fonts' });
    if (p.state !== 'granted') return [];
  } catch {
    return [];
  }
  installedJob ||= window.queryLocalFonts().catch(() => {
    installedJob = null;
    return [];
  });
  return installedJob;
}
const localFiles = new Map();
async function localFace(family, weight, italic) {
  const list = (await installedFonts()).filter(
    (d) => d.family.toLowerCase() === family.toLowerCase(),
  );
  if (!list.length) return null;
  const isIt = (d) => /italic|oblique/i.test(d.style);
  const score = (d) =>
    Math.abs(styleWeight(d.style.toLowerCase()) - weight) + (isIt(d) !== italic ? 1000 : 0);
  const d = list.reduce((a, b) => (score(b) < score(a) ? b : a));
  if (!localFiles.has(d.postscriptName))
    localFiles.set(
      d.postscriptName,
      loadOpentype()
        .then(async (ot) => ot.parse(await (await d.blob()).arrayBuffer()))
        .catch(() => null),
    );
  const ft = await localFiles.get(d.postscriptName);
  if (!ft) return null;
  return {
    name: family,
    subFor: null,
    subsets: ['latin'],
    synthItalic: italic && !isIt(d),
    w: styleWeight(d.style.toLowerCase()),
    ready: Promise.resolve(ft),
    font: async () => ft,
  };
}

// The face for one character style: a Google family from Fontsource; an
// installed font when the browser lets us read it; otherwise an open
// stand-in (noted in `subs` for the message).
async function outlineFace(family, generic, weight, italic) {
  const cat = FONTS.find((ft) => ft.name.toLowerCase() === family.toLowerCase());
  if (cat?.src === 'google') return fsFace(cat, weight, italic, null);
  const local = await localFace(family, weight, italic);
  if (local) return local;
  const sub = OUTLINE_SUBS[family.toLowerCase()];
  if (sub) return fsFace(sub, weight, italic, family);
  if (!cat) {
    // Not in the catalogue, but it may well be on Google Fonts.
    const face = fsFace({ name: family }, weight, italic, null);
    if (await face.ready) return face;
  }
  return fsFace(OUTLINE_SUBS[generic] || ARIMO, weight, italic, family);
}

// A computed paint as [value, alpha]: colours as hex, url(…) made local.
function cssPaint(v) {
  if (!v || v === 'none') return ['none', 1];
  const u = /url\(\s*["']?[^#"')]*#([^"')]+)["']?\s*\)/.exec(v);
  if (u) return [`url(#${u[1]})`, 1];
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) {
    const [r, g, b, a = 1] = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(parseFloat);
    return ['#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join(''), a];
  }
  return [v, 1];
}

// Path attributes for a character's computed paint, defaults left out.
function outlinePaint(cs) {
  const out = {};
  const [fill, fa] = cssPaint(cs.fill);
  out.fill = fill;
  const fo = parseFloat(cs.fillOpacity) * fa;
  if (fill !== 'none' && fo !== 1) out['fill-opacity'] = f(fo);
  const [stroke, sa] = cssPaint(cs.stroke);
  if (stroke !== 'none') {
    out.stroke = stroke;
    out['stroke-width'] = f(parseFloat(cs.strokeWidth));
    const so = parseFloat(cs.strokeOpacity) * sa;
    if (so !== 1) out['stroke-opacity'] = f(so);
    if (cs.strokeLinecap !== 'butt') out['stroke-linecap'] = cs.strokeLinecap;
    if (cs.strokeLinejoin !== 'miter') out['stroke-linejoin'] = cs.strokeLinejoin;
    if (parseFloat(cs.strokeMiterlimit) !== 4) out['stroke-miterlimit'] = cs.strokeMiterlimit;
    if (cs.strokeDasharray && cs.strokeDasharray !== 'none')
      out['stroke-dasharray'] = cs.strokeDasharray.replace(/px/g, '');
    if (parseFloat(cs.strokeDashoffset))
      out['stroke-dashoffset'] = f(parseFloat(cs.strokeDashoffset));
  }
  if (cs.paintOrder && cs.paintOrder !== 'normal') out['paint-order'] = cs.paintOrder;
  return out;
}

function charStyle(p) {
  const cs = getComputedStyle(p);
  const stack = cs.fontFamily
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const st = {
    css: cs.fontFamily,
    family: fontFromCss(cs.fontFamily),
    generic: stack.find((s) => GENERICS.has(s)) || 'sans-serif',
    weight: parseInt(cs.fontWeight, 10) || 400,
    italic: /italic|oblique/.test(cs.fontStyle),
    size: parseFloat(cs.fontSize) || 16,
    caps: cs.textTransform,
    small: cs.fontVariantCaps === 'small-caps' || /small-caps/.test(cs.fontVariant),
    shown: cs.visibility === 'visible',
    deco: cs.textDecorationLine || '',
    paint: outlinePaint(cs),
  };
  st.key = JSON.stringify([st.family, st.weight, st.italic, st.size, st.paint]);
  return st;
}

// Browsers collapse white space in text that isn't xml:space="preserve"
// (other editors' text); find the reading that matches the layout.
function matchChars(chars, n) {
  if (chars.length === n) return chars;
  for (const nl of [' ', '']) {
    const out = [];
    for (const ch of chars) {
      const c = /[\n\r]/.test(ch.c) ? nl : ch.c === '\t' ? ' ' : ch.c;
      if (!c || (c === ' ' && (!out.length || out.at(-1).c === ' '))) continue;
      out.push({ ...ch, c });
    }
    if (out.length === n) return out;
    if (out.at(-1)?.c === ' ' && out.length - 1 === n) return out.slice(0, -1);
  }
  return null;
}

// Path commands of one glyph at (ox, oy), rotated by rot degrees, with an
// optional synthetic-italic shear (Chromium slants by 1/4).
function glyphD(font, s, size, ox, oy, rot, skew, out) {
  const r = (rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  let dx = 0;
  for (const g of font.stringToGlyphs(s)) {
    const T = (x, y) => {
      x += dx - y * skew;
      return `${f(ox + x * cos - y * sin)} ${f(oy + x * sin + y * cos)}`;
    };
    for (const c of g.getPath(0, 0, size).commands)
      if (c.type === 'M' || c.type === 'L') out.push(c.type + T(c.x, c.y));
      else if (c.type === 'Q') out.push(`Q${T(c.x1, c.y1)} ${T(c.x, c.y)}`);
      else if (c.type === 'C') out.push(`C${T(c.x1, c.y1)} ${T(c.x2, c.y2)} ${T(c.x, c.y)}`);
      else if (c.type === 'Z') out.push('Z');
    dx += ((g.advanceWidth || 0) * size) / font.unitsPerEm;
  }
}

// Attributes a text layer passes on to its outlines group: everything but
// its type and paint settings (those go onto the paths).
const TEXT_ONLY =
  /^(x|y|dx|dy|rotate|textLength|lengthAdjust|xml:space|data-(deco|box|leading|tracking|name|stroke-align)|inkscape:label|font-.*|letter-spacing|word-spacing|text-.*|baseline-shift|dominant-baseline|alignment-baseline|writing-mode|direction|unicode-bidi|fill.*|stroke.*|paint-order|style)$/;
const TEXT_CSS =
  /^(font|text-|letter-|word-|white-space|fill|stroke|paint-order|baseline|dominant|alignment|direction|unicode|writing)/;

// Outline one text layer into a new (detached) group. Throws with a
// reason when it can't.
async function outlineText(el, faces, note) {
  const HOSTS = new Set(['text', 'tspan', 'textPath', 'a']);
  let chars = [];
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode()); )
    if (HOSTS.has(n.parentNode.localName))
      for (let k = 0; k < n.data.length; k++) chars.push({ c: n.data[k], p: n.parentNode });
  const styles = new Map();
  const st = (p) => {
    if (!styles.has(p)) styles.set(p, charStyle(p));
    return styles.get(p);
  };
  for (const ch of chars) st(ch.p);

  // The on-screen fonts must have arrived, or the positions would be the
  // fallback font's.
  const wait = new Map();
  const sample = el.textContent;
  for (const s of styles.values()) {
    ensureFont(s.family);
    const spec = `${s.italic ? 'italic ' : ''}${s.weight} ${s.size}px ${s.css}`;
    if (!wait.has(spec))
      wait.set(
        spec,
        Promise.race([
          document.fonts.load(spec, sample).catch(() => null),
          new Promise((r) => setTimeout(r, 3000)),
        ]),
      );
  }
  await Promise.all(wait.values());

  // Where the browser put each character (a hidden layer is shown for the
  // moment it takes to read that).
  const hidden = [];
  for (let a = el; a && a !== doc; a = a.parentNode)
    if (a.getAttribute?.('display') === 'none') hidden.push(a);
  const items = [];
  try {
    for (const a of hidden) a.removeAttribute('display');
    chars = matchChars(chars, el.getNumberOfChars());
    if (!chars) throw new Error('its characters don’t match its layout');
    for (let i = 0; i < chars.length; i++) {
      const { p } = chars[i];
      let c = chars[i].c;
      const j = /[\uD800-\uDBFF]/.test(c) && i + 1 < chars.length ? i + 1 : i;
      if (j > i) c += chars[j].c;
      let s, e, rot;
      try {
        s = el.getStartPositionOfChar(i);
        e = el.getEndPositionOfChar(j);
        rot = el.getRotationOfChar(i);
      } catch {
        i = j;
        continue;
      }
      items.push({ c, p, x: s.x, y: s.y, ex: e.x, ey: e.y, rot, prev: chars[i - 1]?.c });
      i = j;
    }
  } finally {
    for (const a of hidden) a.setAttribute('display', 'none');
  }

  const faceFor = (s) => {
    const k = `${s.family}|${s.generic}|${s.weight}|${s.italic}`;
    if (!faces.has(k)) faces.set(k, outlineFace(s.family, s.generic, s.weight, s.italic));
    return faces.get(k);
  };
  const groups = new Map();
  const groupOf = (s) => {
    if (!groups.has(s.key)) groups.set(s.key, { paint: s.paint, d: [] });
    return groups.get(s.key);
  };
  const mainFont = async (s) => {
    const face = await faceFor(s);
    const ft = await face.ready;
    if (!ft) throw new Error(`the font ${face.name} couldn’t be downloaded`);
    if (face.subFor) note.subs.add(`${face.name} for ${face.subFor}`);
    return { face, ft };
  };

  for (const it of items) {
    const s = st(it.p);
    if (!s.shown) continue;
    const { face } = await mainFont(s);
    let c = it.c;
    if (s.caps === 'uppercase') c = c.toUpperCase();
    else if (s.caps === 'lowercase') c = c.toLowerCase();
    else if (s.caps === 'capitalize' && (!it.prev || /\s/.test(it.prev))) c = c.toUpperCase();
    let size = s.size;
    if (s.small && c !== c.toUpperCase()) {
      c = c.toUpperCase();
      size *= 0.7;
    }
    if (/^\s+$/.test(c)) continue;
    let ft = null;
    for (const sub of face.subsets) {
      const cand = await face.font(sub);
      if (cand && cand.charToGlyphIndex(c) > 0) {
        ft = cand;
        break;
      }
    }
    if (!ft) {
      note.missing++;
      continue;
    }
    // Right-to-left characters run from their end point.
    const back = !it.rot && it.ex < it.x;
    glyphD(
      ft,
      c,
      size,
      back ? it.ex : it.x,
      back ? it.ey : it.y,
      it.rot,
      face.synthItalic ? 0.25 : 0,
      groupOf(s).d,
    );
  }

  // Underline and strikethrough: one bar per stretch of characters that
  // the same element decorates, in that element's paint. Chromium places
  // them by its own rules (a tenth of the size thick; underline just below
  // the baseline, strikethrough a third of the ascent above it), other
  // browsers by the font's post / OS/2 metrics, so match whichever drew it.
  const open = new Map();
  const bars = [];
  const ids = new Map();
  const idOf = (a) => {
    if (!ids.has(a)) ids.set(a, ids.size);
    return ids.get(a);
  };
  for (const it of items) {
    const on = new Set();
    for (let a = it.p; a; a = a === el ? null : a.parentNode) {
      const s = st(a);
      for (const kind of ['underline', 'line-through'])
        if (s.deco.includes(kind)) {
          const k = `${kind}|${idOf(a)}`;
          on.add(k);
          const seg = open.get(k);
          if (seg && Math.abs(it.x - seg.x2) < s.size * 0.5 && Math.abs(it.y - seg.y) < s.size)
            seg.x2 = Math.max(seg.x2, it.ex);
          else {
            const nseg = {
              kind,
              el: a,
              y: it.y,
              x1: Math.min(it.x, it.ex),
              x2: Math.max(it.x, it.ex),
            };
            open.set(k, nseg);
            bars.push(nseg);
          }
        }
    }
    for (const k of open.keys()) if (!on.has(k)) open.delete(k);
  }
  for (const b of bars) {
    const s = st(b.el);
    if (!s.shown) continue;
    const { ft } = await mainFont(s);
    const sc = s.size / ft.unitsPerEm;
    const post = ft.tables.post || {};
    const os2 = ft.tables.os2 || {};
    let top, h;
    if (CHROMIUM) {
      h = Math.max(1, s.size / 10);
      top =
        b.kind === 'underline'
          ? b.y + Math.max(1, Math.ceil(h / 2))
          : b.y - (ft.ascender * sc) / 3 - h / 2;
    } else if (b.kind === 'underline') {
      h = (post.underlineThickness || ft.unitsPerEm / 14) * sc;
      top = b.y - (post.underlinePosition ?? -ft.unitsPerEm / 10) * sc - h / 2;
    } else {
      h = (os2.yStrikeoutSize || post.underlineThickness || ft.unitsPerEm / 14) * sc;
      top = b.y - (os2.yStrikeoutPosition || ft.unitsPerEm * 0.3) * sc;
    }
    groupOf(s).d.push(`M${f(b.x1)} ${f(top)}H${f(b.x2)}V${f(top + h)}H${f(b.x1)}Z`);
  }

  const parts = [...groups.values()].filter((gp) => gp.d.length);
  if (!parts.length) throw new Error('it has no visible characters');
  const g = mk('g');
  for (const a of el.attributes) {
    if (TEXT_ONLY.test(a.name)) continue;
    if ((a.name === 'clip-path' || a.name === 'mask') && /#sc-sa-/.test(a.value)) continue;
    g.setAttributeNS(a.namespaceURI, a.name, a.value);
  }
  for (const k of el.style)
    if (!TEXT_CSS.test(k))
      g.style.setProperty(k, el.style.getPropertyValue(k), el.style.getPropertyPriority(k));
  const name = customName(el) || rawText(el).replace(/\s+/g, ' ').trim().slice(0, 28);
  g.setAttribute('data-name', `${name} (outlines)`);
  for (const gp of parts) mk('path', { ...gp.paint, 'fill-rule': 'nonzero', d: gp.d.join('') }, g);
  return g;
}

async function createOutlines() {
  if (typeEdit) finishTypeEdit(true);
  const sel = normalizeSel(state.sel);
  const texts = sel.flatMap((el) =>
    el.localName === 'text' ? [el] : [...(el.querySelectorAll?.('text') || [])],
  );
  if (!texts.length) return warn('Select some text to create outlines.');
  if (refuseLocked(sel, 'edit')) return;
  try {
    await loadOpentype();
  } catch {
    return warn('Couldn’t load the font reader (vendor/opentype.min.js).');
  }
  const note = { subs: new Set(), missing: 0 };
  const faces = new Map();
  const done = new Map();
  const failed = [];
  for (const el of texts)
    try {
      done.set(el, await outlineText(el, faces, note));
    } catch (e) {
      failed.push(`${layerName(el)}: ${e.message}`);
    }
  // Swap them all in at once: one undo step.
  for (const [el, g] of done)
    if (el.isConnected) el.replaceWith(g);
    else done.delete(el);
  const why = failed.length ? ` Couldn’t outline ${failed.join('; ')}, so it’s unchanged.` : '';
  if (!done.size) return warn(`Couldn’t create outlines. ${why.trim()}`);
  state.sel = sel.map((el) => done.get(el) || el);
  commit();
  const n = done.size;
  let msg = `Created outlines${n > 1 ? ` for ${n} text objects` : ''}.`;
  if (note.subs.size)
    msg +=
      ` Used ${[...note.subs].join(', ')}` +
      ('queryLocalFonts' in window
        ? ' (allow installed fonts in the font picker to use your own).'
        : ', since the browser can’t read installed fonts.');
  if (note.missing)
    msg += ` ${note.missing} character${note.missing > 1 ? 's' : ''} the font doesn’t have ${note.missing > 1 ? 'were' : 'was'} left out.`;
  say(msg + why);
}
