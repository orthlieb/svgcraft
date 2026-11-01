// SVGCraft — Selection and its on-canvas overlay.
'use strict';

// ---------------------------------------------------------------------
// Selection + overlay
// ---------------------------------------------------------------------
// Selecting text shows the Character tab; selecting something else
// afterwards goes back to the tab that was showing, unless another tab was
// chosen in between.
let tabBeforeText = null;
let tabByUs = false;
const propTab = (name) => {
  tabByUs = true;
  $(`[data-tab="${name}"]`).click();
  tabByUs = false;
};
function showCharacterTab() {
  const cur = $('[data-tab="character"]')
    .closest('.sc-ptabs')
    .querySelector('[aria-selected="true"]')?.dataset.tab;
  if (cur === 'character') return;
  tabBeforeText = cur || null;
  propTab('character');
}
for (const t of $('[data-tab="character"]').closest('.sc-ptabs').querySelectorAll('[data-tab]'))
  t.addEventListener('click', () => {
    if (!tabByUs) tabBeforeText = null;
  });
function setSel(els) {
  staleAlert();
  // Picking something outside the isolated group (in Layers, say) leaves it.
  if (scope && els.some((el) => !inScope(el))) setScope(null);
  state.sel = normalizeSel(els);
  els = state.sel;
  if (els.length) readStyle(els[0]);
  if (els.length && readTypeFromSelection() && els.every((el) => el.localName === 'text'))
    showCharacterTab();
  else if (
    els.length &&
    tabBeforeText &&
    $('[data-tab="character"]').getAttribute('aria-selected') === 'true'
  ) {
    propTab(tabBeforeText);
    tabBeforeText = null;
  }
  drawSelection();
  markLayers();
  // The Shape Builder builds from whatever is selected now.
  if (state.tool === 'shapebuilder') sbBuild();
}

// Re-highlight the selected rows without rebuilding the list (a rebuild
// between the two clicks of a double-click would swallow the rename).
function markLayers() {
  let first = null;
  for (const li of $('#sc-layers').children)
    if (li.layerEl) {
      const on = state.sel.includes(li.layerEl);
      li.classList.toggle('sel', on);
      li.setAttribute('aria-selected', on);
      if (on) first ||= li;
    }
  // The selection's row in view.
  first?.scrollIntoView({ block: 'nearest' });
}

// Appearance's blend mode and the Layers panel's lock buttons follow the selection.
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
  syncBoxFields();
  if (typeof syncActions === 'function') syncActions();
  if (typeof syncLibBars === 'function') syncLibBars();
  $('#sc-pos').dataset.sel = '';
  // Direct Selection draws points, the Shape Builder its regions (src/shape-builder.js).
  if (!state.sel.length || state.tool === 'node' || state.tool === 'shapebuilder') return;
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
  if (state.tool !== 'select') return;
  // A locked layer shows its box, not handles it would refuse.
  if (state.sel.some((el) => lockOf(el))) return;
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
        style: `cursor:${cursorFor.rotate}`,
      },
      selLayer,
    );
  const hs = 8 / z;
  for (const k of HANDLES) {
    const p = handlePos(box, k);
    const cursor =
      mode === 'rotate'
        ? cursorFor.rotate
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
  // A gradient's handles, on a shape painted with one (the active paint's).
  if (state.sel.length === 1) drawGradAnnotator(z);
  // An animation's pivot sits on top, like a transform's reference point.
  const pivot = selLayer.querySelector('[data-anim-origin]');
  if (pivot) selLayer.append(pivot);
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
  // A hidden layer has no size to frame it by, so everything shows for
  // the moment it's measured (style.css; nothing is drawn in between).
  doc.setAttribute('data-sc-thumbs', '');
  const b = bboxDoc(el, getM(el));
  doc.removeAttribute('data-sc-thumbs');
  if (!b) return t;
  const pad = Math.max(b.w, b.h) * 0.08 + 1;
  t.setAttribute('viewBox', [b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad].map(f).join(' '));
  const c = el.cloneNode(true);
  bakeInherited(el, c);
  c.removeAttribute('display');
  // A clipping shape is hidden on the canvas, but its row shows it.
  if (el.hasAttribute('data-sc-clipper')) c.removeAttribute('visibility');
  for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id');
  // Shown or hidden in the phone preview: the preview shows it either way.
  for (const n of [c, ...c.querySelectorAll('[data-sc-peek]')]) n.removeAttribute('data-sc-peek');
  t.append(c);
  return t;
}

