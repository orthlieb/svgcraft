// SVGCraft — Type: the on-canvas editor, the Type tool, panels and font picker.
'use strict';

// ---- on-canvas rich editor ------------------------------------------------
// A contenteditable box styled like the layer, one span per run, placed
// with the layer's own screen matrix so the caret sits on rotated text.
// Selecting characters and changing a setting styles just those.
const cssColor = (fill, a = 1) => {
  const h = hex(fill);
  if (!h) return fill;
  const n = parseInt(h.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

function spanCss(o, t) {
  const e = { ...t, ...o };
  const css = {
    fontFamily: fontByName(e.family).css,
    fontWeight: e.weight,
    fontStyle: e.italic ? 'italic' : 'normal',
    fontSize: `${e.size}px`,
    letterSpacing: `${(e.tracking * e.size) / 1000}px`,
    textTransform: e.caps === 'all' ? 'uppercase' : 'none',
    fontVariant: e.caps === 'small' ? 'small-caps' : 'normal',
    textDecoration: decoOf(e.underline, e.strike) || 'none',
    verticalAlign: e.script !== 'none' ? e.script : `${e.shift}px`,
  };
  if (o.fill != null || o.fillA != null)
    css.color = o.fill === 'none' ? 'transparent' : cssColor(o.fill ?? t.fill, o.fillA ?? t.fillA);
  return css;
}

function renderEditor(div, runs, t) {
  div.replaceChildren(
    ...runs.map((r) => {
      const s = document.createElement('span');
      s.dataset.o = JSON.stringify(r.o);
      Object.assign(s.style, spanCss(r.o, t));
      s.textContent = r.t;
      return s;
    }),
  );
  if (!runs.length || runs.at(-1).t.endsWith('\n'))
    div.append(Object.assign(document.createElement('br'), { className: 'sc-end' }));
}

// Runs back out of the editor, whatever the browser did to its DOM.
function readEditor(div) {
  const runs = [];
  const walk = (node, o) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) runs.push({ t: n.textContent, o });
      else if (n.nodeName === 'BR') {
        if (!n.classList.contains('sc-end')) runs.push({ t: '\n', o });
      } else if (n.nodeType === 1) {
        if (/^(DIV|P)$/.test(n.nodeName) && runs.length && !runs.at(-1).t.endsWith('\n'))
          runs.push({ t: '\n', o });
        walk(n, n.dataset?.o ? JSON.parse(n.dataset.o) : o);
      }
    }
  };
  walk(div, {});
  return mergeRuns(runs);
}

