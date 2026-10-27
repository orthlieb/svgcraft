// SVGCraft — Window → SVG Source.
'use strict';

// ---------------------------------------------------------------------
// Window → SVG Source: a read-only pane (docked) or window showing the document's
// SVG exactly as Save as SVG writes it, pretty-printed and highlighted.
//
// The markup is tokenized here (no libraries), re-indented one element per
// line and drawn with createElement / text nodes only, so imported text
// can never turn into markup. Pretty-printing only touches whitespace that
// means nothing: between attributes, and between elements whose content is
// only elements. Text, <style> and anything with real text inside stays
// byte for byte. Each element's lines are remembered, so a canvas selection
// highlights its source and clicking a start tag selects the layer.
// ---------------------------------------------------------------------
const SRC_WIDTH = 100; // the widest the beautified lines get (see srcFitCols)
const SRC_CHUNK = 200; // lines drawn together (see srcFill)
const SRC_EAGER = 5; // blocks drawn straight away; the rest as they scroll in
const SRC_LINE_TOKENS = 4000; // a line with more tokens is drawn unhighlighted
const SRC_MAX_HITS = 2000;
const SRC_LINE_H = 18;
const SRC_INLINE = new Set(['text', 'tspan', 'textPath', 'style', 'script', 'title', 'desc']);
// Long data: URIs (embedded images, fonts) are cut short on screen only.
const SRC_DATA_RE = /(data:[^,"'\s)<]{0,120},)([^"'\s)<]{120,})/g;
const srcShown = (s) => s.replace(SRC_DATA_RE, (m, head, body) => `${head}${body.slice(0, 48)}…`);
const srcWin = $('#sc-source');
const srcCode = $('#sc-src-code');
const srcFind = $('#sc-src-find');

// Markup → a small tree: { k: 'el', name, attrs: [{ n, v }], self, kids }
// or { k: 'text' | 'comment' | 'cdata' | 'pi', s }. Values keep their quotes
// and entities, exactly as written.
function srcParse(s) {
  const root = { k: 'root', kids: [] };
  const stack = [root];
  const re =
    /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<![^>]*>?|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|[^<]+|</g;
  const attrRe = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/g;
  for (const m of s.matchAll(re)) {
    const top = stack[stack.length - 1];
    const t = m[0];
    if (m[1]) {
      const at = stack.findLastIndex((n) => n.name === m[1]);
      if (at > 0) stack.length = at;
      else top.kids.push({ k: 'text', s: t });
    } else if (m[2]) {
      const attrs = [...(m[3] || '').matchAll(attrRe)].map((a) => ({ n: a[1], v: a[2] || '' }));
      const el = { k: 'el', name: m[2], attrs, self: !!m[4], kids: [] };
      top.kids.push(el);
      if (!el.self) stack.push(el);
    } else if (t.startsWith('<!--')) top.kids.push({ k: 'comment', s: t });
    else if (t.startsWith('<![CDATA[')) top.kids.push({ k: 'cdata', s: t });
    else if (t.startsWith('<?') || (t.startsWith('<!') && t.length > 1))
      top.kids.push({ k: 'pi', s: t });
    else top.kids.push({ k: 'text', s: t });
  }
  return root;
}

// CSS → tokens [class, text]: selectors, at-rules (@media, @import…),
// property names, values, comments and punctuation. `decls` starts inside a
// declaration block (a style="" attribute). Whatever it can't make sense
// of stays text in the colour it's in, so nothing is ever lost or added.
const CSS_RULE_LISTS = /^@(media|supports|document|layer|container|scope)\b/i;
function cssTokens(s, decls = false) {
  const out = [];
  const push = (c, t) => t && out.push([c, t]);
  // Block stack: 'rules' (selectors and at-rules) or 'decls'.
  const stack = [decls ? 'decls' : 'rules'];
  let prelude = '';
  let inValue = false;
  const re =
    /\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[{};:,]|[^{};:,"'/]+|\//g;
  for (const [t] of s.matchAll(re)) {
    const mode = stack.at(-1);
    if (t.startsWith('/*')) push('com', t);
    else if (t === '{') {
      push('p', t);
      stack.push(CSS_RULE_LISTS.test(prelude.trim()) ? 'rules' : 'decls');
      prelude = '';
      inValue = false;
    } else if (t === '}') {
      push('p', t);
      if (stack.length > 1) stack.pop();
      inValue = false;
    } else if (mode === 'decls') {
      if (t === ';') {
        push('p', t);
        inValue = false;
      } else if (t === ':' && !inValue) {
        push('p', t);
        inValue = true;
      } else push(inValue ? 'cval' : 'prop', t);
    } else if (t === ';') {
      push('p', t);
      prelude = '';
    } else if (t === ',') {
      // Between selectors.
      push('p', t);
      prelude += t;
    } else {
      // A selector, or an at-rule's keyword and what follows it.
      const at = !prelude.trim() && t.match(/^(\s*)(@[\w-]+)([\s\S]*)$/);
      if (at) {
        push('', at[1]);
        push('at', at[2]);
        push('cval', at[3]);
      } else push(prelude.trimStart().startsWith('@') ? 'cval' : 'sel', t);
      prelude += t;
    }
  }
  return out;
}

// ---- Beautifying long values ------------------------------------------------
// Lines are laid out to the view's width (in characters, between 40 and
// SRC_WIDTH), and again when it's resized.
let srcCols = SRC_WIDTH;
let srcCharW = 0;
function srcFitCols() {
  const w = srcCode.clientWidth;
  if (!w) return srcCols;
  if (!srcCharW) {
    const cs = getComputedStyle(srcCode);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    srcCharW = ctx.measureText('0').width || 7.2;
  }
  // Less the line-number gutter (up to five digits) and the padding.
  return Math.max(40, Math.min(SRC_WIDTH, Math.floor((w - 16 - 12) / srcCharW) - 5));
}

// A value too long for its line is broken where whitespace means nothing:
// path data at each subpath and between its commands' coordinate groups,
// points by pair, animation lists at each ";", transforms by function and
// style by declaration. Each breaker gives the pieces and where a new line
// must start; srcPack fits them to the width. Values whose whitespace
// matters (ids, links, text, data URIs) are never broken.
const SRC_NUM = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;
const PATH_ARITY = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };
// The pieces are exact, back-to-back slices of the value, so put together
// again they give it unchanged; only where a line breaks does whitespace
// change. A run of numbers, cut before every `arity`-th of them.
function srcGroups(text, arity) {
  const nums = [...text.matchAll(SRC_NUM)];
  const cuts = [0];
  if (arity) for (let i = arity; i < nums.length; i += arity) cuts.push(nums[i].index);
  return cuts.map((c, i) => text.slice(c, cuts[i + 1] ?? text.length)).filter(Boolean);
}
function srcPathPieces(d) {
  const cmds = [...d.matchAll(/[MmZzLlHhVvCcSsQqTtAa][^MmZzLlHhVvCcSsQqTtAa]*/g)];
  if (!cmds.length || d.slice(0, cmds[0].index).trim()) return null;
  const pieces = [];
  const breaks = new Set();
  for (const [cmd] of cmds) {
    const k = cmd[0];
    // A closing z stays with the command before it.
    if (/[Zz]/.test(k) && pieces.length) {
      pieces[pieces.length - 1] += cmd;
      continue;
    }
    if (k === 'M' && pieces.length) breaks.add(pieces.length);
    const groups = srcGroups(cmd.slice(1), PATH_ARITY[k.toLowerCase()]);
    pieces.push(k + (groups[0] || ''), ...groups.slice(1));
  }
  pieces[0] = d.slice(0, cmds[0].index) + pieces[0];
  return { pieces, breaks };
}
const srcPointPieces = (v) => {
  const pieces = srcGroups(v, 2);
  return pieces.length > 1 ? { pieces, breaks: new Set() } : null;
};
// Split after each `sep` outside brackets and quotes.
function srcSplit(v, sep) {
  const pieces = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (const ch of v) {
    cur += ch;
    if (quote) quote = ch === quote ? '' : quote;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === sep && !depth) {
      pieces.push(cur);
      cur = '';
    }
  }
  if (cur.trim() || !pieces.length) pieces.push(cur);
  else pieces[pieces.length - 1] += cur;
  return pieces.length > 1 ? { pieces, breaks: new Set() } : null;
}
function srcTransformPieces(v) {
  const at = [...v.matchAll(/[a-zA-Z]+\s*\(/g)].map((m) => m.index);
  if (at.length < 2) return null;
  at[0] = 0;
  return { pieces: at.map((c, i) => v.slice(c, at[i + 1] ?? v.length)), breaks: new Set() };
}
const srcListPieces = (v) => srcSplit(v, ';');
const SRC_BREAK = {
  d: srcPathPieces,
  points: srcPointPieces,
  values: srcListPieces,
  keyTimes: srcListPieces,
  keySplines: srcListPieces,
  keyPoints: srcListPieces,
  transform: srcTransformPieces,
  gradientTransform: srcTransformPieces,
  patternTransform: srcTransformPieces,
  style: srcListPieces,
};
// (A new line starts at each absolute M; runs of little relative subpaths
// pack together.)
// Pieces → lines no wider than the width (a piece longer than a line gets
// one of its own); `breaks` start new lines.
function srcPack({ pieces, breaks }, col) {
  const rows = [];
  let cur = '';
  pieces.forEach((p, i) => {
    if (
      cur.trim() &&
      (breaks.has(i) || col + cur.trimEnd().length + p.trimEnd().length > srcCols)
    ) {
      rows.push(cur.trimEnd());
      cur = p.trimStart();
    } else cur += p;
  });
  if (cur) rows.push(cur);
  return rows;
}

// A <style> element's CSS, one rule per block and one declaration per
// line: [depth, text, inside a declaration block]. Strings, comments and
// url(…) are kept as written.
function srcCssLines(css) {
  const out = [];
  let buf = '';
  let depth = 0;
  let paren = 0;
  const flush = (end, decl) => {
    let t = buf.replace(/\s+/g, ' ').trim();
    buf = '';
    if (!t && !end) return;
    if (decl && !t.startsWith('@')) t = t.replace(/^([\w-]+)\s*:\s*/, '$1: ');
    if (end === ' {' && !t.startsWith('@')) t = t.replace(/\s*,\s*/g, ', ');
    out.push([depth, t + end, decl]);
  };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const j = css.indexOf('*/', i + 2);
      const end = j < 0 ? css.length : j + 2;
      flush('', depth > 0);
      out.push([depth, css.slice(i, end), false]);
      i = end - 1;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      buf += css.slice(i, j + 1);
      i = j;
    } else if (ch === '(') {
      paren++;
      buf += ch;
    } else if (ch === ')') {
      paren = Math.max(0, paren - 1);
      buf += ch;
    } else if (paren) buf += ch;
    else if (ch === '{') {
      flush(' {', false);
      depth++;
    } else if (ch === ';') flush(';', depth > 0);
    else if (ch === '}') {
      if (buf.trim()) flush(';', true);
      depth = Math.max(0, depth - 1);
      out.push([depth, '}', false]);
    } else buf += ch;
  }
  if (buf.trim()) flush('', depth > 0);
  return out;
}

