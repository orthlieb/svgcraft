// SVGCraft — Animations: presets on a layer, written as SMIL when saved.
'use strict';

// A layer's animations are kept as JSON in data-sc-anim, like its effects:
// [{ p: preset, dur, delay, rep (0 = forever), dir, ease, after?, …preset
// options }]. They all start together, each after its own delay, unless
// `after` chains one to the end of the one above it in the list; the list's
// order is also the order their movements combine in.
// The SMIL that plays them (<animate>, <animateTransform>, <set>) is only
// generated when the drawing is saved or previewed, never kept in the live
// drawing, so editing, undo and the Layers panel never see it. Transforms
// are additive, so a layer spins and scales about its own centre on top of
// its transform; SMIL plays wherever SVG does, <img> included.
const ANIM_KEY_TAGS = ['animate', 'animateTransform', 'animateMotion', 'set'];
for (const t of ANIM_KEY_TAGS) NON_GRAPHIC.add(t);

const ANIM_PRESETS = {
  fadeIn: { name: 'Fade in', group: 'Entrances', dur: 0.6, rep: 1, ease: 'out', enter: true },
  slideIn: {
    name: 'Slide in',
    group: 'Entrances',
    dur: 0.6,
    rep: 1,
    ease: 'out',
    enter: true,
    from: 'left',
    dist: 40,
  },
  popIn: { name: 'Pop in', group: 'Entrances', dur: 0.5, rep: 1, ease: 'out', enter: true },
  zoomIn: { name: 'Zoom in', group: 'Entrances', dur: 0.6, rep: 1, ease: 'out', enter: true },
  fadeOut: { name: 'Fade out', group: 'Exits', dur: 0.6, rep: 1, ease: 'in', exit: true },
  slideOut: {
    name: 'Slide out',
    group: 'Exits',
    dur: 0.6,
    rep: 1,
    ease: 'in',
    exit: true,
    from: 'right',
    dist: 40,
  },
  zoomOut: { name: 'Zoom out', group: 'Exits', dur: 0.6, rep: 1, ease: 'in', exit: true },
  spin: { name: 'Spin', group: 'Loops', dur: 1.2, rep: 0, ease: 'linear', turns: 1 },
  pulse: { name: 'Pulse', group: 'Loops', dur: 1, rep: 0, ease: 'inout', scale: 115 },
  bounce: { name: 'Bounce', group: 'Loops', dur: 1, rep: 0, ease: 'inout', dist: 12 },
  shake: { name: 'Shake', group: 'Loops', dur: 0.5, rep: 1, ease: 'linear', dist: 6 },
  float: {
    name: 'Float',
    group: 'Loops',
    dur: 2,
    rep: 0,
    ease: 'inout',
    dir: 'alternate',
    dist: 6,
  },
  blink: { name: 'Blink', group: 'Loops', dur: 1, rep: 0, ease: 'linear' },
  drawOn: {
    name: 'Draw on',
    group: 'Line',
    dur: 1.5,
    rep: 1,
    ease: 'inout',
    enter: true,
    line: true,
  },
  drawOff: {
    name: 'Draw off',
    group: 'Line',
    dur: 1.5,
    rep: 1,
    ease: 'inout',
    exit: true,
    line: true,
  },
  dashMarch: { name: 'Dash march', group: 'Line', dur: 1, rep: 0, ease: 'linear' },
  colourCycle: {
    name: 'Colour cycle',
    group: 'Colour',
    dur: 2,
    rep: 0,
    ease: 'inout',
    dir: 'alternate',
    to: '#dc2626',
  },
};
// Preset options and their limits.
const ANIM_OPTS = {
  from: ['left', 'right', 'top', 'bottom'],
  dist: [0, 10000],
  turns: [-100, 100],
  scale: [1, 1000],
};
const EASES = {
  linear: ['Linear', null],
  ease: ['Ease', '0.25 0.1 0.25 1'],
  in: ['Ease in', '0.42 0 1 1'],
  out: ['Ease out', '0 0 0.58 1'],
  inout: ['Ease in-out', '0.42 0 0.58 1'],
};
const DIRS = { normal: 'Normal', reverse: 'Reverse', alternate: 'Back and forth' };

