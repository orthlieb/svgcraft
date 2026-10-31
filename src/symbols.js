// SVGCraft — Symbols: the drawing's symbols, Edit Symbol and the Symbols library.
'use strict';

// ---- symbols (Illustrator's Symbols panel) ---------------------------------------
// Object → Make Symbol turns the selection into a <symbol id="sc-sym-N"
// data-name="…" overflow="visible"> in defs, its content in document
// coordinates, and leaves one instance — a <use href="#sc-sym-N"> with no
// transform — in its place, so nothing moves. Instances are ordinary layers:
// their own transform, opacity, blend, effects and locks sit on the <use>.
// Paint set on an instance only reaches content that doesn't set its own.
//
// Edit Symbol works in place, as Illustrator's isolation mode does: the
// drawing's layers are set aside behind (dimmed, out of reach), the symbol's
// content is laid out as top-level layers where the instance was, and every
// change is written straight back into the <symbol>, so the other instances
// follow as you go. Done (or Esc) puts the drawing back. History always
// records the real drawing (snapshot() writes the symbol back first).
const SYM_DRAG = 'application/x-svgcraft-symbol';
const hrefOf = (u) => u.getAttribute('href') ?? u.getAttributeNS(XLINK, 'href');
const symList = () => [...defs.querySelectorAll(':scope > symbol')];
const symName = (s) => s.getAttribute('data-name') || s.id;
const symById = (id) => symList().find((s) => s.id === id) || null;

// The symbol a <use> instance draws, or null.
function symbolOf(el) {
  if (el?.localName !== 'use') return null;
  const m = /^#(.+)$/.exec(hrefOf(el) || '');
  const s = m && document.getElementById(m[1]);
  return s?.localName === 'symbol' && defs.contains(s) ? s : null;
}
// Where an instance draws its symbol's content: its transform, then x / y.
const useM = (u) =>
  getM(u).translate(parseFloat(u.getAttribute('x')) || 0, parseFloat(u.getAttribute('y')) || 0);

// An instance's own fill (or stroke) only reaches the parts of its symbol
// that don't set one. When every shape in the symbol sets it (on itself or
// a group inside the symbol), the instance's can't show: this returns the
// first such shape, to read the colour from; null when some part takes the
// instance's.
function symbolOwnPaint(u, key) {
  const sym = symbolOf(u);
  if (!sym) return null;
  const shapes = [...sym.querySelectorAll(SHAPE_SEL)].filter((el) => el.localName !== 'tspan');
  if (!shapes.length) return null;
  const sets = (el) => {
    for (let n = el; n && n !== sym; n = n.parentNode) {
      const v = n.getAttribute(key) || n.style?.getPropertyValue(key);
      if (v && v !== 'inherit') return true;
    }
    return false;
  };
  return shapes.every(sets) ? shapes[0] : null;
}

// Every instance of sym: in the drawing and inside other symbols.
function allUses(sym) {
  const roots = [doc, iso?.back, ...symList().filter((s) => s !== iso?.sym)].filter(Boolean);
  return roots.flatMap((r) => [...r.querySelectorAll('use')]).filter((u) => symbolOf(u) === sym);
}

// Does symbol a draw symbol b (being it, or through instances inside it)?
function symUses(a, b, seen = new Set()) {
  if (a === b) return true;
  if (seen.has(a)) return false;
  seen.add(a);
  return [...a.querySelectorAll('use')].some((u) => {
    const s = symbolOf(u);
    return s && symUses(s, b, seen);
  });
}

// Defs that symbols (and, while editing one, the layers set aside) point
// at. The per-shape syncing only sees #sc-doc; these must survive it.
function keptIds() {
  const ids = new Set();
  const queue = symList().filter((s) => s !== iso?.sym);
  if (iso) queue.push(iso.back);
  while (queue.length) {
    const r = queue.shift();
    for (const el of [r, ...r.querySelectorAll('*')])
      for (const id of refsIn(el)) {
        if (ids.has(id)) continue;
        ids.add(id);
        const d = document.getElementById(id);
        if (d && defs.contains(d) && d.localName !== 'symbol') queue.push(d);
      }
  }
  return ids;
}

