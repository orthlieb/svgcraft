// SVGCraft — UI wiring: tool metadata, panels and the layer list.
'use strict';

// ---------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------
const TOOL_META = {
  select: ['arrow-pointer', 'Move'],
  node: ['bezier-curve', 'Edit Points'],
  pencil: ['pencil', 'Pencil'],
  pen: ['pen-nib', 'Pen'],
  eraser: ['eraser', 'Eraser'],
  rect: ['square', 'Rectangle'],
  ellipse: ['circle', 'Ellipse'],
  line: ['slash', 'Line'],
  text: ['font', 'Type'],
  eyedropper: ['eye-dropper', 'Eyedropper'],
  gradient: ['sc-gradient', 'Gradient'],
  hand: ['hand', 'Hand'],
  zoom: ['magnifying-glass', 'Zoom'],
};

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
  updateOptions();
  stage.style.cursor = tools[name].cursor;
  $('#sc-hint').textContent = tools[name].hint;
  if (changed) tools[name].enter?.(prev);
  if (changed && name === 'text') $('[data-tab="character"]').click();
  drawSelection();
  renderLayers();
}

function syncStyleUI() {
  for (const k of ['fill', 'stroke']) {
    $(`#sc-${k}-on`).checked = state[k + 'On'];
    $(`#sc-${k}-color`).value = state[k];
    $(`#sc-${k}-hex`).value = state[k];
    const a = Math.round(state[k + 'A'] * 100);
    $(`#sc-${k}-a`).value = a;
    $(`#sc-${k}-a-out`).textContent = a + '%';
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
    const kind = pt ? 'pattern' : g ? g.type : 'solid';
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
  // Toolbar chips (Photoshop's foreground / background squares).
  for (const k of ['fill', 'stroke']) {
    const chip = $(`#sc-tb-${k}`);
    chip.classList.toggle('none', !state[k + 'On']);
    chip.classList.toggle('active', state.active === k);
    chip.style.setProperty('--chip', $(`#sc-${k}-chip`).style.getPropertyValue('--chip'));
  }
  // Every field bound to the same setting (options bar + panels) shows it.
  const show = { strokeWidth: f(state.strokeWidth), opacity: Math.round(state.opacity * 100) };
  for (const el of document.querySelectorAll('[data-bind]'))
    if (document.activeElement !== el) el.value = show[el.dataset.bind];
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
  for (const el of targets) applyStyle(el, key);
  if (key === 'align' && state.strokeAlign !== 'center') {
    const shapes = targets.flatMap(paintTargets).filter((t) => t.localName !== 'g');
    if (!shapes.some(closedShape)) {
      state.strokeAlign = 'center';
      syncStyleUI();
      say('Only closed shapes can align their stroke inside or outside.');
    }
  }
  if (final) commit();
  else drawSelection();
}

function wireStyle() {
  for (const k of ['fill', 'stroke']) {
    $(`#sc-${k}-on`).addEventListener('change', (e) => {
      state[k + 'On'] = e.target.checked;
      styleChanged(k, true);
    });
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
      state[k + 'A'] = a.value / 100;
      styleChanged(k, false);
    });
    a.addEventListener('change', () => styleChanged(k, true));
    $(`#sc-${k}-chip`).addEventListener('click', () => {
      state.active = k;
      syncStyleUI();
    });
    $(`#sc-${k}-chip`)
      .closest('.sc-paint')
      .addEventListener('pointerdown', () => {
        state.active = k;
        syncStyleUI();
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
  // Clicking the active toolbar chip opens its colour picker; otherwise it
  // just becomes the active paint.
  for (const k of ['fill', 'stroke']) {
    $(`#sc-tb-${k}`).addEventListener('click', () => {
      if (state.active === k) $(`#sc-${k}-color`).click();
      state.active = k;
      syncStyleUI();
    });
  }
}
