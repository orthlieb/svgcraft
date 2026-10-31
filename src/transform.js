// SVGCraft — Free Transform and Transform Again.
'use strict';

// ---- Transform Again --------------------------------------------------
// The last transform is kept relative to the centre of what it was applied
// to, so repeating it rotates / scales about the new selection's centre
// (and Again with Copy builds step-and-repeat patterns).
let lastT = null;
function noteTransform(T, box) {
  if (!T || !box) return;
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  lastT = new DOMMatrix()
    .translate(-c.x, -c.y)
    .multiply(T)
    .multiply(new DOMMatrix().translate(c.x, c.y));
}
function transformAgain(copy) {
  if (!lastT) return warn('Nothing to repeat yet — transform something first.');
  if (!state.sel.length) return warn('Select something to transform.');
  if (!copy && refuseLocked(state.sel)) return;
  if (copy) {
    state.sel = inDocOrder(state.sel).map((el) => {
      const c = el.cloneNode(true);
      for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id');
      el.after(c);
      return c;
    });
  }
  const box = selBox();
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const T = new DOMMatrix()
    .translate(c.x, c.y)
    .multiply(lastT)
    .multiply(new DOMMatrix().translate(-c.x, -c.y));
  for (const el of state.sel) transformDoc(el, T);
  commit();
}

// ---- Free Transform session (Ctrl+T) ------------------------
// Handles act per mode (free / scale / rotate / skew), the options bar
// shows X Y W H, angle and skew; Enter commits, Esc rolls the whole
// session back.
function beginTransform(mode) {
  if (!state.sel.length) return warn('Select something to transform first.');
  if (refuseLocked(state.sel)) return;
  if (state.tool !== 'select') setTool('select');
  if (state.tf) {
    state.tf.mode = mode;
  } else {
    const box = selBox();
    state.tf = {
      mode,
      entry: hIdx,
      paths: state.sel.map(treePath),
      angle: 0,
      skx: 0,
      sky: 0,
      el0: state.sel[0],
      m0: fullM(state.sel[0]),
      box0: box,
    };
  }
  updateOptions();
  drawSelection();
  $('#sc-hint').textContent = {
    free: 'Free Transform: drag corners to scale, the top knob to rotate · Enter commits, Esc cancels',
    scale:
      'Scale: drag any handle (Shift keeps proportions, Alt from centre) · Enter commits, Esc cancels',
    rotate:
      'Rotate: drag any handle around the centre (Shift snaps to 15°) · Enter commits, Esc cancels',
    skew: 'Skew: drag an edge handle along its edge (Shift snaps to 15°) · Enter commits, Esc cancels',
  }[mode];
}
function endTransform(keep) {
  const tf = state.tf;
  if (!tf) return;
  state.tf = null;
  if (keep) {
    // Transform Again repeats the whole session as one step.
    if (tf.el0.isConnected && hIdx > tf.entry)
      noteTransform(fullM(tf.el0).multiply(tf.m0.inverse()), tf.box0);
  } else if (hIdx > tf.entry) {
    hist.length = tf.entry + 1;
    hIdx = tf.entry;
    restore(hist[hIdx]);
    state.sel = tf.paths.map(fromTreePath).filter(Boolean);
  }
  updateOptions();
  $('#sc-hint').textContent = tools[state.tool].hint;
  drawSelection();
  renderLayers();
}

// Keep the session's number fields in step with the selection.
function syncTransformFields(box) {
  if (!state.tf) return;
  const vals = {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    angle: state.tf.angle,
    skx: state.tf.skx,
    sky: state.tf.sky,
  };
  for (const el of document.querySelectorAll('[data-tf]'))
    if (document.activeElement !== el)
      el.value = LENGTH_KEYS.has(el.dataset.tf)
        ? inUnits(vals[el.dataset.tf])
        : f(vals[el.dataset.tf]);
}

// A number field changed: turn the new value into a transform of the selection.
// Position and size are typed in the document's units.
const LENGTH_KEYS = new Set(['x', 'y', 'w', 'h']);
function applyTransformField(key, v, final, linkBtn = $('#sc-tf-link')) {
  const box = selBox();
  if (!box || !isFinite(v)) return;
  if (LENGTH_KEYS.has(key)) v = fromUnits(v);
  const tf = state.tf;
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const about = (x, y, m) =>
    new DOMMatrix().translate(x, y).multiply(m).multiply(new DOMMatrix().translate(-x, -y));
  const linked = linkBtn.getAttribute('aria-pressed') === 'true';
  let T;
  if (key === 'x') T = new DOMMatrix().translate(v - box.x, 0);
  else if (key === 'y') T = new DOMMatrix().translate(0, v - box.y);
  else if (key === 'w' || key === 'h') {
    if (v <= 0 || !box.w || !box.h) return;
    const s = key === 'w' ? v / box.w : v / box.h;
    const sx = key === 'w' || linked ? s : 1;
    const sy = key === 'h' || linked ? s : 1;
    T = about(box.x, box.y, new DOMMatrix().scale(sx, sy));
  } else if (key === 'angle') {
    T = about(c.x, c.y, new DOMMatrix().rotate(v - tf.angle));
    tf.angle = v;
  } else {
    const d = clamp(v, -89, 89) - tf[key];
    T = about(c.x, c.y, key === 'skx' ? new DOMMatrix().skewX(d) : new DOMMatrix().skewY(d));
    tf[key] = clamp(v, -89, 89);
  }
  for (const el of state.sel) transformDoc(el, T);
  noteTransform(T, box);
  if (final) commit();
  else drawSelection();
}

function rotateSel(deg) {
  transformSel((b) => {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return new DOMMatrix().translate(cx, cy).rotate(deg).translate(-cx, -cy);
  });
  if (state.tf) state.tf.angle += deg;
}

function nextGroupName() {
  let n = 0;
  for (const g of doc.querySelectorAll('g[data-name]')) {
    const m = /^Group (\d+)$/.exec(g.getAttribute('data-name'));
    if (m) n = Math.max(n, +m[1]);
  }
  return `Group ${n + 1}`;
}

// Properties' Transform: the selection's X, Y, W and H, in the document's
// units, typed or scrubbed (the same as Free Transform's fields).
const boxProps = $('#sc-box-props');
function syncBoxFields() {
  const box = state.sel.length && state.tool !== 'node' && selBox();
  boxProps.hidden = !box;
  if (!box) return;
  for (const el of boxProps.querySelectorAll('[data-box]'))
    if (document.activeElement !== el) el.value = inUnits(box[el.dataset.box]);
}
for (const el of boxProps.querySelectorAll('[data-box]')) {
  const go = (final) => {
    if (refuseLocked(state.sel, 'move')) return syncBoxFields();
    if (final) noteStep(el.dataset.box === 'x' || el.dataset.box === 'y' ? 'Move' : 'Scale');
    applyTransformField(el.dataset.box, parseFloat(el.value), final, $('#sc-box-link'));
  };
  el.addEventListener('input', () => go(false));
  el.addEventListener('change', () => go(true));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  });
}
$('#sc-box-link').addEventListener('click', (e) => {
  const b = e.currentTarget;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on);
  b.firstElementChild.innerHTML = icon(on ? 'link' : 'link-slash');
});
