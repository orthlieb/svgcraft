// SVGCraft — Selection and its on-canvas overlay.
'use strict';

// ---------------------------------------------------------------------
// Selection + overlay
// ---------------------------------------------------------------------
function setSel(els) {
  state.sel = normalizeSel(els);
  els = state.sel;
  if (els.length) readStyle(els[0]);
  if (els.length && readTypeFromSelection() && els.every((el) => el.localName === 'text'))
    $('[data-tab="character"]').click();
  drawSelection();
  markLayers();
}

// Re-highlight the selected rows without rebuilding the list (a rebuild
// between the two clicks of a double-click would swallow the rename).
function markLayers() {
  for (const li of $('#sc-layers').children)
    if (li.layerEl) li.classList.toggle('sel', state.sel.includes(li.layerEl));
}

// The Layers panel's blend mode and lock buttons follow the selection.
function syncLayerHead() {
  const el = state.sel[0];
  const blend = $('#sc-blend');
  showPassThrough(blend, el);
  blend.value = el ? blendOf(el) : 'normal';
  const lock = el?.getAttribute('data-sc-lock') || null;
  for (const b of document.querySelectorAll('[data-lock]'))
    b.setAttribute('aria-pressed', lock === b.dataset.lock);
}

function toggleSel(el) {
  setSel(state.sel.includes(el) ? state.sel.filter((x) => x !== el) : [...state.sel, el]);
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function handlePos(box, k) {
  const x = k.includes('w') ? box.x : k.includes('e') ? box.x + box.w : box.x + box.w / 2;
  const y = k.includes('n') ? box.y : k.includes('s') ? box.y + box.h : box.y + box.h / 2;
  return { x, y };
}

function drawSelection() {
  srcSyncSel();
  selLayer.replaceChildren();
  syncCornerUI();
  syncFillRuleUI();
  syncShapeUI();
  syncAnimUI();
  syncTextPathUI();
  syncLayerHead();
  $('#sc-pos').dataset.sel = '';
  if (!state.sel.length || state.tool === 'node') return;
  const z = state.zoom;
  if (state.sel.length > 1) {
    for (const el of state.sel) {
      const b = bboxDoc(el);
      if (b) mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'sc-ov' }, selLayer);
    }
  }
  const box = selBox();
  if (!box) return;
  mk(
    'rect',
    { x: box.x, y: box.y, width: box.w, height: box.h, class: 'sc-ov sc-ov-dash' },
    selLayer,
  );
  const n = state.sel.length;
  $('#sc-pos').dataset.sel = `${n} selected · ${inUnits(box.w)}×${inUnits(box.h)}`;
  syncTransformFields(box);
  if (state.tool === 'gradient') drawGradAnnotator(z);
  if (state.tool !== 'select') return;
  const mode = state.tf?.mode;
  const ce = !state.tf && cornerTarget();
  if (ce) {
    // Round handles sitting inside each corner, at least 12px in.
    const g = rectGeom(ce);
    const r = getRadii(ce);
    const M = fullM(ce);
    const s = Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) || 1;
    const inset = (k) => Math.min(Math.max(r[k], 12 / (z * s)), Math.min(g.w, g.h) / 2);
    const at = {
      tl: (d) => [g.x + d, g.y + d],
      tr: (d) => [g.x + g.w - d, g.y + d],
      br: (d) => [g.x + g.w - d, g.y + g.h - d],
      bl: (d) => [g.x + d, g.y + g.h - d],
    };
    for (const k of CORNERS) {
      const q = new DOMPoint(...at[k](inset(k))).matrixTransform(M);
      mk(
        'circle',
        { cx: q.x, cy: q.y, r: 4 / z, class: 'sc-corner', 'data-corner-h': k },
        selLayer,
      );
    }
  }
  const top = { x: box.x + box.w / 2, y: box.y };
  if (mode !== 'scale')
    mk('line', { x1: top.x, y1: top.y, x2: top.x, y2: top.y - 22 / z, class: 'sc-ov' }, selLayer);
  if (mode !== 'scale')
    mk(
      'circle',
      {
        cx: top.x,
        cy: top.y - 22 / z,
        r: 5 / z,
        class: 'sc-handle',
        'data-handle': 'rot',
        style: 'cursor:grab',
      },
      selLayer,
    );
  const hs = 8 / z;
  for (const k of HANDLES) {
    const p = handlePos(box, k);
    const cursor =
      mode === 'rotate'
        ? 'grab'
        : mode === 'skew' && k.length === 1
          ? { n: 'ew', s: 'ew', e: 'ns', w: 'ns' }[k] + '-resize'
          : {
              n: 'ns',
              s: 'ns',
              e: 'ew',
              w: 'ew',
              nw: 'nwse',
              se: 'nwse',
              ne: 'nesw',
              sw: 'nesw',
            }[k] + '-resize';
    mk(
      'rect',
      {
        x: p.x - hs / 2,
        y: p.y - hs / 2,
        width: hs,
        height: hs,
        class: 'sc-handle',
        'data-handle': k,
        style: `cursor:${cursor}`,
      },
      selLayer,
    );
  }
}

