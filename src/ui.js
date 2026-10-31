// SVGCraft — UI wiring: tool metadata, panels and the layer list.
'use strict';

const PAINT_FOLD_KEY = 'svgcraft.paintFold'; // { fill, stroke }: folded in the Color panel

// ---------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------
const TOOL_META = {
  select: ['sc-move', 'Move'],
  node: ['sc-direct', 'Edit Points'],
  pencil: ['pencil', 'Pencil'],
  pen: ['pen-nib', 'Pen'],
  eraser: ['eraser', 'Eraser'],
  rect: ['square', 'Rectangle'],
  ellipse: ['circle', 'Ellipse'],
  triangle: ['sc-triangle', 'Triangle'],
  polygon: ['sc-star', 'Polygon'],
  line: ['slash', 'Line'],
  custom: ['sc-custom-shape', 'Custom Shape'],
  text: ['sc-type', 'Type'],
  eyedropper: ['eye-dropper', 'Eyedropper'],
  gradient: ['sc-gradient', 'Gradient'],
  hand: ['hand', 'Hand'],
  zoom: ['magnifying-glass', 'Zoom'],
};

// A toolbar button holding a group of tools: held down,
// right-clicked, Alt-clicked or clicked on its corner mark, it opens its
// flyout menu beside the toolbar; a plain click runs `pick` (if given).
function toolFlyout(btn, menu, pick) {
  const items = () => [...menu.querySelectorAll('[role="menuitemradio"]')];
  const open = () => {
    const r = btn.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = `${r.right + 4}px`;
    menu.style.top = `${Math.min(r.top, innerHeight - menu.offsetHeight - 4)}px`;
    (items().find((b) => b.getAttribute('aria-checked') === 'true') || items()[0])?.focus();
  };
  const close = () => (menu.hidden = true);
  let hold = 0;
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    hold = setTimeout(() => {
      hold = -1;
      open();
    }, 400);
  });
  btn.addEventListener('pointerup', () => clearTimeout(hold));
  btn.addEventListener('pointerleave', () => clearTimeout(hold));
  btn.addEventListener('click', (e) => {
    if (hold === -1) {
      hold = 0;
      return;
    }
    if (e.target.closest('.sc-tool-more') || e.altKey) open();
    else pick?.();
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    open();
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
    } else if (e.key === 'Escape') {
      close();
      btn.focus();
    } else return;
    e.stopPropagation();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close();
  });
  return { open, close };
}

// Options bar: the transform session's fields while one is open,
// otherwise the groups whose data-for lists the current tool.
function updateOptions() {
  const key = state.tf ? 'transform' : state.tool;
  for (const o of document.querySelectorAll('.sc-opt'))
    o.classList.toggle('on', o.dataset.for.split(' ').includes(key));
  const [ic, label] = state.tf
    ? {
        free: ['vector-square', 'Free Transform'],
        scale: ['maximize', 'Scale'],
        rotate: ['rotate', 'Rotate'],
        skew: ['italic', 'Skew'],
      }[state.tf.mode]
    : TOOL_META[state.tool];
  const oi = $('#sc-opt-icon');
  oi.dataset.icon = ic;
  oi.innerHTML = icon(ic);
  $('#sc-opt-name').textContent = label;
}

function setTool(name) {
  // The Gradient tool's handles are the Move tool's now.
  if (name === 'gradient') name = 'select';
  if (!tools[name]) return;
  // A phone only previews: the Hand tool (pan) is all there is.
  if (previewMode && name !== 'hand') name = 'hand';
  if (state.tf && name !== 'select') endTransform(true);
  const prev = state.sel;
  const changed = name !== state.tool;
  if (changed) {
    tools[state.tool].leave?.();
    if (!['select', 'hand', 'zoom', 'eyedropper', 'gradient'].includes(name)) state.sel = [];
  }
  state.tool = name;
  stage.dataset.tool = name;
  for (const b of document.querySelectorAll('[data-tool]'))
    b.setAttribute('aria-pressed', b.dataset.tool === name);
  syncShapeButton();
  updateOptions();
  stage.style.cursor = tools[name].cursor;
  $('#sc-hint').textContent = tools[name].hint;
  if (changed) tools[name].enter?.(prev);
  if (changed && name === 'text') showCharacterTab();
  drawSelection();
  renderLayers();
}

// Tab hides the toolbar, options bar and panels, Shift+Tab just the
// panels on the right; either brings everything back.
function togglePanels(rightOnly) {
  const b = document.body.classList;
  const hidden = b.contains('sc-no-panels') || b.contains('sc-no-right');
  b.remove('sc-no-panels', 'sc-no-right');
  if (!hidden) b.add(rightOnly ? 'sc-no-right' : 'sc-no-panels');
  for (const m of document.querySelectorAll('[data-action="togglePanels"]'))
    m.setAttribute('aria-checked', !hidden);
  applyView();
  drawRulers();
}

