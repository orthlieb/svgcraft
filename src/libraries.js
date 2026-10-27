// SVGCraft — Swatches, Gradients, Patterns and Symbols libraries.
'use strict';

// ---- libraries: swatches, gradients, patterns, symbols --------------------------
// Kept in this browser's localStorage. The built-ins seed it, and like
// Photoshop's presets they can be renamed, deleted and restored. Export /
// Import Library carries the lot between browsers as a JSON file. Library
// symbols are { id, name, category, w, h, svg, credit?, size? }: svg is the
// content in a 0 0 w h box, size the height it's placed at (64 if unset).
const LIB_KEY = 'svgcraft.library.v1';
const uid = () => Math.random().toString(36).slice(2, 10);
function defaultLibrary(kind) {
  const all = {
    swatches: PALETTE.filter((c) => c !== 'none').map((c) => ({ id: uid(), name: c, c, a: 1 })),
    gradients: Object.entries(GRAD_PRESETS)
      .filter(([k]) => k !== 'fade')
      .map(([id, [name, fn]]) => ({ id, name, type: 'linear', angle: 0, stops: fn() })),
    patterns: BUILTIN_PATTERNS.map(([name, w, h, svg]) => ({
      id: name.toLowerCase(),
      name,
      w,
      h,
      svg,
    })),
    // The built-in icon set (symbols-library.js, loaded when first needed).
    symbols: (window.SC_SYMBOLS || []).map((x) => ({ ...x })),
  };
  return kind ? all[kind] : all;
}

// A pattern tile from outside (a library file) is sanitised like an
// imported drawing (its <style> rules baked in, so they can't restyle the
// editor).
function cleanTile(markup) {
  const d = new DOMParser().parseFromString(
    `<svg xmlns="${NS}" xmlns:xlink="${XLINK}">${markup}</svg>`,
    'image/svg+xml',
  );
  if (d.querySelector('parsererror')) return '';
  const root = d.documentElement;
  sanitize(root);
  return [...root.childNodes]
    .map((n) => new XMLSerializer().serializeToString(n))
    .join('')
    .replaceAll(` xmlns="${NS}"`, '');
}

// Keep only well-formed entries. `fresh` gives everything new ids (imports).
// A stored library from before symbols existed gets the built-in set.
function cleanLibrary(raw, fresh = false) {
  const out = { swatches: [], gradients: [], patterns: [], symbols: [] };
  if (!raw || typeof raw !== 'object') return out;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const id = (v) =>
    !fresh && typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v) ? v : uid();
  const name = (v, d) => String(v ?? '').slice(0, 80) || d;
  const color = (v) =>
    typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
  const num = (v, lo, hi, d) => (v != null && isFinite(+v) ? clamp(+v, lo, hi) : d);
  for (const x of list(raw.swatches)) {
    const c = color(x.c);
    if (c) out.swatches.push({ id: id(x.id), name: name(x.name, c), c, a: num(x.a, 0, 1, 1) });
  }
  for (const x of list(raw.gradients)) {
    const stops = list(x.stops)
      .map((st) => ({ o: num(st.o, 0, 1, 0), c: color(st.c), a: num(st.a, 0, 1, 1) }))
      .filter((st) => st.c)
      .sort((a, b) => a.o - b.o);
    if (stops.length >= 2)
      out.gradients.push({
        id: id(x.id),
        name: name(x.name, 'Gradient'),
        type: x.type === 'radial' ? 'radial' : 'linear',
        angle: num(x.angle, -180, 180, 0),
        stops,
      });
  }
  for (const x of list(raw.patterns)) {
    const w = num(x.w, 0.5, 4096, 0);
    const h = num(x.h, 0.5, 4096, 0);
    const svg = typeof x.svg === 'string' && x.svg.length < 2e6 ? cleanTile(x.svg) : '';
    if (w && h && svg)
      out.patterns.push({ id: id(x.id), name: name(x.name, 'Pattern'), w, h, svg });
  }
  if (!fresh && !Array.isArray(raw.symbols)) out.symbols = defaultLibrary('symbols');
  // Plain text: control characters become spaces.
  const text = (v, n) =>
    typeof v === 'string'
      ? [...v]
          .map((c) => (c < ' ' || c === '\x7f' ? ' ' : c))
          .join('')
          .trim()
          .slice(0, n)
      : '';
  for (const x of list(raw.symbols)) {
    const w = num(x.w, 0.5, 4096, 0);
    const h = num(x.h, 0.5, 4096, 0);
    const svg = typeof x.svg === 'string' && x.svg.length < 2e6 ? cleanTile(x.svg) : '';
    if (!w || !h || !svg) continue;
    const item = {
      id: id(x.id),
      name: name(text(x.name, 80), 'Symbol'),
      category: text(x.category, 40) || 'Other',
      w,
      h,
      svg,
    };
    const credit = text(x.credit, 200);
    if (credit) item.credit = credit;
    if (x.size != null) item.size = num(x.size, 1, 4096, 64);
    out.symbols.push(item);
  }
  return out;
}