// Character offsets of the editor's selection, and back.
function editorRange(div) {
  const sel = getSelection();
  if (!sel.rangeCount || !div.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  const at = (node, off) => {
    const pre = document.createRange();
    pre.selectNodeContents(div);
    pre.setEnd(node, off);
    const tmp = document.createElement('div');
    tmp.append(pre.cloneContents());
    return readEditor(tmp).reduce((n, x) => n + x.t.length, 0);
  };
  const a = at(r.startContainer, r.startOffset);
  const b = at(r.endContainer, r.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
function setEditorRange(div, start, end) {
  const find = (pos) => {
    let n = 0;
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let last = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === 3) {
        if (pos <= n + node.length) return [node, pos - n];
        n += node.length;
        last = node;
      } else if (node.nodeName === 'BR' && !node.classList.contains('sc-end')) {
        if (pos <= n) return [node.parentNode, [...node.parentNode.childNodes].indexOf(node)];
        n += 1;
      }
    }
    return last ? [last, last.length] : [div, 0];
  };
  const r = document.createRange();
  r.setStart(...find(start));
  r.setEnd(...find(end));
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

let typeEdit = null;
function editTextLayer(el, isNew = false) {
  if (refuseLocked([el], 'edit')) return;
  if (typeEdit) finishTypeEdit(true);
  const wrapEl = $('#sc-stage-wrap');
  const div = document.createElement('div');
  div.className = 'sc-type-edit';
  div.contentEditable = 'true';
  div.spellcheck = false;
  div.setAttribute('role', 'textbox');
  div.setAttribute('aria-multiline', 'true');
  div.setAttribute('aria-label', 'Edit text');
  const runs = rawRuns(el);
  const ed = { el, div, isNew, before: JSON.stringify(runs), range: null };
  // Layer-wide look (runs override it span by span).
  ed.restyle = () => {
    const t = typeFrom(el);
    const cs = getComputedStyle(el);
    ed.t = { ...t, fill: cs.fill, fillA: parseFloat(cs.fillOpacity) || 1 };
    Object.assign(div.style, spanCss({}, ed.t), {
      lineHeight: t.leading ? `${t.leading}px` : '1.2',
      textAlign: { start: 'left', middle: 'center', end: 'right' }[t.align],
      color:
        cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url')
          ? cssColor(cs.fill, ed.t.fillA)
          : '#000',
      opacity: parseFloat(cs.opacity) || 1,
      whiteSpace: t.box ? 'pre-wrap' : 'pre',
      width: t.box ? `${t.box}px` : 'auto',
      verticalAlign: 'baseline',
    });
  };
  ed.place = () => {
    const t = ed.t;
    const content = readEditor(div);
    const firstLine = [];
    for (const r of content) {
      firstLine.push(r);
      if (r.t.includes('\n')) break;
    }
    const big = Math.max(t.size, ...firstLine.map((r) => r.o.size ?? t.size));
    const lead = t.leading || big * 1.2;
    const w = t.box || div.offsetWidth;
    // Text on a path is edited as one straight line where it starts on
    // the path, turned to follow it there.
    const at = isTP(el) && tpPointAt(el, tpOffset(tpOf(el)) / 100);
    if (at) {
      const M = el
        .getScreenCTM()
        .translate(at.x, at.y)
        .rotate(at.deg)
        .translate(-{ start: 0, middle: w / 2, end: w }[t.align], -((lead - big) / 2 + big * 0.8));
      const r = wrapEl.getBoundingClientRect();
      div.style.transform = `matrix(${M.a},${M.b},${M.c},${M.d},${M.e - r.left},${M.f - r.top})`;
      return;
    }
    const x0 = parseFloat(el.getAttribute('x')) || 0;
    const y0 = parseFloat(el.getAttribute('y')) || 0;
    const bx = t.box ? x0 : x0 - { start: 0, middle: w / 2, end: w }[t.align];
    const by = y0 - ((lead - big) / 2 + big * 0.8);
    const M = el.getScreenCTM().translate(bx, by);
    const r = wrapEl.getBoundingClientRect();
    div.style.transform = `matrix(${M.a},${M.b},${M.c},${M.d},${M.e - r.left},${M.f - r.top})`;
  };
  ed.restyle();
  renderEditor(div, runs, ed.t);
  wrapEl.append(div);
  el.style.visibility = 'hidden';
  typeEdit = ed;
  ed.place();
  div.addEventListener('input', () => {
    const runsNow = readEditor(div);
    if (
      runsNow.length &&
      runsNow.at(-1).t.endsWith('\n') &&
      !div.lastChild?.classList?.contains('sc-end')
    )
      div.append(Object.assign(document.createElement('br'), { className: 'sc-end' }));
    ed.place();
  });
  div.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') finishTypeEdit(false);
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || isTP(el))) {
      // Text on a path is one line: Enter finishes it.
      e.preventDefault();
      finishTypeEdit(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  });
  div.addEventListener('paste', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, isTP(el) ? text.replace(/\s*\n\s*/g, ' ') : text);
  });
  // Clicks on the panels, options bar, font picker or paint chips keep the
  // edit open (they style the selected characters); anywhere else ends it.
  div.addEventListener('blur', () =>
    setTimeout(() => {
      if (typeEdit !== ed || document.activeElement === div) return;
      if (document.activeElement?.closest?.('.sc-options, .sc-panel, #sc-fontpop, .sc-chips'))
        return;
      finishTypeEdit(true);
    }, 0),
  );
  state.sel = [el];
  readTypeFromSelection();
  drawSelection();
  setTimeout(() => {
    div.focus();
    const len = runs.reduce((n, r) => n + r.t.length, 0);
    setEditorRange(div, isNew ? len : 0, len);
  }, 0);
}