// The symbols none of the layers use (directly or through other symbols).
function unusedSymbols(layers) {
  const used = new Set();
  const queue = [...layers];
  while (queue.length) {
    const r = queue.shift();
    for (const u of [r, ...r.querySelectorAll('use')]) {
      const s = symbolOf(u);
      if (s && !used.has(s)) {
        used.add(s);
        queue.push(s);
      }
    }
  }
  return new Set(symList().filter((s) => !used.has(s)));
}

// Pasting copies of the drawing's own symbols reuses them instead of piling
// up duplicates: an incoming symbol with the same name and content (ids,
// which an import renames, aside) becomes the one already here.
const symKey = (s) =>
  `${s.getAttribute('data-name') || ''}|${s.innerHTML
    .replace(/\sid="[^"]*"/g, '')
    .replace(/sc-[a-z]+-\d+(?:-\d+)*/g, '#')}`;
function mergeSymbols(incoming, nodes) {
  const have = new Map(symList().map((s) => [symKey(s), s]));
  const map = new Map();
  const keep = [];
  for (const d of incoming) {
    const same = d.localName === 'symbol' && have.get(symKey(d));
    if (same) map.set(d.id, same.id);
    else keep.push(d);
  }
  renameRefs([...nodes, ...keep.filter((d) => d.nodeType === 1)], map);
  return keep;
}

// Give copied content ids of its own, and copies (under fresh ids) of the
// defs it points at — gradients, patterns, filters, clips — so editing the
// copy can't change the original. Symbols stay shared: an instance inside
// stays an instance.
function freshIds(nodes) {
  const map = new Map();
  const taken = new Set();
  const fresh = (id) => {
    const base = /^(sc-[a-z]+)-\d+(?:-\d+)*$/.exec(id)?.[1] || id;
    let n = base === id ? 2 : 1;
    while (document.getElementById(`${base}-${n}`) || taken.has(`${base}-${n}`)) n++;
    taken.add(`${base}-${n}`);
    return `${base}-${n}`;
  };
  for (const n of nodes)
    for (const el of [n, ...n.querySelectorAll('[id]')])
      if (el.id) {
        const nid = fresh(el.id);
        map.set(el.id, nid);
        el.id = nid;
      }
  const clones = [];
  const queue = [...nodes];
  while (queue.length) {
    const n = queue.shift();
    for (const el of [n, ...n.querySelectorAll('*')])
      for (const id of refsIn(el)) {
        if (map.has(id)) continue;
        const src = document.getElementById(id);
        if (!src || !defs.contains(src) || src.closest('symbol')) continue;
        const c = src.cloneNode(true);
        const nid = fresh(id);
        map.set(id, nid);
        c.id = nid;
        defs.append(c);
        clones.push(c);
        queue.push(c);
      }
  }
  renameRefs([...nodes, ...clones], map);
}

// The symbol the panel acts on: the one clicked there, else the selected
// instance's.
let symSel = null;
function panelSymbol() {
  return symById(symSel) || state.sel.map(symbolOf).find(Boolean) || null;
}

// Object → Make Symbol…
async function makeSymbol() {
  const els = normalizeSel(state.sel);
  if (!els.length) return warn('Select the artwork to turn into a symbol.');
  if (refuseLocked(els, 'edit')) return;
  const name = await ask('Make Symbol', {
    value: `Symbol ${symList().length + 1}`,
    text: 'The selection becomes a symbol (in Window → Libraries, Symbols), and an instance of it takes its place.',
    ok: 'Make',
  });
  if (!name || !els.every((el) => doc.contains(el))) return;
  const sym = mk(
    'symbol',
    { id: newDefId('sc-sym'), 'data-name': name.slice(0, 80), overflow: 'visible' },
    defs,
  );
  for (const el of els) {
    const c = el.cloneNode(true);
    setM(c, fullM(el));
    bakeInherited(el, c);
    sym.append(c);
  }
  const u = mk('use', { href: `#${sym.id}`, 'data-name': symName(sym) });
  els.at(-1).after(u);
  setM(u, parentM(u).inverse());
  for (const el of els) el.remove();
  symSel = sym.id;
  setSel([u]);
  commit();
  say(`Made the symbol “${symName(sym)}”. Place more from Window → Libraries, Symbols.`);
}