function loadLibrary() {
  const saved = stored(LIB_KEY);
  if (saved && typeof saved === 'object') {
    try {
      return cleanLibrary(saved);
    } catch {
      /* unreadable: start from the built-ins */
    }
  }
  return defaultLibrary();
}
// The built-in symbols are only fetched for a library that needs them (a
// first visit, or one kept without them): until they arrive the library has
// none, and saving leaves them out so they're filled in next time.
const symbolsPending = () => !window.SC_SYMBOLS && !libHasSymbols;
let libHasSymbols = Array.isArray(stored(LIB_KEY)?.symbols);
const lib = loadLibrary();
const libSel = { swatches: null, gradients: null, patterns: null, symbols: null };
if (symbolsPending())
  need('symbols').then(
    () => {
      lib.symbols = defaultLibrary('symbols');
      libHasSymbols = true;
      renderLibraries();
    },
    () => {},
  );

function saveLibrary() {
  if (!store(LIB_KEY, symbolsPending() ? { ...lib, symbols: undefined } : lib))
    say('Couldn’t save the library: this browser’s storage is full or blocked.');
  renderLibraries();
}

// Name / confirm prompt. Resolves to the text (or true without an input),
// or null when cancelled.
const askDlg = $('#sc-ask');
let askDone = null;
// `alt` adds a third button; choosing it resolves to 'alt'.
// `cancel` relabels the Cancel button.
function ask(title, { value = null, text = '', ok = 'OK', alt = '', cancel = 'Cancel' } = {}) {
  askDone?.(null);
  askDlg.querySelector('[data-ask="cancel"]').textContent = cancel;
  const altBtn = askDlg.querySelector('[data-ask="alt"]');
  altBtn.textContent = alt;
  altBtn.hidden = !alt;
  $('#sc-ask-title').textContent = title;
  askDlg.querySelector('.sc-ask-text').textContent = text;
  askDlg.querySelector('.sc-ask-text').hidden = !text;
  const inp = askDlg.querySelector('.sc-ask-input');
  inp.hidden = value == null;
  inp.value = value ?? '';
  askDlg.querySelector('[data-ask="ok"]').textContent = ok;
  showDialog(askDlg, () => askDone?.(null));
  setTimeout(() => {
    if (value == null) askDlg.querySelector('[data-ask="ok"]').focus();
    else {
      inp.focus();
      inp.select();
    }
  }, 0);
  return new Promise((resolve) => {
    askDone = (v) => {
      askDone = null;
      hideDialog(askDlg);
      resolve(v);
    };
  });
}
const askOk = () => {
  const inp = askDlg.querySelector('.sc-ask-input');
  askDone?.(inp.hidden ? true : inp.value.trim() || null);
};
askDlg.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    askOk();
  } else if (e.key === 'Escape') askDone?.(null);
});
askDlg.querySelector('[data-ask="ok"]').addEventListener('click', askOk);
askDlg.querySelector('[data-ask="cancel"]').addEventListener('click', () => askDone?.(null));
askDlg.querySelector('[data-ask="alt"]').addEventListener('click', () => askDone?.('alt'));

const otherPaint = () => (state.active === 'fill' ? 'stroke' : 'fill');

function applySwatch(c, a, e) {
  const k = e?.shiftKey ? otherPaint() : state.active;
  if (c !== 'none' && k === state.active && activeGrad())
    return editGrad((g) => {
      g.stops[state.gradStop].c = c;
      if (a != null) g.stops[state.gradStop].a = a;
    });
  if (c === 'none') state[k + 'On'] = false;
  else {
    state[k] = c;
    if (a != null) state[k + 'A'] = a;
    state[k + 'On'] = true;
    state[k + 'Grad'] = null;
  }
  styleChanged(k, true);
}
function applyLibGrad(g, e) {
  const k = e?.shiftKey ? otherPaint() : state.active;
  state[k + 'Grad'] = { type: g.type, angle: g.angle, stops: g.stops.map((x) => ({ ...x })) };
  state[k + 'Pat'] = null;
  state[k + 'On'] = true;
  state.gradStop = 0;
  gradReset = true;
  styleChanged(k, true);
  gradReset = false;
}
function applyLibPat(p, e) {
  const k = e?.shiftKey ? otherPaint() : state.active;
  const cur = state[k + 'Pat'];
  state[k + 'Pat'] = { ...p, scale: cur?.scale || 1, angle: cur?.angle || 0 };
  state[k + 'Grad'] = null;
  state[k + 'On'] = true;
  styleChanged(k, true);
}

