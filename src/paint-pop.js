// SVGCraft — Fill and Stroke in the options bar: the drawing tools' paint
// pickers, as on the familiar shape tools.
'use strict';

// Each is a button showing the paint, and its dropdown chooses how that
// paint is drawn: None; a solid colour (the colours this drawing already
// uses, the library's swatches, or any colour with its alpha); a gradient;
// or a pattern. What's chosen is what the next shape gets, and goes on the
// selection too. A gradient's stops and a pattern's scale are edited in
// Properties → Appearance; the libraries are managed in Window → Libraries
// (each section's Custom…).
const PAINT_MODES = [
  ['none', 'None'],
  ['solid', 'Colour'],
  ['gradient', 'Gradient'],
  ['pattern', 'Pattern'],
];
const paintMode = (k) =>
  !state[k + 'On']
    ? 'none'
    : state[k + 'Pat']
      ? 'pattern'
      : state[k + 'Grad']
        ? 'gradient'
        : 'solid';
// What a paint looks like, as a CSS background.
function paintCss(k) {
  const m = paintMode(k);
  if (m === 'pattern') return `${patCss({ ...state[k + 'Pat'], scale: 1 }, state[k], 1)}, #fff`;
  if (m === 'gradient') return `${chipCss(state[k + 'Grad'])}, var(--checker) 0 0 / 8px 8px`;
  if (m === 'solid') return `${solidCss(state[k], state[k + 'A'])}, var(--checker) 0 0 / 8px 8px`;
  return 'none';
}

// The colours the drawing already uses, most used first: each shape's own
// solid fill and stroke, with their alpha.
function docColours(max = 18) {
  const n = new Map();
  for (const el of doc.querySelectorAll(SHAPE_SEL)) {
    if (el.closest('defs, symbol')) continue;
    const cs = getComputedStyle(el);
    for (const [paint, op] of [
      [cs.fill, cs.fillOpacity],
      [cs.stroke, cs.strokeOpacity],
    ]) {
      if (!paint || paint === 'none' || paint.startsWith('url')) continue;
      const c = hex(paint);
      if (!c) continue;
      const a = Math.round(parseFloat(op) * colorAlpha(paint) * 100) / 100;
      const key = `${c}/${a}`;
      n.set(key, (n.get(key) || 0) + 1);
    }
  }
  return [...n]
    .sort((x, y) => y[1] - x[1])
    .slice(0, max)
    .map(([key]) => {
      const [c, a] = key.split('/');
      return { c, a: +a };
    });
}

// Choosing: what the next shape gets, and the selection's paint.
function setSolidPaint(k, c, a, swatch = null) {
  state[k + 'Swatch'] = swatch;
  state[k] = c;
  if (a != null) state[k + 'A'] = a;
  state[k + 'On'] = true;
  state[k + 'Grad'] = null;
  state[k + 'Pat'] = null;
  styleChanged(k, true);
}
function setNoPaint(k) {
  state[k + 'On'] = false;
  styleChanged(k, true);
}

// ---- the buttons ------------------------------------------------------------------
function syncPaintButtons() {
  for (const b of document.querySelectorAll('.sc-paintbtn')) {
    const k = b.dataset.paint;
    const m = paintMode(k);
    const sw = b.querySelector('.sc-paintbtn-sw');
    sw.style.setProperty('--tile', paintCss(k));
    sw.classList.toggle('none', m === 'none');
    const what =
      m === 'none'
        ? 'none'
        : m === 'solid'
          ? `${state[k]}${state[k + 'A'] < 1 ? ` at ${Math.round(state[k + 'A'] * 100)}%` : ''}`
          : m === 'gradient'
            ? 'gradient'
            : `pattern “${state[k + 'Pat'].name}”`;
    const name = k === 'fill' ? 'Fill' : 'Stroke';
    b.setAttribute('aria-label', `${name}: ${what}`);
    b.dataset.tip = `${name}: ${what} · click to change`;
  }
  if (paintPopFor) renderPaintPop();
}
for (const b of document.querySelectorAll('.sc-paintbtn')) {
  b.type = 'button';
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  b.innerHTML =
    '<span class="sc-paintbtn-sw"></span><span class="sc-libpick-caret">' +
    icon('chevron-down') +
    '</span>';
  b.addEventListener('click', () => {
    if (paintPopFor?.btn === b) return closePaintPop();
    if (libPickShut.btn === b && libPickShut.at >= libPickDown.at && b.contains(libPickDown.el))
      return;
    openPaintPop(b);
  });
}

