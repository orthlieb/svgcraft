// SVGCraft — The gradient editor in the Color panel.
'use strict';

// ---- gradient editor (Color panel) --------------------------------------------
const activeGrad = () => (state[state.active + 'On'] ? state[state.active + 'Grad'] : null);
// The presets: Colour → Transparent in the active colour, then the library.
const gradPresets = () => [
  { id: 'fade', name: GRAD_PRESETS.fade[0], stops: GRAD_PRESETS.fade[1](state[state.active]) },
  ...lib.gradients,
];
const stopsKey = (stops) => stops.map((s) => `${s.o}|${s.c}|${s.a ?? 1}`).join(',');

function renderGradEditor() {
  const g = activeGrad();
  const box = $('#sc-grad');
  box.hidden = !g;
  if (!g) return;
  state.gradStop = clamp(state.gradStop || 0, 0, g.stops.length - 1);
  const s = g.stops[state.gradStop];
  $('#sc-grad-title').textContent = `${state.active === 'fill' ? 'Fill' : 'Stroke'} gradient`;
  $('#sc-grad-bar').style.backgroundImage = `${gradCss(g)}, var(--checker)`;
  // The Gradients panel marks the one the picker shows, if it's there.
  const key = stopsKey(g.stops);
  const same = lib.gradients.find((x) => stopsKey(x.stops) === key);
  if (same) libSel.gradients = same.id;
  for (const t of document.querySelectorAll('#sc-gradlib .sc-tile'))
    t.classList.toggle('sel', !!same && t.dataset.id === same.id);
  libPickers.gradients?.sync();
  const marks = $('#sc-grad-stops');
  marks.replaceChildren(
    ...g.stops.map((st, i) => {
      const b = document.createElement('button');
      b.className = 'sc-gstop' + (i === state.gradStop ? ' sel' : '');
      b.style.left = `${st.o * 100}%`;
      b.style.setProperty('--c', cssColor(st.c, 1));
      b.setAttribute('aria-label', `Stop ${i + 1} at ${Math.round(st.o * 100)}%`);
      b.dataset.i = i;
      return b;
    }),
  );
  const set = (sel, v) => {
    const el = $(sel);
    if (document.activeElement !== el) el.value = v;
  };
  set('#sc-gstop-color', s.c);
  set('#sc-gstop-hex', s.c);
  set('#sc-gstop-a', Math.round(s.a * 100));
  set('#sc-gstop-o', Math.round(s.o * 100));
  set('#sc-grad-angle', g.angle);
  $('#sc-grad-angle-wrap').hidden = g.type === 'radial';
  $('#sc-grad-keep').checked = !g.stretch;
  $('#sc-gstop-del').disabled = g.stops.length <= 2;
  for (const b of document.querySelectorAll('[data-gtype]'))
    b.setAttribute('aria-checked', b.dataset.gtype === g.type);
}

// Colour of the gradient at o (for new stops).
function gradAt(g, o) {
  const st = g.stops;
  if (o <= st[0].o) return { ...st[0], o };
  if (o >= st.at(-1).o) return { ...st.at(-1), o };
  const i = st.findIndex((s) => s.o >= o);
  const a = st[i - 1];
  const b = st[i];
  const t = (o - a.o) / (b.o - a.o || 1);
  const ca = parseInt(a.c.slice(1), 16);
  const cb = parseInt(b.c.slice(1), 16);
  const mix = (sh) => Math.round(((ca >> sh) & 255) * (1 - t) + ((cb >> sh) & 255) * t);
  return {
    o,
    c: '#' + [16, 8, 0].map((sh) => mix(sh).toString(16).padStart(2, '0')).join(''),
    a: a.a * (1 - t) + b.a * t,
  };
}

// Edit the active gradient in place, then push it to the selection.
function editGrad(fn, final = true) {
  const g = activeGrad();
  if (!g) return;
  fn(g);
  g.stops.sort((a, b) => a.o - b.o);
  styleChanged(state.active, final);
  renderGradEditor();
}

