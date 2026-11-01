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
// Presets that turn or grow about a point: the pivot, which can be dragged
// anywhere (`origin`: where, as fractions across and down the layer's box).
const PIVOT_PRESETS = new Set([
  'popIn',
  'zoomIn',
  'zoomOut',
  'spin',
  'pulse',
  'rollIn',
  'flipIn',
  'rubberBand',
  'tada',
  'headShake',
  'wobble',
  'swing',
  'heartbeat',
  'jello',
  'flip',
]);
// Swing's named pivots, as fractions of the box.
const PIVOT_AT = {
  centre: [0.5, 0.5],
  top: [0.5, 0],
  bottom: [0.5, 1],
  left: [0, 0.5],
  right: [1, 0.5],
};
// Where animation a turns about, as fractions of the layer's box.
const animOrigin = (a) => a.origin || PIVOT_AT[a.pivot] || PIVOT_AT.centre;
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
    if (
      PIVOT_PRESETS.has(r.p) &&
      Array.isArray(r.origin) &&
      r.origin.length === 2 &&
      r.origin.every((v) => v != null && isFinite(+v))
    )
      a.origin = r.origin.map((v) => Math.round(clamp(+v, -100, 100) * 1e4) / 1e4);
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
