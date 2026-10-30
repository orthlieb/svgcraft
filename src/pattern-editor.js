// SVGCraft — The pattern editor in the Color panel.
'use strict';

// ---- pattern editor (Color panel) -----------------------------------------------
const activePat = () => (state[state.active + 'On'] ? state[state.active + 'Pat'] : null);
function renderPatEditor() {
  renderPatTiles();
  const p = activePat();
  const box = $('#sc-pat');
  box.hidden = !p;
  if (!p) return;
  $('#sc-pat-title').textContent = `${state.active === 'fill' ? 'Fill' : 'Stroke'} pattern`;
  $('#sc-pat-preview').style.setProperty('--tile', patCss(p, state[state.active], 1));
  // The panel marks the same pattern the picker shows.
  if (lib.patterns.some((x) => x.id === p.id)) libSel.patterns = p.id;
  for (const t of document.querySelectorAll('#sc-patlib .sc-tile'))
    t.classList.toggle('sel', t.dataset.id === libSel.patterns);
  libPickers.patterns?.sync();
  const set = (sel, v) => {
    const el = $(sel);
    if (document.activeElement !== el) el.value = v;
  };
  set('#sc-pat-scale', Math.round((p.scale || 1) * 100));
  set('#sc-pat-angle', Math.round(p.angle || 0));
  $('#sc-pat-with').checked = !!p.withShape;
}
function editPat(fn, final = true) {
  const p = activePat();
  if (!p) return;
  fn(p);
  styleChanged(state.active, final);
}
function wirePatEditor() {
  libPickers.patterns = libPicker($('#sc-pat-pick'), {
    label: 'Pattern',
    items: () => lib.patterns,
    current: activePat,
    thumb: libPatThumb,
    pick: (x, e) => applyLibPat(x, e),
    manage: () => showTab('patterns'),
    manageLabel: 'Manage in the Patterns panel',
  });
  $('#sc-pat-with').addEventListener('change', (e) =>
    editPat((p) => (p.withShape = e.target.checked)),
  );
  for (const [sel, set] of [
    ['#sc-pat-scale', (p, v) => (p.scale = clamp(v, 5, 5000) / 100)],
    ['#sc-pat-angle', (p, v) => (p.angle = ((((v + 180) % 360) + 360) % 360) - 180)],
  ]) {
    const inp = $(sel);
    const go = (final) => {
      const v = parseFloat(inp.value);
      if (isFinite(v)) editPat((p) => set(p, v), final);
    };
    inp.addEventListener('input', () => go(false));
    inp.addEventListener('change', () => go(true));
  }
}

// Edit → Define Pattern…: the selection (as it looks, transforms and all)
// becomes a tile the size of its painted box. Gradients, patterns and clips
// it uses travel inside the tile under ids of their own.
async function definePattern() {
  const els = normalizeSel(state.sel).filter(isShown);
  if (!els.length) return warn('Select the artwork to turn into a pattern.');
  const box = paintBox(els);
  if (!box || box.w < 0.5 || box.h < 0.5)
    return warn('There’s nothing visible to make a pattern from.');
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  const w = Math.ceil(box.x + box.w) - x;
  const h = Math.ceil(box.y + box.h) - y;
  if (w > 4096 || h > 4096) return warn('That’s too big for a pattern tile (4096 px at most).');
  const T = new DOMMatrix().translate(-x, -y);
  const parts = els.map((el) => {
    const c = el.cloneNode(true);
    setM(c, T.multiply(fullM(el)));
    bakeInherited(el, c);
    return c;
  });
  const tileDefs = carryDefs(parts, `p${uid()}-`);
  const name = await ask('Define Pattern', {
    value: `Pattern ${lib.patterns.length + 1}`,
    text: `${w} × ${h} px tile from the selection.`,
  });
  if (!name) return;
  const ser = (n) => new XMLSerializer().serializeToString(n).replaceAll(` xmlns="${NS}"`, '');
  const svg = (tileDefs.childNodes.length ? ser(tileDefs) : '') + parts.map(ser).join('');
  const item = { id: uid(), name: name.slice(0, 80), w, h, svg };
  lib.patterns.push(item);
  libSel.patterns = item.id;
  saveLibrary();
  showTab('patterns');
  say(`Defined “${item.name}”. Click it in the Patterns panel to fill with it.`);
}

// Copy every defs entry the nodes point at (url(#…) or href="#…"), and what
// those point at in turn, under prefixed ids; then repoint the references.
function carryDefs(nodes, prefix) {
  const out = mk('defs');
  const map = new Map();
  const queue = [...nodes];
  while (queue.length) {
    const n = queue.shift();
    for (const el of [n, ...n.querySelectorAll('*')])
      for (const id of refsIn(el)) {
        if (map.has(id)) continue;
        const src = document.getElementById(id);
        if (!src || !defs.contains(src)) continue;
        map.set(id, prefix + id);
        const c = src.cloneNode(true);
        c.id = prefix + id;
        out.append(c);
        queue.push(c);
      }
  }
  for (const n of [...nodes, out])
    for (const el of [n, ...n.querySelectorAll('*')]) {
      // Copies aren't SVGCraft's per-shape paints any more: keep them out of
      // the pruning and syncing that would otherwise remove them.
      for (const k of [
        'data-sc-grad',
        'data-sc-pat',
        'data-sc-sa',
        'data-sc-clip',
        'data-sc-clipper',
      ])
        el.removeAttribute(k);
      for (const a of [...el.attributes]) {
        let v = a.value;
        for (const [from, to] of map) {
          const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          v = v.replace(new RegExp(`url\\(\\s*["']?#${esc}["']?\\s*\\)`, 'g'), `url(#${to})`);
          if (a.localName === 'href' && v === `#${from}`) v = `#${to}`;
        }
        if (v !== a.value) el.setAttributeNS(a.namespaceURI, a.name, v);
      }
    }
  return out;
}

// Ids an element points at: url(#…) in any attribute, and href="#…".
function refsIn(el) {
  const ids = [];
  for (const a of el.attributes) {
    for (const m of a.value.matchAll(/url\(\s*["']?#([^"')]+)["']?\s*\)/g)) ids.push(m[1]);
    if (a.localName === 'href' && a.value.startsWith('#')) ids.push(a.value.slice(1));
  }
  return ids;
}
