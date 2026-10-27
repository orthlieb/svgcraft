// SVGCraft — Import: open, place and paste, sanitised.
'use strict';

// ---------------------------------------------------------------------
// Import (open / place / paste) — sanitised
// ---------------------------------------------------------------------
// Imported SVG goes into the editor's own page, so anything that could run
// script, load from elsewhere or reach outside the drawing is taken out.
// It's an allowlist: only SVG drawing elements (no script, foreignObject,
// animation or HTML from another namespace, such as <html:base>, which
// would redirect the editor's own script loads); no event handlers; links
// only within the file (plus image data and http / mailto on <a>); no
// url() reaching another server; no <style> (its rules are baked into
// style attributes first). <title> and <desc> keep their text only: on undo
// the drawing is re-read as HTML, where their content would be parsed as
// HTML. <metadata> may hold RDF from other namespaces, but never SVG, HTML
// or MathML. sanitize() also bakes in <style>, so every caller gets that.
const SVG_ALLOWED = new Set(
  (
    'svg g defs symbol use switch a title desc metadata path rect circle ellipse line ' +
    'polyline polygon text tspan textPath image clipPath mask marker pattern ' +
    'linearGradient radialGradient stop filter feBlend feColorMatrix ' +
    'feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting ' +
    'feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG ' +
    'feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset ' +
    'fePointLight feSpecularLighting feSpotLight feTile feTurbulence view'
  ).split(' '),
);
const MARKUP_NS = new Set([
  NS,
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
]);
// A URL as the browser reads it: no whitespace or control characters
// anywhere (so "java&#9;script:" can't hide), lower case.
// eslint-disable-next-line no-control-regex -- control characters are the point
const urlOf = (v) => v.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
function hrefAllowed(el, v) {
  const u = urlOf(v);
  if (u.startsWith('#')) return true;
  if (el.localName === 'image') return /^data:image\//.test(u);
  if (el.localName === 'a') return /^(https?:|mailto:)/.test(u);
  return false;
}
// url(…) is fine inside the file (url(#id)); anything else would fetch.
const reachesOut = (v) =>
  [...urlOf(v).matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g)].some((m) => !m[2].startsWith('#')) ||
  /expression\(|-moz-binding|behavior:|@import|javascript:/.test(urlOf(v));

function sanitize(root) {
  inlineStyles(root);
  const kill = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_COMMENT,
  );
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType !== Node.ELEMENT_NODE) {
      kill.push(n);
      continue;
    }
    const inMeta = !!n.parentNode.closest?.('metadata');
    const ok = inMeta
      ? !MARKUP_NS.has(n.namespaceURI)
      : n.namespaceURI === NS && SVG_ALLOWED.has(n.localName);
    if (!ok) kill.push(n);
  }
  for (const n of kill) n.remove();
  // <title> and <desc>: text only.
  for (const t of root.querySelectorAll('title, desc'))
    if (t.children.length) t.replaceChildren(t.textContent);
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      const drop =
        name.startsWith('on') ||
        name === 'xml:base' ||
        ((a.localName === 'href' || name === 'xlink:href') && !hrefAllowed(el, a.value)) ||
        (name === 'class' && /(^|\s)sc-/.test(a.value)) ||
        (name !== 'style' && a.value.includes('url(') && reachesOut(a.value));
      if (drop) el.removeAttributeNS(a.namespaceURI, a.localName);
    }
    const st = el.getAttribute('style');
    if (st && reachesOut(st)) {
      const kept = st.split(';').filter((d) => d.trim() && !reachesOut(d));
      if (kept.length) el.setAttribute('style', kept.join(';'));
      else el.removeAttribute('style');
    }
  }
}