// Tile backgrounds: colours and gradients over a checkerboard; patterns in
// the active paint's colour.
const solidCss = (c, a) => `linear-gradient(${cssColor(c, a)}, ${cssColor(c, a)})`;
const libGradCss = (g) => (g.type === 'radial' ? chipCss(g) : gradCss(g));
let patTileInk = null;

function libTile(kind, item, bg, apply) {
  const b = document.createElement('button');
  b.className = 'sc-tile' + (libSel[kind] === item.id ? ' sel' : '');
  b.dataset.id = item.id;
  b.dataset.tip = item.name;
  b.setAttribute('aria-label', item.name);
  b.style.setProperty('--tile', bg);
  b.addEventListener('click', (e) => {
    // Alt-click deletes, as in Photoshop's Swatches panel.
    if (e.altKey) return removeLibItem(kind, item.id);
    libSel[kind] = item.id;
    for (const x of b.parentNode.children) x.classList.toggle('sel', x === b);
    if (e.detail < 2) apply(e);
  });
  b.addEventListener('dblclick', () => renameLibItem(kind, item.id));
  return b;
}

function renderLibraries() {
  const none = document.createElement('button');
  none.className = 'sc-tile none';
  none.dataset.tip = 'No paint';
  none.setAttribute('aria-label', 'No paint');
  none.addEventListener('click', (e) => applySwatch('none', null, e));
  $('#sc-palette').replaceChildren(
    none,
    ...lib.swatches.map((x) =>
      libTile('swatches', x, solidCss(x.c, x.a), (e) => applySwatch(x.c, x.a, e)),
    ),
  );
  $('#sc-gradlib').replaceChildren(
    ...lib.gradients.map((x) => libTile('gradients', x, libGradCss(x), (e) => applyLibGrad(x, e))),
  );
  renderPatTiles(true);
  // The gradient editor's Presets list and the pattern editor's picker follow
  // the library too.
  const presets = $('#sc-grad-preset');
  presets.replaceChildren(
    Object.assign(document.createElement('option'), { value: '', textContent: 'Presets…' }),
    Object.assign(document.createElement('option'), {
      value: 'fade',
      textContent: GRAD_PRESETS.fade[0],
    }),
    ...lib.gradients.map((x) =>
      Object.assign(document.createElement('option'), { value: x.id, textContent: x.name }),
    ),
  );
  renderPatEditor();
  renderSymLib();
}
function renderPatTiles(force = false) {
  const ink = state[state.active];
  if (!force && ink === patTileInk) return;
  patTileInk = ink;
  $('#sc-patlib').replaceChildren(
    ...lib.patterns.map((x) =>
      libTile('patterns', x, patCss({ ...x, scale: 1 }, ink, 1.5), (e) => applyLibPat(x, e)),
    ),
  );
}

const LIB_NOUN = {
  swatches: 'swatch',
  gradients: 'gradient',
  patterns: 'pattern',
  symbols: 'symbol',
};
const libItem = (kind, id) => lib[kind].find((x) => x.id === id);

