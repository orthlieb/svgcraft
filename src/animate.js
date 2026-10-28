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
  // Falls in from above and bounces to rest; slides in and overshoots;
  // rolls in; turns into view.
  dropIn: {
    name: 'Drop in',
    group: 'Entrances',
    dur: 1,
    rep: 1,
    ease: 'linear',
    enter: true,
    dist: 120,
  },
  backIn: {
    name: 'Back in',
    group: 'Entrances',
    dur: 0.8,
    rep: 1,
    ease: 'out',
    enter: true,
    from: 'left',
    dist: 80,
  },
  rollIn: {
    name: 'Roll in',
    group: 'Entrances',
    dur: 0.9,
    rep: 1,
    ease: 'out',
    enter: true,
    dist: 120,
  },
  flipIn: {
    name: 'Flip in',
    group: 'Entrances',
    dur: 0.8,
    rep: 1,
    ease: 'out',
    enter: true,
    axis: 'vertical',
  },
  // Uncovered from a side, or from the middle out; and out of a blur.
  wipeIn: {
    name: 'Wipe in',
    group: 'Entrances',
    dur: 0.8,
    rep: 1,
    ease: 'out',
    enter: true,
    wrap: true,
    from: 'left',
  },
  irisIn: {
    name: 'Iris in',
    group: 'Entrances',
    dur: 0.8,
    rep: 1,
    ease: 'out',
    enter: true,
    wrap: true,
  },
  blurIn: {
    name: 'Blur in',
    group: 'Entrances',
    dur: 0.8,
    rep: 1,
    ease: 'out',
    enter: true,
    wrap: true,
    size: 12,
  },
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
  // Swings on its top-left corner, then drops away.
  hinge: { name: 'Hinge', group: 'Exits', dur: 2, rep: 1, ease: 'linear', exit: true, dist: 300 },
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
  glowPulse: {
    name: 'Glow pulse',
    group: 'Loops',
    dur: 1.2,
    rep: 0,
    ease: 'inout',
    dir: 'alternate',
    wrap: true,
    size: 8,
    to: '#facc15',
  },
  // A group's layers shown one at a time, bottom first: its frames.
  flipbook: { name: 'Flipbook', group: 'Loops', dur: 1, rep: 0, ease: 'linear', hold: true },
  // A highlight sweeping across the layer.
  shine: { name: 'Shine', group: 'Loops', dur: 1.6, rep: 0, ease: 'inout', wrap: true },
  // Rings spreading out from under the layer and fading, one after another.
  ripple: {
    name: 'Ripple',
    group: 'Loops',
    dur: 1.6,
    rep: 0,
    ease: 'out',
    wrap: true,
    scale: 180,
    size: 3,
    to: '#38bdf8',
  },
  // Back and forth about a point (the top: a hanging sign).
  swing: {
    name: 'Swing',
    group: 'Loops',
    dur: 1.2,
    rep: 0,
    ease: 'inout',
    angle: 15,
    pivot: 'top',
  },
  heartbeat: { name: 'Heartbeat', group: 'Loops', dur: 1.3, rep: 0, ease: 'linear', scale: 120 },
  jello: { name: 'Jello', group: 'Loops', dur: 0.9, rep: 1, ease: 'linear', angle: 12 },
  // Squashed and stretched; a wiggling grow; a shake that turns; a sway;
  // a slow fade down and up.
  rubberBand: { name: 'Rubber band', group: 'Loops', dur: 1, rep: 0, ease: 'linear' },
  tada: { name: 'Tada', group: 'Loops', dur: 1, rep: 0, ease: 'linear' },
  headShake: { name: 'Head shake', group: 'Loops', dur: 1, rep: 0, ease: 'inout', dist: 6 },
  wobble: { name: 'Wobble', group: 'Loops', dur: 1, rep: 0, ease: 'linear' },
  breathe: { name: 'Breathe', group: 'Loops', dur: 3, rep: 0, ease: 'inout' },
  // Turned over like a card, about its centre, and back.
  flip: { name: 'Flip', group: 'Loops', dur: 1.2, rep: 1, ease: 'inout', axis: 'vertical' },
  // A text layer's letters shown one by one.
  typewriter: {
    name: 'Typewriter',
    group: 'Text',
    dur: 2,
    rep: 1,
    ease: 'linear',
    enter: true,
    text: true,
  },
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
  // The outline growing thicker and back (scale: how thick, as a % of its width).
  strokePulse: {
    name: 'Stroke pulse',
    group: 'Line',
    dur: 1,
    rep: 0,
    ease: 'inout',
    scale: 250,
    stroke: true,
  },
  // Along another layer's outline (its id in `path`), the layer's centre
  // on the line; `orient` turns it to face the way it goes, `hide` leaves
  // the path out of sight in the saved file.
  followPath: {
    name: 'Move along path',
    group: 'Motion',
    dur: 3,
    rep: 1,
    ease: 'inout',
    hold: true,
    path: '',
    orient: false,
    hide: true,
  },
  // Its outline turning into another layer's (`path`: that layer's id).
  morph: {
    name: 'Morph',
    group: 'Motion',
    dur: 1,
    rep: 1,
    ease: 'inout',
    hold: true,
    path: '',
    hide: true,
  },
  colourCycle: {
    name: 'Colour cycle',
    group: 'Colour',
    dur: 2,
    rep: 0,
    ease: 'inout',
    dir: 'alternate',
    to: '#dc2626',
  },
  // Its own colour and a second one, in bands moving across it (angle: the
  // way they go).
  gradientFlow: {
    name: 'Gradient flow',
    group: 'Colour',
    dur: 2,
    rep: 0,
    ease: 'linear',
    wrap: true,
    angle: 0,
    to: '#f59e0b',
  },
  // Stripes over it, sliding along (size: how wide).
  patternScroll: {
    name: 'Pattern scroll',
    group: 'Colour',
    dur: 1,
    rep: 0,
    ease: 'linear',
    wrap: true,
    angle: 45,
    size: 8,
    to: '#ffffff',
  },
};
// Preset options and their limits.
const ANIM_OPTS = {
  from: ['left', 'right', 'top', 'bottom'],
  dist: [0, 10000],
  turns: [-100, 100],
  scale: [1, 1000],
  angle: [-360, 360],
  size: [0, 200],
  pivot: ['centre', 'top', 'bottom', 'left', 'right'],
  axis: ['vertical', 'horizontal'],
};
// Presets a text layer's letters can each run, in turn (Stagger).
const LETTER_PRESETS = new Set(['fadeIn', 'fadeOut', 'blink', 'colourCycle']);
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
    for (const k of ['pivot', 'axis'])
      if (k in def) a[k] = ANIM_OPTS[k].includes(r[k]) ? r[k] : def[k];
    for (const k of ['dist', 'turns', 'scale', 'angle', 'size'])
      if (k in def) a[k] = num(r[k], ...ANIM_OPTS[k], def[k]);
    if ('to' in def) a.to = /^#[0-9a-f]{6}$/i.test(r.to || '') ? r.to.toLowerCase() : def.to;
    if ('path' in def)
      a.path = typeof r.path === 'string' && /^[^\s"'<>#]{1,100}$/.test(r.path) ? r.path : '';
    for (const k of ['orient', 'hide'])
      if (k in def) a[k] = typeof r[k] === 'boolean' ? r[k] : def[k];
    // Stagger: a group's layers (or a text's letters) each run it in turn.
    const st = num(r.stagger, 0, 60, 0);
    if (st > 0) a.stagger = st;
    // When it starts: on a click on, or the pointer over, this layer (or the
    // one `on` names); or after another layer's animations end. And how
    // long a loop waits before each run after the first.
    const id = (v) => (typeof v === 'string' && /^[A-Za-z_][\w.:-]{0,99}$/.test(v) ? v : null);
    if (r.trigger === 'click' || r.trigger === 'hover') {
      a.trigger = r.trigger;
      if (id(r.on)) a.on = r.on;
    } else if (id(r.afterLayer)) a.afterLayer = r.afterLayer;
    const ps = num(r.pause, 0, 600, 0);
    if (ps > 0) a.pause = ps;
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
// When each of a layer's animations starts, as { t, base, end }: t seconds
// after base (null: the file opening; else a SMIL event such as
// "logo.click"), and end, an event that stops it (a hover loop stops when
// the pointer leaves).
function animTimes(el, list = readAnims(el), seen = new Set()) {
  seen.add(el);
  const out = [];
  list.forEach((a, i) => {
    const prev = out[i - 1];
    if (a.trigger) {
      const on = (a.on && document.getElementById(a.on)?.id) || el.id || '';
      const base = on ? `${on}.${a.trigger === 'click' ? 'click' : 'mouseover'}` : null;
      const end = base && a.trigger === 'hover' && a.rep === 0 ? `${on}.mouseout` : null;
      out.push({ t: a.delay, base, end });
    } else if (a.after && prev) {
      out.push({ t: prev.t + animLength(list[i - 1]) + a.delay, base: prev.base, end: null });
    } else if (a.afterLayer) {
      // After the other layer's last animation to finish (its first run,
      // for one that loops forever), from the same start as that one.
      const other = document.getElementById(a.afterLayer);
      let base = null;
      let t = 0;
      if (other && doc.contains(other) && !seen.has(other) && other.hasAttribute('data-sc-anim')) {
        const theirs = readAnims(other);
        animTimes(other, theirs, seen).forEach((w, k) => {
          const e = w.t + animLength(theirs[k]);
          if (e >= t) [t, base] = [e, w.base];
        });
      }
      out.push({ t: t + a.delay, base, end: null });
    } else out.push({ t: a.delay, base: null, end: null });
  });
  return out;
}
// Animation a as it plays at time w (animTimes): its start event carried
// along for the SMIL to name.
const timed = (a, w) => ({ ...a, _base: w.base, _end: w.end });

// ---- Move along path --------------------------------------------------------------
// Shapes a layer can move along (as text can run along them).
const ROUTE_SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
// Can el move along `route`? Not along itself, or what holds it or is in it.
const routeFits = (el, route) =>
  !!route &&
  doc.contains(route) &&
  ROUTE_SHAPES.has(route.localName) &&
  !route.contains(el) &&
  !el.contains(route);
// The layer a Move along path follows, or null when it's gone.
function motionRoute(el, a) {
  const r = a.path && document.getElementById(a.path);
  return routeFits(el, r) ? r : null;
}
// The route's outline in el's parent's coordinates, as path data.
function motionD(el, route) {
  const P = el.parentNode && el.parentNode !== doc ? fullM(el.parentNode) : new DOMMatrix();
  const M = P.inverse().multiply(fullM(route));
  const T = (p) => {
    const q = new DOMPoint(p.x, p.y).matrixTransform(M);
    return { x: q.x, y: q.y };
  };
  return nodesD(
    shapeNodes(route).map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n) => ({ ...T(n), hin: n.hin && T(n.hin), hout: n.hout && T(n.hout) })),
    })),
  );
}
// The ids of the routes the saved file leaves out of sight.
function hiddenRoutes() {
  const ids = new Set();
  for (const el of doc.querySelectorAll('[data-sc-anim]'))
    for (const a of readAnims(el))
      if ((a.p === 'followPath' || a.p === 'morph') && a.hide && motionRoute(el, a))
        ids.add(a.path);
  return ids;
}