// Tree → lines of tokens [class, text]. `spans` maps each live element of
// the document to its [first, last] line; a line whose start tag belongs
// to a layer carries it as .el (what a click there selects).
function srcPretty(text) {
  const tree = srcParse(text);
  const lines = [];
  const spans = new Map();
  let line = null;
  const newLine = (depth, el = null) => {
    line = { t: depth ? [['', '  '.repeat(depth)]] : [], el };
    lines.push(line);
  };
  // Raw text may hold newlines; they start new (unindented) lines.
  const put = (c, s) =>
    s.split('\n').forEach((p, i) => {
      if (i || !line) newLine(0);
      if (!p) return;
      if (c !== 'txt') return line.t.push([c, p]);
      for (const [j, q] of p.split(/(&#?\w+;)/).entries())
        if (q) line.t.push([j % 2 ? 'ent' : c, q]);
    });
  const putNode = (n) =>
    put(n.k === 'comment' ? 'com' : n.k === 'text' ? 'txt' : n.k === 'cdata' ? 'txt' : 'pi', n.s);
  // A <style> element's content, coloured as CSS (CDATA markers kept).
  const putCss = (n) => {
    if (n.k === 'text') for (const [c, t] of cssTokens(n.s)) put(c, t);
    else if (n.k === 'cdata') {
      const m = n.s.match(/^(<!\[CDATA\[)([\s\S]*?)(\]\]>)?$/);
      put('pi', m[1]);
      for (const [c, t] of cssTokens(m[2])) put(c, t);
      if (m[3]) put('pi', m[3]);
    } else putNode(n);
  };
  const attrW = (a) => 1 + a.n.length + (a.v ? 1 + srcShown(a.v).length : 0);
  // A start tag on one line if it fits; otherwise one attribute per line,
  // as Prettier does (a lone attribute stays beside the tag), with long
  // values broken onto lines of their own under the opening quote.
  function startTag(n, depth, el, raw) {
    const pad = '  '.repeat(depth);
    if (!raw) newLine(depth, el);
    line.t.push(['p', '<'], ['tag', n.name]);
    const full = pad.length + 1 + n.name.length + n.attrs.reduce((w, a) => w + attrW(a), 0) + 2;
    const fits = raw || full <= srcCols;
    const perLine = !fits && n.attrs.length > 1;
    let col = pad.length + 1 + n.name.length;
    n.attrs.forEach((a, i) => {
      if (perLine) {
        line = { t: [['', `${pad}  `]], el };
        lines.push(line);
        col = pad.length + 2;
      } else {
        line.t.push(['', ' ']);
        col++;
      }
      line.t.push(['attr', a.n]);
      col += a.n.length;
      if (!a.v) return;
      line.t.push(['p', '=']);
      col++;
      const room = i === n.attrs.length - 1 ? 2 : 0; // the tag's > or />
      const long = !fits && col + srcShown(a.v).length + room > srcCols;
      const parts = long && a.v.length > 2 && SRC_BREAK[a.n]?.(a.v.slice(1, -1));
      const style = a.n === 'style' && a.v.length > 2;
      if (!parts) {
        // style="…": its declarations coloured as CSS, inside the quotes.
        if (style) line.t.push(['val', a.v[0]], ...cssTokens(a.v.slice(1, -1), true));
        line.t.push(['val', style ? a.v.at(-1) : a.v]);
        col += srcShown(a.v).length;
        return;
      }
      const q = a.v[0];
      const at = col + 1;
      const rows = srcPack(parts, at);
      rows.forEach((r, j) => {
        if (j) {
          line = { t: [['', ' '.repeat(at)]], el };
          lines.push(line);
        }
        if (!j) line.t.push(['val', q]);
        if (style) line.t.push(...cssTokens(r, true));
        else line.t.push(['val', r]);
        if (j === rows.length - 1) line.t.push(['val', q]);
      });
    });
    line.t.push(['p', n.self ? '/>' : '>']);
  }
  const endTag = (n) => line.t.push(['p', '</'], ['tag', n.name], ['p', '>']);
  const liveKids = (el, n) => {
    const kids = el ? [...el.children] : [];
    // The root: serialize() adds its own <defs> ahead of the layers.
    if (n.name === 'svg' && n === tree.kids.find((k) => k.k === 'el')) {
      const count = n.kids.filter((k) => k.k === 'el').length;
      return [...Array(Math.max(0, count - doc.children.length)).fill(null), ...doc.children];
    }
    return kids;
  };
  // Inside text-like content everything is written as it is.
  function raw(n, el) {
    if (n.k !== 'el') return putNode(n);
    const first = lines.length - 1;
    startTag(n, 0, el, true);
    if (!n.self) {
      const live = liveKids(el, n);
      let i = 0;
      for (const k of n.kids) raw(k, k.k === 'el' ? live[i++] || null : null);
      endTag(n);
    }
    if (el && !spans.has(el)) spans.set(el, [first, lines.length - 1]);
  }
  function block(n, depth, el) {
    if (n.k !== 'el') {
      if (n.k === 'text' && !n.s.trim()) return;
      newLine(depth);
      return putNode(n);
    }
    const first = lines.length;
    startTag(n, depth, el, false);
    if (!n.self) {
      const live = liveKids(el, n);
      const inline =
        SRC_INLINE.has(n.name) ||
        n.kids.some((k) => k.k === 'cdata' || (k.k === 'text' && k.s.trim())) ||
        n.attrs.some((a) => a.n === 'xml:space');
      let i = 0;
      const cssOnly = n.name === 'style' && n.kids.every((k) => k.k === 'text' || k.k === 'cdata');
      if (cssOnly) {
        // CSS: one rule per block, one declaration per line, indented.
        const css = (s, d) => {
          for (const [cd, t, decl] of srcCssLines(s)) {
            newLine(d + cd);
            line.t.push(...cssTokens(t, decl));
          }
        };
        for (const k of n.kids)
          if (k.k === 'text') css(k.s, depth + 1);
          else {
            const m = k.s.match(/^(<!\[CDATA\[)([\s\S]*?)(\]\]>)?$/);
            newLine(depth + 1);
            put('pi', m[1]);
            css(m[2], depth + 2);
            if (m[3]) {
              newLine(depth + 1);
              put('pi', m[3]);
            }
          }
        newLine(depth);
        endTag(n);
      } else if (inline) {
        for (const k of n.kids)
          if (n.name === 'style') putCss(k);
          else raw(k, k.k === 'el' ? live[i++] || null : null);
        endTag(n);
      } else if (!n.kids.some((k) => k.k !== 'text')) endTag(n);
      else {
        for (const k of n.kids) block(k, depth + 1, k.k === 'el' ? live[i++] || null : null);
        newLine(depth);
        endTag(n);
      }
    }
    if (el) spans.set(el, [first, lines.length - 1]);
  }
  for (const n of tree.kids) block(n, 0, null);
  return { lines, spans };
}

// The full text of the view (what Copy and Download give), and what's shown.
const srcLineText = (ln) => ln.t.map((t) => t[1]).join('');
const srcCuts = (cls) => cls === 'val' || cls === 'txt' || cls === 'com' || cls === 'cval';
const srcShownText = (ln) => ln.t.map((t) => (srcCuts(t[0]) ? srcShown(t[1]) : t[1])).join('');

// Lines are drawn a block of SRC_CHUNK at a time: the first few straight
// away, the rest as they scroll near the view (until then a block is an
// empty box of the right height). A huge drawing stays quick to open and
// to update, and the scroll bar still spans the whole source.
let srcIO = null;
function srcRender() {
  const v = srcView;
  const text = serialize({ fontCss: fontImport() });
  const cols = srcFitCols();
  if (text === v.text && cols === srcCols) return;
  srcCols = cols;
  v.text = text;
  const { lines, spans } = srcPretty(text);
  v.lines = lines;
  v.spans = spans;
  v.shown = null;
  v.full = lines.map(srcLineText).join('\n') + '\n';
  const top = srcCode.scrollTop;
  const left = srcCode.scrollLeft;
  srcIO?.disconnect();
  srcIO ??= new IntersectionObserver(
    (es) => es.forEach((e) => e.isIntersecting && srcFill(+e.target.dataset.c)),
    { root: srcCode, rootMargin: '600px 0px' },
  );
  const box = document.createElement('div');
  box.className = 'sc-src-lines';
  srcCode.style.setProperty('--src-digits', String(lines.length).length);
  v.rows = new Array(lines.length);
  v.chunks = [];
  for (let i = 0, c = 0; i < lines.length; i += SRC_CHUNK, c++) {
    const ch = document.createElement('div');
    ch.className = 'sc-src-chunk';
    ch.dataset.c = c;
    ch.style.height = `${Math.min(SRC_CHUNK, lines.length - i) * SRC_LINE_H}px`;
    box.append(ch);
    v.chunks.push(ch);
  }
  srcCode.replaceChildren(box);
  v.chunks.forEach((ch, c) => (c < SRC_EAGER ? srcFill(c) : srcIO.observe(ch)));
  srcCode.scrollTop = top;
  srcCode.scrollLeft = left;
  srcMarkSel(false);
  if (srcFind.value) srcSearch(null);
}

function srcFill(c) {
  const v = srcView;
  const ch = v.chunks[c];
  if (!ch || ch.dataset.filled) return;
  // Wrapped lines make a block taller than its placeholder: one that starts
  // above the view scrolls by the difference, so the lines below it (what's
  // shown, a line just revealed) stay put.
  const before = ch.offsetHeight;
  const above = ch.getBoundingClientRect().top < srcCode.getBoundingClientRect().top;
  ch.dataset.filled = '1';
  ch.style.height = '';
  srcIO.unobserve(ch);
  const end = Math.min(v.lines.length, (c + 1) * SRC_CHUNK);
  for (let i = c * SRC_CHUNK; i < end; i++) {
    const ln = v.lines[i];
    const row = document.createElement('div');
    row.className = ln.el ? 'sc-src-ln sc-src-tagln' : 'sc-src-ln';
    if (v.flags?.[i]) row.classList.add('sc-src-on');
    row.dataset.n = i + 1;
    const box = document.createElement('span');
    box.className = 'sc-src-c';
    // A pathological line (thousands of attributes) is drawn plain.
    if (ln.t.length > SRC_LINE_TOKENS) box.textContent = srcShownText(ln);
    else
      for (const [cls, s] of ln.t) {
        const shown = srcCuts(cls) ? srcShown(s) : s;
        if (!cls) {
          box.append(shown);
          continue;
        }
        const sp = document.createElement('span');
        sp.className = `sc-syn-${cls}`;
        sp.textContent = shown;
        if (shown !== s) sp.classList.add('sc-src-cut');
        box.append(sp);
      }
    row.append(box);
    ch.append(row);
    v.rows[i] = row;
  }
  if (above) srcCode.scrollTop += ch.offsetHeight - before;
  if (v.hits.length) srcPaintHits();
}
// The row for line i, drawing its block first if need be.
function srcRow(i) {
  srcFill(Math.floor(i / SRC_CHUNK));
  return srcView.rows[i];
}

// Wait while the user is selecting (or has selected) text in the view.
function srcBusy() {
  if (srcView.pointer) return true;
  const s = getSelection();
  return (
    !!s &&
    !s.isCollapsed &&
    srcCode.contains(s.anchorNode) &&
    srcWin.contains(document.activeElement)
  );
}
function srcSchedule(delay = 250) {
  if (!srcView.open) return;
  clearTimeout(srcView.timer);
  srcView.timer = setTimeout(() => {
    if (!srcView.open) return;
    if (srcBusy()) return srcSchedule(500);
    srcRender();
  }, delay);
}

// Light up the selected layers' lines; on a new selection scroll to them.
function srcMarkSel(scroll) {
  const v = srcView;
  if (v.flags)
    for (const r of srcCode.querySelectorAll('.sc-src-on')) r.classList.remove('sc-src-on');
  v.flags = new Uint8Array(v.lines.length);
  let first = -1;
  for (const el of v.sel) {
    const span = v.spans.get(el);
    if (!span) continue;
    v.flags.fill(1, span[0], span[1] + 1);
    for (let i = span[0]; i <= span[1]; i++) v.rows[i]?.classList.add('sc-src-on');
    if (first < 0) first = span[0];
  }
  if (scroll && first >= 0) srcReveal(srcRow(first));
}
function srcReveal(row, rect) {
  const box = srcCode.getBoundingClientRect();
  const r = rect || row.getBoundingClientRect();
  if (r.top < box.top || r.bottom > box.bottom)
    srcCode.scrollTop += r.top - box.top - (box.height - r.height) / 3;
  if (rect && (r.left < box.left + 60 || r.right > box.right))
    srcCode.scrollLeft += r.left - box.left - box.width / 3;
}

// drawSelection() calls this; it only acts when the selection changed.
function srcSyncSel() {
  const v = srcView;
  if (!v.open) return;
  const sel = state.sel;
  if (sel.length === v.sel.length && sel.every((el, i) => el === v.sel[i])) return;
  v.sel = [...sel];
  srcMarkSel(true);
}

// Find: every match lights up (CSS Custom Highlights where the browser has
// them, otherwise the lines); Enter / Shift+Enter step through them.
const srcHL = typeof CSS !== 'undefined' && CSS.highlights && window.Highlight;
function srcRange(m) {
  const c = srcView.rows[m.line]?.firstChild;
  if (!c) return null;
  const range = document.createRange();
  const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  let at = 0;
  let started = false;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.data.length;
    if (!started && m.start < at + len) {
      range.setStart(n, m.start - at);
      started = true;
    }
    if (started && m.end <= at + len) {
      range.setEnd(n, m.end - at);
      return range;
    }
    at += len;
  }
  return null;
}
function srcClearHits() {
  for (const r of srcCode.querySelectorAll('.sc-src-hit')) r.classList.remove('sc-src-hit');
  if (srcHL) {
    CSS.highlights.delete('sc-src-find');
    CSS.highlights.delete('sc-src-find-cur');
  }
}
// Paint the matches on the lines drawn so far (srcFill repaints).
function srcPaintHits() {
  const v = srcView;
  srcClearHits();
  if (!srcHL) {
    for (const h of v.hits) v.rows[h.line]?.classList.add('sc-src-hit');
    return;
  }
  const all = [];
  let cur = null;
  v.hits.forEach((h, i) => {
    const r = v.rows[h.line] && srcRange(h);
    if (!r) return;
    all.push(r);
    if (i === v.hit) cur = r;
  });
  CSS.highlights.set('sc-src-find', new window.Highlight(...all));
  if (cur) CSS.highlights.set('sc-src-find-cur', new window.Highlight(cur));
  return cur;
}
// step: ±1 moves to the next / previous match, 0 (typing) shows the
// nearest, null (the source changed) just repaints.
function srcSearch(step) {
  const v = srcView;
  const q = srcFind.value.toLowerCase();
  const keep = v.hits[v.hit];
  v.hits = [];
  if (q) {
    v.shown ??= v.lines.map((ln) => srcShownText(ln).toLowerCase());
    v.shown.some((s, line) => {
      for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + q.length)) {
        v.hits.push({ line, start: i, end: i + q.length });
        if (v.hits.length >= SRC_MAX_HITS) return true;
      }
      return false;
    });
  }
  if (!v.hits.length) v.hit = -1;
  else if (step)
    v.hit = (Math.max(v.hit, step > 0 ? -1 : 0) + step + v.hits.length) % v.hits.length;
  else {
    // Stay on the same match across re-renders and further typing.
    const at = keep ? v.hits.findIndex((h) => h.line >= keep.line) : 0;
    v.hit = at < 0 ? 0 : at;
  }
  if (step != null && v.hit >= 0) srcRow(v.hits[v.hit].line);
  const cur = srcPaintHits();
  $('#sc-src-count').textContent = !q
    ? ''
    : v.hits.length
      ? `${v.hit + 1} of ${v.hits.length}${v.hits.length >= SRC_MAX_HITS ? '+' : ''}`
      : 'No matches';
  // Previous / next only with something to step through.
  for (const b of [$('#sc-src-prev'), $('#sc-src-next')]) b.disabled = !v.hits.length;
  if (step != null && v.hit >= 0) {
    const row = v.rows[v.hits[v.hit].line];
    row.classList.add('sc-src-cur');
    srcReveal(row, cur?.getBoundingClientRect());
    setTimeout(() => row.classList.remove('sc-src-cur'), 600);
  }
}