// [ and ]: the stroke width down or up a pixel (the familiar brush size keys).
function setStrokeWidthBy(d) {
  state.strokeWidth = clamp(Math.round(state.strokeWidth + d), 0, 200);
  styleChanged('width', true);
  syncStyleUI();
  say(`Stroke width: ${state.strokeWidth} px.`);
}

function syncStyleUI() {
  for (const k of ['fill', 'stroke']) {
    // Set inside the symbol: shown, not editable, with the way to change it.
    const sec = $(`.sc-paint[data-target="${k}"]`);
    const locked = !!state[k + 'Locked'] && state.sel.length > 0;
    sec.inert = locked;
    sec.classList.toggle('sc-paint-locked', locked);
    let note = sec.previousElementSibling?.matches('.sc-paint-note')
      ? sec.previousElementSibling
      : null;
    if (locked && !note) {
      note = document.createElement('p');
      note.className = 'sc-paint-note';
      note.innerHTML =
        `The symbol sets this ${k} itself. ` +
        '<button class="sc-linkbtn" data-action="editSymbol">Edit Symbol</button> to change it.';
      sec.before(note);
    }
    if (note) note.hidden = !locked;
    $(`#sc-${k}-color`).value = state[k];
    $(`#sc-${k}-hex`).value = state[k];
    const a = Math.round(state[k + 'A'] * 100);
    if (document.activeElement !== $(`#sc-${k}-a`)) $(`#sc-${k}-a`).value = a;
    const chip = $(`#sc-${k}-chip`);
    chip.classList.toggle('none', !state[k + 'On']);
    const g = state[k + 'On'] && state[k + 'Grad'];
    const pt = state[k + 'On'] && state[k + 'Pat'];
    chip.style.setProperty(
      '--chip',
      pt
        ? patCss({ ...pt, scale: 1 }, state[k], 1.2)
        : g
          ? chipCss(g)
          : state[k] +
            Math.round(state[k + 'A'] * 255)
              .toString(16)
              .padStart(2, '0'),
    );
    const kind = !state[k + 'On'] ? 'none' : pt ? 'pattern' : g ? g.type : 'solid';
    for (const b of document.querySelectorAll(`[data-kind-for="${k}"] [data-kind]`))
      b.setAttribute('aria-checked', b.dataset.kind === kind);
    chip.closest('.sc-paint').classList.toggle('active', state.active === k);
  }
  for (const b of document.querySelectorAll('[data-stroke-cap]'))
    b.setAttribute('aria-checked', b.dataset.strokeCap === state.cap);
  for (const b of document.querySelectorAll('[data-stroke-join]'))
    b.setAttribute('aria-checked', b.dataset.strokeJoin === state.join);
  for (const b of document.querySelectorAll('[data-stroke-align]'))
    b.setAttribute('aria-checked', b.dataset.strokeAlign === state.strokeAlign);
  for (const sel of document.querySelectorAll('select[data-stroke-dash]')) {
    sel.value = state.dash;
  }
  $('#sc-dash-custom').hidden = state.dash !== 'custom';
  $('#sc-dash-custom')
    .querySelectorAll('input')
    .forEach((inp, i) => {
      if (document.activeElement !== inp) inp.value = state.dashPat[i] ?? '';
    });
  renderGradEditor();
  renderPatEditor();
  for (const b of document.querySelectorAll('[data-gtype]'))
    b.setAttribute('aria-checked', b.dataset.gtype === (activeGrad()?.type || state.gradType));

  // Every field bound to the same setting (options bar + panels) shows it.
  const show = { strokeWidth: f(state.strokeWidth), opacity: Math.round(state.opacity * 100) };
  for (const el of document.querySelectorAll('[data-bind]'))
    if (document.activeElement !== el) el.value = show[el.dataset.bind];
  if (typeof syncPaintButtons === 'function') syncPaintButtons();
}