const INKSCAPE = 'http://www.inkscape.org/namespaces/inkscape';

// A layer's own name: data-name (what Illustrator exports) or Inkscape's label.
function customName(el) {
  return el.getAttribute('data-name') || el.getAttributeNS(INKSCAPE, 'label') || '';
}

function layerName(el) {
  const own = customName(el);
  if (own) return own;
  const tag = el.localName;
  const id = el.id ? ` #${el.id}` : '';
  if (tag === 'text') return `“${rawText(el).replace(/\s+/g, ' ').trim().slice(0, 28)}”`;
  if (tag === 'g') return `group (${el.children.length})${id}`;
  const sym = symbolOf(el);
  if (sym) return symName(sym);
  if (tag === 'path') return `path${id}`;
  return tag + id;
}

// A small live preview of one layer, framed on its own bounding box.
function layerThumb(el) {
  const t = mk('svg', { class: 'sc-thumb', 'aria-hidden': 'true' });
  const b = bboxDoc(el, getM(el));
  if (!b) return t;
  const pad = Math.max(b.w, b.h) * 0.08 + 1;
  t.setAttribute('viewBox', [b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad].map(f).join(' '));
  const c = el.cloneNode(true);
  bakeInherited(el, c);
  c.removeAttribute('display');
  // A clipping shape is hidden on the canvas, but its row shows it.
  if (el.hasAttribute('data-sc-clipper')) c.removeAttribute('visibility');
  for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id');
  t.append(c);
  return t;
}

// Groups the user folded in the Layers panel, keyed by tree path.
const folded = new Set();
let rangeAnchor = null;

function renderLayers() {
  const ol = $('#sc-layers');
  ol.replaceChildren();
  if (!items().length) {
    const li = document.createElement('li');
    li.className = 'sc-empty';
    li.textContent = 'No layers yet. Draw something, or drop an SVG onto the canvas.';
    ol.append(li);
    return;
  }
  let rows = 0;
  const walk = (parent, depth) => {
    for (const el of [...parent.children].filter(selectable).reverse()) {
      if (rows++ >= 500) return;
      const open = el.localName === 'g' && !folded.has(treePath(el).join('/'));
      ol.append(layerRow(el, depth, open, rows));
      if (open) walk(el, depth + 1);
    }
  };
  walk(doc, 0);
  syncLayerHead();
}

function layerRow(el, depth, open, n) {
  const li = document.createElement('li');
  const hidden = el.getAttribute('display') === 'none';
  const isGroup = el.localName === 'g';
  li.className = (state.sel.includes(el) ? 'sel ' : '') + (hidden ? 'hidden' : '');
  li.style.paddingLeft = `${4 + depth * 16}px`;
  li.layerEl = el;
  li.draggable = true;

  const twisty = document.createElement('button');
  twisty.className = 'sc-twisty';
  if (isGroup) {
    twisty.innerHTML = `<i data-icon="chevron-right" class="${open ? 'open' : ''}">${icon('chevron-right')}</i>`;
    twisty.setAttribute('aria-label', open ? 'Collapse group' : 'Expand group');
    twisty.setAttribute('aria-expanded', open);
    twisty.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = treePath(el).join('/');
      if (open) folded.add(key);
      else folded.delete(key);
      renderLayers();
    });
  } else twisty.tabIndex = -1;

  const eye = document.createElement('button');
  eye.className = 'sc-eye';
  eye.innerHTML = `<i data-icon="${hidden ? 'eye-slash' : 'eye'}">${icon(hidden ? 'eye-slash' : 'eye')}</i>`;
  eye.setAttribute('aria-label', hidden ? 'Show layer' : 'Hide layer');
  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    if (hidden) el.removeAttribute('display');
    else el.setAttribute('display', 'none');
    commit();
  });

  let thumb;
  if (isGroup) {
    thumb = document.createElement('span');
    thumb.className = 'sc-thumb sc-folder';
    thumb.innerHTML = `<i data-icon="${open ? 'folder-open' : 'folder'}">${icon(open ? 'folder-open' : 'folder')}</i>`;
  } else thumb = n <= 150 ? layerThumb(el) : mk('svg', { class: 'sc-thumb' });

  const name = document.createElement('span');
  name.className = 'sc-layer-name';
  name.textContent = layerName(el);
  name.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    renameLayer(el, name);
  });
  li.append(eye, twisty, thumb, name);
  // Clipping: the group row says it clips, the clipping shape's row says
  // it's the window (and is underlined, as in Illustrator).
  const clipper = clipperOf(el.parentNode) === el;
  if (clipper || clipperOf(el)) {
    if (clipper) li.classList.add('sc-clipper');
    const b = document.createElement('span');
    b.className = 'sc-clip-badge';
    b.innerHTML = icon('scissors');
    b.dataset.tip = clipper ? 'Clipping path' : 'Clipping group';
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', b.dataset.tip);
    li.append(b);
  }
  if (symbolOf(el)) {
    const s = document.createElement('i');
    s.className = 'sc-sym-badge';
    s.innerHTML = icon('clover');
    s.dataset.tip = `Instance of the symbol “${symName(symbolOf(el))}”`;
    name.before(s);
    li.classList.add('sc-instance');
  }
  if (fxOn(readFx(el))) {
    const fx = document.createElement('button');
    fx.className = 'sc-fx-badge';
    fx.innerHTML = icon('sc-fx');
    fx.setAttribute('aria-label', 'Layer style');
    fx.dataset.tip = 'Layer style · double-click to edit';
    fx.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      setSel([el]);
      openLayerStyle();
    });
    li.append(fx);
  }
  if (el.hasAttribute('data-sc-anim') && animated(el)) {
    const b = document.createElement('i');
    b.className = 'sc-anim-badge';
    b.innerHTML = icon('play');
    b.dataset.tip = 'Animated: see Properties → Animate';
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', 'Animated');
    li.append(b);
  }
  const lock = el.getAttribute('data-sc-lock');
  if (lock) {
    const b = document.createElement('button');
    b.className = 'sc-row-lock';
    b.innerHTML = icon(lock === 'all' ? 'lock' : 'up-down-left-right');
    b.setAttribute('aria-label', 'Unlock layer');
    b.dataset.tip = `${lock === 'all' ? 'Locked' : 'Position locked'} · click to unlock`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setLock([el], null);
    });
    li.append(b);
  }

  // Photoshop's rules: click selects, Ctrl/⌘-click toggles, Shift-click
  // selects the run of rows from the last plain click.
  li.addEventListener('click', (e) => {
    if (e.target.closest('input')) return;
    if (e.ctrlKey || e.metaKey) toggleSel(el);
    else if (e.shiftKey && rangeAnchor && rangeAnchor.isConnected) {
      const rows = [...$('#sc-layers').children].map((r) => r.layerEl).filter(Boolean);
      const [a, b] = [rows.indexOf(rangeAnchor), rows.indexOf(el)].sort((x, y) => x - y);
      setSel(rows.slice(a, b + 1));
    } else {
      rangeAnchor = el;
      setSel([el]);
    }
  });
  wireLayerDrag(li, el);
  return li;
}