// The panels follow the characters under the caret / selection.
document.addEventListener('selectionchange', () => {
  const ed = typeEdit;
  if (!ed || document.activeElement !== ed.div) return;
  ed.range = editorRange(ed.div) || ed.range;
  if (!ed.range) return;
  const runs = readEditor(ed.div);
  const at = ed.range.start === ed.range.end ? Math.max(0, ed.range.start - 1) : ed.range.start;
  let pos = 0;
  let o = {};
  for (const r of runs) {
    if (at < pos + r.t.length) {
      o = r.o;
      break;
    }
    pos += r.t.length;
  }
  state.type = {
    ...typeFrom(ed.el),
    ...pickKeys(
      o,
      RUN_KEYS.filter((k) => k !== 'fill' && k !== 'fillA'),
    ),
  };
  syncTypeUI();
  if (o.fill && o.fill !== 'none') {
    state.fill = hex(o.fill) || state.fill;
    state.fillOn = true;
  } else if (o.fill === 'none') state.fillOn = false;
  else readStyle(ed.el);
  if (o.fillA != null) state.fillA = o.fillA;
  syncStyleUI();
});

// Style the selected characters (all of them when nothing is selected);
// paragraph settings go to the layer.
function applyToEdit(patch, refocus = true) {
  const ed = typeEdit;
  const div = ed.div;
  const layerPatch = pickKeys(patch, ['leading', 'align', 'box']);
  const runPatch = pickKeys(patch, RUN_KEYS);
  let runs = readEditor(div);
  const len = runs.reduce((n, r) => n + r.t.length, 0);
  const range = ed.range && ed.range.end > ed.range.start ? ed.range : { start: 0, end: len };
  if (Object.keys(layerPatch).length) {
    applyType(ed.el, { ...typeFrom(ed.el), ...layerPatch }, runs);
    ed.restyle();
  }
  if (Object.keys(runPatch).length) {
    const lt = ed.t;
    const next = [];
    let pos = 0;
    for (const r of runs) {
      const a = pos;
      const b = pos + r.t.length;
      pos = b;
      const cuts = [
        [a, Math.max(a, Math.min(b, range.start)), false],
        [Math.max(a, range.start), Math.min(b, range.end), true],
        [Math.max(a, Math.min(b, range.end)), b, false],
      ];
      for (const [s, e, hit] of cuts) {
        if (e <= s) continue;
        let o = r.o;
        if (hit) {
          o = { ...o, ...runPatch };
          if (runPatch.family)
            Object.assign(
              o,
              fitStyle(runPatch.family, o.weight ?? lt.weight, o.italic ?? lt.italic),
            );
          if (runPatch.shift != null) o.script = 'none';
          o = pruneO(o, lt);
        }
        next.push({ t: r.t.slice(s - a, e - a), o });
      }
    }
    runs = mergeRuns(next);
    renderEditor(div, runs, lt);
    if (runPatch.family) ensureFont(runPatch.family);
  }
  ed.place();
  if (refocus) {
    div.focus();
    setEditorRange(div, range.start, range.end);
    ed.range = range;
  }
}

function finishTypeEdit(keep) {
  const ed = typeEdit;
  if (!ed) return;
  typeEdit = null;
  const { el, div, isNew, before } = ed;
  const runs = readEditor(div);
  div.remove();
  el.style.removeProperty('visibility');
  if (!el.getAttribute('style')) el.removeAttribute('style');
  if (!keep) {
    if (isNew) {
      el.remove();
      state.sel = [];
    } else layoutText(el, JSON.parse(before));
    drawSelection();
    renderLayers();
    return;
  }
  if (
    !runs
      .map((r) => r.t)
      .join('')
      .trim()
  ) {
    el.remove();
    state.sel = [];
    if (isNew) {
      drawSelection();
      renderLayers();
    } else commit();
    return;
  }
  layoutText(el, runs);
  if (!isNew && JSON.stringify(rawRuns(el)) === before) return drawSelection();
  state.sel = [el];
  commit();
}

