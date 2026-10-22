// SVGCraft — Import: open, place and paste, sanitised.
'use strict';

// ---------------------------------------------------------------------
// Import (open / place / paste) — sanitised
// ---------------------------------------------------------------------
function sanitize(root) {
  root.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((n) => n.remove());
  for (const n of root.querySelectorAll('animate, set'))
    if (/href/i.test(n.getAttribute('attributeName') || '')) n.remove();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const v = a.value.trim().toLowerCase();
      if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name);
      else if (
        (a.localName === 'href' || a.name === 'xlink:href') &&
        (v.startsWith('javascript:') || (v.startsWith('data:') && !v.startsWith('data:image/')))
      )
        el.removeAttributeNS(a.namespaceURI, a.localName);
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
function dedupeIds(root, againstDrawing) {
  const map = new Map();
  for (const el of root.querySelectorAll('[id]')) {
    const id = el.id;
    if (!id.startsWith('sc-') && !(againstDrawing && document.getElementById(id))) continue;
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
// push it down onto each top-level child. currentColor has no meaning
// outside the source page; pin it to the root's colour (or black).
function inheritRootPaint(root) {
  const own = Object.fromEntries(
    (root.getAttribute('style') || '')
      .split(';')
      .map((d) => d.split(':').map((x) => x.trim()))
      .filter(([k, v]) => k && v),
  );
  const color = own.color || root.getAttribute('color') || '#000000';
  for (const el of [root, ...root.querySelectorAll('*')]) {
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
  inlineStyles(root);
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
  const shift = s.minX || s.minY ? new DOMMatrix().translate(-s.minX, -s.minY) : null;
  for (const n of s.nodes) {
    if (shift) setM(n, shift.multiply(getM(n)));
    doc.append(n);
  }
  setSize(s.w, s.h);
  state.guides = s.guides;
  state.meta = s.meta;
  renderGuides();
  loadDocFonts();
  if (name) state.fileName = name.replace(/\.svg$/i, '');
  state.sel = [];
  fit();
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
  };
  img.src = dataUrl;
}

function importFile(file, mode) {
  if (!file) return;
  const r = new FileReader();
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
    r.onload = () => placeImage(r.result);
    r.readAsDataURL(file);
    return;
  }
  r.onload = () => {
    try {
      const replace = mode === 'open' || (mode === 'auto' && !items().length);
      if (replace) openDoc(r.result, file.name);
      else placeSvg(r.result, file.name);
      say(`${replace ? 'Opened' : 'Imported'} ${file.name}`);
    } catch (err) {
      say(err.message || 'Could not read that file');
    }
  };
  r.readAsText(file);
}