// Drag rows to restack them: the top or bottom half of a row drops in
// front of / behind it; the middle of a group row drops inside it.
let dragEls = null;
function dropZone(e, li, el) {
  if (!dragEls || dragEls.some((d) => d === el || d.contains(el))) return null;
  const r = li.getBoundingClientRect();
  const t = (e.clientY - r.top) / r.height;
  if (el.localName === 'g') return t < 0.28 ? 'above' : t > 0.72 ? 'below' : 'into';
  return t < 0.5 ? 'above' : 'below';
}
function clearDropMarks() {
  for (const r of document.querySelectorAll('.drop-above, .drop-below, .drop-into, .drop-end'))
    r.classList.remove('drop-above', 'drop-below', 'drop-into', 'drop-end');
}
function wireLayerDrag(li, el) {
  li.addEventListener('dragstart', (e) => {
    dragEls = state.sel.includes(el) ? normalizeSel(state.sel) : [el];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layerName(el));
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => {
    dragEls = null;
    li.classList.remove('dragging');
    clearDropMarks();
  });
  li.addEventListener('dragover', (e) => {
    const zone = dropZone(e, li, el);
    if (!zone) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    li.classList.add(`drop-${zone}`);
  });
  li.addEventListener('drop', (e) => {
    const zone = dropZone(e, li, el);
    if (!zone) return;
    e.preventDefault();
    e.stopPropagation();
    moveLayers(dragEls, el, zone);
  });
}

function moveLayers(els, target, zone) {
  els = inDocOrder(els);
  if (zone === 'into') {
    for (const el of els) reparent(el, target);
    folded.delete(treePath(target).join('/'));
  } else if (zone === 'above') {
    let ref = target;
    for (const el of els) {
      reparent(el, target.parentNode, ref.nextSibling);
      ref = el;
    }
  } else if (zone === 'below') {
    for (const el of els) reparent(el, target.parentNode, target);
  } else {
    // Empty space under the list: to the very back of the drawing.
    const ref = [...doc.children].find((c) => selectable(c) && !els.includes(c)) || null;
    for (const el of els) reparent(el, doc, ref);
  }
  dragEls = null;
  clearDropMarks();
  state.sel = els;
  commit();
  readStyle(els[0]);
}

// Swap a layer's name for a text field. Enter or leaving the field saves,
// Esc cancels, and an empty name goes back to the automatic one.
function renameLayer(el, span) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sc-layer-input';
  input.value = customName(el);
  input.placeholder = layerName(el);
  input.setAttribute('aria-label', 'Layer name');
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v !== customName(el)) {
      el.removeAttributeNS(INKSCAPE, 'label');
      if (v) el.setAttribute('data-name', v);
      else el.removeAttribute('data-name');
      commit();
    } else renderLayers();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}