// ---- Type tool ------------------------------------------------------------
tools.text = {
  hint: 'Click to add point text, or drag a box for paragraph text · Click text to edit it · Ctrl+Enter or click away finishes, Esc cancels',
  cursor: cursorFor.text,
  down(e, p) {
    // As in Photoshop, a click while typing only commits the text (the
    // editor's blur does that); the next click starts a new layer.
    if (typeEdit) {
      this.hit = this.g = null;
      return;
    }
    const hit = doc.contains(e.target) ? e.target.closest('text') : null;
    this.hit = hit;
    this.g = hit ? null : { p0: snapPt(p) };
  },
  move(e, p) {
    if (!this.g) return;
    const q = snapPt(p);
    const a = this.g.p0;
    guides.replaceChildren();
    mk(
      'rect',
      {
        x: Math.min(a.x, q.x),
        y: Math.min(a.y, q.y),
        width: Math.abs(q.x - a.x),
        height: Math.abs(q.y - a.y),
        class: 'sc-ov sc-ov-dash',
      },
      guides,
    );
  },
  up(e, p) {
    guides.replaceChildren();
    if (this.hit) {
      const el = this.hit;
      this.hit = null;
      setTimeout(() => editTextLayer(el), 0);
      return;
    }
    const g = this.g;
    this.g = null;
    if (!g) return;
    const q = snapPt(p);
    const w = Math.abs(q.x - g.p0.x);
    const h = Math.abs(q.y - g.p0.y);
    const area = w * state.zoom > 12 && h * state.zoom > 12;
    const t = { ...state.type, box: area ? w : 0 };
    const lead = leadingOf(t);
    const top = Math.min(g.p0.y, q.y);
    const el = mk('text', {
      ...newStyle('text'),
      x: f(area ? Math.min(g.p0.x, q.x) : g.p0.x),
      y: f(area ? top + (lead - t.size) / 2 + t.size * 0.8 : g.p0.y),
    });
    doc.append(el);
    applyType(el, t, '');
    renderLayers();
    setTimeout(() => editTextLayer(el, true), 0);
  },
  leave() {
    if (typeEdit) finishTypeEdit(true);
    guides.replaceChildren();
  },
};

// ---- options bar / Character / Paragraph panels ---------------------------
function readTypeFromSelection() {
  const el = selectedTexts()[0];
  if (el) state.type = { ...typeFrom(el) };
  syncTypeUI();
  return !!el;
}

function syncTypeUI() {
  const t = state.type;
  for (const b of document.querySelectorAll('[data-type-show="family"]')) {
    b.textContent = t.family;
    b.style.fontFamily = fontByName(t.family).css;
  }
  for (const sel of document.querySelectorAll('select[data-type="style"]')) {
    sel.replaceChildren(
      ...fontStyles(t.family).map(([w, it, label]) => {
        const o = document.createElement('option');
        o.value = `${w}${it ? 'i' : ''}`;
        o.textContent = label;
        return o;
      }),
    );
    sel.value = `${t.weight}${t.italic ? 'i' : ''}`;
  }
  const show = {
    size: f(t.size),
    leading: t.leading ? f(t.leading) : '',
    tracking: t.tracking,
    shift: t.script !== 'none' ? '' : f(t.shift),
    box: t.box ? f(t.box) : '',
  };
  for (const el of document.querySelectorAll('input[data-type]'))
    if (document.activeElement !== el) el.value = show[el.dataset.type];
  const boxField = $('[data-type="box"]');
  if (boxField) boxField.disabled = !t.box;
  for (const b of document.querySelectorAll('[data-type-align]'))
    b.setAttribute('aria-checked', b.dataset.typeAlign === t.align);
  const on = {
    caps: t.caps === 'all',
    smallcaps: t.caps === 'small',
    super: t.script === 'super',
    sub: t.script === 'sub',
    underline: t.underline,
    strike: t.strike,
  };
  for (const b of document.querySelectorAll('[data-type-toggle]'))
    b.setAttribute('aria-pressed', !!on[b.dataset.typeToggle]);
  $('#sc-type-convert').textContent = t.box ? 'Convert to Point Text' : 'Convert to Paragraph Text';
}