// Layer previews are drawn after their rows: the list appears at once with
// blank previews, which fill in as they scroll into view and, a few at a
// time while the browser is idle, the rest. Rebuilding the list (after an
// edit, say) drops what was still to draw.
//
// Drawn previews are kept, each with a key for what it showed: the layer's
// markup and what it inherits from its groups. After an edit only the
// layers whose key changed (the edited ones, and the groups holding them)
// are dropped and drawn again; the rest come back at once. Gradients,
// patterns and effects stay live through their url(#…) references.
const thumbCache = new WeakMap(); // layer → { key, svg }
function thumbKey(el) {
  let k = el.outerHTML;
  for (let p = el.parentNode; p && p !== doc; p = p.parentNode)
    for (const a of p.attributes) k += `\u0001${a.name}=${a.value}`;
  return k;
}
function pendingThumb(el) {
  const key = thumbKey(el);
  const kept = thumbCache.get(el);
  if (kept?.key === key) return kept.svg.cloneNode(true);
  thumbCache.delete(el);
  const t = mk('svg', { class: 'sc-thumb', 'aria-hidden': 'true' });
  t.layerEl = el;
  return t;
}
const idle =
  window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 16));
function fillThumbs(list) {
  const job = (list.thumbJob = (list.thumbJob || 0) + 1);
  const left = new Set([...list.querySelectorAll('.sc-thumb')].filter((t) => t.layerEl));
  const draw = (t) => {
    if (!left.delete(t) || !t.isConnected || !t.layerEl.isConnected) return;
    const drawn = layerThumb(t.layerEl);
    thumbCache.set(t.layerEl, { key: thumbKey(t.layerEl), svg: drawn });
    t.replaceWith(drawn.cloneNode(true));
  };
  const seen = new IntersectionObserver((entries) => {
    if (list.thumbJob !== job) return seen.disconnect();
    for (const e of entries) if (e.isIntersecting) draw(e.target);
  });
  for (const t of left) seen.observe(t);
  const step = (deadline) => {
    if (list.thumbJob !== job) return seen.disconnect();
    for (const t of left) {
      if (deadline.timeRemaining() < 2) break;
      draw(t);
    }
    if (left.size) idle(step);
    else seen.disconnect();
  };
  idle(step);
}

// Whether the Layers rows take the arrow keys: when the list was reached by
// the keyboard (Tab), not by a click.
let layerKeys = false;
$('#sc-layers').addEventListener('pointerdown', () => (layerKeys = false), true);
$('#sc-layers').addEventListener('keyup', (e) => {
  if (e.key === 'Tab') layerKeys = true;
});

// Groups the user folded in the Layers panel, keyed by tree path.
const folded = new Set();
let rangeAnchor = null;

function renderLayers() {
  const ol = $('#sc-layers');
  // The row with the keyboard keeps it through the redraw.
  const focused = ol.contains(document.activeElement)
    ? document.activeElement.closest('li')?.layerEl
    : null;
  ol.replaceChildren();
  if (!items().length) {
    const li = document.createElement('li');
    li.className = 'sc-empty';
    li.textContent = curDoc
      ? 'Nothing here yet. Draw something, or drop an SVG onto the canvas.'
      : 'No drawing open. File → New, or Open.';
    ol.append(li);
    return;
  }
  let rows = 0;
  const walk = (parent, depth) => {
    for (const el of [...parent.children].filter(selectable).reverse()) {
      if (rows++ >= 500) return;
      const open = el.localName === 'g' && !folded.has(treePath(el).join('/'));
      ol.append(layerRow(el, depth, open));
      if (open) walk(el, depth + 1);
    }
  };
  walk(doc, 0);
  // One row takes Tab (the selected one, else the top), the arrows the rest;
  // the selection's row is scrolled into view.
  const rowsNow = [...ol.children].filter((r) => r.layerEl);
  const home = rowsNow.find((r) => r.classList.contains('sel')) || rowsNow[0];
  if (home) home.tabIndex = 0;
  const back = focused && rowsNow.find((r) => r.layerEl === focused);
  if (back) {
    back.tabIndex = 0;
    if (home !== back) home.tabIndex = -1;
    back.focus({ preventScroll: true });
  }
  rowsNow.find((r) => r.classList.contains('sel'))?.scrollIntoView({ block: 'nearest' });
  fillThumbs(ol);
  syncLayerHead();
}