let srcReturnFocus = null;
function openSource() {
  const v = srcView;
  v.open = true;
  srcReturnFocus = document.activeElement;
  srcWin.hidden = false;
  // Docked beside the canvas, unless it was floated (src/dock.js).
  dockOnOpen(srcDock);
  $('[data-action="toggleSource"]').setAttribute('aria-checked', 'true');
  syncPhoneSource();
  v.text = null;
  v.sel = [...state.sel];
  srcRender();
  srcMarkSel(true);
  setTimeout(() => srcCode.focus(), 0);
}
function closeSource() {
  const v = srcView;
  if (!v.open) return;
  v.open = false;
  clearTimeout(v.timer);
  srcWin.hidden = true;
  syncDock();
  $('[data-action="toggleSource"]').setAttribute('aria-checked', 'false');
  syncPhoneSource();
  if (srcHL) {
    CSS.highlights.delete('sc-src-find');
    CSS.highlights.delete('sc-src-find-cur');
  }
  if (srcWin.contains(document.activeElement)) {
    // Back to where the user was, unless that was the menu that opened it.
    const back = srcReturnFocus;
    if (back?.isConnected && !srcWin.contains(back) && !back.closest('.sc-menus')) back.focus();
    else document.activeElement.blur();
  }
}
const toggleSource = () => (srcView.open ? closeSource() : openSource());
// The phone's text view: the source full-screen under the toolbar, with
// Copy; the same button goes back to the drawing.
function syncPhoneSource() {
  const b = $('[data-action="phoneSource"]');
  const open = srcView.open;
  b.setAttribute('aria-pressed', open);
  b.dataset.tip = open ? 'Drawing view' : 'Text view: the SVG source, to read, search and copy';
  b.setAttribute('aria-label', open ? 'Drawing view' : 'Text view');
  b.innerHTML = `<i data-icon="${open ? 'image' : 'code'}">${icon(open ? 'image' : 'code')}</i>`;
}