// Change one setting on the text being edited, else on the selected text
// layers (each keeps its other settings), and make it the default.
function changeType(patch, final = true) {
  Object.assign(state.type, patch);
  if (patch.family)
    Object.assign(state.type, fitStyle(patch.family, state.type.weight, state.type.italic));
  ensureFont(state.type.family);
  if (typeEdit) {
    applyToEdit(patch, final);
    syncTypeUI();
    return;
  }
  const targets = selectedTexts();
  // Styling a whole layer clears the same setting from its characters.
  const keys = Object.keys(patch).filter((k) => RUN_KEYS.includes(k));
  if (patch.family) keys.push('weight', 'italic');
  for (const el of targets) {
    const t = { ...typeFrom(el), ...patch };
    if (patch.family) Object.assign(t, fitStyle(patch.family, t.weight, t.italic));
    const runs = rawRuns(el).map((r) => ({
      t: r.t,
      o: Object.fromEntries(Object.entries(r.o).filter(([k]) => !keys.includes(k))),
    }));
    applyType(el, t, runs);
  }
  syncTypeUI();
  if (!targets.length) return;
  if (final) commit();
  else drawSelection();
}

function convertTextKind() {
  const els = selectedTexts();
  if (!els.length) return warn('Select a text layer first.');
  if (els.some(isTP)) return warn('Text on a path is always one line — release it first.');
  for (const el of els) {
    const t = typeFrom(el);
    const text = rawRuns(el);
    if (t.box) {
      // Paragraph → point: one line per paragraph, anchored where the box was.
      const x0 = parseFloat(el.getAttribute('x')) || 0;
      el.setAttribute('x', f(x0 + { start: 0, middle: t.box / 2, end: t.box }[t.align]));
      applyType(el, { ...t, box: 0 }, text);
    } else {
      const b = el.getBBox();
      el.setAttribute('x', f(b.x));
      applyType(el, { ...t, box: Math.max(b.width, t.size * 4) }, text);
    }
  }
  readTypeFromSelection();
  commit();
}