function layerRow(el, depth, open) {
  const li = document.createElement('li');
  const hidden = el.getAttribute('display') === 'none';
  const isGroup = el.localName === 'g';
  li.className =
    (state.sel.includes(el) ? 'sel ' : '') +
    (hidden ? 'hidden ' : '') +
    (el === scope ? 'scope' : '');
  li.style.paddingLeft = `${4 + depth * 16}px`;
  li.layerEl = el;
  li.draggable = true;
  li.tabIndex = -1;
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', state.sel.includes(el));
  if (isGroup) li.setAttribute('aria-expanded', open);

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
  } else {
    twisty.tabIndex = -1;
    twisty.setAttribute('aria-hidden', 'true');
  }

  const eye = document.createElement('button');
  eye.className = 'sc-eye';
  eye.innerHTML = `<i data-icon="${hidden ? 'eye-slash' : 'eye'}">${icon(hidden ? 'eye-slash' : 'eye')}</i>`;
  eye.setAttribute('aria-label', hidden ? 'Show' : 'Hide');
  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.altKey) return soloLayer(el);
    if (hidden) el.removeAttribute('display');
    else el.setAttribute('display', 'none');
    commit();
  });

  // Groups too show what's in them (the twisty marks them as groups).
  const thumb = pendingThumb(el);

  const name = document.createElement('span');
  name.className = 'sc-layer-name';
  name.textContent = layerName(el);
  name.addEventListener('dblclick', (e) => {
    // The name's text renames; the empty row after it is the row's.
    const r = document.createRange();
    r.selectNodeContents(name);
    if (e.clientX > r.getBoundingClientRect().right + 4) return;
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
    fx.setAttribute('aria-label', 'Effects');
    fx.dataset.tip = 'Effects · double-click to edit';
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
    b.setAttribute('aria-label', 'Unlock');
    b.dataset.tip = `${lock === 'all' ? 'Locked' : 'Position locked'} · click to unlock`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setLock([el], null);
    });
    li.append(b);
  }

  // The usual rules: click selects, Ctrl/⌘-click toggles, Shift-click
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
  // Double-click a row (not its name): Layer Style.
  li.addEventListener('dblclick', (e) => {
    if (e.target.closest('.sc-eye, .sc-twisty, input')) return;
    setSel([el]);
    ifAllowed('layerStyle');
  });
  // The keyboard: up and down select the next row (Shift adds it), Alt+up
  // and down move the layer up and down the stack, F2 or Enter renames,
  // right and left open and fold a group.
  // A row clicked with the mouse leaves the arrows to nudge the layer;
  // reached by the keyboard, the row takes them.
  li.addEventListener('keydown', (e) => {
    if (e.target !== li || !layerKeys) return;
    const rows = [...$('#sc-layers').children].filter((r) => r.layerEl);
    const i = rows.indexOf(li);
    const k = e.key;
    let done = true;
    if ((k === 'ArrowUp' || k === 'ArrowDown') && e.altKey)
      ifAllowed(k === 'ArrowUp' ? 'forward' : 'backward');
    else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Home' || k === 'End') {
      const to = rows[{ ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: rows.length - 1 }[k]];
      if (to) {
        if (e.shiftKey) setSel([...new Set([...state.sel, to.layerEl])]);
        else {
          rangeAnchor = to.layerEl;
          setSel([to.layerEl]);
        }
        const now = [...$('#sc-layers').children].find((r) => r.layerEl === to.layerEl);
        now?.focus();
      }
    } else if (k === 'F2' || k === 'Enter') renameLayer(el, name);
    else if ((k === 'ArrowRight' && isGroup && !open) || (k === 'ArrowLeft' && isGroup && open))
      twisty.click();
    else done = false;
    if (!done) return;
    e.preventDefault();
    e.stopPropagation();
  });
  wireLayerDrag(li, el);
  return li;
}

// Alt-click an eye: show only that layer; Alt-click it
// again for the others back as they were.
let solo = null;
function soloLayer(el) {
  noteStep('Show Only This');
  const vis = (n) => n.getAttribute('display');
  if (solo?.el === el && [...solo.was.keys()].every((n) => n.isConnected)) {
    for (const [n, d] of solo.was)
      if (d == null) n.removeAttribute('display');
      else n.setAttribute('display', d);
    solo = null;
  } else {
    const was = new Map();
    const set = (n, d) => {
      was.set(n, vis(n));
      if (d == null) n.removeAttribute('display');
      else n.setAttribute('display', d);
    };
    // It and the groups it's in show; everything beside them hides.
    for (let n = el; n && n !== doc; n = n.parentNode) {
      set(n, null);
      for (const s of n.parentNode.children) if (s !== n && selectable(s)) set(s, 'none');
    }
    solo = { el, was };
  }
  commit();
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
    e.dataTransfer.effectAllowed = 'copyMove';
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

// Layers dragged onto the footer's New button are copied
// in place, and onto the bin deleted.
for (const [name, effect, run] of [
  ['duplicate', 'copy', () => actions.duplicate(0)],
  ['delete', 'move', () => actions.delete()],
]) {
  const b = $(`.sc-layers-foot [data-action="${name}"]`);
  b.addEventListener('dragover', (e) => {
    if (!dragEls) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = effect;
    b.classList.add('sc-drop-on');
  });
  b.addEventListener('dragleave', () => b.classList.remove('sc-drop-on'));
  b.addEventListener('drop', (e) => {
    if (!dragEls) return;
    e.preventDefault();
    b.classList.remove('sc-drop-on');
    state.sel = dragEls;
    dragEls = null;
    clearDropMarks();
    noteStep(stepName(name));
    run();
  });
}

function moveLayers(els, target, zone) {
  noteStep('Move Object');
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
  input.setAttribute('aria-label', 'Name');
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
      noteStep('Rename');
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
