// SVGCraft — Clipping masks.
'use strict';

// ---- clipping masks (Illustrator's Object → Clipping Mask) ---------------------
// A clipping group is <g data-sc-clip> whose clipper — a single shape or
// text, marked data-sc-clipper — stays inside it, hidden with
// visibility="hidden" (so it can still be measured, selected and edited, and
// keeps its own paint for Release). syncClips() keeps a <clipPath> (sc-clip-N,
// in defs) holding a copy of the clipper in step with it, so moving or
// reshaping the clipper moves the window, not the art. A clipper that leaves
// its group, or a group that loses its clipper, stops clipping.
const CLIP_SHAPES = ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text'];
// The clipping shape of a clipping group (the first marked direct child).
function clipperOf(g) {
  if (!g?.hasAttribute?.('data-sc-clip')) return null;
  for (const c of g.children)
    if (c.hasAttribute('data-sc-clipper') && CLIP_SHAPES.includes(c.localName)) return c;
  return null;
}
const clipRef = (g) => /^url\(#(sc-clip-\d+)\)$/.exec(g.getAttribute('clip-path') || '')?.[1];

// The clipper's geometry as clipPath content: same transform relative to
// the group (clipPathUnits="userSpaceOnUse" is the group's own space), with
// the font it inherits, and none of the editor's bookkeeping or anything that
// would hide it.
function clipCopy(cl) {
  const c = cl.cloneNode(true);
  bakeInherited(cl, c);
  for (const n of [c, ...c.querySelectorAll('*')]) {
    for (const a of [...n.attributes])
      if (a.name === 'id' || a.name.startsWith('data-')) n.removeAttribute(a.name);
  }
  for (const a of ['visibility', 'display', 'clip-path', 'mask', 'filter', 'opacity'])
    c.removeAttribute(a);
  for (const p of ['visibility', 'display', 'mix-blend-mode', 'isolation', 'opacity'])
    c.style.removeProperty(p);
  if (!c.getAttribute('style')) c.removeAttribute('style');
  if (getComputedStyle(cl).fillRule === 'evenodd') c.setAttribute('clip-rule', 'evenodd');
  return c;
}

function syncClips() {
  // A clipper outside a clipping group (or a second one in it) is an
  // ordinary shape again.
  for (const c of doc.querySelectorAll('[data-sc-clipper]'))
    if (clipperOf(c.parentNode) !== c) {
      c.removeAttribute('data-sc-clipper');
      if (c.getAttribute('visibility') === 'hidden') c.removeAttribute('visibility');
    }
  const owned = new Set();
  for (const g of doc.querySelectorAll('[data-sc-clip]')) {
    const cl = clipperOf(g);
    if (!cl) {
      g.removeAttribute('data-sc-clip');
      continue;
    }
    let id = clipRef(g);
    let host = id && defs.querySelector(`:scope > #${id}`);
    // A duplicated group still points at the original's clipPath: give it its own.
    if (!host || !host.hasAttribute('data-sc-clip') || owned.has(id)) {
      let n = 1;
      while (document.getElementById(`sc-clip-${n}`) || owned.has(`sc-clip-${n}`)) n++;
      id = `sc-clip-${n}`;
      host = mk('clipPath', { id, 'data-sc-clip': '', clipPathUnits: 'userSpaceOnUse' }, defs);
    }
    if (g.getAttribute('clip-path') !== `url(#${id})`) g.setAttribute('clip-path', `url(#${id})`);
    if (cl.getAttribute('visibility') !== 'hidden') cl.setAttribute('visibility', 'hidden');
    owned.add(id);
    const copy = clipCopy(cl);
    if (host.innerHTML !== copy.outerHTML) host.replaceChildren(copy);
  }
  for (const g of doc.querySelectorAll('[clip-path]')) {
    const id = clipRef(g);
    if (id && !owned.has(id)) g.removeAttribute('clip-path');
  }
  // Symbols (and layers set aside while editing one) may use it too.
  const kept = keptIds();
  for (const host of defs.querySelectorAll(':scope > clipPath[data-sc-clip]'))
    if (!owned.has(host.id) && !kept.has(host.id)) host.remove();
}
let clipQueued = false;
// Any change can reshape a clipper (geometry, transform, font, the text
// itself), and syncClips() only writes what differs, so watch everything.
new MutationObserver(() => {
  if (clipQueued) return;
  clipQueued = true;
  queueMicrotask(() => {
    clipQueued = false;
    syncClips();
  });
}).observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });

