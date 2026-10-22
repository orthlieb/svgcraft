// SVGCraft — Library export and import in other apps' formats.
'use strict';

// ---- library exchange: formats other apps read -------------------------------
// Export writes one zip: the SVGCraft library (JSON, everything) plus
//   swatches  → GIMP palette (.gpl), CSS variables
//   gradients → SVG <linearGradient>/<radialGradient> defs, CSS gradients
//   patterns  → SVG <pattern> defs
//   symbols   → an SVG sprite of <symbol>s, for <use href="symbols.svg#id">
// The SVG files also draw a labelled sample of each item, so they make
// sense when opened. Import reads the zip, or any of these on their own,
// plus GIMP gradients.
const xmlEsc = (v) =>
  String(v).replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );
// Unique, id- and CSS-safe names: "Sky blue" → "sky-blue", "sky-blue-2" …
function slugger(prefix) {
  const used = new Set();
  return (name) => {
    let base =
      String(name)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || prefix;
    if (!/^[a-z]/.test(base)) base = `${prefix}-${base}`;
    let s = base;
    for (let n = 2; used.has(s); n++) s = `${base}-${n}`;
    used.add(s);
    return s;
  };
}
const rgbOf = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const libCss = (c, a) => (a < 1 ? cssColor(c, f(a)) : c);
const cssGradient = (g) => {
  const stops = g.stops.map((s) => `${libCss(s.c, s.a)} ${f(s.o * 100)}%`).join(', ');
  return g.type === 'radial'
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${f(90 - g.angle)}deg, ${stops})`;
};
const stopMarkup = (g) =>
  g.stops
    .map(
      (s) =>
        `<stop offset="${f(s.o)}" stop-color="${s.c}"` +
        (s.a < 1 ? ` stop-opacity="${f(s.a)}"` : '') +
        '/>',
    )
    .join('');
// A gradient in its box's own coordinates: Photoshop angles run
// anticlockwise from 3 o'clock.
function gradDefMarkup(g, id) {
  const attrs = `id="${id}" data-name="${xmlEsc(g.name)}"`;
  if (g.type === 'radial')
    return `<radialGradient ${attrs} cx="0.5" cy="0.5" r="0.5">${stopMarkup(g)}</radialGradient>`;
  const t = (g.angle * Math.PI) / 180;
  const dx = Math.cos(t) / 2;
  const dy = -Math.sin(t) / 2;
  return (
    `<linearGradient ${attrs} x1="${f(0.5 - dx)}" y1="${f(0.5 - dy)}" ` +
    `x2="${f(0.5 + dx)}" y2="${f(0.5 + dy)}">${stopMarkup(g)}</linearGradient>`
  );
}

// A sheet of labelled samples: `cell(item, x, y, id)` draws one at x, y.
function sampleSheet(title, items, prefix, { w, h, defs, cell, extra = '' }) {
  const slug = slugger(prefix);
  const ids = items.map((x) => slug(x.name));
  const cols = Math.min(items.length, 6);
  const rows = Math.ceil(items.length / cols);
  const cw = w + 24;
  const ch = h + 44;
  const out = [
    `<svg xmlns="${NS}" viewBox="0 0 ${cols * cw + 24} ${rows * ch + 24}" ` +
      `font-family="system-ui, sans-serif" font-size="12">`,
    `<title>${xmlEsc(title)}</title>`,
    extra,
    `<defs>`,
    ...items.map((x, i) => '  ' + defs(x, ids[i])),
    `</defs>`,
  ];
  items.forEach((x, i) => {
    const cx = 24 + (i % cols) * cw;
    const cy = 24 + Math.floor(i / cols) * ch;
    out.push(
      cell(x, cx, cy, ids[i]) +
        `<text x="${cx + w / 2}" y="${cy + h + 18}" text-anchor="middle" fill="#333333">${xmlEsc(x.name)}</text>`,
    );
  });
  out.push('</svg>');
  return out.join('\n') + '\n';
}

const rgbHex = (rgb) =>
  '#' + rgb.map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
// GIMP palette: "R G B Name" lines (GIMP 3 adds an alpha column).
function gplText(swatches) {
  const lines = ['GIMP Palette', 'Name: SVGCraft', 'Columns: 8', '#'];
  for (const x of swatches)
    lines.push(
      rgbOf(x.c)
        .map((v) => String(v).padStart(3))
        .join(' ') +
        '\t' +
        x.name,
    );
  return lines.join('\n') + '\n';
}
function readGpl(text) {
  const rgba = /^Channels:\s*RGBA/im.test(text);
  const out = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = rgba
      ? line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/)
      : line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/);
    if (!m) continue;
    const c = rgbHex([+m[1], +m[2], +m[3]]);
    const a = rgba ? f(clamp(+m[4] / 255, 0, 1)) : 1;
    out.push({ name: (rgba ? m[5] : m[4]).trim() || c, c, a });
  }
  return out;
}

// GIMP gradient: segments with a colour at each end. Off-centre midpoints
// and curved blends get an extra stop at the midpoint.
function readGgr(text) {
  const lines = text.split(/\r?\n/);
  const name = (lines.find((l) => l.startsWith('Name:')) || 'Name: Gradient').slice(5).trim();
  const stops = [];
  const push = (o, r, g, b, a) => {
    const st = { o: clamp(o, 0, 1), c: rgbHex([r * 255, g * 255, b * 255]), a: clamp(a, 0, 1) };
    const last = stops[stops.length - 1];
    if (!last || last.o !== st.o || last.c !== st.c || last.a !== st.a) stops.push(st);
  };
  for (const line of lines) {
    const v = line.trim().split(/\s+/).map(Number);
    if (v.length < 13 || v.some((x) => !isFinite(x))) continue;
    const [l, m, r, r0, g0, b0, a0, r1, g1, b1, a1, blend] = v;
    push(l, r0, g0, b0, a0);
    if (Math.abs(m - (l + r) / 2) > 1e-3 || blend !== 0)
      push(m, (r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, (a0 + a1) / 2);
    push(r, r1, g1, b1, a1);
  }
  return stops.length >= 2 ? [{ name, type: 'linear', angle: 0, stops }] : [];
}

// Any SVG: its gradients, patterns and symbols. Colours in other notations
// (names, rgb(), hsl()) are read through a canvas.
const colorCtx = document.createElement('canvas').getContext('2d');
function anyHex(c) {
  if (!c) return null;
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = c.trim();
  return hex(colorCtx.fillStyle);
}
function readSvgLibrary(text, fileName) {
  const d = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (d.querySelector('parsererror') || d.documentElement.localName !== 'svg') return null;
  const byId = (id) => d.querySelector(`[id="${CSS.escape(id)}"]`);
  const hrefOf = (n) =>
    (n.getAttribute('href') || n.getAttributeNS(XLINK, 'href') || '').replace(/^#/, '');
  const label = (n, d) =>
    n.getAttribute('data-name') ||
    n.getAttribute('inkscape:label') ||
    n.querySelector(':scope > title')?.textContent ||
    n.id ||
    d;
  const out = { gradients: [], patterns: [], symbols: [] };
  for (const g of d.querySelectorAll('linearGradient, radialGradient')) {
    let src = g;
    for (let i = 0; i < 6 && src && !src.querySelector(':scope > stop'); i++)
      src = byId(hrefOf(src));
    if (!src) continue;
    const stops = [...src.querySelectorAll(':scope > stop')].map((s) => {
      const style = (k) =>
        s.getAttribute(k) ??
        (s.getAttribute('style') || '').match(new RegExp(`${k}\\s*:\\s*([^;]+)`))?.[1];
      const off = style('offset') || '0';
      const col = style('stop-color') || '#000';
      const op = parseFloat(style('stop-opacity') ?? 1);
      return {
        o: off.trim().endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0,
        c: anyHex(col),
        a: (isFinite(op) ? op : 1) * colorAlpha(col),
      };
    });
    if (stops.length < 2) continue;
    let angle = 0;
    if (g.localName === 'linearGradient') {
      const v = (k, dflt) => parseFloat(g.getAttribute(k) ?? dflt) || 0;
      angle = Math.round(
        (Math.atan2(-(v('y2', 0) - v('y1', 0)), v('x2', 1) - v('x1', 0)) * 180) / Math.PI,
      );
    }
    out.gradients.push({
      name: label(g, 'Gradient'),
      type: g.localName === 'radialGradient' ? 'radial' : 'linear',
      angle,
      stops,
    });
  }
  const inner = (n) => [...n.childNodes].map((c) => new XMLSerializer().serializeToString(c));
  for (const p of d.querySelectorAll('pattern')) {
    if (p.getAttribute('patternContentUnits') === 'objectBoundingBox') continue;
    const vb = (p.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const hasVb = vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0;
    const w = hasVb ? vb[2] : parseFloat(p.getAttribute('width'));
    const h = hasVb ? vb[3] : parseFloat(p.getAttribute('height'));
    let body = inner(p).join('');
    if (!(w >= 0.5 && h >= 0.5) || !body.trim()) continue;
    if (hasVb && (vb[0] || vb[1]))
      body = `<g transform="translate(${-vb[0]} ${-vb[1]})">${body}</g>`;
    // currentColor inside the tile is the paint's colour; a fixed colour
    // on the <pattern> itself is dropped.
    out.patterns.push({ name: label(p, 'Pattern'), w, h, svg: body });
  }
  const category = fileName.replace(/\.svg$/i, '').slice(0, 40) || 'Imported';
  for (const s of d.querySelectorAll('symbol')) {
    const vb = (s.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (!(vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0)) continue;
    let body = inner(s)
      .filter((m) => !/^<title[\s>]/.test(m))
      .join('');
    if (!body.trim()) continue;
    if (vb[0] || vb[1]) body = `<g transform="translate(${-vb[0]} ${-vb[1]})">${body}</g>`;
    const item = { name: label(s, 'Symbol'), category, w: vb[2], h: vb[3], svg: body };
    if (s.getAttribute('data-category')) item.category = s.getAttribute('data-category');
    if (s.getAttribute('data-credit')) item.credit = s.getAttribute('data-credit');
    out.symbols.push(item);
  }
  return out;
}

// Symbols as an SVG sprite: one <symbol id> each, for <use href="symbols.svg#id">.
function spriteSvg(items) {
  const credits = [...new Set(items.map((x) => x.credit).filter(Boolean))];
  return sampleSheet('SVGCraft symbols', items, 'symbol', {
    w: 120, // room for the name under each 64 px icon
    h: 64,
    extra: credits.length
      ? `<desc>Credits: ${xmlEsc(credits.join('; '))}. Use one with &lt;use href="symbols.svg#id"/&gt;.</desc>`
      : `<desc>Use one with &lt;use href="symbols.svg#id"/&gt;.</desc>`,
    defs: (x, id) =>
      `<symbol id="${id}" viewBox="0 0 ${f(x.w)} ${f(x.h)}" data-name="${xmlEsc(x.name)}" ` +
      `data-category="${xmlEsc(x.category)}"` +
      (x.credit ? ` data-credit="${xmlEsc(x.credit)}"` : '') +
      `>${x.svg}</symbol>`,
    cell: (x, cx, cy, id) =>
      `<use href="#${id}" x="${cx + 28}" y="${cy}" width="64" height="64" fill="#1f2937"/>`,
  });
}
const cssVars = (title, items, prefix, value) => {
  const slug = slugger(prefix);
  const lines = items.map((x) => `  --${slug(x.name)}: ${value(x)};`);
  return `/* SVGCraft ${title} */\n:root {\n${lines.join('\n')}\n}\n`;
};
