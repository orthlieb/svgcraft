// SVGCraft — Playing animations on the canvas, and Properties → Animate.
'use strict';

// ---- preview ---------------------------------------------------------------------
const animPlay = { playing: false, nodes: [], texts: [], undos: [] };
function playAnimations() {
  stopAnimations();
  const els = [...doc.querySelectorAll('[data-sc-anim]')];
  if (!els.length) return warn('Nothing is animated yet: add one in the Animation tab.');
  const letters = new Map();
  for (const el of els) {
    const list = readAnims(el);
    // The preview plays click and hover starts as if they'd happened.
    const times = animTimes(el, list);
    list.forEach((a, j) => {
      const start = times[j].t;
      if (ANIM_PRESETS[a.p].wrap) {
        const w = wrapLayer(el, el, a, true, start, (d) => defs.append(d));
        if (w) {
          animPlay.nodes.push(...w.nodes);
          animPlay.undos.push(w.undo);
        }
        return;
      }
      for (const { at: where, nodes } of animEmit(el, a, true, start)) {
        // Letters are split for the preview and put back when it stops.
        if (where?.letter != null && !letters.has(el)) animPlay.texts.push([el, el.innerHTML]);
        const host = animHost(el, where, letters);
        for (const n of nodes) {
          n.setAttribute('data-sc-preview', '');
          host?.append(n);
          animPlay.nodes.push(n);
        }
      }
    });
  }
  for (const n of animPlay.nodes) n.beginElementAt(+n.dataset.scBegin || 0);
  animPlay.playing = true;
  syncAnimUI();
}
// Back to the drawing at rest.
function stopAnimations() {
  if (!animPlay.playing) return;
  for (const n of animPlay.nodes) n.remove();
  for (const [el, html] of animPlay.texts) el.innerHTML = html;
  for (const undo of animPlay.undos.reverse()) undo();
  animPlay.nodes = [];
  animPlay.texts = [];
  animPlay.undos = [];
  animPlay.playing = false;
  syncAnimUI();
}
const toggleAnimations = () => (animPlay.playing ? stopAnimations() : playAnimations());
// Any click on the canvas, or Esc, stops it so editing sees the real shapes.
// A right-click doesn't: its menu offers Stop Animations (and anything in
// it that changes the drawing stops it anyway, as commit does).
stage.addEventListener('pointerdown', (e) => e.button !== 2 && stopAnimations(), true);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && animPlay.playing) {
      stopAnimations();
      e.stopPropagation();
    }
  },
  true,
);