const viewCentre = () => {
  const r = stage.getBoundingClientRect();
  return toDoc({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
};

// A new instance, centred on `at` (the middle of the view by default);
// `attrs` go on the instance.
function placeSymbol(sym = panelSymbol(), at = viewCentre(), attrs = {}) {
  if (!sym) return warn('Click a symbol in the Symbols panel first.');
  if (iso && symUses(sym, iso.sym)) return warn('A symbol can’t hold an instance of itself.');
  const u = mk('use', { href: `#${sym.id}`, 'data-name': symName(sym), ...attrs }, doc);
  // Centred on what it paints, strokes included.
  const b = paintBox([u]) || bboxDoc(u);
  if (b) setM(u, new DOMMatrix().translate(at.x - (b.x + b.w / 2), at.y - (b.y + b.h / 2)));
  if (state.tool !== 'select') setTool('select');
  setSel([u]);
  commit();
  return u;
}

// Object → Break Link to Symbol: instances become ordinary groups.
function breakOne(u) {
  const sym = symbolOf(u);
  const g = mk('g');
  for (const a of [...u.attributes])
    if (
      !['href', 'x', 'y', 'width', 'height', 'id', 'transform', 'data-sc-iso'].includes(a.localName)
    )
      g.setAttributeNS(a.namespaceURI, a.name, a.value);
  if (!g.hasAttribute('data-name')) g.setAttribute('data-name', symName(sym));
  setM(g, useM(u));
  const kids = [...sym.children].map((c) => c.cloneNode(true));
  freshIds(kids);
  g.append(...kids);
  u.replaceWith(g);
  return g;
}
function breakSymbolLink() {
  const els = normalizeSel(state.sel).filter(symbolOf);
  if (!els.length) return warn('Select a symbol instance to break its link.');
  if (refuseLocked(els, 'edit')) return;
  const syms = new Set(els.map(symbolOf));
  const out = new Map(els.map((u) => [u, breakOne(u)]));
  // A symbol whose last instance that was goes too (Undo brings it back).
  const gone = [...syms].filter((s) => !allUses(s).some((u) => !s.contains(u)));
  for (const s of gone) {
    s.remove();
    if (symSel === s.id) symSel = null;
  }
  setSel(state.sel.map((el) => out.get(el) || el));
  commit();
  const n = gone.length;
  say(
    `Broke the link of ${els.length} instance${els.length === 1 ? '' : 's'}.` +
      (n
        ? n === 1
          ? ` “${symName(gone[0])}” had no other instances, so it’s gone from the drawing’s symbols.`
          : ` ${n} symbols had no other instances, so they’re gone from the drawing’s symbols.`
        : ''),
  );
}

async function renameSymbol(sym = panelSymbol()) {
  if (!sym) return warn('Click a symbol in the Symbols panel first, then rename it.');
  const old = symName(sym);
  const name = (await ask('Rename symbol', { value: old, ok: 'Rename' }))?.slice(0, 80);
  if (!name || name === old || !sym.isConnected) return;
  sym.setAttribute('data-name', name);
  // Instances still called after the symbol follow its new name.
  for (const u of allUses(sym))
    if (u.getAttribute('data-name') === old) u.setAttribute('data-name', name);
  if (iso?.sym === sym) $('#sc-iso-name').textContent = name;
  commit();
}

// Delete a symbol; its instances (if any) either become ordinary groups
// or go with it.
async function deleteSymbol(sym = panelSymbol()) {
  if (!sym) return warn('Click a symbol in the Symbols panel first, then delete it.');
  const uses = allUses(sym).filter((u) => !sym.contains(u));
  let how = 'delete';
  if (uses.length) {
    const n = uses.length;
    const r = await ask(`Delete “${symName(sym)}”?`, {
      text: `It has ${n} instance${n === 1 ? '' : 's'}. Break their links (they stay, as ordinary groups) or delete them too?`,
      ok: 'Break Links',
      alt: 'Delete Instances',
    });
    if (!r || !sym.isConnected) return;
    how = r === 'alt' ? 'delete' : 'break';
  }
  exitIso();
  const live = allUses(sym).filter((u) => !sym.contains(u));
  if (
    refuseLocked(
      live.filter((u) => doc.contains(u)),
      'edit',
    )
  )
    return;
  const out = new Map();
  for (const u of live)
    if (how === 'break') out.set(u, breakOne(u));
    else u.remove();
  const name = symName(sym);
  sym.remove();
  if (symSel === sym.id) symSel = null;
  state.sel = state.sel.map((el) => out.get(el) || el).filter((el) => doc.contains(el));
  commit();
  say(
    !live.length
      ? `Deleted the symbol “${name}”.`
      : how === 'break'
        ? `Deleted “${name}”; its instances are groups now.`
        : `Deleted “${name}” and its instances.`,
  );
}

// Object → Edit Symbol (or the panel's button): the selected instance, else
// the panel's symbol at its first instance (placing one if there's none).
function editSymbol() {
  const inst = state.sel.find(symbolOf);
  if (inst) return enterIso(inst);
  const sym = panelSymbol();
  if (!sym) return warn('Select an instance, or click a symbol in the Symbols panel, to edit it.');
  if (iso) return warn('Finish editing this symbol first: Done, or Esc.');
  enterIso([...doc.querySelectorAll('use')].find((u) => symbolOf(u) === sym) || placeSymbol(sym));
}

function enterIso(inst, quiet = false) {
  const sym = symbolOf(inst);
  if (!sym || !doc.contains(inst)) return;
  if (iso) return warn('Finish editing this symbol first: Done, or Esc.');
  if (!quiet) {
    if (refuseLocked([inst], 'edit')) return;
    tools[state.tool].leave?.();
    if (state.tf) endTransform(true);
  }
  const M = parentM(inst).multiply(useM(inst));
  const path = treePath(inst);
  const back = mk('g', { id: 'sc-iso-back', 'aria-hidden': 'true' });
  doc.before(back);
  inst.setAttribute('data-sc-iso', '');
  back.append(...doc.childNodes);
  for (const c of sym.children) {
    const k = c.cloneNode(true);
    if (k instanceof SVGGraphicsElement) setM(k, M.multiply(getM(c)));
    doc.append(k);
  }
  iso = { sym, M, back, inst, path };
  state.sel = [];
  $('#sc-iso-name').textContent = symName(sym);
  $('#sc-iso').hidden = false;
  drawSelection();
  renderLayers();
  if (!quiet) say(`Editing “${symName(sym)}”: every instance follows. Done or Esc finishes.`);
}

// Write what's being edited back into the symbol (in its own coordinates).
function isoWrite() {
  if (!iso) return;
  const inv = iso.M.inverse();
  const kids = [...doc.children].map((c) => {
    const k = c.cloneNode(true);
    if (c instanceof SVGGraphicsElement) setM(k, inv.multiply(getM(c)));
    return k;
  });
  if (iso.sym.innerHTML !== kids.map((k) => k.outerHTML).join('')) iso.sym.replaceChildren(...kids);
}
let isoQueued = false;
new MutationObserver(() => {
  if (!iso || isoQueued) return;
  isoQueued = true;
  queueMicrotask(() => {
    isoQueued = false;
    isoWrite();
  });
}).observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });

