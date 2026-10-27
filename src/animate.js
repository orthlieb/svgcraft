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

// ---- animations in opened files ------------------------------------------------
// A file's own SMIL (noted on each element by stashSmil() in src/import.js)
// becomes presets where a preset would write the same thing: every preset
// is tried on the layer, in each direction, with its options read off the
// file's values, and kept if what it generates matches. SVGCraft's own
// exports (Export Clean SVG drops the settings) come back exactly, and
// hand-made animations that do what a preset does (a spin about the
// layer's centre, a fade) become editable. The rest are counted, and the
// opener says so.

// Seconds in a SMIL clock value ("5s", "500ms", "1.5", "0:01:02.5"), or NaN.
function smilClock(v) {
  v = (v ?? '').trim();
  let m = /^(\d+(?:\.\d+)?)(h|min|s|ms)?$/.exec(v);
  if (m) return +m[1] * { h: 3600, min: 60, s: 1, ms: 0.001 }[m[2] || 's'];
  m = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(v);
  if (m) return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3];
  return NaN;
}
// An animation element's timing: { begin, dur, rep } (rep 0 = forever),
// or null when it starts on an event or repeats a part of a run.
function smilTiming(a) {
  const begin = a.begin == null || a.begin.trim() === '' ? 0 : smilClock(a.begin);
  const dur = smilClock(a.dur);
  if (!(begin >= 0) || !(dur > 0)) return null;
  let rep = 1;
  if (a.repeatCount === 'indefinite' || a.repeatDur === 'indefinite') rep = 0;
  else if (a.repeatCount != null) rep = +a.repeatCount;
  else if (a.repeatDur != null) rep = smilClock(a.repeatDur) / dur;
  if (rep !== 0 && !(Math.abs(rep - Math.round(rep)) < 1e-6 && rep >= 1)) return null;
  return { begin, dur, rep: Math.round(rep) };
}
const smilNums = (v) =>
  String(v)
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
// Any CSS colour as #rrggbb (canvas does the parsing).
const smilCtx = document.createElement('canvas').getContext('2d');
function smilHex(v) {
  smilCtx.fillStyle = '#000';
  smilCtx.fillStyle = String(v).trim();
  return smilCtx.fillStyle;
}
// One channel, from a file's element or a generated one, made comparable:
// its values as number lists (transforms padded: rotate a cx cy, translate
// x y, scale sx sy; colours as #rrggbb), keyTimes, timing and pacing.
function smilChannel({ tag, attrs: a }, el) {
  const name = a.attributeName || '';
  const type = tag === 'animateTransform' ? a.type || 'translate' : '';
  const t = smilTiming(a);
  if (!t || tag === 'set' || tag === 'animateMotion') return null;
  const base = () => {
    if (type === 'scale') return '1';
    if (type) return '0';
    return el.getAttribute(name) ?? getComputedStyle(el).getPropertyValue(name) ?? '';
  };
  let raw;
  if (a.values != null)
    raw = a.values
      .split(';')
      .map((v) => v.trim())
      .filter(Boolean);
  else if (a.to != null) raw = [a.from ?? base(), a.to];
  else if (a.by != null) {
    const f0 = smilNums(a.from ?? base());
    const by = smilNums(a.by);
    raw = [f0.join(' '), f0.map((x, i) => x + (by[i] ?? by[0] ?? 0)).join(' ')];
  } else return null;
  if (raw.length < 2) return null;
  const colour = /^(fill|stroke|stop-color|color)$/.test(name);
  const values = raw.map((v) => {
    if (colour) return smilHex(v);
    const n = smilNums(v);
    if (type === 'rotate') return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0];
    if (type === 'translate') return [n[0] ?? 0, n[1] ?? 0];
    if (type === 'scale') return [n[0] ?? 1, n[1] ?? n[0] ?? 1];
    return n;
  });
  if (!colour && values.some((v) => !v.length || v.some((x) => !isFinite(x)))) return null;
  const kt = a.keyTimes ? smilNums(a.keyTimes.replace(/;/g, ' ')) : null;
  const calc = a.calcMode === 'discrete' || a.calcMode === 'spline' ? a.calcMode : 'linear';
  return {
    tag,
    name,
    type,
    additive: a.additive === 'sum',
    values,
    kt: kt?.length === values.length ? kt : values.map((_, i) => i / (values.length - 1)),
    calc,
    spline: calc === 'spline' ? smilNums((a.keySplines || '').split(';')[0]) : null,
    ...t,
  };
}
const smilNear = (x, y) => Math.abs(x - y) <= 0.01 + 0.005 * Math.max(Math.abs(x), Math.abs(y));
// Does a file's channel g do what generated channel c does? A transform
// that replaces (SMIL's default) is the same as one added on top when the
// element had no transform of its own.
function smilSame(g, c, own) {
  if (g.tag !== c.tag || g.name !== c.name || g.type !== c.type) return false;
  if (c.type && !g.additive && own) return false;
  if (!smilNear(g.begin, c.begin) || !smilNear(g.dur, c.dur) || g.rep !== c.rep) return false;
  if (g.calc !== c.calc || g.values.length !== c.values.length) return false;
  for (let i = 0; i < g.values.length; i++) {
    const [a, b] = [g.values[i], c.values[i]];
    if (typeof a === 'string' ? a !== b : a.some((x, j) => !smilNear(x, b[j] ?? NaN))) return false;
    if (Math.abs(g.kt[i] - c.kt[i]) > 0.002) return false;
  }
  return true;
}
// Do two <set>s set the same thing at the same time?
function smilSameSet(x, y) {
  const [a, b] = [x.attrs, y.attrs];
  if (a.attributeName !== b.attributeName) return false;
  if (!smilNear(smilClock(a.begin || '0s'), smilClock(b.begin || '0s'))) return false;
  const [p, q] = [smilNums(a.to ?? ''), smilNums(b.to ?? '')];
  return p.length === q.length && p.every((v, i) => smilNear(v, q[i]));
}
// The ease a spline is closest to.
function smilEase(ch) {
  if (ch.calc !== 'spline') return 'linear';
  let best = 'ease';
  let d0 = Infinity;
  for (const [k, [, s]] of Object.entries(EASES)) {
    if (!s) continue;
    const d = smilNums(s).reduce((t, x, i) => t + Math.abs(x - (ch.spline[i] ?? 0)), 0);
    if (d < d0) [best, d0] = [k, d];
  }
  return best;
}
// One run's values, forward, for a direction (null when they can't be).
function smilForward(values, dir) {
  if (dir === 'reverse') return [...values].reverse();
  if (dir !== 'alternate') return values;
  const n = values.length;
  if (n < 3 || n % 2 === 0) return null;
  const half = values.slice(0, (n + 1) / 2);
  const same = (a, b) => (typeof a === 'string' ? a === b : a.every((x, i) => smilNear(x, b[i])));
  return half.every((v, i) => same(v, values[n - 1 - i])) ? half : null;
}
// A preset's options read off the file's channels, run forward.
function smilOptions(chs, dir, el) {
  const o = {};
  const fwd = (c) => smilForward(c.values, dir);
  const rot = chs.find((c) => c.type === 'rotate');
  if (rot && fwd(rot)) {
    const v = fwd(rot);
    o.turns = (v.at(-1)[0] - v[0][0]) / 360;
  }
  const sc = chs.find((c) => c.type === 'scale');
  if (sc && fwd(sc)) o.scale = Math.max(...fwd(sc).map((v) => v[0])) * 100;
  const mv = chs.find((c) => c.type === 'translate');
  if (mv && fwd(mv)) {
    const far = fwd(mv).reduce((p, v) => (Math.hypot(...v) > Math.hypot(...p) ? v : p));
    const m = fullM(el);
    o.dist = Math.hypot(...far) * (Math.hypot(m.a, m.b) || 1);
    o.from =
      Math.abs(far[0]) >= Math.abs(far[1])
        ? far[0] < 0
          ? 'left'
          : 'right'
        : far[1] < 0
          ? 'top'
          : 'bottom';
  }
  const col = chs.find((c) => c.name === 'fill');
  if (col && fwd(col)) o.to = fwd(col).at(-1);
  return o;
}
// A layer's noted SMIL as presets: { anims, lost }.
function smilToAnims(el, notes, own) {
  let lost = 0;
  const sets = notes.filter((n) => n.tag === 'set');
  let pool = [];
  for (const n of notes) {
    if (n.tag === 'set') continue;
    const c = smilChannel(n, el);
    if (c) pool.push(c);
    else lost++;
  }
  const anims = [];
  const setsUsed = new Set();
  while (pool.length) {
    const first = pool[0];
    const peers = pool.filter(
      (c) => smilNear(c.begin, first.begin) && smilNear(c.dur, first.dur) && c.rep === first.rep,
    );
    // Every preset that writes these channels; the one whose <set>s (an
    // entrance starting hidden, a line's dashes) are the file's wins, as a
    // reversed Fade in writes what a Fade out does, but for its <set>.
    let found = null;
    for (const dir of ['normal', 'alternate', 'reverse']) {
      const opts = smilOptions(peers, dir, el);
      for (const p of Object.keys(ANIM_PRESETS)) {
        const def = ANIM_PRESETS[p];
        const a = {
          p,
          dur: dir === 'alternate' ? first.dur / 2 : first.dur,
          delay: first.begin,
          rep: first.rep,
          dir,
          ease: smilEase(first),
        };
        for (const k of ['from', 'dist', 'turns', 'scale', 'to'])
          if (k in def && opts[k] != null) a[k] = opts[k];
        if (animUnfit(el, p)) continue;
        const gen = animNodes(el, a, false, a.delay).map((n) => ({
          tag: n.localName,
          attrs: Object.fromEntries([...n.attributes].map((x) => [x.name, x.value])),
        }));
        const chs = gen.filter((g) => g.tag !== 'set').map((g) => smilChannel(g, el));
        if (!chs.length || chs.some((c) => !c)) continue;
        const used = [];
        for (const c of chs) {
          const m = peers.find((g) => !used.includes(g) && smilSame(g, c, own));
          if (!m) break;
          used.push(m);
        }
        if (used.length !== chs.length || !used.includes(first)) continue;
        // The file's <set>s it accounts for, less any it would add: what
        // plays must stay as it was, so a delayed fade in with no <set> to
        // start it hidden comes back as a reversed Fade out, which has none.
        const setHits = [];
        let extra = 0;
        for (const g of gen.filter((x) => x.tag === 'set')) {
          const i = sets.findIndex(
            (x, j) => !setsUsed.has(j) && !setHits.includes(j) && smilSameSet(x, g),
          );
          if (i >= 0) setHits.push(i);
          else extra++;
        }
        const score = setHits.length - extra;
        if (!found || score > found.score) found = { a, used, setHits, score };
      }
    }
    if (!found) {
      lost++;
      pool = pool.slice(1);
      continue;
    }
    pool = pool.filter((c) => !found.used.includes(c));
    for (const i of found.setHits) setsUsed.add(i);
    anims.push(found.a);
  }
  lost += sets.length - setsUsed.size;
  anims.sort((x, y) => x.delay - y.delay);
  return { anims, lost };
}
// After a file is opened or placed: turn the noted SMIL on its layers
// (under roots) into presets. { kept, lost }, lost starting at the count
// the importer couldn't note at all.
function adoptSmil(roots, lost = 0) {
  let kept = 0;
  for (const r of roots)
    for (const el of [r, ...(r.querySelectorAll?.('[data-sc-smil]') || [])]) {
      if (!el.hasAttribute?.('data-sc-smil')) continue;
      let note = null;
      try {
        note = JSON.parse(el.getAttribute('data-sc-smil'));
      } catch {
        /* unreadable: nothing to keep */
      }
      el.removeAttribute('data-sc-smil');
      const notes = Array.isArray(note?.list) ? note.list.slice(0, 50) : [];
      // Only layers in the drawing animate (not symbols' insides, or runs of text).
      if (!doc.contains(el) || !selectable(el) || el.parentNode.closest('text')) {
        lost += notes.length;
        continue;
      }
      const r2 = smilToAnims(el, notes, !!note.own);
      lost += r2.lost;
      if (!r2.anims.length) continue;
      writeAnims(el, [...readAnims(el), ...r2.anims]);
      // Checked and clamped as any file's settings are.
      writeAnims(el, readAnims(el));
      kept += r2.anims.length;
    }
  return { kept, lost };
}
// Tell the user what became of the file's animations.
function reportSmil({ kept, lost }) {
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (lost)
    warn(
      `${n(lost, 'animation')} in this file can’t be edited in SVGCraft, so ${lost === 1 ? 'it was' : 'they were'} left out.` +
        (kept ? ` The other ${kept === 1 ? 'one is' : `${kept} are`} in the Animation tab.` : ''),
    );
  else if (kept)
    say(
      `Kept the file’s ${n(kept, 'animation')}: edit ${kept === 1 ? 'it' : 'them'} in the Animation tab.`,
    );
}

// ---- preview ---------------------------------------------------------------------
const animPlay = { playing: false, nodes: [] };
function playAnimations() {
  stopAnimations();
  const els = [...doc.querySelectorAll('[data-sc-anim]')];
  if (!els.length) return warn('Nothing is animated yet: add one in the Animation tab.');
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
  if (why) return warn(why);
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