// ---- Properties: the Animate section ----------------------------------------------
const animUI = { edit: 0 };
// The layer the tab animates: the one selected, or of a layer and a path
// above it (for Move along path), the layer.
function animPair() {
  const sel = normalizeSel(state.sel);
  return sel.length === 2 && routeFits(sel[0], sel[1]) ? { el: sel[0], route: sel[1] } : null;
}
const animTarget = () => (state.sel.length === 1 ? state.sel[0] : animPair()?.el || null);
function describeAnim(a, start) {
  const d = ANIM_PRESETS[a.p];
  const reps = a.rep === 0 ? '∞' : `×${a.rep}`;
  const later = a.delay ? ` + ${f(a.delay)} s` : '';
  const when = a.trigger
    ? `on ${a.trigger}${later}`
    : a.afterLayer
      ? `after ${layerName(document.getElementById(a.afterLayer) || doc)}${later}`
      : a.after
        ? `then at ${f(start)} s`
        : a.delay
          ? `at ${f(a.delay)} s`
          : '';
  return [d.name, `${f(a.dur)} s`, reps, when].filter(Boolean).join(' · ');
}
// Move the animation at `from` to index `to` of the list, keeping it the
// one being edited. The first one can't run after anything.
function moveAnim(from, to) {
  const n = animTarget() ? readAnims(animTarget()).length : 0;
  if (from === to || from >= n || to < 0 || to >= n) return;
  editAnims((l) => {
    l.splice(to, 0, ...l.splice(from, 1));
    delete l[0].after;
    animUI.edit = to;
  });
}
function syncAnimUI() {
  for (const n of document.querySelectorAll('[data-anim-origin]')) n.remove();
  for (const b of document.querySelectorAll('[data-action="toggleAnimations"]')) {
    if (b.getAttribute('role') === 'menuitemcheckbox')
      b.setAttribute('aria-checked', animPlay.playing);
    else if ('playIcon' in b.dataset) {
      // The phone's icon button.
      b.innerHTML = icon(animPlay.playing ? 'stop' : 'play');
      b.setAttribute('aria-label', animPlay.playing ? 'Stop' : 'Play animations');
      b.setAttribute('aria-pressed', animPlay.playing);
    } else {
      b.textContent = animPlay.playing ? '■ Stop' : '▶ Play';
      b.setAttribute('aria-pressed', animPlay.playing);
    }
  }
  const el = animTarget();
  $('#sc-anim-props').hidden = !el;
  $('#sc-anim-none').hidden = !!el;
  if (!el) return;
  const pair = animPair();
  $('#sc-anim-pair').hidden = !pair;
  if (pair)
    $('#sc-anim-pair').textContent =
      `Animating “${layerName(pair.el)}”. Add Move along path to send it along “${layerName(pair.route)}”, or Morph to turn it into that shape.`;
  const list = readAnims(el);
  const at = animStarts(list);
  animUI.edit = clamp(animUI.edit, 0, Math.max(0, list.length - 1));
  const ul = $('#sc-anim-list');
  ul.replaceChildren(
    ...list.map((a, i) => {
      const li = document.createElement('li');
      li.className = 'sc-anim-item' + (i === animUI.edit ? ' sel' : '');
      li.classList.toggle('after', !!a.after);
      const grip = document.createElement('span');
      grip.className = 'sc-anim-grip';
      grip.textContent = '⠿';
      grip.dataset.tip = 'Drag to reorder (or Alt+↑ / Alt+↓)';
      grip.addEventListener('pointerdown', (e) => dragAnim(e, i));
      const name = document.createElement('button');
      name.className = 'sc-anim-name';
      name.textContent = describeAnim(a, at[i]);
      name.setAttribute('aria-pressed', i === animUI.edit);
      name.addEventListener('click', () => {
        animUI.edit = i;
        syncAnimUI();
      });
      name.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        e.stopPropagation();
        moveAnim(i, i + (e.key === 'ArrowUp' ? -1 : 1));
        $('#sc-anim-list .sel .sc-anim-name')?.focus();
      });
      const x = document.createElement('button');
      x.className = 'sc-ibtn sc-anim-x';
      x.innerHTML = icon('xmark');
      x.setAttribute('aria-label', `Remove ${ANIM_PRESETS[a.p].name}`);
      x.dataset.tip = 'Remove this animation';
      x.addEventListener('click', () => editAnims((l) => l.splice(i, 1)));
      li.append(grip, name, x);
      return li;
    }),
  );
  ul.hidden = !list.length;
  const box = $('#sc-anim-edit');
  box.hidden = !list.length;
  if (!list.length) return;
  const a = list[animUI.edit];
  const set = (sel, v) => {
    const inp = box.querySelector(sel);
    if (document.activeElement !== inp) {
      if (inp.type === 'checkbox') inp.checked = v;
      else inp.value = v;
    }
  };
  set('[data-anim="dur"]', f(a.dur));
  set('[data-anim="delay"]', f(a.delay));
  set('[data-anim="forever"]', a.rep === 0);
  set('[data-anim="rep"]', a.rep || 1);
  box.querySelector('[data-anim="rep"]').disabled = a.rep === 0;
  set('[data-anim="dir"]', a.dir);
  set('[data-anim="ease"]', a.ease);
  set('[data-anim="after"]', !!a.after);
  box.querySelector('[data-anim="after"]').disabled = animUI.edit === 0;
  // Preset options.
  const opts = $('#sc-anim-opts');
  const field = (label, input) => {
    const l = document.createElement('label');
    l.className = 'sc-field';
    l.append(label, input);
    return l;
  };
  const number = (k, unit, step = 1) => {
    const i = document.createElement('input');
    i.type = 'number';
    i.step = step;
    i.dataset.animOpt = k;
    i.value = f(a[k]);
    const u = document.createElement('span');
    u.className = 'sc-unit';
    u.textContent = unit;
    const w = document.createElement('span');
    w.append(i, u);
    return w;
  };
  const kids = [];
  if ('from' in a) {
    const s = document.createElement('select');
    s.dataset.animOpt = 'from';
    for (const v of ANIM_OPTS.from)
      s.append(
        Object.assign(document.createElement('option'), {
          value: v,
          textContent: v[0].toUpperCase() + v.slice(1),
        }),
      );
    s.value = a.from;
    kids.push(field(a.p === 'slideOut' ? 'To ' : 'From ', s));
  }
  if ('dist' in a) kids.push(field('Distance ', number('dist', 'px')));
  if ('turns' in a) kids.push(field('Turns ', number('turns', '(− = anticlockwise)', 0.25)));
  if ('scale' in a) kids.push(field('Grow to ', number('scale', '%')));
  if ('angle' in a) kids.push(field('Angle ', number('angle', '°')));
  if ('size' in a)
    kids.push(
      field(
        { blurIn: 'Blur ', ripple: 'Ring width ', patternScroll: 'Stripe width ' }[a.p] ||
          'Glow size ',
        number('size', 'px'),
      ),
    );
  const choose = (k, label, names) => {
    const s = document.createElement('select');
    s.dataset.animOpt = k;
    for (const v of ANIM_OPTS[k])
      s.append(
        Object.assign(document.createElement('option'), { value: v, textContent: names[v] }),
      );
    s.value = a[k];
    kids.push(field(label, s));
  };
  if ('pivot' in a) {
    choose('pivot', 'Swing from ', {
      centre: 'Centre',
      top: 'Top',
      bottom: 'Bottom',
      left: 'Left',
      right: 'Right',
    });
    // A pivot dragged elsewhere is none of those.
    if (a.origin) {
      const s = kids.at(-1).querySelector('select');
      s.append(
        Object.assign(document.createElement('option'), { value: 'custom', textContent: 'Custom' }),
      );
      s.value = 'custom';
    }
  }
  if (PIVOT_PRESETS.has(a.p)) {
    // Where it turns or grows about: across and down its box, in %; the ⊕
    // on the canvas drags it.
    const [ox, oy] = animOrigin(a);
    const pct = (k, v, label) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = 5;
      i.dataset.animOpt = k;
      i.value = f(v * 100);
      i.setAttribute('aria-label', label);
      return i;
    };
    const w = document.createElement('span');
    w.className = 'sc-anim-pivot';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'sc-ibtn';
    reset.innerHTML = icon('rotate-left');
    reset.setAttribute('aria-label', 'Reset the pivot');
    reset.dataset.tip = 'Back to the centre (or double-click the ⊕)';
    reset.disabled = !a.origin;
    reset.addEventListener('click', () => editAnims((l) => delete l[animUI.edit]?.origin));
    w.append(
      pct('originX', ox, 'Pivot across, %'),
      ' ',
      pct('originY', oy, 'Pivot down, %'),
      Object.assign(document.createElement('span'), { className: 'sc-unit', textContent: '%' }),
      reset,
    );
    kids.push(field('Pivot ', w));
  }
  if ('axis' in a)
    choose('axis', 'Turn ', { vertical: 'Side to side', horizontal: 'Top over bottom' });
  // Stagger: a group's layers, or a text's letters, one after another.
  const def = ANIM_PRESETS[a.p];
  if (
    (el.localName === 'g' && a.p !== 'flipbook' && !def.wrap) ||
    (el.localName === 'text' && LETTER_PRESETS.has(a.p))
  ) {
    const w = number(
      'stagger',
      el.localName === 'g' ? 's between objects' : 's between letters',
      0.05,
    );
    w.querySelector('input').value = f(a.stagger || 0);
    w.querySelector('input').min = 0;
    kids.push(field('Stagger ', w));
  }
  if ('to' in a) {
    const c = document.createElement('input');
    c.type = 'color';
    c.dataset.animOpt = 'to';
    c.value = a.to;
    kids.push(
      field(
        {
          glowPulse: 'Glow colour ',
          ripple: 'Ring colour ',
          gradientFlow: 'Second colour ',
          patternScroll: 'Stripe colour ',
        }[a.p] || 'To colour ',
        c,
      ),
    );
  }
  if ('path' in a) {
    // Every outline it could follow, by name.
    const s = document.createElement('select');
    s.dataset.animOpt = 'path';
    const route = motionRoute(el, a);
    if (!route)
      s.append(
        Object.assign(document.createElement('option'), { value: '', textContent: '— gone —' }),
      );
    [...doc.querySelectorAll('*')]
      .filter((r) => routeFits(el, r) && !r.parentNode.closest('text, clipPath, mask'))
      .forEach((r, i) =>
        s.append(
          Object.assign(document.createElement('option'), {
            value: r.id || `@${i}`,
            textContent: layerName(r),
            selected: r === route,
          }),
        ),
      );
    kids.push(field(a.p === 'morph' ? 'Into ' : 'Path ', s));
  }
  for (const [k, label] of [
    ['orient', 'Orient to path'],
    ['hide', a.p === 'morph' ? 'Hide that shape when saved' : 'Hide the path when saved'],
  ])
    if (k in a) {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.dataset.animOpt = k;
      c.checked = a[k];
      const l = document.createElement('label');
      l.className = 'sc-check';
      l.append(c, ` ${label}`);
      kids.push(l);
    }
  const focused = document.activeElement?.dataset?.animOpt;
  if (!focused) {
    opts.replaceChildren(...kids);
    $('#sc-anim-timing').replaceChildren(...timingFields(el, a, field));
  }
  if (
    PIVOT_PRESETS.has(a.p) &&
    state.tool === 'select' &&
    !animPlay.playing &&
    $('#sc-anim-props').checkVisibility?.()
  )
    markPivot(pivotAt(el, animOrigin(a)));
}
// The pivot (fractions of el's box) in the drawing's space.
function pivotAt(el, [fx, fy]) {
  const b = el.getBBox();
  return new DOMPoint(b.x + fx * b.width, b.y + fy * b.height).matrixTransform(fullM(el));
}
// The pivot's ⊕ on the canvas, at p, for dragging (see tools.select).
function markPivot(p) {
  for (const n of document.querySelectorAll('[data-anim-origin]')) n.remove();
  const z = state.zoom;
  const r = 7 / z;
  const g = mk('g', { class: 'sc-pivot', 'data-anim-origin': '' }, selLayer);
  mk('circle', { cx: p.x, cy: p.y, r }, g);
  mk(
    'path',
    { d: `M${p.x - r * 1.6} ${p.y}H${p.x + r * 1.6}M${p.x} ${p.y - r * 1.6}V${p.y + r * 1.6}` },
    g,
  );
}
// Drag the pivot to doc point p (snapping to the box's corners, edge
// middles and centre within a few pixels): its new place, as fractions.
function pivotFrom(el, p) {
  const b = el.getBBox();
  const M = fullM(el);
  const q = new DOMPoint(p.x, p.y).matrixTransform(M.inverse());
  let fx = (q.x - b.x) / (b.width || 1);
  let fy = (q.y - b.y) / (b.height || 1);
  const reach = 8 / state.zoom;
  for (const sx of [0, 0.5, 1])
    for (const sy of [0, 0.5, 1]) {
      const s = pivotAt(el, [sx, sy]);
      if (Math.hypot(s.x - p.x, s.y - p.y) < reach) [fx, fy] = [sx, sy];
    }
  return [fx, fy].map((v) => Math.round(clamp(v, -100, 100) * 1e4) / 1e4);
}
// Set the edited animation's pivot (null: back to its default).
function setPivot(origin) {
  editAnims((l) => {
    const a = l[animUI.edit];
    if (!a) return;
    const [dx, dy] = PIVOT_AT[a.pivot] || PIVOT_AT.centre;
    if (!origin || Math.hypot(origin[0] - dx, origin[1] - dy) < 1e-4) delete a.origin;
    else a.origin = origin;
  });
}
// Switching panel tabs shows or hides the ⊕ with the Animation tab.
for (const t of document.querySelectorAll('[data-tab]'))
  t.addEventListener('click', () => setTimeout(syncAnimUI));