// Bake <style> rules into inline styles so imported CSS can't leak into
// the editor's own UI. Specificity is approximated by source order.
function inlineStyles(root) {
  for (const st of [...root.querySelectorAll('style')]) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(st.textContent);
      const assigned = new Map();
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        let targets;
        try {
          targets = root.querySelectorAll(rule.selectorText);
        } catch {
          continue;
        }
        for (const el of targets) {
          const m = assigned.get(el) || [];
          for (const prop of rule.style) m.push([prop, rule.style.getPropertyValue(prop)]);
          assigned.set(el, m);
        }
      }
      for (const [el, props] of assigned) {
        const own = el.getAttribute('style') || '';
        el.setAttribute(
          'style',
          props.map(([k, v]) => `${k}:${v}`).join(';') + (own ? ';' + own : ''),
        );
      }
    } catch {
      /* unparsable stylesheet — drop it */
    }
    st.remove();
  }
}

// Rename incoming ids that already exist in the drawing, and repoint refs.
// Placed or pasted into a drawing, SVGCraft's own generated ids (sc-…) are
// always renamed. Opening a file replaces the drawing, so its ids only
// change if they clash with the editor's own elements (sc-view, sc-checker…);
// otherwise they'd grow a -2 on every reload.
function dedupeIds(root, againstDrawing) {
  const map = new Map();
  const editorOwn = (id) => {
    const e = document.getElementById(id);
    // The drawing's own content is being replaced; #sc-doc and #sc-defs aren't.
    return !!e && (e === doc || e === defs || (!doc.contains(e) && !defs.contains(e)));
  };
  for (const el of root.querySelectorAll('[id]')) {
    const id = el.id;
    const clash = againstDrawing
      ? id.startsWith('sc-') || document.getElementById(id)
      : editorOwn(id);
    if (!clash) continue;
    let n = 2;
    while (document.getElementById(`${id}-${n}`)) n++;
    map.set(id, `${id}-${n}`);
    el.id = `${id}-${n}`;
  }
  renameRefs([root], map);
}

// Repoint url(#…) and href="#…" references under roots by an old → new id map.
function renameRefs(roots, map) {
  if (!map.size) return;
  for (const r of roots)
    for (const el of [r, ...r.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) {
        let v = a.value;
        for (const [o, nw] of map) {
          v = v
            .split(`url(#${o})`)
            .join(`url(#${nw})`)
            .split(`url("#${o}")`)
            .join(`url(#${nw})`)
            .split(`url('#${o}')`)
            .join(`url(#${nw})`);
          if (v === `#${o}`) v = `#${nw}`;
          // Text on a path names its path layer by id.
          if (a.name === 'data-sc-textpath' && v === o) v = nw;
        }
        if (v !== a.value) el.setAttributeNS(a.namespaceURI, a.name, v);
      }
    }
}

// SVGCraft's own symbols come back as sc-sym-N, numbered after the ones
// already in the drawing (unless it's being replaced).
function renumberSymbols(root, againstDrawing) {
  const map = new Map();
  const taken = new Set([...root.querySelectorAll('[id]')].map((el) => el.id));
  for (const s of root.querySelectorAll('symbol[id^="sc-sym-"]')) {
    if (/^sc-sym-\d+$/.test(s.id) && !(againstDrawing && document.getElementById(s.id))) continue;
    let n = 1;
    while (taken.has(`sc-sym-${n}`) || (againstDrawing && document.getElementById(`sc-sym-${n}`)))
      n++;
    taken.add(`sc-sym-${n}`);
    map.set(s.id, `sc-sym-${n}`);
    s.id = `sc-sym-${n}`;
  }
  renameRefs([root], map);
}

const INHERITED = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'font-family',
  'font-size',
  'font-weight',
];

// Paint set on the root <svg> (icon sets love fill="none"
// stroke="currentColor") would be lost when the root is unwrapped, so
// push it down onto each top-level child. currentColor that would come from
// the source page has no meaning here; pin it to the root's colour (or
// black). currentColor under an element of the file that sets its own
// colour (a pattern tile, drawn in its paint's colour) keeps working, so
// it's left alone.
const setsColor = (el) =>
  el.hasAttribute('color') || /(^|;)\s*color\s*:/.test(el.getAttribute('style') || '');