async function renameLibItem(kind, id = libSel[kind]) {
  const item = libItem(kind, id);
  if (!item) return say(`Click a ${LIB_NOUN[kind]} first, then rename it.`);
  const name = await ask(`Rename ${LIB_NOUN[kind]}`, { value: item.name });
  if (!name) return;
  item.name = name.slice(0, 80);
  saveLibrary();
}
function removeLibItem(kind, id = libSel[kind]) {
  const i = lib[kind].findIndex((x) => x.id === id);
  if (i < 0) return say(`Click a ${LIB_NOUN[kind]} first, then delete it.`);
  const [gone] = lib[kind].splice(i, 1);
  if (libSel[kind] === id) libSel[kind] = null;
  saveLibrary();
  say(`Deleted “${gone.name}”.`);
}
async function addLibItem(kind) {
  if (kind === 'patterns') return definePattern();
  if (kind === 'symbols') return saveSymbolToLib();
  const k = state.active;
  let item;
  if (kind === 'swatches') {
    const g = activeGrad();
    const st = g?.stops[state.gradStop];
    const c = st ? st.c : state[k];
    const a = st ? st.a : state[k + 'A'];
    item = { c, a, name: a < 1 ? `${c} ${Math.round(a * 100)}%` : c };
  } else {
    const g = activeGrad();
    if (!g) return say('Set the fill or stroke to a gradient first, then save it.');
    item = { type: g.type, angle: g.angle, stops: g.stops.map((x) => ({ ...x })) };
    item.name = `Gradient ${lib.gradients.length + 1}`;
  }
  const name = await ask(`New ${LIB_NOUN[kind]}`, { value: item.name, ok: 'Add' });
  if (!name) return;
  item = { id: uid(), ...item, name: name.slice(0, 80) };
  lib[kind].push(item);
  libSel[kind] = item.id;
  saveLibrary();
}
async function resetLib(kind) {
  const ok = await ask(`Reset ${kind}`, {
    text: `Replace your ${kind} with the built-in set? Export the library first to keep a copy.`,
    ok: 'Reset',
  });
  if (!ok) return;
  if (kind === 'symbols') await need('symbols');
  lib[kind] = defaultLibrary(kind);
  libSel[kind] = null;
  saveLibrary();
}
// Import takes an SVGCraft library (zip or JSON), or a palette, gradient
// or SVG from another app (see readLibraryFile), and adds what it holds.
async function importLibrary(file) {
  let raw;
  try {
    raw = await readLibraryFile(file.name || '', await file.arrayBuffer());
  } catch {
    return say(
      'That file isn’t a library, GIMP palette (.gpl) or gradient (.ggr), or SVG SVGCraft can read.',
    );
  }
  const add = cleanLibrary(raw, true);
  // Skip what's already there (same colour, same stops, same tile, whatever
  // its name). A new definition under a name already in use asks first.
  const key = {
    swatches: (x) => `${x.c}/${f(x.a)}`,
    gradients: (x) => JSON.stringify([x.type, x.angle, x.stops]),
    patterns: (x) => `${f(x.w)}x${f(x.h)}:${x.svg}`,
    symbols: (x) => `${f(x.w)}x${f(x.h)}:${x.svg}`,
  };
  const KINDS = ['swatches', 'gradients', 'patterns', 'symbols'];
  const nameKey = (x) => x.name.trim().toLowerCase();
  const fresh = {};
  const clashes = [];
  for (const kind of KINDS) {
    const have = new Set(lib[kind].map(key[kind]));
    const names = new Set(lib[kind].map(nameKey));
    fresh[kind] = add[kind].filter((x) => {
      const k = key[kind](x);
      if (have.has(k)) return false;
      have.add(k);
      if (names.has(nameKey(x))) clashes.push([kind, x]);
      return true;
    });
  }
  let choice = 'keep';
  if (clashes.length) {
    const n = clashes.length;
    const shown = clashes.slice(0, 3).map(([, x]) => `“${x.name}”`);
    const answer = await ask('Name clash', {
      text:
        `${n === 1 ? '1 imported item has' : `${n} imported items have`} the same name as ` +
        `${n === 1 ? 'one' : 'ones'} you have but a different definition: ` +
        `${shown.join(', ')}${n > 3 ? ` and ${n - 3} more` : ''}. Keep both (the imported ` +
        `${n === 1 ? 'one is' : 'ones are'} renamed), replace yours, or skip ` +
        `${n === 1 ? 'it' : 'them'}?`,
      ok: 'Keep both',
      alt: 'Replace mine',
      cancel: 'Skip them',
    });
    choice = answer === 'alt' ? 'replace' : answer ? 'keep' : 'skip';
  }
  const clashing = new Set(clashes.map(([, x]) => x));
  const tally = { added: [], replaced: [], skipped: 0 };
  const count = (list, kind, n) => n && list.push(`${n} ${n === 1 ? LIB_NOUN[kind] : kind}`);
  for (const kind of KINDS) {
    let added = 0;
    let replaced = 0;
    const taken = new Set(lib[kind].map(nameKey));
    const done = new Set();
    for (const x of fresh[kind]) {
      if (clashing.has(x) && choice === 'skip') {
        tally.skipped++;
        continue;
      }
      if (clashing.has(x) && choice === 'replace') {
        // Yours keeps its place, id and name; it takes the new definition.
        const i = lib[kind].findIndex((y) => nameKey(y) === nameKey(x) && !done.has(y));
        if (i >= 0) {
          const mine = lib[kind][i];
          lib[kind][i] = { ...x, id: mine.id, name: mine.name };
          done.add(lib[kind][i]);
          replaced++;
          continue;
        }
      }
      if (taken.has(nameKey(x))) {
        const base = x.name.replace(/ \d+$/, '');
        let n = 2;
        while (taken.has(`${base} ${n}`.toLowerCase())) n++;
        x.name = `${base} ${n}`.slice(0, 80);
      }
      taken.add(nameKey(x));
      lib[kind].push(x);
      added++;
    }
    count(tally.added, kind, added);
    count(tally.replaced, kind, replaced);
  }
  saveLibrary();
  const parts = [];
  if (tally.added.length) parts.push(`Imported ${tally.added.join(', ')}.`);
  if (tally.replaced.length) parts.push(`Replaced ${tally.replaced.join(', ')}.`);
  if (tally.skipped) parts.push(`Skipped ${tally.skipped} with a name you already use.`);
  say(parts.join(' ') || 'Nothing new in that library.');
}