// ---- font picker ------------------------------------------------------------
const fontPop = $('#sc-fontpop');
const fontSearch = fontPop.querySelector('input');
const fontList = fontPop.querySelector('ul');
let fontActive = 0;
// The list shows Popular (system fonts, the popular Google families and
// any installed fonts) or one Google category; a search looks through
// every family, best matches first. Long lists stop at FONT_ROWS rows.
const FONT_ROWS = 150;
let fontCat = 'pop';
const fontSeen = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        previewFont(fontByName(e.target.dataset.font));
        fontSeen.unobserve(e.target);
      }
  },
  { root: fontList, rootMargin: '200px 0px' },
);
function fontMatches(q) {
  const rank = (ft) => {
    const n = ft.name.toLowerCase();
    return n === q ? 0 : n.startsWith(q) ? 1 : n.split(' ').some((w) => w.startsWith(q)) ? 2 : 3;
  };
  return FONTS.map((ft) => [ft, rank(ft)])
    .filter(([ft, r]) => r < 3 || ft.name.toLowerCase().includes(q))
    .sort(([a, ra], [b, rb]) => ra - rb || !!b.pop - !!a.pop)
    .map(([ft]) => ft);
}
function renderFontList() {
  const q = fontSearch.value.trim().toLowerCase();
  for (const b of fontPop.querySelectorAll('[data-font-cat]'))
    b.setAttribute('aria-checked', b.dataset.fontCat === fontCat);
  const inCat = (ft) =>
    fontCat === 'pop' || fontCat === 'all' ? true : ft.src === 'google' && ft.cat === fontCat;
  const pool = q ? fontMatches(q) : FONTS;
  const groups = [];
  if (fontCat === 'pop' || fontCat === 'all')
    groups.push(['System fonts', pool.filter((ft) => ft.src === 'system')]);
  const google = pool.filter(
    (ft) => ft.src === 'google' && inCat(ft) && (q || fontCat !== 'pop' || ft.pop),
  );
  groups.push([
    !q && fontCat === 'pop'
      ? 'Popular Google Fonts'
      : `${fontCat === 'pop' || fontCat === 'all' ? 'Google Fonts' : FONT_CATS[fontCat][0]} · ${google.length}`,
    google,
  ]);
  if (fontCat === 'pop' || fontCat === 'all')
    groups.push(['Installed on this computer', pool.filter((ft) => ft.src === 'local')]);
  $('#sc-local-fonts').hidden =
    !('queryLocalFonts' in window) ||
    FONTS.some((ft) => ft.src === 'local') ||
    (fontCat !== 'pop' && fontCat !== 'all');
  fontList.replaceChildren();
  let idx = 0;
  for (const [title, list] of groups) {
    if (!list.length) continue;
    const h = document.createElement('li');
    h.className = 'sc-font-head';
    h.textContent = title;
    fontList.append(h);
    for (const ft of list.slice(0, FONT_ROWS)) {
      const li = document.createElement('li');
      li.className = 'sc-font-item';
      li.setAttribute('role', 'option');
      li.dataset.font = ft.name;
      li.dataset.idx = idx++;
      li.setAttribute('aria-selected', ft.name === state.type.family);
      li.textContent = ft.name;
      li.style.fontFamily = ft.css;
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pickFont(ft.name);
      });
      fontList.append(li);
      if (ft.src === 'google') fontSeen.observe(li);
    }
    if (list.length > FONT_ROWS) {
      const more = document.createElement('li');
      more.className = 'sc-font-head';
      more.textContent = `${list.length - FONT_ROWS} more: type to narrow them down`;
      fontList.append(more);
    }
  }
  if (!idx) {
    const li = document.createElement('li');
    li.className = 'sc-font-head';
    li.textContent = 'No fonts match';
    fontList.append(li);
  }
  fontActive = Math.max(
    0,
    [...fontList.querySelectorAll('.sc-font-item')].findIndex(
      (li) => li.dataset.font === state.type.family,
    ),
  );
  if (q) fontActive = 0;
  markFontActive();
}
for (const b of fontPop.querySelectorAll('[data-font-cat]')) {
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', () => {
    fontCat = b.dataset.fontCat;
    fontList.scrollTop = 0;
    renderFontList();
    fontSearch.focus();
  });
}
function markFontActive() {
  const items = [...fontList.querySelectorAll('.sc-font-item')];
  items.forEach((li, i) => li.classList.toggle('active', i === fontActive));
  items[fontActive]?.scrollIntoView({ block: 'nearest' });
}
function openFontPicker(btn) {
  fontPop.hidden = false;
  const r = btn.getBoundingClientRect();
  fontPop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - fontPop.offsetWidth - 4))}px`;
  const below = r.bottom + 2 + fontPop.offsetHeight < innerHeight;
  fontPop.style.top = `${below ? r.bottom + 2 : Math.max(4, r.top - fontPop.offsetHeight - 2)}px`;
  fontSearch.value = '';
  renderFontList();
  fontSearch.focus();
}
function closeFontPicker() {
  fontPop.hidden = true;
}
function pickFont(name) {
  closeFontPicker();
  changeType({ family: name });
}
fontSearch.addEventListener('input', renderFontList);
fontSearch.addEventListener('keydown', (e) => {
  const items = [...fontList.querySelectorAll('.sc-font-item')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    fontActive = clamp(fontActive + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
    markFontActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (items[fontActive]) pickFont(items[fontActive].dataset.font);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFontPicker();
  }
  e.stopPropagation();
});
document.addEventListener('pointerdown', (e) => {
  if (!fontPop.hidden && !fontPop.contains(e.target) && !e.target.closest('[data-fontpick]'))
    closeFontPicker();
});
for (const b of document.querySelectorAll('[data-fontpick]'))
  b.addEventListener('click', () => (fontPop.hidden ? openFontPicker(b) : closeFontPicker()));

// The weight a font's style name ("Semibold Italic", …) stands for.
const styleWeight = (s) =>
  /thin|hairline/.test(s)
    ? 100
    : /extra ?light|ultra ?light/.test(s)
      ? 200
      : /light/.test(s)
        ? 300
        : /medium/.test(s)
          ? 500
          : /semi ?bold|demi/.test(s)
            ? 600
            : /extra ?bold|ultra ?bold/.test(s)
              ? 800
              : /black|heavy/.test(s)
                ? 900
                : /bold/.test(s)
                  ? 700
                  : 400;

// Chromium's Local Font Access lists the fonts installed on this computer.
async function loadLocalFonts() {
  try {
    const data = await window.queryLocalFonts();
    const fam = new Map();
    const known = new Set(FONTS.map((ft) => ft.name));
    for (const d of data) {
      if (known.has(d.family)) continue;
      const s = d.style.toLowerCase();
      const w = styleWeight(s);
      const e = fam.get(d.family) || { w: new Set(), i: false };
      e.w.add(w);
      if (/italic|oblique/.test(s)) e.i = true;
      fam.set(d.family, e);
    }
    for (const [name, e] of [...fam].sort((a, b) => a[0].localeCompare(b[0]))) {
      const w = [...e.w].sort((a, b) => a - b);
      FONTS.push({ name, css: `'${name}', sans-serif`, w, iw: e.i ? w : [], i: e.i, src: 'local' });
    }
    say(
      `${fam.size} installed font families added. They only look right on computers that have them.`,
    );
    $('#sc-local-fonts').hidden = true;
    renderFontList();
  } catch {
    warn('The browser did not allow access to installed fonts.');
  }
}
$('#sc-local-fonts').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  loadLocalFonts();
});

// ---- type controls ------------------------------------------------------------
for (const sel of document.querySelectorAll('select[data-type="style"]'))
  sel.addEventListener('change', () =>
    changeType({ weight: parseInt(sel.value, 10), italic: sel.value.endsWith('i') }),
  );
for (const el of document.querySelectorAll('input[data-type]')) {
  const key = el.dataset.type;
  const read = () => {
    const v = parseFloat(el.value);
    if (key === 'leading') return { leading: isFinite(v) && v > 0 ? v : 0 };
    if (!isFinite(v)) return null;
    if (key === 'shift') return { shift: v, script: 'none' };
    if (key === 'box') return state.type.box ? { box: Math.max(1, v) } : null;
    if (key === 'size') return { size: Math.max(0.5, v) };
    return { [key]: v };
  };
  el.addEventListener('input', () => {
    const p = read();
    if (p && !typeEdit) changeType(p, false);
  });
  el.addEventListener('change', () => {
    const p = read();
    if (p) changeType(p, true);
    syncTypeUI();
  });
  el.addEventListener('keydown', (e) => {
    // Swallow the key: focus may move to the canvas text editor while it's handled.
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  });
}
for (const b of document.querySelectorAll('[data-type-align]'))
  b.addEventListener('click', () => changeType({ align: b.dataset.typeAlign }));
for (const b of document.querySelectorAll('[data-type-toggle]')) {
  b.addEventListener('click', () => {
    const k = b.dataset.typeToggle;
    const t = state.type;
    const patch = {
      caps: { caps: t.caps === 'all' ? 'none' : 'all' },
      smallcaps: { caps: t.caps === 'small' ? 'none' : 'small' },
      super: { script: t.script === 'super' ? 'none' : 'super' },
      sub: { script: t.script === 'sub' ? 'none' : 'sub' },
      underline: { underline: !t.underline },
      strike: { strike: !t.strike },
    }[k];
    changeType(patch);
  });
}
$('#sc-type-convert').addEventListener('click', convertTextKind);

// Open the Properties group on its Character tab.
function showCharacterPanel() {
  showTab('character');
  $('#sc-panel').classList.add('open');
}
function showParagraphPanel() {
  showTab('paragraph');
  $('#sc-panel').classList.add('open');
}

// Raster of the artboard for pixel sampling, rebuilt lazily after edits.
let rasterJob = null;
function raster() {
  if (rasterJob) return rasterJob;
  rasterJob = new Promise((resolve) => {
    const s = clamp(2048 / Math.max(state.w, state.h), 1, 4);
    const url = URL.createObjectURL(
      new Blob([serialize({ animate: false })], { type: 'image/svg+xml' }),
    );
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(state.w * s));
      c.height = Math.max(1, Math.round(state.h * s));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ ctx, s, c });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  return rasterJob;
}

// Colour under doc point p, or a reason string when there's nothing to take.
async function samplePixel(p) {
  if (p.x < 0 || p.y < 0 || p.x > state.w || p.y > state.h) return 'Outside the artboard.';
  const r = await raster();
  if (!r) return "Couldn't render the drawing to sample it.";
  let d;
  try {
    d = r.ctx.getImageData(
      Math.min(r.c.width - 1, Math.floor(p.x * r.s)),
      Math.min(r.c.height - 1, Math.floor(p.y * r.s)),
      1,
      1,
    ).data;
  } catch {
    return 'The drawing uses an external image, so the browser blocks pixel sampling.';
  }
  if (!d[3]) return 'Nothing there to sample (transparent).';
  const hx = '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
  return { hex: hx, a: +(d[3] / 255).toFixed(2) };
}

tools.eyedropper = {
  hint: 'Style: click a shape to copy its fill, stroke and opacity (onto the selection too) · Colour: click to take the exact pixel colour into the active paint · Alt-click sends it to the other paint',
  cursor: cursorFor.eyedropper,
  async down(e, p) {
    if (state.eyedropMode === 'style') {
      const el = topLevel(e.target);
      if (!el) return warn('Click a shape to copy its style.');
      const targets = state.sel.filter((x) => x !== el);
      const hit = e.target.closest?.(SHAPE_SEL);
      readStyle(hit && doc.contains(hit) ? hit : el);
      if (!targets.length) return say('Style picked up — new shapes will use it.');
      for (const t of targets)
        for (const k of ['fill', 'stroke', 'width', 'opacity']) applyStyle(t, k);
      commit();
      return say(`Style applied to ${targets.length} object${targets.length > 1 ? 's' : ''}.`);
    }
    const c = await samplePixel(p);
    if (typeof c === 'string') return warn(c);
    const k = e.altKey ? (state.active === 'fill' ? 'stroke' : 'fill') : state.active;
    state[k] = c.hex;
    state[k + 'On'] = true;
    state[k + 'A'] = c.a;
    styleChanged(k, true);
    say(
      `${k === 'fill' ? 'Fill' : 'Stroke'} set to ${c.hex}${c.a < 1 ? ` at ${Math.round(c.a * 100)}%` : ''}.`,
    );
  },
  // In Colour mode, a ring around the cursor previews the sampled colour.
  async move(e, p) {
    if (state.eyedropMode !== 'pixel') return;
    const stamp = (this.stamp = (this.stamp || 0) + 1);
    const c = await samplePixel(p);
    if (stamp !== this.stamp || state.tool !== 'eyedropper') return;
    guides.replaceChildren();
    if (typeof c === 'string') return;
    const z = state.zoom;
    mk(
      'circle',
      {
        cx: p.x,
        cy: p.y,
        r: 16 / z,
        class: 'sc-eyedrop-ring',
        stroke: c.hex,
        'stroke-opacity': c.a,
        'stroke-width': 8,
      },
      guides,
    );
    mk('circle', { cx: p.x, cy: p.y, r: 20 / z, class: 'sc-eyedrop-ring sc-ov' }, guides);
    $('#sc-eyedrop-note').textContent = `${c.hex}${c.a < 1 ? ` · ${Math.round(c.a * 100)}%` : ''}`;
  },
  leave() {
    this.stamp = (this.stamp || 0) + 1;
    guides.replaceChildren();
    $('#sc-eyedrop-note').textContent = '';
  },
};