// ---- Morph ---------------------------------------------------------------------------
// Two outlines as paths SMIL can blend: the same commands, segment for
// segment, all curves. Sub-shapes pair up biggest with biggest (one with no
// partner grows from, or shrinks to, a point at its own centre); segments
// are split until both have as many; and the target turns and runs the way
// that lines its points up best with the start's.
const mLerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
// A subpath as cubic segments [p0, c1, c2, p1], a closed one with its
// closing segment.
function cubicSegs(sp) {
  const n = sp.nodes;
  const seg = (a, b) =>
    a.hout || b.hin
      ? [a, a.hout || a, b.hin || b, b]
      : [a, mLerp(a, b, 1 / 3), mLerp(a, b, 2 / 3), b];
  const segs = [];
  for (let i = 1; i < n.length; i++) segs.push(seg(n[i - 1], n[i]));
  if (sp.closed && n.length > 1) segs.push(seg(n.at(-1), n[0]));
  return segs.map((s) => s.map((p) => ({ x: p.x, y: p.y })));
}
function splitSeg([p0, c1, c2, p1]) {
  const a = mLerp(p0, c1, 0.5);
  const b = mLerp(c1, c2, 0.5);
  const c = mLerp(c2, p1, 0.5);
  const d = mLerp(a, b, 0.5);
  const e = mLerp(b, c, 0.5);
  const m = mLerp(d, e, 0.5);
  return [
    [p0, a, d, m],
    [m, e, c, p1],
  ];
}
const segLen = (s) =>
  Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y) +
  Math.hypot(s[2].x - s[1].x, s[2].y - s[1].y) +
  Math.hypot(s[3].x - s[2].x, s[3].y - s[2].y);