// Object → Clipping Mask → Make: the topmost selected layer clips the rest.
function makeClip() {
  const els = normalizeSel(state.sel);
  if (els.length < 2)
    return say('Select the art and, on top of it, the shape or text to clip it with.');
  const top = els.at(-1);
  if (!CLIP_SHAPES.includes(top.localName))
    return say(
      `The topmost selected layer (${layerName(top)}) must be a single shape or text to clip with.`,
    );
  if (refuseLocked(els, 'edit')) return;
  const g = mk('g', { 'data-name': 'Clipping group', 'data-sc-clip': '' });
  top.after(g);
  for (const el of els) reparent(el, g);
  top.setAttribute('data-sc-clipper', '');
  top.setAttribute('visibility', 'hidden');
  state.sel = [g];
  commit();
}

// Release: the group stays (as in Illustrator); the clipper shows again.
function releaseClip() {
  const groups = new Set();
  for (const el of state.sel) {
    const g = el.closest?.('[data-sc-clip]');
    if (g && doc.contains(g)) groups.add(g);
  }
  if (!groups.size) return say('Select a clipping group, or a layer in one, to release.');
  if (
    refuseLocked(
      [...groups].map((g) => clipperOf(g) || g),
      'edit',
    )
  )
    return;
  const out = [];
  for (const g of groups) {
    const cl = clipperOf(g);
    g.removeAttribute('data-sc-clip');
    g.removeAttribute('clip-path');
    if (g.getAttribute('data-name') === 'Clipping group')
      g.setAttribute('data-name', nextGroupName());
    if (cl) {
      cl.removeAttribute('data-sc-clipper');
      cl.removeAttribute('visibility');
    }
    out.push(g);
  }
  state.sel = out;
  commit();
}

// Blend mode (Photoshop's Layers-panel menu) is CSS mix-blend-mode on the
// layer. Groups also have Photoshop's Pass Through, their default: nothing
// set, so their layers blend with what's below the group. A group set to
// Normal is isolated (CSS isolation), so its layers blend only with each
// other; any other mode isolates it anyway.
const isGroupLayer = (el) => el?.localName === 'g';
function blendOf(el) {
  const m = el.style?.mixBlendMode;
  if (m && m !== 'normal') return m;
  if (!isGroupLayer(el)) return 'normal';
  return el.style?.isolation === 'isolate' ? 'normal' : 'pass-through';
}
function setBlend(el, mode) {
  el.style.removeProperty('mix-blend-mode');
  el.style.removeProperty('isolation');
  if (mode === 'normal' && isGroupLayer(el)) el.style.isolation = 'isolate';
  else if (mode && mode !== 'normal' && mode !== 'pass-through') el.style.mixBlendMode = mode;
  if (!el.getAttribute('style')) el.removeAttribute('style');
}
// Pass Through is only offered for groups.
function showPassThrough(select, el) {
  select.querySelector('[value="pass-through"]').hidden = !isGroupLayer(el);
}

function applyStyle(el, key) {
  if (key === 'opacity') {
    setPaintAttr(el, 'opacity', f(state.opacity), 1);
    return;
  }
  if (key === 'fill' && el.localName === 'text')
    for (const ts of el.querySelectorAll('tspan[data-run]')) {
      ts.removeAttribute('fill');
      ts.removeAttribute('fill-opacity');
    }
  for (const t of paintTargets(el)) {
    if (key === 'fill' || key === 'stroke') {
      t.style?.removeProperty(key);
      const grad = state[key + 'On'] && state[key + 'Grad'];
      const pat = state[key + 'On'] && state[key + 'Pat'];
      if (pat && t.matches(GRAD_SHAPES)) setPatPaint(t, key, pat, state[key]);
      else if (grad && t.matches(GRAD_SHAPES)) setGradPaint(t, key, grad);
      else if ((!grad && !pat) || t.localName === 'g')
        t.setAttribute(key, state[key + 'On'] ? state[key] : 'none');
      setPaintAttr(t, `${key}-opacity`, f(state[key + 'A']), 1);
    } else if (key === 'width') {
      const k = alignOf(t) === 'center' ? 1 : 2;
      setPaintAttr(t, 'stroke-width', f(state.strokeWidth * k));
      refreshDash(t);
    } else if (key === 'align') {
      if (t.localName !== 'g') setStrokeAlign(t, state.strokeAlign);
    } else if (key === 'cap') {
      setPaintAttr(t, 'stroke-linecap', state.cap, 'butt');
      refreshDash(t);
    } else if (key === 'join') {
      setPaintAttr(t, 'stroke-linejoin', state.join, 'miter');
    } else if (key === 'dash') {
      t.style?.removeProperty('stroke-dasharray');
      if (state.dash === 'solid') {
        t.removeAttribute('data-dash');
        t.removeAttribute('stroke-dasharray');
      } else if (state.dash !== 'custom') {
        t.setAttribute('data-dash', state.dash);
        refreshDash(t);
      } else if (state.dashPat.some((n) => n > 0)) {
        t.setAttribute('data-dash', state.dashPat.map(f).join(' '));
        refreshDash(t);
      }
    }
  }
}