// ---- the dropdown -----------------------------------------------------------------
let paintPopFor = null; // { btn, k, mode }
const paintPop = (() => {
  const pop = document.createElement('div');
  pop.id = 'sc-paintpop';
  pop.className = 'sc-libpick-pop sc-paintpop';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  if ('popover' in pop) pop.popover = 'auto';
  pop.innerHTML =
    '<div class="sc-seg sc-paintpop-modes" role="radiogroup"></div>' +
    '<div class="sc-paintpop-body"></div>';
  document.body.append(pop);
  const modes = pop.querySelector('.sc-paintpop-modes');
  for (const [m, label] of PAINT_MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.mode = m;
    b.textContent = label;
    b.addEventListener('click', () => pickPaintMode(m));
    modes.append(b);
  }
  pop.addEventListener('toggle', (e) => {
    if (e.newState !== 'closed' || !paintPopFor) return;
    libPickShut = { btn: paintPopFor.btn, at: performance.now() };
    // Esc (the browser's) goes back to the button; a click elsewhere doesn't.
    const away = document.activeElement && document.activeElement !== document.body;
    closePaintPop(!away || paintPop.contains(document.activeElement));
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closePaintPop();
  });
  return pop;
})();

function openPaintPop(btn) {
  libPickOpen?.close(false);
  const k = btn.dataset.paint;
  state.active = k;
  paintPopFor = { btn, k, mode: paintMode(k) };
  paintPop.setAttribute('aria-label', k === 'fill' ? 'Fill' : 'Stroke');
  renderPaintPop();
  paintPop.hidden = false;
  if (paintPop.popover) paintPop.showPopover();
  const r = btn.getBoundingClientRect();
  const w = paintPop.offsetWidth;
  const h = paintPop.offsetHeight;
  paintPop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  paintPop.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  btn.setAttribute('aria-expanded', 'true');
  paintPop.querySelector('[aria-checked="true"]')?.focus();
}
function closePaintPop(refocus = true) {
  if (!paintPopFor) return;
  const { btn } = paintPopFor;
  paintPopFor = null;
  if (paintPop.popover && paintPop.matches(':popover-open')) paintPop.hidePopover();
  paintPop.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  if (refocus) btn.focus();
}

// A mode: None and Colour apply at once; Gradient and Pattern show their
// tiles (and apply the last one used).
function pickPaintMode(m) {
  const { k } = paintPopFor;
  paintPopFor.mode = m;
  if (m === 'none') setNoPaint(k);
  else if (m === 'solid') setSolidPaint(k, state[k], state[k + 'A']);
  else if (m === 'gradient' && !state[k + 'Grad']) setPaintKind(k, 'linear');
  else if (m === 'pattern' && !state[k + 'Pat']) setPaintKind(k, 'pattern');
  renderPaintPop();
}

const ppTile = (label, bg, onPick, sel, global = false) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className =
    'sc-libpick-tile sc-paintpop-tile' + (sel ? ' sel' : '') + (global ? ' global' : '');
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-pressed', !!sel);
  b.dataset.tip = label;
  const t = document.createElement('span');
  t.className = 'sc-libpick-tile-thumb';
  t.style.setProperty('--tile', bg);
  b.append(t);
  b.addEventListener('click', onPick);
  return b;
};
const ppHeading = (text) => {
  const h = document.createElement('p');
  h.className = 'sc-subhead';
  h.textContent = text;
  return h;
};
const ppGrid = (tiles, cls = '') => {
  const g = document.createElement('div');
  g.className = `sc-paintpop-grid ${cls}`;
  g.append(...tiles);
  return g;
};
const ppCustom = (tab, tip) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sc-tbtn sc-libpick-manage';
  b.textContent = 'Custom…';
  b.dataset.tip = tip;
  b.addEventListener('click', () => {
    closePaintPop(false);
    openLibraries(tab);
  });
  const f = document.createElement('div');
  f.className = 'sc-libpick-foot';
  f.append(b);
  return f;
};

