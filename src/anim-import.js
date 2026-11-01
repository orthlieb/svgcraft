// SVGCraft — Animations in opened files: SMIL read back into presets, and
// the report of what couldn't be kept, and why.
'use strict';

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
// ---- what couldn't be kept, and why --------------------------------------------
// Each animation left out is noted as { where, what, why, near? }: the layer
// (or part of the file) it was on, its markup, the reason, and the preset
// that came nearest with how it differs. The More info link in the
// warning shows them (reportSmil).
function smilMarkup(tag, attrs) {
  const q = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const out = `<${tag}${Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${q(v)}"`)
    .join('')}/>`;
  return out.length > 600 ? `${out.slice(0, 600)}…` : out;
}
// A file's element as a short name: its layer name, id or tag.
function smilWhere(el) {
  if (!el) return 'The file';
  if (doc.contains(el)) return `Object “${layerName(el)}”`;
  const name = el.getAttribute?.('data-name') || el.id;
  return name ? `<${el.localName}> “${name}”` : `<${el.localName}>`;
}
// Why a SMIL element couldn't be read at all (smilChannel gave null).
function smilUnreadable({ tag, attrs: a }) {
  if (tag === 'set') return 'It sets a value at a moment; no preset writes that on its own.';
  if (!smilTiming(a)) {
    const t = ['begin', 'dur', 'repeatCount', 'repeatDur']
      .filter((k) => a[k] != null)
      .map((k) => `${k}="${a[k]}"`)
      .join(' ');
    return `Its timing (${t || 'no dur'}) isn’t one SVGCraft can set: it needs a length (dur), a start in seconds or on a click or hover, and a whole number of repeats or forever.`;
  }
  if (a.values == null && a.to == null && a.by == null)
    return 'It has no values, to or by: nothing to animate between.';
  return `Its values (${a.values ?? `${a.from ?? '(current)'} → ${a.to ?? `by ${a.by}`}`}) aren’t numbers or a colour SVGCraft can read for ${a.attributeName || 'that attribute'}.`;
}
// One channel's values, for reading: "0 70 30 → 360 70 30".
const smilShow = (c) =>
  c.values.map((v) => (typeof v === 'string' ? v : v.map((x) => f(x)).join(' '))).join(' → ');
// What a channel changes: "rotate (transform)", "opacity".
const smilWhat = (c) => (c.type ? `${c.type} (${c.name})` : c.name);
// How file channel g differs from what preset channel c writes, or null
// when they're the same (see smilSame).
function smilDiff(g, c, own, name) {
  if (c.type && !g.additive && own)
    return `It replaces the object’s own transform (it has no additive="sum") on an object that already has one; ${name} adds to it.`;
  if (g.base !== c.base) return `It starts on ${g.base || 'opening'}, not ${c.base || 'opening'}.`;
  if (!smilNear(g.dur, c.dur) || !smilNear(g.begin, c.begin) || g.rep !== c.rep)
    return `Its timing (${f(g.dur)} s from ${f(g.begin)} s, ${g.rep ? `${g.rep}×` : 'forever'}) isn’t what ${name} writes for it (${f(c.dur)} s from ${f(c.begin)} s, ${c.rep ? `${c.rep}×` : 'forever'}).`;
  if (g.calc !== c.calc) return `It’s ${g.calc}, where ${name} is ${c.calc}.`;
  if (g.values.length !== c.values.length)
    return `It has ${g.values.length} values (${smilShow(g)}); ${name} writes ${c.values.length} (${smilShow(c)}).`;
  for (let i = 0; i < g.values.length; i++) {
    const [a, b] = [g.values[i], c.values[i]];
    if (typeof a === 'string' ? a !== b : a.some((x, j) => !smilNear(x, b[j] ?? NaN))) {
      const why =
        g.type === 'rotate' && smilNear(a[0], b[0])
          ? ` It turns about (${f(a[1])}, ${f(a[2])}), not (${f(b[1])}, ${f(b[2])}).`
          : '';
      return `Its values are ${smilShow(g)}; ${name} would write ${smilShow(c)}.${why}`;
    }
    if (Math.abs(g.kt[i] - c.kt[i]) > 0.002)
      return `Its keyTimes (${g.kt.map(f).join('; ')}) aren’t ${name}’s (${c.kt.map(f).join('; ')}).`;
  }
  return null;
}
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
  // The pivot, as fractions of the layer's box: the point a turn is about,
  // or the one a grow keeps still (its shift is that point × (1 − scale)).
  const bb = el.getBBox();
  const frac = (x, y) => [
    Math.round(((x - bb.x) / (bb.width || 1)) * 1e4) / 1e4,
    Math.round(((y - bb.y) / (bb.height || 1)) * 1e4) / 1e4,
  ];
  const mv0 = chs.find((c) => c.type === 'translate');
  if (rot && fwd(rot) && fwd(rot)[0].length >= 3) o.origin = frac(fwd(rot)[0][1], fwd(rot)[0][2]);
  else if (sc && fwd(sc) && mv0 && fwd(mv0)?.length === fwd(sc).length) {
    const cen = [bb.x + bb.width / 2, bb.y + bb.height / 2];
    const at = [0, 1].map((axis) => {
      const i = fwd(sc).findIndex((v) => Math.abs(1 - (v[axis] ?? v[0])) > 0.01);
      return i < 0 ? cen[axis] : fwd(mv0)[i][axis] / (1 - (fwd(sc)[i][axis] ?? fwd(sc)[i][0]));
    });
    o.origin = frac(...at);
  }
  const mv = chs.find((c) => c.type === 'translate');
  // How far it goes (from the layer's place, or from where it starts), and
  // which way.
  const farthest = (vs) => vs.reduce((p, v) => (Math.hypot(...v) > Math.hypot(...p) ? v : p));
  const side = (v) =>
    Math.abs(v[0]) >= Math.abs(v[1]) ? (v[0] < 0 ? 'left' : 'right') : v[1] < 0 ? 'top' : 'bottom';
  const k = Math.hypot(fullM(el).a, fullM(el).b) || 1;
  let shifted = null;
  if (mv && fwd(mv)) {
    const far = farthest(fwd(mv));
    o.dist = Math.hypot(...far) * k;
    o.from = side(far);
    const v0 = fwd(mv)[0];
    if (Math.hypot(...v0) > 0.01) {
      const rel = farthest(fwd(mv).map((v) => [v[0] - v0[0], v[1] - v0[1]]));
      shifted = { dist: Math.hypot(...rel) * k, from: side(rel) };
    }
  }
  // Stroke pulse: its widest, against the width it starts at.
  const sw = chs.find((c) => c.name === 'stroke-width');
  if (sw && fwd(sw) && fwd(sw)[0][0] > 0)
    o.scale = (Math.max(...fwd(sw).map((v) => v[0])) / fwd(sw)[0][0]) * 100;
  const col = chs.find((c) => c.name === 'fill');
  if (col && fwd(col)) o.to = fwd(col).at(-1);
  // A move about another resting place (a bob from +5 to −5): the same
  // presets, measured from where it starts, with the layer shifted there.
  if (shifted) o.shifted = { ...o, ...shifted, shift: true };
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
  const lost = [];
  const where = smilWhere(el);
  const drop = (n, why, near) =>
    lost.push({ where, what: smilMarkup(n.tag, n.attrs), why, ...(near ? { near } : {}) });
  const sets = notes.filter((n) => n.tag === 'set');
  let pool = [];
  for (const n of notes) {
    if (n.tag === 'set' || n.tag === 'animateMotion' || n.attrs.attributeName === 'd') continue;
    const c = smilChannel(n, el);
    if (c) pool.push(Object.assign(c, { note: n }));
    else drop(n, smilUnreadable(n));
  }
  const anims = [];
  // An outline changing: Morph, into a layer of its own made from the
  // outline it ends on.
  for (const n of notes) {
    if (n.tag !== 'animate' || n.attrs.attributeName !== 'd') continue;
    const m = el.localName === 'path' && smilMorph(el, n.attrs);
    if (m) anims.push(m);
    else
      drop(
        n,
        el.localName === 'path'
          ? 'It changes the outline (d) between shapes Morph can’t rebuild: it needs at least two outlines it can read, as values or from / to.'
          : `It changes the outline (d) of a <${el.localName}>; Morph works on paths.`,
      );
  }
  // Motion along a path: Move along path, its route a layer of its own.
  for (const n of notes) {
    if (n.tag !== 'animateMotion') continue;
    const m = smilMotion(el, n.attrs, pool);
    if (!m) {
      drop(
        n,
        'It moves along a path in a way Move along path can’t rebuild: its timing, its path, or turning with the path about a point other than the object’s centre.',
      );
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
    // Should none fit: the preset that came nearest, and how it differs.
    let near = null;
    let wrote = false;
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
        const opts0 = smilOptions(peers.map(run), dir, el);
        for (const opts of [opts0, opts0.shifted].filter(Boolean))
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
            // A pivot of its own, if it isn't where the preset turns anyway.
            if (PIVOT_PRESETS.has(p) && opts.origin) {
              const [x, y] = animOrigin(a);
              if (Math.hypot(opts.origin[0] - x, opts.origin[1] - y) > 0.002)
                a.origin = opts.origin;
            }
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
            let chs = gen.filter((g) => g.tag !== 'set').map((g) => smilChannel(g, el));
            if (!chs.length || chs.some((c) => !c)) continue;
            // Shifted: its moves as they'd be with the layer moved by off.
            let off = null;
            if (opts.shift) {
              const ct = chs.find((c) => c.type === 'translate');
              if (first.type !== 'translate' || !ct) continue;
              off = [0, 1].map((i) => first.values[0][i] - ct.values[0][i]);
              if (Math.hypot(...off) < 0.01) continue;
              chs = chs.map((c) =>
                c.type === 'translate'
                  ? { ...c, values: c.values.map((v) => [v[0] + off[0], v[1] + off[1]]) }
                  : c,
              );
            }
            const used = [];
            for (const c of chs) {
              const m = peers.find((g) => !used.includes(g) && smilSame(g, c, own));
              if (!m) break;
              used.push(m);
            }
            if (used.length !== chs.length || !used.includes(first)) {
              if (off) continue;
              const c0 = chs.find(
                (c) => c.tag === first.tag && c.name === first.name && c.type === first.type,
              );
              if (!c0) continue;
              wrote = true;
              const ok = used.includes(first);
              // Closer: more of the file's elements matched, the same first
              // and last values, fewer extra elements of its own.
              const same = (x, y) =>
                typeof x === 'string' ? x === y : x.every((v, j) => smilNear(v, y[j] ?? NaN));
              const ends =
                same(first.values[0], c0.values[0]) + same(first.values.at(-1), c0.values.at(-1));
              const score = (ok ? 1000 : 0) + used.length * 10 + ends * 3 - chs.length;
              if (near && score <= near.score) continue;
              const miss = chs[used.length];
              const why = ok
                ? `it also writes ${smilWhat(miss)} (${smilShow(miss)}), which the file doesn’t have with it.`
                : smilDiff(first, c0, own, def.name) || 'it writes it differently.';
              near = {
                score,
                text: `${def.name}${dir === 'normal' ? '' : ` (${DIRS[dir]})`}: ${why}`,
              };
              continue;
            }
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
            const score = used.length * 100 + setHits.length - extra - (off ? 1 : 0);
            if (!found || score > found.score) found = { a, used, setHits, score, off };
          }
      }
    if (!found) {
      drop(
        first.note,
        wrote
          ? 'No preset writes exactly this.'
          : `No preset animates ${smilWhat(first)}${first.base ? ` started by ${first.base}` : ''}.`,
        near?.text,
      );
      pool = pool.slice(1);
      continue;
    }
    pool = pool.filter((c) => !found.used.includes(c));
    for (const i of found.setHits) setsUsed.add(i);
    if (found.off) setM(el, getM(el).translate(...found.off));
    anims.push(found.a);
  }
  sets.forEach((n, j) => {
    if (!setsUsed.has(j))
      drop(
        n,
        `It sets ${n.attrs.attributeName || 'a value'} at a moment (a <set>), which none of the presets kept here writes.`,
      );
  });
  anims.sort((x, y) => x.delay - y.delay);
  return { anims, lost };
}
// After a file is opened or placed: turn the noted SMIL on its layers
// (under roots) into presets. { kept, lost }, lost starting at the count
// the importer couldn't note at all.
function adoptSmil(roots, lost = []) {
  lost = [...lost];
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
        const why = el.parentNode?.closest?.('text')
          ? 'It animates part of some text (a run of its letters); SVGCraft animates whole objects, or their letters in turn with Stagger.'
          : doc.contains(el)
            ? 'It animates something inside an object, not an object of its own.'
            : 'It’s in a symbol or <defs>, not an object in the drawing.';
        for (const n of notes)
          lost.push({ where: smilWhere(el), what: smilMarkup(n.tag, n.attrs || {}), why });
        continue;
      }
      const r2 = smilToAnims(el, notes, !!note.own);
      lost.push(...r2.lost);
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
  if (lost.length)
    warn(
      `${n(lost.length, 'animation')} in this file can’t be edited in SVGCraft, so ${lost.length === 1 ? 'it was' : 'they were'} left out.` +
        (kept ? ` The other ${kept === 1 ? 'one is' : `${kept} are`} in the Animation tab.` : ''),
      { more: () => showSmilReport(lost, kept) },
    );
  else if (kept)
    say(
      `Kept the file’s ${n(kept, 'animation')}: edit ${kept === 1 ? 'it' : 'them'} in the Animation tab.`,
    );
}
// The More info dialog: each animation left out, where it was, its markup,
// why, and the preset that came nearest.
function smilReportText(lost, kept) {
  return [
    `Animations left out: ${lost.length}${kept ? ` (${kept} kept)` : ''}`,
    ...lost.map((e, i) =>
      [
        '',
        `${i + 1}. ${e.where}`,
        `   ${e.what}`,
        `   Why: ${e.why}`,
        ...(e.near ? [`   Nearest preset: ${e.near}`] : []),
      ].join('\n'),
    ),
  ].join('\n');
}
function showSmilReport(lost, kept) {
  const dlg = $('#sc-smil-report');
  $('#sc-smil-report-intro').textContent =
    `SVGCraft turns a file’s SVG animation into presets you can edit. ${
      lost.length === 1 ? 'This one didn’t match any' : `These ${lost.length} didn’t match any`
    }, so ${lost.length === 1 ? 'it was' : 'they were'} left out${
      kept ? `; the other ${kept} ${kept === 1 ? 'is' : 'are'} in the Animation tab` : ''
    }. Saving the drawing won’t write ${lost.length === 1 ? 'it' : 'them'}.`;
  $('#sc-smil-list').replaceChildren(
    ...lost.map((e) => {
      const li = document.createElement('li');
      const where = document.createElement('div');
      where.className = 'sc-smil-where';
      where.textContent = e.where;
      const what = document.createElement('code');
      what.className = 'sc-smil-what';
      what.textContent = e.what;
      const why = document.createElement('p');
      why.textContent = e.why;
      li.append(where, what, why);
      if (e.near) {
        const near = document.createElement('p');
        near.className = 'sc-smil-near';
        const b = document.createElement('strong');
        b.textContent = 'Nearest preset: ';
        near.append(b, e.near);
        li.append(near);
      }
      return li;
    }),
  );
  $('#sc-smil-report-copy').onclick = () =>
    navigator.clipboard.writeText(smilReportText(lost, kept)).then(
      () => say('Copied the report.'),
      () => say('Couldn’t reach the clipboard.'),
    );
  const close = () => hideDialog(dlg);
  $('#sc-smil-report-close').onclick = close;
  showDialog(dlg, close);
  $('#sc-smil-report-close').focus();
}
