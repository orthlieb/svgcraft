// SVGCraft — Animations as SMIL: each preset's channels, timing, and
// letters played one after another (Stagger).
'use strict';

// ---- SMIL ------------------------------------------------------------------------
// What an animation changes, as channels: { tag, attrs, values, keyTimes?,
// discrete?, at0? }. Values and keyTimes are for one forward run.
function animChannels(el, a) {
  const b = el.getBBox();
  // The point it turns and grows about: its centre, or the pivot dragged.
  const [cx, cy] = PIVOT_PRESETS.has(a.p)
    ? [b.x + animOrigin(a)[0] * b.width, b.y + animOrigin(a)[1] * b.height]
    : [b.x + b.width / 2, b.y + b.height / 2];
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
  // Scale about the centre, across and down separately.
  const growXY = (pairs, keyTimes) => [
    move(
      pairs.map(([sx, sy]) => [cx * (1 - sx), cy * (1 - sy)]),
      keyTimes,
    ),
    {
      tag: 'animateTransform',
      attrs: { attributeName: 'transform', type: 'scale', additive: 'sum' },
      values: pairs.map(([sx, sy]) => `${f(sx)} ${f(sy)}`),
      keyTimes,
    },
  ];
  const side = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[a.from] || [0, 0];
  // Turning (degrees) about a point.
  const turn = (degs, px, py, keyTimes) => ({
    tag: 'animateTransform',
    attrs: { attributeName: 'transform', type: 'rotate', additive: 'sum' },
    values: degs.map((t) => `${f(t)} ${f(px)} ${f(py)}`),
    keyTimes,
  });
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
    case 'dropIn':
      return [
        move(
          [-1, 0, -0.25, 0, -0.08, 0].map((t) => [0, t * d]),
          [0, 0.45, 0.65, 0.8, 0.9, 1],
        ),
        op([0, 1, 1], [0, 0.3, 1]),
      ];
    case 'backIn':
      return [
        move(
          [1, -0.08, 0].map((t) => [side[0] * d * t, side[1] * d * t]),
          [0, 0.7, 1],
        ),
        op([0, 1, 1], [0, 0.4, 1]),
      ];
    case 'rollIn':
      return [
        move([
          [-d, 0],
          [0, 0],
        ]),
        turn([-120, 0], cx, cy),
        op([0, 1]),
      ];
    case 'flipIn': {
      const kt = [0, 0.7, 1];
      const pairs =
        a.axis === 'horizontal'
          ? [
              [1, 0.01],
              [1, 1.08],
              [1, 1],
            ]
          : [
              [0.01, 1],
              [1.08, 1],
              [1, 1],
            ];
      return [...growXY(pairs, kt), op([0, 1, 1], [0, 0.3, 1])];
    }
    case 'hinge': {
      // Rotations about the top-left corner, then the fall.
      const kt = [0, 0.2, 0.4, 0.6, 0.8, 1];
      return [
        move(
          [0, 0, 0, 0, 0, 1].map((t) => [0, t * d]),
          kt,
        ),
        turn([0, 80, 60, 80, 60, 60], b.x, b.y, kt),
        op([1, 1, 1, 1, 1, 0], kt),
      ];
    }
    case 'rubberBand':
      return growXY(
        [
          [1, 1],
          [1.25, 0.75],
          [0.75, 1.25],
          [1.15, 0.85],
          [0.95, 1.05],
          [1.05, 0.95],
          [1, 1],
        ],
        [0, 0.3, 0.4, 0.5, 0.65, 0.75, 1],
      );
    case 'tada': {
      const kt = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
      return [
        ...grow([1, 0.9, 0.9, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1], kt),
        turn([0, -3, -3, 3, -3, 3, -3, 3, -3, 3, 0], cx, cy, kt),
      ];
    }
    case 'headShake': {
      const kt = [0, 0.065, 0.185, 0.315, 0.435, 0.5, 1];
      return [
        move(
          [0, -6, 5, -3, 2, 0, 0].map((t) => [(t / 6) * d, 0]),
          kt,
        ),
        turn([0, -9, 7, -5, 3, 0, 0], cx, cy, kt),
      ];
    }
    case 'wobble': {
      const kt = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1];
      return [
        move(
          [0, -0.25, 0.2, -0.15, 0.1, -0.05, 0].map((t) => [t * b.width, 0]),
          kt,
        ),
        turn([0, -5, 3, -3, 2, -1, 0], cx, cy, kt),
      ];
    }
    case 'breathe':
      return [op([1, 0.4, 1])];
    case 'swing': {
      const r = (deg) => `${f(deg)} ${f(cx)} ${f(cy)}`;
      return [
        {
          tag: 'animateTransform',
          attrs: { attributeName: 'transform', type: 'rotate', additive: 'sum' },
          values: [r(0), r(a.angle), r(0), r(-a.angle), r(0)],
        },
      ];
    }
    case 'heartbeat': {
      const s = a.scale / 100;
      return grow([1, s, 1, s, 1, 1], [0, 0.14, 0.28, 0.42, 0.7, 1]);
    }
    case 'jello': {
      // Skewed both ways, less each time, about the centre: the shift
      // keeps the centre where the two skews would move it from.
      const angles = [0, -1, 0.5, -0.25, 0.125, -0.0625, 0].map((t) => t * a.angle);
      const tan = (deg) => Math.tan((deg * Math.PI) / 180);
      const skew = (type) => ({
        tag: 'animateTransform',
        attrs: { attributeName: 'transform', type, additive: 'sum' },
        values: angles.map(f),
      });
      return [
        move(angles.map((t) => [-tan(t) * (cy + tan(t) * cx), -tan(t) * cx])),
        skew('skewX'),
        skew('skewY'),
      ];
    }
    case 'flip':
      return growXY(
        a.axis === 'horizontal'
          ? [
              [1, 1],
              [1, -1],
              [1, 1],
            ]
          : [
              [1, 1],
              [-1, 1],
              [1, 1],
            ],
      );
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
    case 'strokePulse': {
      const w = parseFloat(getComputedStyle(el).strokeWidth) || 1;
      return [
        {
          tag: 'animate',
          attrs: { attributeName: 'stroke-width' },
          values: [w, (w * a.scale) / 100, w].map(f),
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
    case 'followPath': {
      const route = motionRoute(el, a);
      if (!route) return [];
      // The motion moves the layer in its parent's space, outside its own
      // transform (and turns it about that space's origin), so a fixed
      // shift inside the transform first puts its centre at the origin:
      // then the centre rides the line and the layer turns about itself.
      const own = getM(el);
      const c = new DOMPoint(cx, cy).matrixTransform(own);
      const lin = new DOMMatrix([own.a, own.b, own.c, own.d, 0, 0]);
      const v = new DOMPoint(-c.x, -c.y).matrixTransform(lin.inverse());
      const at = `${f(v.x)} ${f(v.y)}`;
      return [
        {
          tag: 'animateMotion',
          attrs: {
            path: motionD(el, route),
            calcMode: 'linear',
            ...(a.orient ? { rotate: a.dir === 'reverse' ? 'auto-reverse' : 'auto' } : {}),
          },
          valuesAttr: 'keyPoints',
          values: ['0', '1'],
          keyTimes: [0, 1],
        },
        {
          tag: 'animateTransform',
          attrs: { attributeName: 'transform', type: 'translate', additive: 'sum' },
          values: [at, at],
        },
      ];
    }
    case 'morph': {
      const target = motionRoute(el, a);
      const d =
        target && el.localName === 'path' && morphD(shapeNodes(el), morphTarget(el, target));
      return d ? [{ tag: 'animate', attrs: { attributeName: 'd' }, values: d }] : [];
    }
    case 'colourCycle': {
      const from = hex(getComputedStyle(el).fill) || '#000000';
      return [{ tag: 'animate', attrs: { attributeName: 'fill' }, values: [from, a.to] }];
    }
  }
  return [];
}

// Why a preset can't go on a layer, or ''.
function animUnfit(el, p, a = null) {
  const def = ANIM_PRESETS[p];
  if (def.stroke && (getComputedStyle(el).stroke || 'none') === 'none')
    return `${def.name} needs a stroke.`;
  if (def.line || p === 'dashMarch') {
    if (typeof el.getTotalLength !== 'function') return `${def.name} needs a path or shape.`;
    if (getComputedStyle(el).stroke === 'none') return `${def.name} needs a stroke.`;
  }
  if (def.text && el.localName !== 'text') return `${def.name} needs text.`;
  if (p === 'flipbook' && (el.localName !== 'g' || staggerKids(el).length < 2))
    return 'Flipbook needs a group of two or more objects: its frames, bottom one first.';
  if (p === 'morph') {
    if (el.localName !== 'path')
      return 'Morph needs a shape: a path, rectangle, circle, ellipse, line or polygon.';
    if (!(a && motionRoute(el, a)))
      return 'Morph needs the shape to become: select the object, then Shift-click that shape above it.';
  }
  if (p === 'followPath' && !(a && motionRoute(el, a)))
    return 'Move along path needs a path: select the object, then Shift-click the path above it.';
  // A group's own fill only reaches shapes that don't set one.
  if (p === 'colourCycle' && (el.localName === 'g' || !hex(getComputedStyle(el).fill || '')))
    return 'Colour cycle needs a shape with a solid fill.';
  return '';
}

// The SMIL elements for one animation. `preview` makes them wait for
// beginElementAt() (the editor's timeline started when the page loaded);
// each node remembers its start in seconds.
function animNodes(el, a, preview = false, start = a.delay) {
  if (animUnfit(el, a.p, a)) return [];
  return chanNodes(a, animChannels(el, a), preview, start);
}
// keyTimes, finer than other numbers: a pause makes them long fractions.
const kf = (t) => +t.toFixed(4);
// A run's values held at the last one for `pause` seconds after it.
function paused(values, kt, dur, pause) {
  const total = dur + pause;
  return [[...values, values.at(-1)], [...kt.map((t) => (t * dur) / total), 1], total];
}
// The begin attribute for a start `t` seconds in (after a's start event,
// if it has one).
const smilBegin = (a, t, at0) =>
  a._base && !at0 ? `${a._base}${t ? `+${f(t)}s` : ''}` : `${f(at0 ? 0 : t)}s`;
// SMIL elements for channels, timed and paced for animation a. A channel
// with `raw` has its values and keyTimes for the whole run already (no
// direction to apply); `hideWith` is how an entrance stays hidden while it
// waits for its delay (opacity, unless that's not what it animates).
function chanNodes(a, channels, preview, start, hideWith = ['opacity']) {
  const def = ANIM_PRESETS[a.p];
  const spline = EASES[a.ease][1];
  const forever = a.rep === 0;
  // Entrances and exits hold their last frame; loops go back to rest.
  const hold = (def.enter || def.exit || def.line || def.hold) && !forever;
  const nodes = [];
  for (const ch of channels) {
    const attrs = { ...ch.attrs };
    const begin = ch.at0 ? 0 : start;
    if (ch.tag === 'set') {
      if (!ch.at0) continue;
    } else if (ch.raw) {
      let { values, kt } = ch.raw;
      let dur = a.dur * (a.dir === 'alternate' ? 2 : 1);
      if (a.pause > 0) [values, kt, dur] = paused(values, kt, dur, a.pause);
      attrs.values = values.join(';');
      attrs.keyTimes = kt.map(kf).join(';');
      attrs.calcMode = 'discrete';
      attrs.dur = `${f(dur)}s`;
      attrs.repeatCount = forever ? 'indefinite' : String(a.rep);
      if (hold) attrs.fill = 'freeze';
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
      if (a.pause > 0) [values, kt, dur] = paused(values, kt, dur, a.pause);
      attrs[ch.valuesAttr || 'values'] = values.join(';');
      attrs.dur = `${f(dur)}s`;
      attrs.repeatCount = forever ? 'indefinite' : String(a.rep);
      if (ch.discrete) {
        attrs.calcMode = 'discrete';
        attrs.keyTimes = kt.map(kf).join(';');
      } else if (spline) {
        attrs.calcMode = 'spline';
        attrs.keyTimes = kt.map(kf).join(';');
        attrs.keySplines = Array(values.length - 1)
          .fill(spline)
          .join(';');
      } else if (ch.keyTimes || a.dir === 'alternate' || a.pause > 0)
        attrs.keyTimes = kt.map(kf).join(';');
      if (hold) attrs.fill = 'freeze';
    }
    attrs.begin = preview ? 'indefinite' : smilBegin(a, begin, ch.at0);
    if (a._end && !ch.at0 && !preview) attrs.end = a._end;
    const n = mk(ch.tag, attrs);
    n.dataset.scBegin = begin;
    nodes.push(n);
  }
  // An entrance waiting for its delay starts hidden, not shown then hidden.
  if (def.enter && (start > 0 || a._base) && !def.line)
    for (const name of hideWith) {
      const n = mk('set', {
        attributeName: name,
        to: name === 'visibility' ? 'hidden' : '0',
        begin: preview ? 'indefinite' : '0s',
      });
      n.dataset.scBegin = 0;
      nodes.unshift(n);
    }
  return nodes;
}

// ---- Stagger and letters ------------------------------------------------------------
// The letters of a text layer, in order: each non-space character, put in
// a <tspan> of its own (marked, so opening the file joins them back up).
function splitLetters(text) {
  const out = [];
  const walker = text.ownerDocument.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const t of nodes) {
    if (t.parentNode.closest('title, desc')) continue;
    const parts = [];
    for (const ch of t.data) {
      if (/\s/.test(ch)) parts.push(text.ownerDocument.createTextNode(ch));
      else {
        const sp = text.ownerDocument.createElementNS(NS, 'tspan');
        sp.setAttribute('data-sc-gen', '');
        sp.textContent = ch;
        parts.push(sp);
        out.push(sp);
      }
    }
    t.replaceWith(...parts);
  }
  return out;
}
const letterCount = (text) => (text.textContent.match(/\S/gu) || []).length;
// Channels for one letter (i of n) of text layer `text`.
function letterChannels(text, a, i, n) {
  if (a.p === 'typewriter') {
    // Each letter appears at its moment in the run (the last a little before
    // the end), or, run backwards, goes at its moment.
    const k = (i + 1) / (n + 1);
    const raw = {
      normal: { values: ['hidden', 'visible'], kt: [0, k] },
      reverse: { values: ['visible', 'hidden'], kt: [0, 1 - k] },
      alternate: { values: ['hidden', 'visible', 'hidden'], kt: [0, k / 2, 1 - k / 2] },
    }[a.dir];
    return [{ tag: 'animate', attrs: { attributeName: 'visibility' }, raw }];
  }
  const cs = getComputedStyle(text);
  if (a.p === 'colourCycle')
    return [
      {
        tag: 'animate',
        attrs: { attributeName: 'fill' },
        values: [hex(cs.fill) || '#000000', a.to],
      },
    ];
  const [vals, kt, discrete] = {
    fadeIn: [[0, 1]],
    fadeOut: [[1, 0]],
    blink: [[1, 0, 1], [0, 0.5, 1], true],
  }[a.p];
  // Opacity per letter, as fill and stroke opacity (which every viewer
  // applies to a <tspan>).
  const out = [];
  for (const [name, paint] of [
    ['fill-opacity', cs.fill],
    ['stroke-opacity', cs.stroke],
  ]) {
    if (!paint || paint === 'none') continue;
    const base = parseFloat(cs.getPropertyValue(name)) || 1;
    out.push({
      tag: 'animate',
      attrs: { attributeName: name },
      values: vals.map((v) => f(v * base)),
      keyTimes: kt,
      discrete,
    });
  }
  return out;
}
// The layers a group's animation goes to, one after another (bottom first).
const staggerKids = (g) =>
  [...g.children].filter((c) => selectable(c) && c.getAttribute('display') !== 'none');