function inheritRootPaint(root) {
  const own = Object.fromEntries(
    (root.getAttribute('style') || '')
      .split(';')
      .map((d) => d.split(':').map((x) => x.trim()))
      .filter(([k, v]) => k && v),
  );
  const color = own.color || root.getAttribute('color') || '#000000';
  for (const el of [root, ...root.querySelectorAll('*')]) {
    let owned = false;
    for (let a = el; a && a !== root && !owned; a = a.parentNode) owned = setsColor(a);
    if (owned) continue;
    for (const k of ['fill', 'stroke'])
      if (/^currentcolor$/i.test(el.getAttribute(k) || '')) el.setAttribute(k, color);
  }
  const paint = {};
  for (const k of INHERITED) {
    const v = own[k] || root.getAttribute(k);
    if (v) paint[k] = /^currentcolor$/i.test(v) ? color : v;
  }
  for (const c of root.children) {
    if (NON_GRAPHIC.has(c.localName)) continue;
    for (const [k, v] of Object.entries(paint)) if (!c.hasAttribute(k)) c.setAttribute(k, v);
  }
}

function parseSvg(text, { dedupe = true } = {}) {
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = xml.documentElement;
  if (xml.querySelector('parsererror') || root.localName !== 'svg')
    throw new Error('Not a valid SVG file');
  sanitize(root);
  inheritRootPaint(root);
  // Sprite sheets keep their symbols at the top level: they belong in defs.
  const syms = [...root.children].filter((c) => c.localName === 'symbol');
  if (syms.length) {
    let d = [...root.children].find((c) => c.localName === 'defs');
    if (!d) root.prepend((d = xml.createElementNS(NS, 'defs')));
    d.append(...syms);
  }
  dedupeIds(root, dedupe);
  renumberSymbols(root, dedupe);
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const num = (v) => (v && !String(v).endsWith('%') ? parseFloat(v) : NaN);
  let [minX, minY, w, h] =
    vb.length === 4 && vb.every(isFinite)
      ? vb
      : [0, 0, num(root.getAttribute('width')), num(root.getAttribute('height'))];
  if (!(w > 0)) w = 800;
  if (!(h > 0)) h = 600;
  // A width and height in real-world units: the document shows those
  // units, and if the file's user units aren't CSS pixels (a viewBox in
  // mm, say) the drawing is scaled to pixels, keeping its real size.
  const lw = parseLength(root.getAttribute('width'));
  const lh = parseLength(root.getAttribute('height'));
  let units = 'px';
  let k = 1;
  if (lw && lw.unit !== 'px') {
    units = lw.unit === 'pc' ? 'pt' : lw.unit;
    if (vb.length === 4 && vb.every(isFinite)) k = lw.px / w;
    else [w, h] = [lw.px, lh?.px || h];
    if (Math.abs(k - 1) < 1e-3) k = 1;
  }
  const defsOut = [];
  const nodes = [];
  for (const c of [...root.childNodes]) {
    if (c.nodeType !== 1) continue;
    if (c.localName === 'defs')
      defsOut.push(...[...c.childNodes].map((n) => document.importNode(n, true)));
    // Editor settings in other namespaces (Inkscape's sodipodi:namedview)
    // draw nothing, so they aren't layers either.
    else if (!NON_GRAPHIC.has(c.localName) && c.namespaceURI === root.namespaceURI)
      nodes.push(document.importNode(c, true));
  }
  return {
    minX,
    minY,
    w,
    h,
    units,
    k,
    defs: defsOut,
    nodes,
    clip: root.getAttribute('data-svgcraft') === 'clip',
    guides: parseGuides(root.getAttribute('data-sc-guides')),
    meta: readMeta(root),
  };
}