// Split the longest segments until there are n.
function growSegs(segs, n) {
  const out = [...segs];
  while (out.length < n) {
    let k = 0;
    out.forEach((s, i) => {
      if (segLen(s) > segLen(out[k])) k = i;
    });
    out.splice(k, 1, ...splitSeg(out[k]));
  }
  return out;
}
const reverseSegs = (segs) => segs.map(([a, b, c, d]) => [d, c, b, a]).reverse();
const subSize = (segs) => {
  const xs = segs.flat().map((p) => p.x);
  const ys = segs.flat().map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};
const subCentre = (segs) => {
  const pts = segs.map((s) => s[0]);
  return {
    x: pts.reduce((t, p) => t + p.x, 0) / pts.length,
    y: pts.reduce((t, p) => t + p.y, 0) / pts.length,
  };
};
// b turned (if closed) and run the way that puts its points nearest a's.
function alignSegs(a, b, closed) {
  let best = b;
  let cost = Infinity;
  for (const cand of [b, reverseSegs(b)])
    for (let r = 0; r < (closed ? cand.length : 1); r++) {
      const rot = [...cand.slice(r), ...cand.slice(0, r)];
      const c = rot.reduce(
        (t, s, i) => t + (s[0].x - a[i][0].x) ** 2 + (s[0].y - a[i][0].y) ** 2,
        0,
      );
      if (c < cost) [best, cost] = [rot, c];
    }
  return best;
}
// [from, to] path data blending subpaths `from` into `to`, or null.
function morphD(from, to) {
  const subs = (list) =>
    list
      .map((sp) => ({ closed: sp.closed, segs: cubicSegs(sp) }))
      .filter((s) => s.segs.length)
      .sort((x, y) => subSize(y.segs) - subSize(x.segs));
  const A = subs(from);
  const B = subs(to);
  if (!A.length || !B.length) return null;
  const dot = (s) => {
    const c = subCentre(s.segs);
    return { closed: s.closed, segs: [[c, c, c, c]] };
  };
  while (A.length < B.length) A.push(dot(B[A.length]));
  while (B.length < A.length) B.push(dot(A[B.length]));
  const P = (p) => `${fp(p.x)} ${fp(p.y)}`;
  const out = ['', ''];
  A.forEach((a, i) => {
    const b = B[i];
    const closed = a.closed && b.closed;
    const n = Math.max(a.segs.length, b.segs.length);
    const sa = growSegs(a.segs, n);
    const sb = alignSegs(sa, growSegs(b.segs, n), closed);
    [sa, sb].forEach((segs, k) => {
      out[k] +=
        `M${P(segs[0][0])}` +
        segs.map((s) => `C${P(s[1])} ${P(s[2])} ${P(s[3])}`).join('') +
        (closed ? 'Z' : '');
    });
  });
  return out;
}
// The target's outline in el's own coordinates, as subpaths.
function morphTarget(el, target) {
  const M = fullM(el).inverse().multiply(fullM(target));
  const T = (p) => {
    const q = new DOMPoint(p.x, p.y).matrixTransform(M);
    return { x: q.x, y: q.y };
  };
  return shapeNodes(target).map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({ ...T(n), hin: n.hin && T(n.hin), hout: n.hout && T(n.hout) })),
  }));
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
      const [px, py] = {
        centre: [cx, cy],
        top: [cx, b.y],
        bottom: [cx, b.y + b.height],
        left: [b.x, cy],
        right: [b.x + b.width, cy],
      }[a.pivot] || [cx, cy];
      const r = (deg) => `${f(deg)} ${f(px)} ${f(py)}`;
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
  if (def.text && el.localName !== 'text') return `${def.name} needs a text layer.`;
  if (p === 'flipbook' && (el.localName !== 'g' || staggerKids(el).length < 2))
    return 'Flipbook needs a group of two or more layers: its frames, bottom one first.';
  if (p === 'morph') {
    if (el.localName !== 'path')
      return 'Morph needs a shape: a path, rectangle, circle, ellipse, line or polygon.';
    if (!(a && motionRoute(el, a)))
      return 'Morph needs the shape to become: select the layer, then Shift-click that shape above it.';
  }
  if (p === 'followPath' && !(a && motionRoute(el, a)))
    return 'Move along path needs a path: select the layer, then Shift-click the path above it.';
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
// ---- Effects round a layer (Wipe in, Iris in, Blur in, Glow pulse, Shine) ----------
// These need a clip, filter or mask from <defs>, on a group wrapped round the
// layer (Shine also puts its highlight in that group). Save and ▶ Play make
// them, all marked data-sc-gen, so reopening the file takes them off again.
let genSeq = 0;
function genId() {
  let id;
  do id = `sc-gen-${++genSeq}`;
  while (document.getElementById(id));
  return id;
}
const genEl = (tag, attrs = {}, kids = []) => {
  const n = mk(tag, { ...attrs, 'data-sc-gen': '' });
  n.append(...kids);
  return n;
};
// What wraps the layer for animation a: { defs, attrs (for the wrapping
// group), overlay? (Shine's highlight), under? (drawn below the layer:
// Ripple's rings), use? (a <use> to point at the layer) }.
function wrapParts(el, a, preview, start) {
  const m = fullM(el);
  const k = Math.hypot(m.a, m.b) || 1;
  const nodes = (channels) => chanNodes(a, channels, preview, start, []);
  const anim = (name, values) => ({ tag: 'animate', attrs: { attributeName: name }, values });
  // An entrance waiting for its delay starts as it will begin.
  const waitAs = (name, value) => {
    if (!((start > 0 || a._base) && ANIM_PRESETS[a.p].enter)) return [];
    const n = mk('set', { attributeName: name, to: value, begin: preview ? 'indefinite' : '0s' });
    n.dataset.scBegin = 0;
    return [n];
  };
  // The layer's box, in the space it sits in.
  const box = () => {
    const b = el.getBBox();
    const own = getM(el);
    const pts = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(own));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  };
  // A box over the layer filled with paint (a gradient or pattern), masked
  // by the layer itself, so it only colours the layer.
  const masked = (paint) => {
    const use = genEl('use');
    const mask = genEl('mask', { id: genId(), 'mask-type': 'alpha' }, [use]);
    const b = box();
    const overlay = genEl('rect', {
      x: f(b.x),
      y: f(b.y),
      width: f(b.width),
      height: f(b.height),
      fill: `url(#${paint.id})`,
      mask: `url(#${mask.id})`,
      'pointer-events': 'none',
    });
    return { defs: [paint, mask], attrs: {}, overlay, use };
  };
  // A paint's transform slid d along, after the transform it has.
  const slide = (name, d) => ({
    tag: 'animateTransform',
    attrs: { attributeName: name, type: 'translate', additive: 'sum' },
    values: ['0 0', `${f(d)} 0`],
  });
  switch (a.p) {
    case 'wipeIn': {
      // A clip box (in the layer's bounding-box units, a little larger, for
      // strokes) growing from one side.
      const grow = {
        left: { width: ['0', '1.2'] },
        right: { x: ['1.1', '-0.1'], width: ['0', '1.2'] },
        top: { height: ['0', '1.2'] },
        bottom: { y: ['1.1', '-0.1'], height: ['0', '1.2'] },
      }[a.from];
      const rect = genEl('rect', { x: '-0.1', y: '-0.1', width: '1.2', height: '1.2' });
      rect.append(
        ...waitAs('width' in grow ? 'width' : 'height', '0'),
        ...nodes(Object.entries(grow).map(([n, v]) => anim(n, v))),
      );
      const clip = genEl('clipPath', { id: genId(), clipPathUnits: 'objectBoundingBox' }, [rect]);
      return { defs: [clip], attrs: { 'clip-path': `url(#${clip.id})` } };
    }
    case 'irisIn': {
      const c = genEl('circle', { cx: '0.5', cy: '0.5', r: '0.75' });
      c.append(...waitAs('r', '0'), ...nodes([anim('r', ['0', '0.75'])]));
      const clip = genEl('clipPath', { id: genId(), clipPathUnits: 'objectBoundingBox' }, [c]);
      return { defs: [clip], attrs: { 'clip-path': `url(#${clip.id})` } };
    }
    case 'blurIn': {
      const sd = f(a.size / k);
      const blur = genEl('feGaussianBlur', { stdDeviation: '0' });
      blur.append(...waitAs('stdDeviation', sd), ...nodes([anim('stdDeviation', [sd, '0'])]));
      const filter = genEl(
        'filter',
        { id: genId(), x: '-50%', y: '-50%', width: '200%', height: '200%' },
        [blur],
      );
      return { defs: [filter], attrs: { filter: `url(#${filter.id})` } };
    }
    case 'glowPulse': {
      // A blur of its outline, in the glow colour, under the layer; only the
      // colour's opacity moves.
      const flood = genEl('feFlood', {
        'flood-color': a.to,
        'flood-opacity': '0',
        result: 'colour',
      });
      flood.append(...nodes([anim('flood-opacity', ['0', '1'])]));
      const filter = genEl(
        'filter',
        { id: genId(), x: '-50%', y: '-50%', width: '200%', height: '200%' },
        [
          genEl('feGaussianBlur', {
            in: 'SourceAlpha',
            stdDeviation: f(a.size / k),
            result: 'soft',
          }),
          flood,
          genEl('feComposite', { in: 'colour', in2: 'soft', operator: 'in', result: 'glow' }),
          genEl('feMerge', {}, [
            genEl('feMergeNode', { in: 'glow' }),
            genEl('feMergeNode', { in: 'SourceGraphic' }),
          ]),
        ],
      );
      return { defs: [filter], attrs: { filter: `url(#${filter.id})` } };
    }
    case 'shine': {
      // A soft white band, off to the left at rest, swept across a box over
      // the layer; masked by the layer itself, so it only lights the layer.
      const grad = genEl(
        'linearGradient',
        {
          id: genId(),
          x1: '0',
          y1: '0',
          x2: '1',
          y2: '0.35',
          gradientTransform: 'translate(-1 0)',
        },
        [
          genEl('stop', { offset: '0.3', 'stop-color': '#ffffff', 'stop-opacity': '0' }),
          genEl('stop', { offset: '0.5', 'stop-color': '#ffffff', 'stop-opacity': '0.65' }),
          genEl('stop', { offset: '0.7', 'stop-color': '#ffffff', 'stop-opacity': '0' }),
        ],
      );
      grad.append(
        ...nodes([
          {
            tag: 'animateTransform',
            attrs: { attributeName: 'gradientTransform', type: 'translate' },
            values: ['-1 0', '1 0'],
          },
        ]),
      );
      return masked(grad);
    }
    case 'ripple': {
      // Two rings round its centre, half a run apart, each growing from the
      // layer's size and fading; under the layer, unseen at rest.
      const b = box();
      const r0 = Math.max(b.width, b.height) / 2;
      const r1 = (r0 * a.scale) / 100;
      const half = (a.dur * (a.dir === 'alternate' ? 2 : 1) + (a.pause || 0)) / 2;
      const ring = (t) => {
        const c = genEl('circle', {
          cx: f(b.x + b.width / 2),
          cy: f(b.y + b.height / 2),
          r: f(r0),
          fill: 'none',
          stroke: a.to,
          'stroke-width': f(a.size),
          opacity: '0',
        });
        c.append(
          ...chanNodes(
            a,
            [anim('r', [f(r0), f(r1)]), anim('opacity', ['1', '0'])],
            preview,
            start + t,
            [],
          ),
        );
        return c;
      };
      const under = genEl('g', { 'pointer-events': 'none' }, [ring(0), ring(half)]);
      return { defs: [], attrs: {}, under };
    }
    case 'gradientFlow': {
      // Its colour, the second and back, repeating; slid one band along.
      const b = box();
      const L = Math.max(b.width, b.height) || 1;
      const from = hex(getComputedStyle(el).fill || '') || '#000000';
      const grad = genEl(
        'linearGradient',
        {
          id: genId(),
          gradientUnits: 'userSpaceOnUse',
          x1: '0',
          y1: '0',
          x2: f(L),
          y2: '0',
          spreadMethod: 'repeat',
          gradientTransform: `translate(${f(b.x)} ${f(b.y)}) rotate(${f(a.angle)})`,
        },
        [
          genEl('stop', { offset: '0', 'stop-color': from }),
          genEl('stop', { offset: '0.5', 'stop-color': a.to }),
          genEl('stop', { offset: '1', 'stop-color': from }),
        ],
      );
      grad.append(...nodes([slide('gradientTransform', L)]));
      return masked(grad);
    }
    case 'patternScroll': {
      // Stripes, a stripe and a gap to a tile, slid one tile along.
      const w = Math.max(a.size, 0.5);
      const pat = genEl(
        'pattern',
        {
          id: genId(),
          patternUnits: 'userSpaceOnUse',
          width: f(2 * w),
          height: f(2 * w),
          patternTransform: `rotate(${f(a.angle)})`,
        },
        [genEl('rect', { width: f(w), height: f(2 * w), fill: a.to })],
      );
      pat.append(...nodes([slide('patternTransform', 2 * w)]));
      return masked(pat);
    }
  }
  return null;
}
// Wrap host (layer el itself, or its copy being saved) for animation a: the
// parts' defs go to addDef, a group goes round host. { top, nodes, undo }:
// the group, the SMIL in it all, and how to take it off again (the preview).
function wrapLayer(el, host, a, preview, start, addDef) {
  const parts = wrapParts(el, a, preview, start);
  if (!parts) return null;
  const g = genEl('g', parts.attrs);
  if (host.parentNode) host.before(g);
  g.append(host);
  if (parts.overlay) g.append(parts.overlay);
  if (parts.under) g.prepend(parts.under);
  let madeId = false;
  if (parts.use) {
    if (!host.id) {
      host.id = genId();
      host.setAttribute('data-sc-gen-id', '');
      madeId = true;
    }
    parts.use.setAttribute('href', `#${host.id}`);
  }
  for (const d of parts.defs) addDef(d);
  const nodes = [...parts.defs, parts.under]
    .filter(Boolean)
    .flatMap((d) =>
      [...d.querySelectorAll('*')].filter((n) => ANIM_KEY_TAGS.includes(n.localName)),
    );
  return {
    top: g,
    nodes,
    undo: () => {
      if (g.parentNode) g.replaceWith(host);
      for (const d of parts.defs) d.remove();
      if (madeId) {
        host.removeAttribute('id');
        host.removeAttribute('data-sc-gen-id');
      }
    },
  };
}