// One animation's SMIL and where each piece goes: [{ at, nodes }], at null
// for the layer itself, { child: k } for its k-th child element, { letter: i }
// for its i-th letter.
function animEmit(el, a, preview, start) {
  if (animUnfit(el, a.p, a)) return [];
  const letters =
    el.localName === 'text' && (a.p === 'typewriter' || (a.stagger > 0 && LETTER_PRESETS.has(a.p)));
  if (letters) {
    const n = letterCount(el);
    const gap = a.p === 'typewriter' ? 0 : a.stagger;
    const hide = a.p === 'typewriter' ? ['visibility'] : ['fill-opacity', 'stroke-opacity'];
    return Array.from({ length: n }, (_, i) => ({
      at: { letter: i },
      nodes: chanNodes(a, letterChannels(el, a, i, n), preview, start + i * gap, hide),
    }));
  }
  if (a.p === 'flipbook') {
    // Frame by frame (back and forth: there and back, the ends once each);
    // each layer is shown for its frames and hidden for the rest.
    const kids = [...el.children];
    const frames = staggerKids(el);
    const n = frames.length;
    const ids = [...Array(n).keys()];
    const order = {
      normal: ids,
      reverse: [...ids].reverse(),
      alternate: [...ids, ...ids.slice(1, -1).reverse()],
    }[a.dir];
    return frames.map((c, k) => {
      const values = [];
      const kt = [];
      order.forEach((f0, i) => {
        const v = f0 === k ? 'inline' : 'none';
        if (values.at(-1) !== v) {
          values.push(v);
          kt.push(i / order.length);
        }
      });
      const raw = { values, kt };
      return {
        at: { child: kids.indexOf(c) },
        nodes: chanNodes(
          a,
          [{ tag: 'animate', attrs: { attributeName: 'display' }, raw }],
          preview,
          start,
          [],
        ),
      };
    });
  }
  if (a.stagger > 0 && el.localName === 'g') {
    const kids = [...el.children];
    return staggerKids(el).map((c, k) => ({
      at: { child: kids.indexOf(c) },
      nodes: animNodes(c, a, preview, start + k * a.stagger),
    }));
  }
  return [{ at: null, nodes: animNodes(el, a, preview, start) }];
}