// Switch a paint between solid / linear / radial.
function setPaintKind(k, kind) {
  state.active = k;
  if (kind !== 'pattern') state[k + 'Pat'] = null;
  if (kind === 'solid') state[k + 'Grad'] = null;
  else if (kind === 'pattern') {
    state[k + 'Grad'] = null;
    state[k + 'Pat'] ||= { ...lib.patterns[0], scale: 1, angle: 0 };
    if (!state[k + 'Pat'].svg) state[k + 'Pat'] = null;
    state[k + 'On'] = true;
  } else {
    const cur = state[k + 'Grad'];
    state[k + 'Grad'] = cur
      ? { ...cloneGrad(cur), type: kind }
      : { type: kind, stops: GRAD_PRESETS.fade[1](state[k]), angle: 0 };
    state[k + 'On'] = true;
    state.gradStop = 0;
  }
  gradReset = true;
  styleChanged(k, true);
  gradReset = false;
}

function wireGradEditor() {
  for (const b of document.querySelectorAll('[data-kind]'))
    b.addEventListener('click', () =>
      setPaintKind(b.closest('[data-kind-for]').dataset.kindFor, b.dataset.kind),
    );
  for (const b of document.querySelectorAll('[data-gtype]'))
    b.addEventListener('click', () => {
      state.gradType = b.dataset.gtype;
      if (activeGrad()) setPaintKind(state.active, b.dataset.gtype);
      else renderGradEditor();
      for (const x of document.querySelectorAll('[data-gtype]'))
        x.setAttribute('aria-checked', x.dataset.gtype === state.gradType);
    });
  // Presets: Colour → Transparent and the Gradients library, as tiles.
  // Picking one swaps in its stops; the button shows the one in use.
  libPickers.gradients = libPicker($('#sc-grad-preset'), {
    label: 'Gradient',
    items: gradPresets,
    current: () => {
      const g = activeGrad();
      if (!g) return null;
      const key = stopsKey(g.stops);
      return (
        gradPresets().find((x) => stopsKey(x.stops) === key) || { id: '', name: 'Custom', ...g }
      );
    },
    thumb: libGradThumb,
    pick: (x) =>
      editGrad((g) => {
        g.stops = x.stops.map((s) => ({ ...s }));
        state.gradStop = 0;
      }),
    manage: () => showTab('gradients'),
    manageLabel: 'Manage in the Gradients panel',
  });
  $('#sc-grad-keep').addEventListener('change', (e) =>
    editGrad((g) => (g.stretch = !e.target.checked)),
  );
  $('#sc-grad-save').addEventListener('click', () => addLibItem('gradients'));
  $('#sc-grad-reverse').addEventListener('click', () =>
    editGrad((g) => {
      g.stops = g.stops.map((s) => ({ ...s, o: 1 - s.o })).reverse();
      state.gradStop = g.stops.length - 1 - state.gradStop;
    }),
  );
  const angle = $('#sc-grad-angle');
  const setAngle = (final) => {
    const v = parseFloat(angle.value);
    if (!isFinite(v)) return;
    gradReset = true;
    editGrad((g) => (g.angle = ((((v + 180) % 360) + 360) % 360) - 180), final);
    gradReset = false;
  };
  angle.addEventListener('input', () => setAngle(false));
  angle.addEventListener('change', () => setAngle(true));
  // Stop fields.
  const color = $('#sc-gstop-color');
  color.addEventListener('input', () =>
    editGrad((g) => (g.stops[state.gradStop].c = color.value), false),
  );
  color.addEventListener('change', () => editGrad(() => {}, true));
  const hx = $('#sc-gstop-hex');
  hx.addEventListener('change', () => {
    const v = hex(hx.value.trim().startsWith('#') ? hx.value.trim() : '#' + hx.value.trim());
    if (v && /^#[0-9a-f]{6}$/.test(v)) editGrad((g) => (g.stops[state.gradStop].c = v));
    else renderGradEditor();
  });
  for (const [id, key] of [
    ['#sc-gstop-a', 'a'],
    ['#sc-gstop-o', 'o'],
  ]) {
    const el = $(id);
    const apply = (final) => {
      const v = parseFloat(el.value);
      if (!isFinite(v)) return;
      editGrad((g) => {
        const s = g.stops[state.gradStop];
        s[key] = clamp(v / 100, 0, 1);
        if (key === 'o') {
          g.stops.sort((a, b) => a.o - b.o);
          state.gradStop = g.stops.indexOf(s);
        }
      }, final);
    };
    el.addEventListener('input', () => apply(false));
    el.addEventListener('change', () => apply(true));
  }
  for (const el of document.querySelectorAll('#sc-grad input[type="number"]'))
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        el.blur();
      }
    });
  $('#sc-gstop-del').addEventListener('click', () =>
    editGrad((g) => {
      if (g.stops.length > 2) g.stops.splice(state.gradStop, 1);
      state.gradStop = Math.max(0, state.gradStop - 1);
    }),
  );
  // The bar: click to add a stop; drag a stop along it, or off it to remove.
  const bar = $('#sc-grad-bar');
  const oAt = (e) => {
    const r = bar.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  };
  $('#sc-grad-track').addEventListener('pointerdown', (e) => {
    const g = activeGrad();
    if (!g) return;
    const mark = e.target.closest('.sc-gstop');
    if (!mark) {
      const s = gradAt(g, oAt(e));
      editGrad((gg) => {
        gg.stops.push(s);
        gg.stops.sort((a, b) => a.o - b.o);
        state.gradStop = gg.stops.indexOf(s);
      });
      return;
    }
    e.preventDefault();
    state.gradStop = +mark.dataset.i;
    const stop = g.stops[state.gradStop];
    renderGradEditor();
    const track = e.currentTarget;
    track.setPointerCapture(e.pointerId);
    let off = false;
    const move = (ev) => {
      const r = bar.getBoundingClientRect();
      off = g.stops.length > 2 && ev.clientY > r.bottom + 28;
      editGrad((gg) => {
        stop.o = oAt(ev);
        gg.stops.sort((a, b) => a.o - b.o);
        state.gradStop = gg.stops.indexOf(stop);
      }, false);
      track.querySelector('.sc-gstop.sel')?.classList.toggle('removing', off);
    };
    const up = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
      editGrad((gg) => {
        if (off) {
          gg.stops.splice(gg.stops.indexOf(stop), 1);
          state.gradStop = 0;
        }
      });
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  });
}