// A split pane beside the canvas, or (floated) a window of its own.
const srcDock = makeDockable(srcWin, {
  key: 'svgcraft.sourceDock',
  btn: $('#sc-src-dock'),
  order: 1,
});

async function copySource() {
  srcRender();
  try {
    await navigator.clipboard.writeText(srcView.full);
    say('Copied the SVG source');
  } catch {
    say('Clipboard unavailable');
  }
}
function downloadSource() {
  srcRender();
  // Exactly what the window shows, in full; the tab keeps its * if unsaved.
  download(new Blob([srcView.full], { type: 'image/svg+xml' }), `${state.fileName}.svg`);
  say('Downloaded the SVG source');
}
// Long lines wrap unless Wrap was turned off (remembered).
const SRC_WRAP_KEY = 'svgcraft.sourceWrap';
function setSrcWrap(on, save) {
  srcWin.classList.toggle('sc-src-wrap', on);
  $('#sc-src-wrap').setAttribute('aria-pressed', on);
  if (save) store(SRC_WRAP_KEY, on ? null : false);
}

const SRC_PASS = new Set(['z', 'y', 's', 'o']);
function wireSource() {
  // Resized (dragged, docked, floated, the window): laid out again to fit.
  new ResizeObserver(() => {
    if (srcView.open && srcFitCols() !== srcCols) srcSchedule(100);
  }).observe(srcCode);
  $('#sc-src-close').addEventListener('click', closeSource);
  $('#sc-src-copy').addEventListener('click', copySource);
  $('#sc-src-download').addEventListener('click', downloadSource);
  $('#sc-src-wrap').addEventListener('click', () =>
    setSrcWrap(!srcWin.classList.contains('sc-src-wrap'), true),
  );
  setSrcWrap(stored(SRC_WRAP_KEY, true) !== false);
  $('#sc-src-prev').addEventListener('click', () => srcSearch(-1));
  $('#sc-src-next').addEventListener('click', () => srcSearch(1));
  srcFind.addEventListener('input', () => srcSearch(0));
  srcWin.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // Undo, redo, save and open still reach the app; nothing else does,
    // so Delete or the arrows can't change the drawing from in here.
    if (mod && !e.altKey && SRC_PASS.has(k) && e.target !== srcFind) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSource();
    } else if (mod && (k === 'f' || k === 'g') && !e.altKey) {
      e.preventDefault();
      if (k === 'g') srcSearch(e.shiftKey ? -1 : 1);
      else {
        srcFind.focus();
        srcFind.select();
      }
    } else if (mod && k === 'u') {
      e.preventDefault();
      closeSource();
    } else if (e.key === 'F3') {
      e.preventDefault();
      srcSearch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter' && e.target === srcFind) {
      e.preventDefault();
      srcSearch(e.shiftKey ? -1 : 1);
    } else if (mod && k === 'a' && e.target === srcCode) {
      e.preventDefault();
      srcView.chunks.forEach((ch, c) => srcFill(c));
      getSelection().selectAllChildren(srcCode);
    }
  });
  srcCode.addEventListener('pointerdown', () => (srcView.pointer = true));
  window.addEventListener('pointerup', () => (srcView.pointer = false));
  window.addEventListener('pointercancel', () => (srcView.pointer = false));
  // Clicking a start tag selects its layer (not when ending a text selection).
  srcCode.addEventListener('click', (e) => {
    if (!getSelection().isCollapsed) return;
    const row = e.target.closest?.('.sc-src-tagln');
    let el = row && srcView.lines[row.dataset.n - 1]?.el;
    if (!el || !doc.contains(el)) return;
    // Only layers and groups select: a text run selects its text.
    for (let a = el.parentNode; a && a !== doc; a = a.parentNode)
      if (a.localName !== 'g' && a.localName !== 'a') el = a;
    if (!selectable(el)) return;
    if (state.tool !== 'select' && state.tool !== 'node') setTool('select');
    setSel([el]);
  });

  // Drag by the title bar; resizing is the browser's own corner handle.
  dragWindow(srcWin, $('#sc-src-titlebar'));
}
// Copy / cut inside the source window copy its text, not the layers.
const inSource = (e) => {
  if (srcWin.contains(e.target)) return true;
  const s = getSelection();
  return !!s && !s.isCollapsed && srcWin.contains(s.anchorNode);
};