function readStyle(el) {
  const shape = el.matches(SHAPE_SEL) ? el : el.querySelector(SHAPE_SEL);
  const ownCs = getComputedStyle(el);
  state.opacity = parseFloat(ownCs.opacity) || 0;
  if (shape) {
    const cs = getComputedStyle(shape);
    const fill = cs.fill;
    state.fillOn = !!fill && fill !== 'none';
    if (state.fillOn) state.fill = hex(fill) || state.fill;
    state.fillA = parseFloat(cs.fillOpacity) * colorAlpha(fill);
    state.fillGrad = gradFor(shape, 'fill');
    state.fillPat = patFor(shape, 'fill');
    if (state.fillPat) state.fill = patInk(shape, 'fill') || state.fill;
    const stroke = cs.stroke;
    state.strokeOn = !!stroke && stroke !== 'none';
    if (state.strokeOn) state.stroke = hex(stroke) || state.stroke;
    state.strokeA = parseFloat(cs.strokeOpacity) * colorAlpha(stroke);
    state.strokeGrad = gradFor(shape, 'stroke');
    state.strokePat = patFor(shape, 'stroke');
    if (state.strokePat) state.stroke = patInk(shape, 'stroke') || state.stroke;
    state.gradStop = 0;
    state.strokeWidth = strokeW(shape);
    state.strokeAlign = alignOf(shape);
    state.cap = cs.strokeLinecap || 'butt';
    state.join = cs.strokeLinejoin || 'miter';
    const dd = shape.getAttribute('data-dash');
    const raw = cs.strokeDasharray && cs.strokeDasharray !== 'none' ? cs.strokeDasharray : null;
    state.dash = customDash(dd) || (!dd && raw) ? 'custom' : dd || 'solid';
    if (customDash(dd)) state.dashPat = customDash(dd);
    else if (!dd && raw)
      state.dashPat = raw
        .split(/[\s,]+/)
        .map((v) => Math.round((parseFloat(v) / Math.max(state.strokeWidth, 0.25)) * 100) / 100);
  }
  syncStyleUI();
  syncLayerHead();
}

// Attributes for a newly drawn element. Line-ish tools never fill; if the
// stroke is switched off they borrow the fill colour so the mark shows.
function newStyle(kind) {
  const a = {};
  const lineish = kind === 'line' || kind === 'open';
  if (lineish) {
    a.fill = 'none';
    const alpha = state.strokeOn ? state.strokeA : state.fillA;
    a.stroke = state.strokeOn ? state.stroke : state.fill;
    if (alpha < 1) a['stroke-opacity'] = f(alpha);
    a['stroke-width'] = f(state.strokeWidth || 1);
    if (state.cap !== 'butt') a['stroke-linecap'] = state.cap;
    if (state.join !== 'miter') a['stroke-linejoin'] = state.join;
  } else {
    a.fill = state.fillOn ? state.fill : 'none';
    if (state.fillA < 1) a['fill-opacity'] = f(state.fillA);
    if (kind !== 'text' && state.strokeOn && state.strokeWidth > 0) {
      a.stroke = state.stroke;
      a['stroke-width'] = f(state.strokeWidth);
      if (state.cap !== 'butt') a['stroke-linecap'] = state.cap;
      if (state.join !== 'miter') a['stroke-linejoin'] = state.join;
      if (state.strokeA < 1) a['stroke-opacity'] = f(state.strokeA);
      if (kind === 'shape' && state.strokeAlign !== 'center') {
        a['data-stroke-align'] = state.strokeAlign;
        a['stroke-width'] = f(state.strokeWidth * 2);
        if (state.strokeAlign === 'outside') a['paint-order'] = 'stroke';
      }
    }
  }
  const dashKey =
    state.dash === 'custom' && state.dashPat.some((n) => n > 0)
      ? state.dashPat.map(f).join(' ')
      : ['dash', 'dot', 'long'].includes(state.dash) && state.dash;
  if (a.stroke && a.stroke !== 'none' && dashKey) {
    a['data-dash'] = dashKey;
    a['stroke-dasharray'] = dashArray(
      dashKey,
      state.strokeWidth || 1,
      a['stroke-linecap'] || 'butt',
    );
  }
  if (state.opacity < 1) a.opacity = f(state.opacity);
  return a;
}