// A layer's animations, every field checked (the attribute comes from files).
function readAnims(el) {
  let raw = [];
  try {
    raw = JSON.parse(el.getAttribute('data-sc-anim') || '[]');
  } catch {
    /* unreadable: no animations */
  }
  const out = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 20) : []) {
    const def = r && ANIM_PRESETS[r.p];
    if (!def) continue;
    const num = (v, lo, hi, d) => (v != null && isFinite(+v) ? clamp(+v, lo, hi) : d);
    const a = {
      p: r.p,
      dur: num(r.dur, 0.05, 600, def.dur),
      delay: num(r.delay, 0, 600, 0),
      rep: Math.round(num(r.rep, 0, 1000, def.rep)),
      dir: DIRS[r.dir] ? r.dir : def.dir || 'normal',
      ease: EASES[r.ease] ? r.ease : def.ease,
    };
    if (r.after === true && out.length) a.after = true;
    if ('from' in def) a.from = ANIM_OPTS.from.includes(r.from) ? r.from : def.from;
    for (const k of ['dist', 'turns', 'scale'])
      if (k in def) a[k] = num(r[k], ...ANIM_OPTS[k], def[k]);
    if ('to' in def) a.to = /^#[0-9a-f]{6}$/i.test(r.to || '') ? r.to.toLowerCase() : def.to;
    out.push(a);
  }
  return out;
}
function writeAnims(el, list) {
  if (list.length) el.setAttribute('data-sc-anim', JSON.stringify(list));
  else el.removeAttribute('data-sc-anim');
}
const animated = (el) => readAnims(el).length > 0;

// How long one animation runs, in seconds (one run when it loops forever).
const animLength = (a) => a.dur * (a.dir === 'alternate' ? 2 : 1) * (a.rep || 1);
// When each of a layer's animations starts: its delay, counted from the end
// of the one above when it runs after it (from the end of that one's first
// run when that one loops forever).
function animStarts(list) {
  const at = [];
  list.forEach((a, i) => {
    at.push(a.after && i ? at[i - 1] + animLength(list[i - 1]) + a.delay : a.delay);
  });
  return at;
}

// ---- SMIL ------------------------------------------------------------------------
// What an animation changes, as channels: { tag, attrs, values, keyTimes?,
// discrete?, at0? }. Values and keyTimes are for one forward run.
function animChannels(el, a) {
  const b = el.getBBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const o = el.hasAttribute('opacity') ? +el.getAttribute('opacity') || 0 : 1;
  // Animations work in the layer's own units: distances are given on screen.
  const m = fullM(el);
  const k = Math.hypot(m.a, m.b) || 1;
  const d = (a.dist ?? 0) / k;
  const op = (values, keyTimes) => ({
    tag: 'animate',
    attrs: { attributeName: 'opacity' },
    values: values.map((v) => f(v * o)),
    keyTimes,
  });
  const move = (pairs, keyTimes) => ({
    tag: 'animateTransform',
    attrs: { attributeName: 'transform', type: 'translate', additive: 'sum' },
    values: pairs.map(([x, y]) => `${f(x)} ${f(y)}`),
    keyTimes,
  });
  // Scale about the centre: a translate that keeps the centre still, then
  // the scale (both additive, so applied in that order on top of the layer's).
  const grow = (scales, keyTimes) => [
    move(
      scales.map((s) => [cx * (1 - s), cy * (1 - s)]),
      keyTimes,
    ),
    {
      tag: 'animateTransform',
      attrs: { attributeName: 'transform', type: 'scale', additive: 'sum' },
      values: scales.map((s) => f(s)),
      keyTimes,
    },
  ];
  const side = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[a.from] || [0, 0];
  const len = () => (typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0);
  switch (a.p) {
    case 'fadeIn':
      return [op([0, 1])];
    case 'fadeOut':
      return [op([1, 0])];
    case 'slideIn':
      return [
        move([
          [side[0] * d, side[1] * d],
          [0, 0],
        ]),
        op([0, 1]),
      ];
    case 'slideOut':
      return [
        move([
          [0, 0],
          [side[0] * d, side[1] * d],
        ]),
        op([1, 0]),
      ];
    case 'popIn':
      return [...grow([0, 1.1, 1], [0, 0.7, 1]), op([0, 1, 1], [0, 0.4, 1])];
    case 'zoomIn':
      return [...grow([0.3, 1]), op([0, 1])];
    case 'zoomOut':
      return [...grow([1, 0.3]), op([1, 0])];
    case 'spin':
      return [
        {
          tag: 'animateTransform',
          attrs: { attributeName: 'transform', type: 'rotate', additive: 'sum' },
          values: [`0 ${f(cx)} ${f(cy)}`, `${f(360 * a.turns)} ${f(cx)} ${f(cy)}`],
        },
      ];
    case 'pulse':
      return grow([1, a.scale / 100, 1]);
    case 'bounce':
      return [
        move(
          [
            [0, 0],
            [0, -d],
            [0, 0],
            [0, -d * 0.4],
            [0, 0],
          ],
          [0, 0.3, 0.6, 0.8, 1],
        ),
      ];
    case 'shake':
      return [
        move([
          [0, 0],
          [-d, 0],
          [d, 0],
          [-d, 0],
          [d, 0],
          [0, 0],
        ]),
      ];
    case 'float':
      return [
        move([
          [0, 0],
          [0, -d],
        ]),
      ];
    case 'blink':
      return [{ ...op([1, 0, 1], [0, 0.5, 1]), discrete: true }];
    case 'drawOn':
    case 'drawOff': {
      const L = f(len());
      const dash = {
        tag: 'set',
        attrs: { attributeName: 'stroke-dasharray', to: `${L} ${L}` },
        at0: true,
      };
      const values = a.p === 'drawOn' ? [L, 0] : [0, L];
      return [
        dash,
        ...(a.p === 'drawOn'
          ? [{ tag: 'set', attrs: { attributeName: 'stroke-dashoffset', to: `${L}` }, at0: true }]
          : []),
        {
          tag: 'animate',
          attrs: { attributeName: 'stroke-dashoffset' },
          values: values.map(String),
        },
      ];
    }
    case 'dashMarch': {
      const cs = getComputedStyle(el);
      let dashes =
        cs.strokeDasharray === 'none' ? [] : cs.strokeDasharray.split(/[\s,]+/).map(parseFloat);
      const out = [];
      if (!dashes.filter((x) => x > 0).length) {
        const w = parseFloat(cs.strokeWidth) || 1;
        dashes = [3 * w, 2 * w];
        out.push({
          tag: 'set',
          attrs: { attributeName: 'stroke-dasharray', to: dashes.map(f).join(' ') },
          at0: true,
        });
      }
      const period = dashes.reduce((s, x) => s + x, 0) * (dashes.length % 2 ? 2 : 1);
      out.push({
        tag: 'animate',
        attrs: { attributeName: 'stroke-dashoffset' },
        values: ['0', f(-period)],
      });
      return out;
    }
    case 'colourCycle': {
      const from = hex(getComputedStyle(el).fill) || '#000000';
      return [{ tag: 'animate', attrs: { attributeName: 'fill' }, values: [from, a.to] }];
    }
  }
  return [];
}