// Layers that can be picked by name (a click's target, the one to start
// after): every layer of the drawing, in order, each as its id or "@n".
const pickable = () =>
  [...doc.querySelectorAll('*')].filter(
    (n) => selectable(n) && !n.parentNode.closest('text, clipPath, mask'),
  );
function pickOptions(list, current, first) {
  const s = document.createElement('select');
  if (first)
    s.append(Object.assign(document.createElement('option'), { value: '', textContent: first }));
  list.forEach((n, i) =>
    s.append(
      Object.assign(document.createElement('option'), {
        value: n.id || `@${i}`,
        textContent: layerName(n),
        selected: !!current && n.id === current,
      }),
    ),
  );
  return s;
}
// Start (on click, on hover, after another layer) and Pause between runs.
function timingFields(el, a, field) {
  const out = [];
  const start = document.createElement('select');
  start.dataset.animOpt = 'trigger';
  for (const [v, t] of [
    ['', a.after ? 'After the one above' : 'When the file opens'],
    ['click', 'On click'],
    ['hover', 'On hover'],
    ['afterLayer', 'After another object'],
  ])
    start.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
  start.value = a.trigger || (a.afterLayer ? 'afterLayer' : '');
  out.push(field('Start ', start));
  const layers = pickable();
  if (a.trigger) {
    const on = pickOptions(
      layers.filter((n) => n !== el),
      a.on,
      'This object',
    );
    on.dataset.animOpt = 'on';
    out.push(field(a.trigger === 'click' ? 'Clicking ' : 'Pointing at ', on));
  } else if (a.afterLayer) {
    const after = pickOptions(
      layers.filter((n) => n !== el && n.hasAttribute('data-sc-anim')),
      a.afterLayer,
    );
    after.dataset.animOpt = 'afterLayer';
    out.push(field('After ', after));
  }
  const p = document.createElement('input');
  p.type = 'number';
  p.min = 0;
  p.step = 0.1;
  p.dataset.animOpt = 'pause';
  p.value = f(a.pause || 0);
  const u = document.createElement('span');
  u.className = 'sc-unit';
  u.textContent = 's between runs';
  const w = document.createElement('span');
  w.append(p, u);
  out.push(field('Pause ', w));
  return out;
}
// The layer an "@n" or id option names (it gets an id now it's pointed at).
function pickedLayer(value, list) {
  const m = /^@(\d+)$/.exec(value);
  const n = m ? list[+m[1]] : document.getElementById(value);
  return n ? ensureId(n, 'layer') : null;
}