// Where `at` points under root (the layer, live or a copy being saved).
function animHost(root, at, letters) {
  if (!at) return root;
  if ('child' in at) return root.children[at.child] || null;
  if (!letters.has(root)) letters.set(root, splitLetters(root));
  return letters.get(root)[at.letter] || null;
}

// Saving: each animated layer's copy gets its SMIL. `live` is the layer in
// the drawing (for its geometry), `copy` the clone being written out;
// addDef takes what goes in the file's <defs>. Returns what to write in
// copy's place (a group wrapped round it, for Wipe in and the like).
function writeAnimations(live, copy, on, addDef = () => {}) {
  for (const n of copy.querySelectorAll('[data-sc-preview]')) n.remove();
  if (!on) return copy;
  const pick = (root) =>
    [root, ...root.querySelectorAll('[data-sc-anim]')].filter((e) =>
      e.hasAttribute?.('data-sc-anim'),
    );
  const lives = pick(live);
  const copies = pick(copy);
  const letters = new Map();
  lives.forEach((el, i) => {
    const list = readAnims(el);
    const times = animTimes(el, list);
    list.forEach((a0, j) => {
      const a = timed(a0, times[j]);
      const start = times[j].t;
      if (ANIM_PRESETS[a.p].wrap) {
        const w = copies[i] && wrapLayer(el, copies[i], a, false, start, addDef);
        for (const n of w?.nodes || []) delete n.dataset.scBegin;
        return;
      }
      for (const { at: where, nodes } of animEmit(el, a, false, start)) {
        const host = copies[i] && animHost(copies[i], where, letters);
        for (const n of nodes) {
          delete n.dataset.scBegin;
          // On a layer inside it, or a letter: dropped when the file reopens.
          if (where) n.setAttribute('data-sc-gen', '');
          host?.append(n);
        }
      }
    });
  });
  let top = copy;
  while (top.parentNode?.hasAttribute?.('data-sc-gen')) top = top.parentNode;
  return top;
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
  // A click on, or the pointer over, an element: "logo.click+0.5s".
  const ev = /^([A-Za-z_][\w.:-]*)\.(click|mouseover)\s*(?:\+\s*(\S+))?$/.exec(
    (a.begin || '').trim(),
  );
  const base = ev ? `${ev[1]}.${ev[2]}` : null;
  const begin = ev
    ? ev[3]
      ? smilClock(ev[3])
      : 0
    : a.begin == null || a.begin.trim() === ''
      ? 0
      : smilClock(a.begin);
  const dur = smilClock(a.dur);
  if (!(begin >= 0) || !(dur > 0)) return null;
  let rep = 1;
  if (a.repeatCount === 'indefinite' || a.repeatDur === 'indefinite') rep = 0;
  else if (a.repeatCount != null) rep = +a.repeatCount;
  else if (a.repeatDur != null) rep = smilClock(a.repeatDur) / dur;
  if (rep !== 0 && !(Math.abs(rep - Math.round(rep)) < 1e-6 && rep >= 1)) return null;
  return { begin, dur, rep: Math.round(rep), base };
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
  if (g.base !== c.base) return false;
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
  if (rot && fwd(rot)) {
    // Swing: its widest angle, and the point it turns about.
    const v = fwd(rot);
    o.angle = Math.max(...v.map((x) => Math.abs(x[0])));
    const b = el.getBBox();
    const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
    const at = {
      centre: [cx, cy],
      top: [cx, b.y],
      bottom: [cx, b.y + b.height],
      left: [b.x, cy],
      right: [b.x + b.width, cy],
    };
    o.pivot = Object.keys(at).reduce((best, k) =>
      Math.hypot(at[k][0] - v[0][1], at[k][1] - v[0][2]) <
      Math.hypot(at[best][0] - v[0][1], at[best][1] - v[0][2])
        ? k
        : best,
    );
  }
  const sk = chs.find((c) => c.type === 'skewX');
  if (sk && fwd(sk)) o.angle = Math.max(...fwd(sk).map((x) => Math.abs(x[0])));
  const sc = chs.find((c) => c.type === 'scale');
  if (sc && fwd(sc)) {
    o.scale = Math.max(...fwd(sc).map((v) => v[0])) * 100;
    o.axis = fwd(sc).some((v) => !smilNear(v[0], 1)) ? 'vertical' : 'horizontal';
  }
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
  // Stroke pulse: its widest, against the width it starts at.
  const sw = chs.find((c) => c.name === 'stroke-width');
  if (sw && fwd(sw) && fwd(sw)[0][0] > 0)
    o.scale = (Math.max(...fwd(sw).map((v) => v[0])) / fwd(sw)[0][0]) * 100;
  const col = chs.find((c) => c.name === 'fill');
  if (col && fwd(col)) o.to = fwd(col).at(-1);
  return o;
}
// An <animate> of a path's d as Morph (or null): from the path's own outline
// to the one it ends on (the middle one, run back and forth), which becomes
// a layer beside it, in the same place.
function smilMorph(el, a) {
  const t = smilTiming(a);
  if (!t || a.calcMode === 'discrete') return null;
  let vals = a.values ? a.values.split(';').map((v) => v.trim()) : [a.from, a.to];
  vals = vals.filter(Boolean);
  let dir = 'normal';
  let dur = t.dur;
  if (vals.length === 3 && vals[0] === vals[2]) {
    dir = 'alternate';
    dur /= 2;
  } else if (vals.length !== 2) return null;
  const end = vals[1];
  try {
    if (!parsePathD(end).length) return null;
  } catch {
    return null;
  }
  const target = mk('path', {
    d: end,
    fill: el.getAttribute('fill') || '#000000',
    'data-name': 'Morph target',
  });
  if (el.hasAttribute('transform')) target.setAttribute('transform', el.getAttribute('transform'));
  el.before(target);
  return {
    p: 'morph',
    dur,
    delay: t.begin,
    rep: t.rep,
    dir,
    ease:
      a.calcMode === 'spline'
        ? smilEase({ calc: 'spline', spline: smilNums((a.keySplines || '').split(';')[0]) })
        : 'linear',
    path: ensureId(target, 'morph-to'),
    hide: true,
  };
}
// An <animateMotion> as Move along path: { anim, used } (used: the fixed
// shift SVGCraft writes alongside, from the pool), or null. Its path becomes
// a new layer beside el, in the same space the motion moves it in.
function smilMotion(el, a, pool) {
  const t = smilTiming(a);
  if (!t || a.calcMode === 'discrete') return null;
  let d = a.path;
  if (!d && a.values) {
    const pts = a.values
      .split(';')
      .filter((v) => v.trim())
      .map(smilNums);
    if (pts.length < 2 || pts.some((p) => p.length < 2 || p.some((x) => !isFinite(x)))) return null;
    d = `M${pts.map((p) => `${p[0]} ${p[1]}`).join('L')}`;
  } else if (!d && a.to) {
    const from = smilNums(a.from || '0 0');
    d = `M${from[0] || 0} ${from[1] || 0}L${smilNums(a.to).slice(0, 2).join(' ')}`;
  }
  let subs;
  try {
    subs = d ? parsePathD(d) : [];
  } catch {
    return null;
  }
  if (!subs.length || !subs.some((sp) => sp.nodes.length > 1)) return null;
  // Its direction, from keyPoints (fractions of the way along).
  const kp = a.keyPoints ? smilNums(a.keyPoints.replace(/;/g, ' ')) : [0, 1];
  const kt = a.keyTimes ? smilNums(a.keyTimes.replace(/;/g, ' ')) : null;
  const is = (x, y) => x.length === y.length && x.every((v, i) => smilNear(v, y[i]));
  let dir;
  let dur = t.dur;
  if (is(kp, [0, 1])) dir = 'normal';
  else if (is(kp, [1, 0])) dir = 'reverse';
  else if (is(kp, [0, 1, 0]) && kt && is(kt, [0, 0.5, 1])) {
    dir = 'alternate';
    dur /= 2;
  } else return null;
  const turn = (a.rotate || '0').trim();
  const orient = turn === 'auto' || turn === 'auto-reverse';
  if (!orient && +turn !== 0) return null;
  // Where el's centre is, in its parent's space, and the fixed shift
  // SVGCraft writes to put it on the line (when it's there, the path is
  // the route itself; otherwise the motion moved el from where it sits).
  const b = el.getBBox();
  const own = getM(el);
  const c = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(own);
  const lin = new DOMMatrix([own.a, own.b, own.c, own.d, 0, 0]);
  const v = new DOMPoint(-c.x, -c.y).matrixTransform(lin.inverse());
  const used = pool.find(
    (ch) =>
      ch.type === 'translate' &&
      ch.additive &&
      smilNear(ch.begin, t.begin) &&
      smilNear(ch.dur, t.dur) &&
      ch.rep === t.rep &&
      ch.values.every((p) => smilNear(p[0], v.x) && smilNear(p[1], v.y)),
  );
  // Turning about el's own place only matches when that's its centre.
  if (!used && orient && Math.hypot(c.x, c.y) > 0.5) return null;
  const T = used ? (p) => p : (p) => ({ x: p.x + c.x, y: p.y + c.y });
  const route = mk('path', {
    d: nodesD(
      subs.map((sp) => ({
        closed: sp.closed,
        nodes: sp.nodes.map((n) => ({
          ...T(n),
          hin: n.hin && T(n.hin),
          hout: n.hout && T(n.hout),
        })),
      })),
    ),
    fill: 'none',
    stroke: '#999999',
    'stroke-width': f(1 / (Math.hypot(parentM(el).a, parentM(el).b) || 1)),
    'data-name': 'Motion path',
  });
  el.before(route);
  return {
    anim: {
      p: 'followPath',
      dur,
      delay: t.begin,
      rep: t.rep,
      dir,
      ease:
        a.calcMode === 'spline'
          ? smilEase({ calc: 'spline', spline: smilNums((a.keySplines || '').split(';')[0]) })
          : 'linear',
      path: ensureId(route, 'motion-path'),
      orient,
      hide: true,
    },
    used,
  };
}
// A layer's noted SMIL as presets: { anims, lost }.
function smilToAnims(el, notes, own) {
  let lost = 0;
  const sets = notes.filter((n) => n.tag === 'set');
  let pool = [];
  for (const n of notes) {
    if (n.tag === 'set' || n.tag === 'animateMotion' || n.attrs.attributeName === 'd') continue;
    const c = smilChannel(n, el);
    if (c) pool.push(c);
    else lost++;
  }
  const anims = [];
  // An outline changing: Morph, into a layer of its own made from the
  // outline it ends on.
  for (const n of notes) {
    if (n.tag !== 'animate' || n.attrs.attributeName !== 'd') continue;
    const m = el.localName === 'path' && smilMorph(el, n.attrs);
    if (m) anims.push(m);
    else lost++;
  }
  // Motion along a path: Move along path, its route a layer of its own.
  for (const n of notes) {
    if (n.tag !== 'animateMotion') continue;
    const m = smilMotion(el, n.attrs, pool);
    if (!m) {
      lost++;
      continue;
    }
    if (m.used) pool = pool.filter((c) => c !== m.used);
    anims.push(m.anim);
  }
  const setsUsed = new Set();
  while (pool.length) {
    const first = pool[0];
    const peers = pool.filter(
      (c) =>
        smilNear(c.begin, first.begin) &&
        smilNear(c.dur, first.dur) &&
        c.rep === first.rep &&
        c.base === first.base,
    );
    // A pause between runs: the last value held to the end of each.
    const n = first.values.length;
    const same = (x, y) => (typeof x === 'string' ? x === y : x.every((v, i) => smilNear(v, y[i])));
    const hold =
      n >= 3 && same(first.values[n - 1], first.values[n - 2]) && first.kt[n - 2] < 0.999
        ? first.dur * (1 - first.kt[n - 2])
        : 0;
    // Started by a click or the pointer: on which layer.
    const [onId, evt] = first.base ? first.base.split(/\.(?=[^.]+$)/) : [];
    const timing = first.base
      ? {
          trigger: evt === 'click' ? 'click' : 'hover',
          ...(onId !== el.id ? { on: onId } : {}),
        }
      : {};
    // Every preset that writes these channels; the one whose <set>s (an
    // entrance starting hidden, a line's dashes) are the file's wins, as a
    // reversed Fade in writes what a Fade out does, but for its <set>.
    let found = null;
    for (const pause of hold ? [hold, 0] : [0])
      for (const dir of ['normal', 'alternate', 'reverse']) {
        // The options, read off one run without its pause.
        const run = (c) =>
          pause
            ? {
                ...c,
                values: c.values.slice(0, -1),
                kt: c.kt.slice(0, -1).map((t) => (t * c.dur) / (c.dur - pause)),
                dur: c.dur - pause,
              }
            : c;
        const opts = smilOptions(peers.map(run), dir, el);
        for (const p of Object.keys(ANIM_PRESETS)) {
          const def = ANIM_PRESETS[p];
          const a = {
            p,
            dur: (first.dur - pause) / (dir === 'alternate' ? 2 : 1),
            delay: first.begin,
            rep: first.rep,
            dir,
            ease: smilEase(first),
            ...timing,
            ...(pause ? { pause } : {}),
          };
          for (const k of ['from', 'dist', 'turns', 'scale', 'to', 'angle', 'pivot', 'axis'])
            if (k in def && opts[k] != null) a[k] = opts[k];
          if (animUnfit(el, p, a)) continue;
          const ta = {
            ...a,
            _base: first.base,
            _end: first.base && a.trigger === 'hover' && a.rep === 0 ? `${onId}.mouseout` : null,
          };
          const gen = animNodes(el, ta, false, a.delay).map((n) => ({
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
          // The preset that accounts for most of the file's elements wins (a Roll in,
          // not a Slide in and a Spin), then the one matching its <set>s best.
          const score = used.length * 100 + setHits.length - extra;
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
  if ('pivot' in a)
    choose('pivot', 'Swing from ', {
      centre: 'Centre',
      top: 'Top',
      bottom: 'Bottom',
      left: 'Left',
      right: 'Right',
    });
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
      el.localName === 'g' ? 's between layers' : 's between letters',
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
}
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
    ['afterLayer', 'After another layer'],
  ])
    start.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
  start.value = a.trigger || (a.afterLayer ? 'afterLayer' : '');
  out.push(field('Start ', start));
  const layers = pickable();
  if (a.trigger) {
    const on = pickOptions(
      layers.filter((n) => n !== el),
      a.on,
      'This layer',
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
      else if (k === 'trigger') {
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
          else warn('Start after another layer needs another animated layer.');
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