// The drawing's markup, as it is with the symbol editing put away.
function docHtml() {
  if (!iso) return doc.innerHTML;
  iso.inst.removeAttribute('data-sc-iso');
  const html = iso.back.innerHTML;
  iso.inst.setAttribute('data-sc-iso', '');
  return html;
}

// Leave symbol editing, keeping the edits.
function exitIso() {
  if (!iso) return;
  tools[state.tool].leave?.();
  if (state.tf) endTransform(true);
  if (!iso) return;
  isoWrite();
  const { back, inst } = iso;
  doc.replaceChildren(...back.childNodes);
  back.remove();
  inst.removeAttribute('data-sc-iso');
  iso = null;
  $('#sc-iso').hidden = true;
  state.sel = [inst];
  const s = snapshot();
  const h = hist[hIdx];
  if (!h || h.d !== s.d || h.f !== s.f) commit();
  else afterChange();
  setSel([inst]);
}
// Drop the editing without writing anything (the drawing is being replaced).
function dropIso() {
  if (!iso) return;
  iso.back.remove();
  iso = null;
  $('#sc-iso').hidden = true;
}

// ---- the Symbols panel ----
let symPanelKey = null;
function symBox(sym) {
  const u = mk('use', { href: `#${sym.id}`, visibility: 'hidden' }, view);
  const b = bboxDoc(u, new DOMMatrix());
  u.remove();
  return b;
}
function symTile(sym) {
  const b = document.createElement('button');
  b.className = 'sc-sym-tile' + (symSel === sym.id ? ' sel' : '');
  b.dataset.id = sym.id;
  b.draggable = true;
  b.setAttribute('aria-label', symName(sym));
  b.dataset.tip = `${symName(sym)} · double-click to place, or drag onto the canvas`;
  const t = mk('svg', { class: 'sc-sym-thumb', 'aria-hidden': 'true' });
  mk('use', { href: `#${sym.id}` }, t);
  const name = document.createElement('span');
  name.className = 'sc-sym-name';
  name.textContent = symName(sym);
  b.append(t, name);
  b.addEventListener('click', () => {
    symSel = sym.id;
    for (const x of b.parentNode.children) x.classList.toggle('sel', x === b);
  });
  b.addEventListener('dblclick', (e) => {
    if (e.target.closest('.sc-sym-name')) renameSymbol(sym);
    else placeSymbol(sym);
  });
  b.addEventListener('dragstart', (e) => {
    symSel = sym.id;
    e.dataTransfer.setData(SYM_DRAG, sym.id);
    e.dataTransfer.effectAllowed = 'copy';
  });
  return b;
}
function renderSymbols() {
  const grid = $('#sc-symlib');
  const list = symList();
  if (symSel && !symById(symSel)) symSel = null;
  const key = list.map((s) => `${s.id}\u0001${symName(s)}`).join('\u0002');
  if (key !== symPanelKey) {
    symPanelKey = key;
    if (list.length) grid.replaceChildren(...list.map(symTile));
    else {
      const p = document.createElement('p');
      p.className = 'sc-sym-empty';
      p.textContent = 'No symbols yet. Select some artwork and choose Object → Make Symbol.';
      grid.replaceChildren(p);
    }
  }
  for (const tile of grid.querySelectorAll('.sc-sym-tile')) {
    tile.classList.toggle('sel', tile.dataset.id === symSel);
    const box = symBox(symById(tile.dataset.id));
    const t = tile.querySelector('svg');
    if (!box) t.removeAttribute('viewBox');
    else {
      const pad = Math.max(box.w, box.h) * 0.08 + 1;
      t.setAttribute(
        'viewBox',
        [box.x - pad, box.y - pad, box.w + 2 * pad, box.h + 2 * pad].map(f).join(' '),
      );
    }
  }
}
function wireSymbols() {
  for (const b of document.querySelectorAll('[data-sym-act]'))
    b.addEventListener('click', () =>
      ({
        make: makeSymbol,
        place: () => placeSymbol(),
        edit: editSymbol,
        break: breakSymbolLink,
        rename: () => renameSymbol(),
        delete: () => deleteSymbol(),
        save: () => saveSymbolToLib(),
      })[b.dataset.symAct](),
    );
  stage.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types || [];
    if (!types.includes(SYM_DRAG) && !types.includes(LIBSYM_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  stage.addEventListener('drop', (e) => {
    const item = e.dataTransfer?.types.includes(LIBSYM_DRAG)
      ? libItem('symbols', e.dataTransfer.getData(LIBSYM_DRAG))
      : null;
    const sym = !item && symById(e.dataTransfer?.getData(SYM_DRAG));
    if (!item && !sym) return;
    e.preventDefault();
    e.stopPropagation();
    if (item) placeLibSymbol(item, toDoc(e));
    else placeSymbol(sym, toDoc(e));
  });
  // This drawing / Library.
  for (const b of document.querySelectorAll('[data-symview]'))
    b.addEventListener('click', () => setSymView(b.dataset.symview));
  $('#sc-libsym-cat').addEventListener('change', (e) => {
    symFilter.cat = e.target.value;
    renderSymLib();
  });
  $('#sc-libsym-q').addEventListener('input', (e) => {
    symFilter.q = e.target.value;
    renderSymLib();
  });
  renderSymbols();
}

// ---- the Symbols library ----
// Symbols kept across drawings, in the library store with the swatches,
// gradients and patterns. Placing one adds it to the drawing as an ordinary
// symbol (or reuses the identical one already there) and places an
// instance. The built-in icons set no colour of their own, so they draw in
// the instance's fill; their credit rides along on the <symbol> as
// data-credit.
const LIBSYM_DRAG = 'application/x-svgcraft-library-symbol';
const symFilter = { cat: '', q: '' };
let symView = 'doc';

// A short, stable fingerprint (FNV-1a), for ids that come out the same
// every time the same library symbol is placed.
function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

// The drawing's symbol for a library entry: the one already there with the
// same content, else a new one in defs (with any defs the entry carries).
function libSymbolFor(item) {
  const d = new DOMParser().parseFromString(
    `<svg xmlns="${NS}" xmlns:xlink="${XLINK}">${item.svg}</svg>`,
    'image/svg+xml',
  );
  if (d.querySelector('parsererror')) return null;
  sanitize(d.documentElement);
  const sym = mk('symbol');
  const carried = [];
  for (const n of d.documentElement.children) {
    const el = document.importNode(n, true);
    if (el.localName === 'defs') carried.push(...el.children);
    else sym.append(el);
  }
  // Ids get a prefix of the entry's own, so they can't clash with the
  // drawing's and the same entry always makes the same markup.
  const pre = `sl${hashStr(`${f(item.w)}x${f(item.h)}:${item.svg}`)}-`;
  const map = new Map();
  for (const r of [...carried, sym])
    for (const el of [r, ...r.querySelectorAll('[id]')])
      if (el.id && el !== sym) {
        map.set(el.id, pre + el.id);
        el.id = pre + el.id;
      }
  renameRefs([...carried, sym], map);
  const s = (item.size || 64) / item.h;
  for (const c of sym.children)
    if (c instanceof SVGGraphicsElement) setM(c, new DOMMatrix().scale(s).multiply(getM(c)));
  const same = symList().find((x) => x.innerHTML === sym.innerHTML);
  if (same) return same;
  // A changed copy of an earlier placement: its own ids for its content.
  for (const el of sym.querySelectorAll('[id]'))
    if (document.getElementById(el.id)) {
      let n = 2;
      while (document.getElementById(`${el.id}-${n}`)) n++;
      el.id = `${el.id}-${n}`;
    }
  for (const c of carried) if (!c.id || !document.getElementById(c.id)) defs.append(c);
  sym.id = newDefId('sc-sym');
  sym.setAttribute('data-name', item.name);
  sym.setAttribute('overflow', 'visible');
  if (item.credit) sym.setAttribute('data-credit', item.credit);
  defs.append(sym);
  return sym;
}

// Place a library symbol: an instance centred on `at`, in the fill colour.
function placeLibSymbol(item = libItem('symbols', libSel.symbols), at = viewCentre()) {
  if (!item) return warn('Click a symbol in the library first.');
  const sym = libSymbolFor(item);
  if (!sym) return warn(`Couldn’t read the library symbol “${item.name}”.`);
  const paint =
    state.fillOn && !state.fillGrad && !state.fillPat
      ? { fill: state.fill, 'fill-opacity': state.fillA < 1 ? f(state.fillA) : null }
      : {};
  symSel = sym.id;
  return placeSymbol(sym, at, paint);
}

// Save to Library: the panel's symbol (or the selected instance's), as it
// looks, in a box the size of what it paints.
async function saveSymbolToLib(sym = panelSymbol()) {
  if (!sym) return warn('Click a symbol in This drawing (or select an instance) to save it.');
  const probe = mk('use', { href: `#${sym.id}` }, doc);
  const box = paintBox([probe]);
  probe.remove();
  if (!box || box.w < 0.5 || box.h < 0.5) return warn('That symbol has nothing visible to save.');
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  const w = Math.ceil(box.x + box.w) - x;
  const h = Math.ceil(box.y + box.h) - y;
  if (w > 4096 || h > 4096)
    return warn('That symbol is too big for the library (4096 px at most).');
  const T = new DOMMatrix().translate(-x, -y);
  const parts = [...sym.children].map((c) => {
    const k = c.cloneNode(true);
    if (c instanceof SVGGraphicsElement) setM(k, T.multiply(getM(c)));
    return k;
  });
  const carried = carryDefs(parts, `s${uid()}-`);
  const name = await ask('Save to Library', {
    value: symName(sym),
    text: 'The symbol joins your Symbols library, ready to place in any drawing.',
    ok: 'Save',
  });
  if (!name) return;
  const ser = (n) => new XMLSerializer().serializeToString(n).replaceAll(` xmlns="${NS}"`, '');
  const item = {
    id: uid(),
    name: name.slice(0, 80),
    category: 'Saved',
    w,
    h,
    svg: (carried.childNodes.length ? ser(carried) : '') + parts.map(ser).join(''),
    size: h,
  };
  const credit = sym.getAttribute('data-credit');
  if (credit) item.credit = credit.slice(0, 200);
  lib.symbols.push(item);
  libSel.symbols = item.id;
  symFilter.cat = '';
  symFilter.q = '';
  $('#sc-libsym-q').value = '';
  saveLibrary();
  setSymView('lib');
  say(`Saved “${item.name}” to the library.`);
}

function setSymView(v) {
  symView = v === 'lib' ? 'lib' : 'doc';
  for (const b of document.querySelectorAll('[data-symview]'))
    b.setAttribute('aria-checked', b.dataset.symview === symView);
  for (const p of document.querySelectorAll('[data-symview-pane]'))
    p.hidden = p.dataset.symviewPane !== symView;
}

// A library tile's picture: the content on white, uncoloured parts in ink.
function libSymCss(item) {
  const svg =
    `<svg xmlns="${NS}" xmlns:xlink="${XLINK}" viewBox="0 0 ${f(item.w)} ${f(item.h)}" ` +
    `fill="#1f2328" color="#1f2328">${item.svg}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
const libSymCssCache = new Map();
function libSymTile(item) {
  const b = document.createElement('button');
  b.className = 'sc-sym-tile' + (libSel.symbols === item.id ? ' sel' : '');
  b.dataset.id = item.id;
  b.draggable = true;
  b.setAttribute('aria-label', item.name);
  b.dataset.tip = `${item.name} · ${item.category} · double-click to place, or drag onto the canvas`;
  const t = document.createElement('span');
  t.className = 'sc-sym-thumb sc-libsym-thumb';
  const key = `${f(item.w)}x${f(item.h)}:${item.svg}`;
  if (!libSymCssCache.has(key)) libSymCssCache.set(key, libSymCss(item));
  t.style.setProperty('--tile', libSymCssCache.get(key));
  const name = document.createElement('span');
  name.className = 'sc-sym-name';
  name.textContent = item.name;
  b.append(t, name);
  b.addEventListener('click', (e) => {
    if (e.altKey) return removeLibItem('symbols', item.id);
    pickLibSymbol(item.id);
  });
  b.addEventListener('dblclick', (e) => {
    if (e.target.closest('.sc-sym-name')) renameLibItem('symbols', item.id);
    else placeLibSymbol(item);
  });
  b.addEventListener('dragstart', (e) => {
    libSel.symbols = item.id;
    e.dataTransfer.setData(LIBSYM_DRAG, item.id);
    e.dataTransfer.effectAllowed = 'copy';
  });
  return b;
}
// The library's current symbol (the one Custom Shape draws): marked in the
// panel and shown on the tool's picker.
function pickLibSymbol(id) {
  libSel.symbols = id;
  for (const x of document.querySelectorAll('#sc-libsyms .sc-sym-tile'))
    x.classList.toggle('sel', x.dataset.id === id);
  libPickers.symbols?.sync();
}
function renderSymLib() {
  const cats = [...new Set(lib.symbols.map((x) => x.category))];
  if (symFilter.cat && !cats.includes(symFilter.cat)) symFilter.cat = '';
  const pick = $('#sc-libsym-cat');
  pick.replaceChildren(
    Object.assign(document.createElement('option'), { value: '', textContent: 'All' }),
    ...cats.map((c) =>
      Object.assign(document.createElement('option'), { value: c, textContent: c }),
    ),
  );
  pick.value = symFilter.cat;
  if (libSel.symbols && !libItem('symbols', libSel.symbols)) libSel.symbols = null;
  const q = symFilter.q.trim().toLowerCase();
  const shown = lib.symbols.filter(
    (x) =>
      (!symFilter.cat || x.category === symFilter.cat) &&
      (!q || `${x.name} ${x.category}`.toLowerCase().includes(q)),
  );
  const grid = $('#sc-libsyms');
  if (shown.length) grid.replaceChildren(...shown.map(libSymTile));
  else {
    const p = document.createElement('p');
    p.className = 'sc-sym-empty';
    p.textContent = lib.symbols.length
      ? 'No library symbols match.'
      : 'The library is empty. Save a symbol to it, or Reset for the built-in icons.';
    grid.replaceChildren(p);
  }
  libPickers.symbols?.sync();
}

function swapPaint() {
  [state.fill, state.stroke] = [state.stroke, state.fill];
  [state.fillOn, state.strokeOn] = [state.strokeOn, state.fillOn];
  [state.fillA, state.strokeA] = [state.strokeA, state.fillA];
  [state.fillGrad, state.strokeGrad] = [state.strokeGrad, state.fillGrad];
  [state.fillPat, state.strokePat] = [state.strokePat, state.fillPat];
  syncStyleUI();
  if (state.sel.length) {
    for (const el of state.sel) {
      applyStyle(el, 'fill');
      applyStyle(el, 'stroke');
    }
    commit();
  }
}

// D: Photoshop's default colours, a black fill and a white stroke (on the
// selection too, as X swaps them there).
function defaultPaint() {
  Object.assign(state, {
    fill: '#000000',
    stroke: '#ffffff',
    fillA: 1,
    strokeA: 1,
    fillGrad: null,
    strokeGrad: null,
    fillPat: null,
    strokePat: null,
  });
  syncStyleUI();
  if (state.sel.length) {
    for (const el of state.sel) {
      applyStyle(el, 'fill');
      applyStyle(el, 'stroke');
    }
    commit();
  }
}

// A tool-option number field (smoothing, eraser size, font size).
function bindNumber(id, key) {
  const el = $(id);
  const read = () => {
    const v = parseFloat(el.value);
    if (!isFinite(v)) return;
    state[key] = clamp(v, +el.min, +el.max);
    tools[state.tool].redraw?.();
  };
  el.addEventListener('input', read);
  el.addEventListener('change', () => (el.value = state[key]));
  read();
}

// Scrubby labels: drag a field's label sideways to change its value
// (Shift = 10× faster), as in Photoshop's options bar.
function wireScrubbers() {
  for (const lab of document.querySelectorAll('.sc-scrub')) {
    const input = lab.parentElement.querySelector('input');
    lab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lab.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const v0 = parseFloat(input.value) || 0;
      const step = parseFloat(input.step) || 1;
      const move = (ev) => {
        const d = Math.round((ev.clientX - x0) / 3) * step * (ev.shiftKey ? 10 : 1);
        const v = clamp(+(v0 + d).toFixed(3), +input.min, +input.max);
        if (String(v) === input.value) return;
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const up = () => {
        lab.removeEventListener('pointermove', move);
        lab.removeEventListener('pointerup', up);
        lab.removeEventListener('pointercancel', up);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      lab.addEventListener('pointermove', move);
      lab.addEventListener('pointerup', up);
      lab.addEventListener('pointercancel', up);
    });
  }
}