// Dragging an animation's grip up or down the list; a line shows where it
// will land.
function dragAnim(e, from) {
  if (e.button !== 0) return;
  e.preventDefault();
  const ul = $('#sc-anim-list');
  const rows = [...ul.children];
  let to = from;
  const mark = (y) => {
    // The slot the pointer is nearest: before row k means index k.
    let slot = rows.length;
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        slot = k;
        break;
      }
    }
    to = slot > from ? slot - 1 : slot;
    rows.forEach((r, k) => {
      r.classList.toggle('drop-above', to !== from && k === slot && slot <= rows.length - 1);
      r.classList.toggle(
        'drop-below',
        to !== from && slot === rows.length && k === rows.length - 1,
      );
    });
  };
  rows[from].classList.add('dragging');
  const move = (ev) => mark(ev.clientY);
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    for (const r of rows) r.classList.remove('dragging', 'drop-above', 'drop-below');
    if (to !== from) moveAnim(from, to);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

// Change the selected layer's animations and record it; false if it can't.
function editAnims(fn) {
  const el = animTarget();
  if (!el || refuseLocked([el], 'edit')) return false;
  stopAnimations();
  const list = readAnims(el);
  fn(list);
  writeAnims(el, list);
  commit();
  renderLayers();
  syncAnimUI();
  return true;
}
// An id for a layer that's pointed at (a path to move along).
function ensureId(el, stem) {
  if (!el.id) {
    let n = 1;
    while (document.getElementById(`${stem}-${n}`)) n++;
    el.id = `${stem}-${n}`;
  }
  return el.id;
}
function addAnimation(p) {
  const el = animTarget();
  if (!el || !ANIM_PRESETS[p]) return;
  const def = ANIM_PRESETS[p];
  const a = { p, dur: def.dur, delay: 0, rep: def.rep, dir: def.dir || 'normal', ease: def.ease };
  for (const k of [
    'from',
    'dist',
    'turns',
    'scale',
    'to',
    'orient',
    'hide',
    'angle',
    'pivot',
    'axis',
    'size',
  ])
    if (k in def) a[k] = def[k];
  const pair = animPair();
  if (p === 'followPath' && pair) a.path = ensureId(pair.route, 'motion-path');
  if (p === 'morph' && pair) a.path = ensureId(pair.route, 'morph-to');
  let target = el;
  // A rectangle, circle… becomes a path, which can change its outline.
  if (p === 'morph' && pair && el.localName !== 'path' && ROUTE_SHAPES.has(el.localName)) {
    if (refuseLocked([el], 'edit')) return;
    const d = nodesD(shapeNodes(el));
    target = toPath(el);
    target.removeAttribute('data-rect');
    target.removeAttribute('data-radii');
    target.setAttribute('d', d);
    state.sel = state.sel.map((x) => (x === el ? target : x));
  }
  const why = animUnfit(target, p, a);
  if (why) return warn(why);
  const done = editAnims((l) => {
    l.push(a);
    animUI.edit = l.length - 1;
  });
  if (!done) return;
  // The layer it animates, on its own, so the tab carries on with it.
  if (pair) setSel([target]);
  say(`Added ${def.name}. Press ▶ Play to see it.`);
}