// Why a preset can't go on a layer, or ''.
function animUnfit(el, p) {
  const def = ANIM_PRESETS[p];
  if (def.line || p === 'dashMarch') {
    if (typeof el.getTotalLength !== 'function') return `${def.name} needs a path or shape.`;
    if (getComputedStyle(el).stroke === 'none') return `${def.name} needs a stroke.`;
  }
  // A group's own fill only reaches shapes that don't set one.
  if (p === 'colourCycle' && (el.localName === 'g' || !hex(getComputedStyle(el).fill || '')))
    return 'Colour cycle needs a shape with a solid fill.';
  return '';
}

// The SMIL elements for one animation. `preview` makes them wait for
// beginElementAt() (the editor's timeline started when the page loaded);
// each node remembers its start in seconds.
function animNodes(el, a, preview = false, start = a.delay) {
  const def = ANIM_PRESETS[a.p];
  if (animUnfit(el, a.p)) return [];
  const spline = EASES[a.ease][1];
  const forever = a.rep === 0;
  // Entrances and exits hold their last frame; loops go back to rest.
  const hold = (def.enter || def.exit || def.line) && !forever;
  const nodes = [];
  for (const ch of animChannels(el, a)) {
    const attrs = { ...ch.attrs };
    const begin = ch.at0 ? 0 : start;
    if (ch.tag === 'set') {
      if (!ch.at0) continue;
    } else {
      let values = ch.values;
      let kt = ch.keyTimes || values.map((_, i) => i / (values.length - 1));
      let dur = a.dur;
      if (a.dir === 'reverse') {
        values = [...values].reverse();
        kt = kt.map((t) => 1 - t).reverse();
      } else if (a.dir === 'alternate') {
        values = [...values, ...[...values].reverse().slice(1)];
        kt = [
          ...kt.map((t) => t / 2),
          ...kt
            .map((t) => 1 - t / 2)
            .reverse()
            .slice(1),
        ];
        dur *= 2;
      }
      attrs.values = values.join(';');
      attrs.dur = `${f(dur)}s`;
      attrs.repeatCount = forever ? 'indefinite' : String(a.rep);
      if (ch.discrete) {
        attrs.calcMode = 'discrete';
        attrs.keyTimes = kt.map(f).join(';');
      } else if (spline) {
        attrs.calcMode = 'spline';
        attrs.keyTimes = kt.map(f).join(';');
        attrs.keySplines = Array(values.length - 1)
          .fill(spline)
          .join(';');
      } else if (ch.keyTimes || a.dir === 'alternate') attrs.keyTimes = kt.map(f).join(';');
      if (hold) attrs.fill = 'freeze';
    }
    attrs.begin = preview ? 'indefinite' : `${f(begin)}s`;
    const n = mk(ch.tag, attrs);
    n.dataset.scBegin = begin;
    nodes.push(n);
  }
  // An entrance waiting for its delay starts hidden, not shown then hidden.
  if (def.enter && start > 0 && !def.line) {
    const n = mk('set', {
      attributeName: 'opacity',
      to: '0',
      begin: preview ? 'indefinite' : '0s',
    });
    n.dataset.scBegin = 0;
    nodes.unshift(n);
  }
  return nodes;
}