// Push a style change to the selection; `final` commits it to history.
function styleChanged(key, final) {
  syncStyleUI();
  if (typeEdit && key === 'fill') {
    applyToEdit({ fill: state.fillOn ? state.fill : 'none', fillA: state.fillA }, final);
    return;
  }
  const targets = state.tool === 'node' && tools.node.el ? [tools.node.el] : state.sel;
  if (!targets.length) return;
  // Lock All: the layer keeps its own look (the panels go back to showing it).
  if (refuseLocked(targets, 'edit')) {
    readStyle(targets[0]);
    return;
  }
  if ((key === 'fill' || key === 'stroke') && targets.every((el) => symbolOwnPaint(el, key))) {
    readStyle(targets[0]);
    warn(`The symbol sets its own ${key}: Edit Symbol (double-click the instance) to change it.`);
    return;
  }
  for (const el of targets) applyStyle(el, key);
  if (key === 'align' && state.strokeAlign !== 'center') {
    const shapes = targets.flatMap(paintTargets).filter((t) => t.localName !== 'g');
    if (!shapes.some(closedShape)) {
      state.strokeAlign = 'center';
      syncStyleUI();
      warn('Only closed shapes can align their stroke inside or outside.');
    }
  }
  if (final) commit();
  else drawSelection();
}

function wireStyle() {
  for (const k of ['fill', 'stroke']) {
    const color = $(`#sc-${k}-color`);
    color.addEventListener('input', () => {
      state[k] = color.value;
      state[k + 'On'] = true;
      state[k + 'Grad'] = null;
      styleChanged(k, false);
    });
    color.addEventListener('change', () => styleChanged(k, true));
    const hx = $(`#sc-${k}-hex`);
    hx.addEventListener('change', () => {
      const v = hex(hx.value.trim().startsWith('#') ? hx.value.trim() : '#' + hx.value.trim());
      if (v && /^#[0-9a-f]{6}$/.test(v)) {
        state[k] = v;
        state[k + 'On'] = true;
        state[k + 'Grad'] = null;
      }
      styleChanged(k, true);
    });
    const a = $(`#sc-${k}-a`);
    a.addEventListener('input', () => {
      const v = parseFloat(a.value);
      if (!isFinite(v)) return;
      state[k + 'A'] = clamp(v, 0, 100) / 100;
      styleChanged(k, false);
    });
    a.addEventListener('change', () => styleChanged(k, true));
    // The chip is the paint's one swatch: a click makes it the active paint
    // (the section's pointerdown already did) and opens the colour picker,
    // as the toolbar's chip does; a gradient or pattern has its editor.
    $(`#sc-${k}-chip`).addEventListener('click', () => {
      state.active = k;
      syncStyleUI();
      if (!state[k + 'Grad'] && !state[k + 'Pat']) color.click();
    });
    $(`#sc-${k}-chip`)
      .closest('.sc-paint')
      .addEventListener('pointerdown', (e) => {
        if (e.target.closest('.sc-paint-fold')) return;
        state.active = k;
        syncStyleUI();
      });
  }
  // Fill and Stroke fold to their first row; kept for next time.
  const folded = stored(PAINT_FOLD_KEY, {}) || {};
  for (const b of document.querySelectorAll('[data-fold]')) {
    const sec = b.closest('.sc-paint');
    const set = (on) => {
      sec.classList.toggle('folded', on);
      b.setAttribute('aria-expanded', !on);
      b.innerHTML = icon(on ? 'chevron-right' : 'chevron-down');
    };
    set(!!folded[b.dataset.fold]);
    b.addEventListener('click', () => {
      const on = !sec.classList.contains('folded');
      set(on);
      folded[b.dataset.fold] = on;
      store(PAINT_FOLD_KEY, folded);
    });
  }
  for (const el of document.querySelectorAll('[data-bind]')) {
    const key = el.dataset.bind;
    const read = () => {
      const v = parseFloat(el.value);
      if (!isFinite(v)) return false;
      const c = clamp(v, +el.min, +el.max);
      state[key] = key === 'opacity' ? c / 100 : c;
      return true;
    };
    const k = key === 'strokeWidth' ? 'width' : 'opacity';
    el.addEventListener('input', () => read() && styleChanged(k, false));
    el.addEventListener('change', () => {
      read();
      styleChanged(k, true);
      syncStyleUI();
    });
  }
}

// The options bar, when its controls don't fit: a ‹ or › at the end that
// has more scrolls it (as does the mouse wheel), so nothing is cut off
// unseen.
{
  const bar = $('#sc-options');
  const [left, right] = [$('.sc-opt-more-l'), $('.sc-opt-more-r')];
  const sync = () => {
    left.hidden = bar.scrollLeft <= 1;
    right.hidden = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 1;
  };
  const by = (d) => bar.scrollBy({ left: d * bar.clientWidth * 0.6, behavior: 'smooth' });
  left.addEventListener('click', () => by(-1));
  right.addEventListener('click', () => by(1));
  bar.addEventListener('scroll', sync, { passive: true });
  bar.addEventListener(
    'wheel',
    (e) => {
      if (bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
  new ResizeObserver(sync).observe(bar);
  new MutationObserver(() => requestAnimationFrame(sync)).observe(bar, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden'],
  });
  sync();
}