// The gradient's line and end handles over the first selected shape.
function drawGradAnnotator(z) {
  const el = gradTargets()[0];
  if (!el) return;
  const ge = document.getElementById(paintRef(el, state.active) || '');
  if (!ge || !ge.hasAttribute('data-sc-grad')) return;
  const M = fullM(el).multiply(gradSpace(el, ge.hasAttribute('data-stretch')).toLocal);
  const geo = geoOf(ge);
  const radial = ge.localName === 'radialGradient';
  const pt = (x, y) => new DOMPoint(x, y).matrixTransform(M);
  const A = radial ? pt(geo.cx, geo.cy) : pt(geo.x1, geo.y1);
  const B = radial ? pt(geo.cx + geo.r, geo.cy) : pt(geo.x2, geo.y2);
  if (radial) {
    const R = Math.hypot(B.x - A.x, B.y - A.y);
    mk('circle', { cx: A.x, cy: A.y, r: R, class: 'sc-ov sc-ov-dash' }, selLayer);
  }
  mk('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'sc-grad-line-bg' }, selLayer);
  mk('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'sc-ov' }, selLayer);
  for (const s of readGrad(ge)?.stops || []) {
    const x = A.x + (B.x - A.x) * s.o;
    const y = A.y + (B.y - A.y) * s.o;
    mk(
      'rect',
      {
        x: x - 3.5 / z,
        y: y - 3.5 / z,
        width: 7 / z,
        height: 7 / z,
        fill: s.c,
        class: 'sc-grad-mark',
      },
      selLayer,
    );
  }
  mk('circle', { cx: A.x, cy: A.y, r: 6 / z, class: 'sc-grad-h', 'data-grad-h': 'a' }, selLayer);
  mk(
    'circle',
    { cx: B.x, cy: B.y, r: 5 / z, class: 'sc-grad-h end', 'data-grad-h': 'b' },
    selLayer,
  );
}