function wireAnimations() {
  const add = $('#sc-anim-add');
  for (const group of ['Entrances', 'Exits', 'Loops', 'Motion', 'Line', 'Colour', 'Text']) {
    const g = document.createElement('optgroup');
    g.label = group;
    for (const [k, d] of Object.entries(ANIM_PRESETS))
      if (d.group === group)
        g.append(
          Object.assign(document.createElement('option'), { value: k, textContent: d.name }),
        );
    add.append(g);
  }
  add.addEventListener('change', () => {
    addAnimation(add.value);
    add.value = '';
  });
  const box = $('#sc-anim-edit');
  box.addEventListener('change', (e) => {
    const t = e.target;
    const k = t.dataset.anim || t.dataset.animOpt;
    if (!k) return;
    editAnims((l) => {
      const a = l[animUI.edit];
      if (!a) return;
      if (k === 'forever')
        a.rep = t.checked ? 0 : Math.max(1, +box.querySelector('[data-anim="rep"]').value || 1);
      else if (k === 'after') {
        if (t.checked) a.after = true;
        else delete a.after;
      } else if (k === 'rep') a.rep = Math.max(1, Math.round(+t.value) || 1);
      else if (k === 'stagger') {
        if (+t.value > 0) a.stagger = +t.value;
        else delete a.stagger;
      } else if (['dur', 'delay', 'dist', 'turns', 'scale', 'angle', 'size'].includes(k))
        a[k] = +t.value;
      else if (k === 'orient' || k === 'hide') a[k] = t.checked;
      else if (k === 'originX' || k === 'originY') {
        const o = [...animOrigin(a)];
        if (isFinite(+t.value) && t.value !== '') o[k === 'originX' ? 0 : 1] = +t.value / 100;
        a.origin = o.map((v) => Math.round(clamp(v, -100, 100) * 1e4) / 1e4);
      } else if (k === 'pivot') {
        if (t.value === 'custom') a.origin = [...animOrigin(a)];
        else {
          a.pivot = t.value;
          delete a.origin;
        }
      } else if (k === 'trigger') {
        delete a.trigger;
        delete a.on;
        delete a.afterLayer;
        const el = animTarget();
        if (t.value === 'click' || t.value === 'hover') {
          a.trigger = t.value;
          // The layer clicked needs an id for the file to name it.
          ensureId(el, 'layer');
        } else if (t.value === 'afterLayer') {
          const first = pickable().find((n) => n !== el && n.hasAttribute('data-sc-anim'));
          if (first) a.afterLayer = ensureId(first, 'layer');
          else warn('Start after another object needs another animated object.');
        }
      } else if (k === 'on') {
        const el = animTarget();
        const id =
          t.value &&
          pickedLayer(
            t.value,
            pickable().filter((n) => n !== el),
          );
        if (id) a.on = id;
        else delete a.on;
      } else if (k === 'afterLayer') {
        const el = animTarget();
        const id = pickedLayer(
          t.value,
          pickable().filter((n) => n !== el && n.hasAttribute('data-sc-anim')),
        );
        if (id) a.afterLayer = id;
      } else if (k === 'pause') {
        if (+t.value > 0) a.pause = +t.value;
        else delete a.pause;
      } else if (k === 'path') {
        // A layer without an id gets one now it's pointed at.
        const m = /^@(\d+)$/.exec(t.value);
        const el = animTarget();
        const r = m
          ? [...doc.querySelectorAll('*')].filter(
              (n) => routeFits(el, n) && !n.parentNode.closest('text, clipPath, mask'),
            )[+m[1]]
          : document.getElementById(t.value);
        if (r) a.path = ensureId(r, 'motion-path');
      } else a[k] = t.value;
    });
  });
  syncAnimUI();
}
wireAnimations();