// Saving: each animated layer's copy gets its SMIL. `live` is the layer in
// the drawing (for its geometry), `copy` the clone being written out.
function writeAnimations(live, copy, on) {
  for (const n of copy.querySelectorAll('[data-sc-preview]')) n.remove();
  if (!on) return;
  const pick = (root) =>
    [root, ...root.querySelectorAll('[data-sc-anim]')].filter((e) =>
      e.hasAttribute?.('data-sc-anim'),
    );
  const lives = pick(live);
  const copies = pick(copy);
  lives.forEach((el, i) => {
    const list = readAnims(el);
    const at = animStarts(list);
    list.forEach((a, j) => {
      for (const n of animNodes(el, a, false, at[j])) {
        delete n.dataset.scBegin;
        copies[i]?.append(n);
      }
    });
  });
}

// ---- preview ---------------------------------------------------------------------
const animPlay = { playing: false, nodes: [] };
function playAnimations() {
  stopAnimations();
  const els = [...doc.querySelectorAll('[data-sc-anim]')];
  if (!els.length) return say('Nothing is animated yet: add an animation under Properties.');
  for (const el of els) {
    const list = readAnims(el);
    const at = animStarts(list);
    list.forEach((a, j) => {
      for (const n of animNodes(el, a, true, at[j])) {
        n.setAttribute('data-sc-preview', '');
        el.append(n);
        animPlay.nodes.push(n);
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
  animPlay.nodes = [];
  animPlay.playing = false;
  syncAnimUI();
}
const toggleAnimations = () => (animPlay.playing ? stopAnimations() : playAnimations());
// Any click on the canvas, or Esc, stops it so editing sees the real shapes.
stage.addEventListener('pointerdown', stopAnimations, true);
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
const animTarget = () => (state.sel.length === 1 ? state.sel[0] : null);
function describeAnim(a, start) {
  const d = ANIM_PRESETS[a.p];
  const reps = a.rep === 0 ? '∞' : `×${a.rep}`;
  const when = a.after ? `then at ${f(start)} s` : a.delay ? `at ${f(a.delay)} s` : '';
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
  for (const b of document.querySelectorAll('[data-action="toggleAnimations"]')) {
    if (b.getAttribute('role') === 'menuitemcheckbox')
      b.setAttribute('aria-checked', animPlay.playing);
    else {
      b.textContent = animPlay.playing ? '■ Stop' : '▶ Play';
      b.setAttribute('aria-pressed', animPlay.playing);
    }
  }
  const el = animTarget();
  $('#sc-anim-props').hidden = !el;
  $('#sc-anim-none').hidden = !!el;
  if (!el) return;
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
    kids.push(field(a.p === 'slideIn' ? 'From ' : 'To ', s));
  }
  if ('dist' in a) kids.push(field('Distance ', number('dist', 'px')));
  if ('turns' in a) kids.push(field('Turns ', number('turns', '(− = anticlockwise)', 0.25)));
  if ('scale' in a) kids.push(field('Grow to ', number('scale', '%')));
  if ('to' in a) {
    const c = document.createElement('input');
    c.type = 'color';
    c.dataset.animOpt = 'to';
    c.value = a.to;
    kids.push(field('To colour ', c));
  }
  const focused = document.activeElement?.dataset?.animOpt;
  if (!focused) opts.replaceChildren(...kids);
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
function addAnimation(p) {
  const el = animTarget();
  if (!el || !ANIM_PRESETS[p]) return;
  const why = animUnfit(el, p);
  if (why) return say(why);
  const def = ANIM_PRESETS[p];
  const a = { p, dur: def.dur, delay: 0, rep: def.rep, dir: def.dir || 'normal', ease: def.ease };
  for (const k of ['from', 'dist', 'turns', 'scale', 'to']) if (k in def) a[k] = def[k];
  const done = editAnims((l) => {
    l.push(a);
    animUI.edit = l.length - 1;
  });
  if (done) say(`Added ${def.name}. Press ▶ Play to see it.`);
}

function wireAnimations() {
  const add = $('#sc-anim-add');
  for (const group of ['Entrances', 'Exits', 'Loops', 'Line', 'Colour']) {
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
      else if (['dur', 'delay', 'dist', 'turns', 'scale'].includes(k)) a[k] = +t.value;
      else a[k] = t.value;
    });
  });
  syncAnimUI();
}
wireAnimations();