// Every family named by a text layer or one of its runs.
const docFamilies = () =>
  [
    ...doc.querySelectorAll('text, tspan[font-family]'),
    ...(iso ? iso.back.querySelectorAll('text, tspan[font-family]') : []),
    ...defs.querySelectorAll(':scope > symbol text, :scope > symbol tspan[font-family]'),
  ].map((el) =>
    el.localName === 'text' ? typeFrom(el).family : fontFromCss(el.getAttribute('font-family')),
  );
const loadDocFonts = () => docFamilies().forEach(ensureFont);

// Replace the current tab's drawing with an SVG file's. It counts as
// freshly opened (no *) unless keepSaved.
function openSvg(text, name, { keepSaved = false } = {}) {
  const s = parseSvg(text, { dedupe: false });
  tools[state.tool].leave?.();
  dropIso();
  doc.replaceChildren();
  defs.replaceChildren(...s.defs);
  const shift =
    s.minX || s.minY || s.k !== 1 ? new DOMMatrix().scale(s.k).translate(-s.minX, -s.minY) : null;
  for (const n of s.nodes) {
    if (shift) setM(n, shift.multiply(getM(n)));
    doc.append(n);
  }
  state.units = s.units;
  setSize(s.w * s.k, s.h * s.k);
  state.guides = s.guides;
  state.meta = s.meta;
  renderGuides();
  loadDocFonts();
  if (name) state.fileName = name.replace(/\.svg$/i, '');
  state.sel = [];
  fit();
  noteStep('Open');
  commit();
  if (curDoc && !keepSaved) {
    curDoc.saved = curDoc.svg;
    renderTabs();
  }
}

function placeSvg(text, name = 'Pasted SVG') {
  const s = parseSvg(text);
  defs.append(...mergeSymbols(s.defs, s.nodes));
  if (s.clip) {
    // Our own clipboard: drop the pieces back where they were, nudged.
    for (const n of s.nodes) {
      setM(n, new DOMMatrix().translate(10, 10).multiply(getM(n)));
      doc.append(n);
    }
    state.sel = s.nodes;
  } else {
    const g = mk('g', { 'data-name': name }, doc);
    g.append(...s.nodes);
    const k = Math.min(1, (state.w * 0.9) / s.w, (state.h * 0.9) / s.h);
    const tx = (state.w - s.w * k) / 2;
    const ty = (state.h - s.h * k) / 2;
    setM(g, new DOMMatrix().translate(tx, ty).scale(k).translate(-s.minX, -s.minY));
    state.sel = [g];
  }
  loadDocFonts();
  setTool('select');
  commit();
}

function placeImage(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, (state.w * 0.9) / img.width, (state.h * 0.9) / img.height);
    const w = img.width * k;
    const h = img.height * k;
    const el = mk(
      'image',
      {
        href: dataUrl,
        x: f((state.w - w) / 2),
        y: f((state.h - h) / 2),
        width: f(w),
        height: f(h),
      },
      doc,
    );
    state.sel = [el];
    setTool('select');
    commit();
    say('Placed the image. Image → Image Trace… turns it into shapes.');
  };
  img.src = dataUrl;
}

// `handle`: the file itself, where the browser gives it, for Save (save.js).
function importFile(file, mode, handle) {
  if (!file) return;
  // With nothing open, any file opens as a drawing of its own.
  if (!curDoc) mode = 'open';
  const r = new FileReader();
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
    r.onload = () => {
      if (!curDoc) newDoc({ name: file.name.replace(/\.[^.]+$/, '') || nextUntitled() });
      placeImage(r.result);
    };
    r.readAsDataURL(file);
    return;
  }
  r.onload = () => {
    try {
      const replace = mode === 'open' || (mode === 'auto' && !items().length);
      if (replace) openDoc(r.result, file.name, handle);
      else placeSvg(r.result, file.name);
      say(`${replace ? 'Opened' : 'Imported'} ${file.name}`);
    } catch (err) {
      warn(err.message || 'Could not read that file');
    }
  };
  r.readAsText(file);
}