function renderPaintPop() {
  const { k, mode } = paintPopFor;
  // Redrawn as the paint changes: the control that had the keyboard keeps it.
  const had = paintPop.contains(document.activeElement)
    ? document.activeElement.getAttribute('aria-label')
    : null;
  for (const b of paintPop.querySelectorAll('[data-mode]'))
    b.setAttribute('aria-checked', b.dataset.mode === mode);
  const body = paintPop.querySelector('.sc-paintpop-body');
  const cur = paintMode(k);
  const out = [];
  if (mode === 'none') {
    const p = document.createElement('p');
    p.className = 'sc-hint';
    p.textContent = `No ${k}.`;
    out.push(p);
  } else if (mode === 'solid') {
    const on = (c, a) => cur === 'solid' && state[k] === c && Math.abs(state[k + 'A'] - a) < 0.005;
    const docs = docColours();
    if (docs.length)
      out.push(
        ppHeading('This drawing'),
        ppGrid(
          docs.map((x) =>
            ppTile(
              `${x.c}${x.a < 1 ? ` ${Math.round(x.a * 100)}%` : ''}`,
              libSwatchThumb(x),
              () => setSolidPaint(k, x.c, x.a),
              on(x.c, x.a),
            ),
          ),
          'small',
        ),
      );
    out.push(
      ppHeading('Swatches'),
      ppGrid(
        lib.swatches.map((x) =>
          ppTile(
            x.name,
            libSwatchThumb(x),
            () => setSolidPaint(k, x.c, x.a, x.global ? x.id : null),
            on(x.c, x.a),
            x.global,
          ),
        ),
        'small',
      ),
    );
    // Any colour: the picker, its hex and its alpha.
    const row = document.createElement('div');
    row.className = 'sc-paintpop-colour';
    const pick = document.createElement('input');
    pick.type = 'color';
    pick.value = state[k];
    pick.setAttribute('aria-label', 'Pick a colour');
    pick.addEventListener('input', () => setSolidPaint(k, pick.value));
    const hx = document.createElement('input');
    hx.type = 'text';
    hx.className = 'sc-hex';
    hx.value = state[k];
    hx.spellcheck = false;
    hx.setAttribute('aria-label', 'Hex');
    hx.addEventListener('change', () => {
      const v = hex(hx.value.trim().startsWith('#') ? hx.value.trim() : '#' + hx.value.trim());
      if (v && /^#[0-9a-f]{6}$/.test(v)) setSolidPaint(k, v);
      else hx.value = state[k];
    });
    const al = document.createElement('input');
    al.type = 'number';
    al.min = '0';
    al.max = '100';
    al.step = '1';
    al.value = Math.round(state[k + 'A'] * 100);
    al.setAttribute('aria-label', 'Alpha');
    al.addEventListener('change', () => {
      const v = parseFloat(al.value);
      if (isFinite(v)) setSolidPaint(k, state[k], clamp(v, 0, 100) / 100);
    });
    const pct = document.createElement('span');
    pct.className = 'sc-unit';
    pct.textContent = '%';
    row.append(pick, hx, al, pct);
    out.push(row, ppCustom('swatches', 'Make and manage swatches in the Libraries window'));
  } else if (mode === 'gradient') {
    const g = state[k + 'Grad'];
    const key = g ? stopsKey(g.stops) : '';
    out.push(
      ppGrid(
        gradPresets().map((x) =>
          ppTile(
            x.name,
            libGradThumb(x),
            () => applyLibGrad({ type: g?.type || 'linear', angle: g?.angle || 0, stops: x.stops }),
            stopsKey(x.stops) === key,
          ),
        ),
      ),
      ppCustom('gradients', 'Make, save and manage gradients in the Libraries window'),
    );
  } else {
    const p = state[k + 'Pat'];
    out.push(
      ppGrid(
        lib.patterns.map((x) =>
          ppTile(x.name, libPatThumb(x), () => applyLibPat(x), p?.id === x.id),
        ),
      ),
      ppCustom('patterns', 'Make and manage patterns in the Libraries window'),
    );
  }
  body.replaceChildren(...out);
  if (had) paintPop.querySelector(`[aria-label="${CSS.escape(had)}"]`)?.focus();
}
